#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Sincroniza o formulário "Ações Preventivas" (Microsoft Forms, OneDrive da empresa) com o Supabase do GIGA+,
SEM Power Automate Premium e SEM cliente de sincronização do OneDrive.

  python sincronizar_forms.py login   -> entra uma vez na conta Microsoft da empresa (código de dispositivo)
  python sincronizar_forms.py sync    -> envia respostas novas/alteradas e fotos novas (rodar a cada ~10 min)
  python sincronizar_forms.py status  -> mostra o que já foi sincronizado
  python sincronizar_forms.py pasta <pasta-ou-zip>  -> MODO MANUAL, sem login Microsoft: envia o que você baixou do OneDrive pelo
                                                       navegador (planilha .xlsx, fotos soltas e/ou o .zip da pasta "Pergunta")

Obs.: se o administrador do tenant bloquear o app da Microsoft usado no "login" (erro AADSTS50105), use o modo "pasta".

Como funciona
  • Lê a planilha e a pasta "Pergunta" (fotos) pela Microsoft Graph, só com permissão de LEITURA (Files.Read).
  • Linhas  -> função SQL preventivas_receber (upsert pelo ID da resposta).
  • Fotos   -> Edge Function preventivas-foto (reduz, gira certo e grava no bucket público).
  • Guarda o que já enviou em estado.json: cada execução só manda o que é novo.

Arquivos locais (fora do projeto, nada de segredo vai para o Git): %APPDATA%\\preventivas-sync\\
  config.json       {"token": "<token do Power Automate/preventivas>", "sb_key": "<publishable key do Supabase>"}
  token_cache.bin   sessão Microsoft (renovada sozinha; vale ~90 dias de uso)
  estado.json       o que já foi enviado
  sync.log          histórico
"""
import base64, hashlib, io, json, os, sys, time, traceback, urllib.parse, urllib.request, urllib.error
import datetime as dt
from concurrent.futures import ThreadPoolExecutor

import msal
import openpyxl

PASTA = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'preventivas-sync')
os.makedirs(PASTA, exist_ok=True)
F_CONFIG, F_CACHE, F_ESTADO, F_LOG = (os.path.join(PASTA, n) for n in ('config.json', 'token_cache.bin', 'estado.json', 'sync.log'))

SB_URL = 'https://wdbhqsenyegxercgihth.supabase.co'
CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e'      # "Microsoft Graph Command Line Tools" (app pública da Microsoft)
AUTORIDADE = 'https://login.microsoftonline.com/organizations'
ESCOPOS = ['Files.Read']                                # só leitura dos arquivos do próprio usuário
GRAPH = 'https://graph.microsoft.com/v1.0'
PASTA_FOTOS = 'Aplicativos/Microsoft Forms/AÇÕES PREVENTIVAS - GESTÃO RAFAEL FRAGA/Pergunta'
NOME_XLSX = 'AÇÕES PREVENTIVAS - GESTÃO RAFAEL FRAGA.xlsx'
MAX_FOTO = 12 * 1024 * 1024
LADO_MAX, QUALIDADE = 1280, 70                           # tamanho máximo (px) e qualidade JPEG das fotos guardadas


def log(msg):
    linha = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    print(linha)
    try:
        with open(F_LOG, 'a', encoding='utf-8') as f: f.write(linha + '\n')
    except Exception: pass


def ler_json(caminho, padrao):
    try:
        with open(caminho, encoding='utf-8') as f: return json.load(f)
    except Exception: return padrao


def salvar_json(caminho, obj):
    tmp = caminho + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, caminho)


# ---------------------------------------------------------------- Microsoft
def app_msal():
    cache = msal.SerializableTokenCache()
    if os.path.exists(F_CACHE):
        cache.deserialize(open(F_CACHE, encoding='utf-8').read())
    return msal.PublicClientApplication(CLIENT_ID, authority=AUTORIDADE, token_cache=cache), cache


def salvar_cache(cache):
    if cache.has_state_changed:
        with open(F_CACHE, 'w', encoding='utf-8') as f: f.write(cache.serialize())


def fazer_login():
    app, cache = app_msal()
    fluxo = app.initiate_device_flow(scopes=ESCOPOS)
    if 'user_code' not in fluxo:
        print('Falha ao iniciar o login:', json.dumps(fluxo, ensure_ascii=False)); sys.exit(1)
    print(fluxo['message'], flush=True)
    res = app.acquire_token_by_device_flow(fluxo)          # espera você concluir no navegador
    if 'access_token' not in res:
        print('Login não concluído:', res.get('error_description') or res); sys.exit(1)
    salvar_cache(cache)
    print('Login OK:', res.get('id_token_claims', {}).get('preferred_username', ''))


def token_acesso():
    app, cache = app_msal()
    contas = app.get_accounts()
    if not contas: raise SystemExit('Sem login. Rode:  python sincronizar_forms.py login')
    res = app.acquire_token_silent(ESCOPOS, account=contas[0])
    if not res or 'access_token' not in res:
        raise SystemExit('Sessão expirou. Rode de novo:  python sincronizar_forms.py login')
    salvar_cache(cache)
    return res['access_token']


def graph_get(url, tk, tentativas=3):
    for i in range(tentativas):
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + tk})
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and i < tentativas - 1: time.sleep(int(e.headers.get('Retry-After', 5))); continue
            raise RuntimeError(f'Graph {e.code}: {e.read().decode("utf-8", "replace")[:300]}')


def baixar(url, tentativas=3):                              # URL pré-assinada: não leva o token
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return r.read()
        except Exception:
            if i == tentativas - 1: raise
            time.sleep(2)


def q(caminho):                                             # codifica um caminho do OneDrive para a URL do Graph
    return urllib.parse.quote(caminho, safe='/')


# ---------------------------------------------------------------- Supabase
def post_json(url, corpo, chave=None, tentativas=3):
    dados = json.dumps(corpo).encode('utf-8')
    cab = {'Content-Type': 'application/json'}
    if chave: cab['apikey'] = chave
    for i in range(tentativas):
        req = urllib.request.Request(url, data=dados, headers=cab, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=180) as r: return json.loads(r.read().decode('utf-8') or 'null')
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tentativas - 1: time.sleep(3); continue
            raise RuntimeError(f'Supabase {e.code}: {e.read().decode("utf-8", "replace")[:300]}')
        except urllib.error.URLError:
            if i == tentativas - 1: raise
            time.sleep(3)


# ---------------------------------------------------------------- sincronização
def achar_xlsx(tk, estado):
    if estado.get('xlsx_id'): return estado['xlsx_id']
    # a pasta de respostas fica dentro de "Aplicativos/Microsoft Forms/<formulário>"; a planilha costuma ficar na raiz do OneDrive
    termo = urllib.parse.quote(NOME_XLSX.replace("'", "''"))
    res = graph_get(f"{GRAPH}/me/drive/root/search(q='{termo}')?$select=id,name,parentReference", tk)
    achados = [i for i in res.get('value', []) if i.get('name', '').lower() == NOME_XLSX.lower()]
    if not achados: raise RuntimeError(f'Não achei a planilha "{NOME_XLSX}" no seu OneDrive.')
    estado['xlsx_id'] = achados[0]['id']
    log(f"planilha localizada em: {achados[0].get('parentReference', {}).get('path', '?')}")
    return estado['xlsx_id']


def linhas_da_planilha(conteudo):
    ws = openpyxl.load_workbook(io.BytesIO(conteudo), data_only=True).active
    it = ws.iter_rows(values_only=True)
    cab = next(it)
    saida = []
    for r in it:
        if r[0] is None: continue
        o = {}
        for h, v in zip(cab, r):
            if v is None or (isinstance(v, str) and not v.strip()): continue
            if isinstance(v, dt.datetime): v = v.strftime('%Y-%m-%dT%H:%M:%S')
            o[str(h)] = v
        saida.append(o)
    return saida


def sincronizar_linhas(tk, cfg, estado):
    item = graph_get(f"{GRAPH}/me/drive/items/{achar_xlsx(tk, estado)}?$select=id,name,@microsoft.graph.downloadUrl", tk)
    enviar_linhas(linhas_da_planilha(baixar(item['@microsoft.graph.downloadUrl'])), cfg, estado)


def enviar_linhas(linhas, cfg, estado):
    hashes = estado.setdefault('linhas', {})
    novas = []
    for o in linhas:
        h = hashlib.sha1(json.dumps(o, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
        if hashes.get(str(o['ID'])) != h: novas.append((o, h))
    for i in range(0, len(novas), 200):
        lote = novas[i:i + 200]
        n = post_json(f'{SB_URL}/rest/v1/rpc/preventivas_receber', {'p_token': cfg['token'], 'p_dados': [o for o, _ in lote]}, cfg['sb_key'])
        if n != len(lote): raise RuntimeError(f'esperava gravar {len(lote)} linhas e o servidor gravou {n}')
        for o, h in lote: hashes[str(o['ID'])] = h
        salvar_json(F_ESTADO, estado)
    log(f'planilha: {len(linhas)} linhas lidas, {len(novas)} novas/alteradas enviadas')


def listar_fotos(tk):
    url = f"{GRAPH}/me/drive/root:/{q(PASTA_FOTOS)}:/children?$top=999&$select=id,name,size,file,@microsoft.graph.downloadUrl"
    itens = []
    while url:
        res = graph_get(url, tk)
        for i in res.get('value', []):
            if 'file' in i:
                i['ler'] = (lambda u: (lambda: baixar(u)))(i['@microsoft.graph.downloadUrl'])
                itens.append(i)
        url = res.get('@odata.nextLink')
    return itens


EXT_FOTO = ('.jpg', '.jpeg', '.png', '.webp', '.mp4')


def fonte_local(origem):
    """Lê uma pasta baixada do OneDrive (ou um .zip dela): devolve (linhas_das_planilhas, fotos). Só usa o NOME dos arquivos (sem caminhos)."""
    import tempfile, zipfile
    linhas, fotos, vistos = [], [], set()
    tmp = tempfile.mkdtemp(prefix='preventivas_')

    def ler_arquivo(nome, tamanho, abrir):
        baixo = nome.lower()
        if baixo.endswith('.xlsx') and not nome.startswith('~$'):
            try:
                l = linhas_da_planilha(abrir())
                if l and 'ID' in l[0] and 'Hora de início' in l[0]: linhas.extend(l); log(f'planilha encontrada: {nome} ({len(l)} linhas)')
            except Exception as e: log(f'  planilha ignorada ({nome}): {e}')
        elif baixo.endswith(EXT_FOTO) and nome not in vistos:
            vistos.add(nome)
            fotos.append({'name': nome, 'size': tamanho, 'ler': abrir})          # só lê o conteúdo na hora de enviar (não carrega tudo na memória)

    caminhos = [origem] if os.path.isfile(origem) else [os.path.join(r, f) for r, _, fs in os.walk(origem) for f in fs]
    for c in caminhos:
        if c.lower().endswith('.zip'):
            z = zipfile.ZipFile(c)                                                  # fica aberto até o fim do programa
            for m in z.infolist():
                if m.is_dir(): continue
                ler_arquivo(os.path.basename(m.filename.replace('\\', '/')), m.file_size, (lambda zz, mm: (lambda: zz.read(mm)))(z, m))
        else:
            ler_arquivo(os.path.basename(c), os.path.getsize(c), (lambda cc: (lambda: open(cc, 'rb').read()))(c))
    return linhas, fotos


def pre_reduzir(dados, nome):
    """Reduz a foto aqui (já girando pela EXIF): mais leve para enviar, economiza Storage e evita o limite de CPU da Edge Function (erro 546)."""
    if not nome.lower().endswith(('.jpg', '.jpeg')): return dados
    try:
        from PIL import Image, ImageOps
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(dados))).convert('RGB')
        im.thumbnail((LADO_MAX, LADO_MAX))
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=QUALIDADE, optimize=True, progressive=True)
        return buf.getvalue()
    except Exception as e:
        log(f'  não consegui pré-reduzir {nome}: {e}'); return dados


def enviar_foto(item, cfg):
    dados = pre_reduzir(item['ler'](), item['name'])
    r = post_json(f'{SB_URL}/functions/v1/preventivas-foto',
                  {'token': cfg['token'], 'nome': item['name'], 'base64': base64.b64encode(dados).decode('ascii')})
    if not (r and r.get('ok')): raise RuntimeError(f'resposta inesperada: {r}')
    return item['name']


def sincronizar_fotos(itens, cfg, estado, limite):
    feitas = set(estado.setdefault('fotos_v2', []))            # v2 = fotos já enviadas no tamanho reduzido atual (1280 px, q70)
    antigas = set(estado.get('fotos', []))                      # envio v1 (1600 px, q80): só vídeos/PNG dessa lista são aproveitados
    pend = [i for i in itens if i['name'] not in feitas and i.get('size', 0) <= MAX_FOTO
            and not (i['name'].lower().endswith(('.mp4', '.png', '.webp')) and i['name'] in antigas)]
    grandes = [i['name'] for i in itens if i.get('size', 0) > MAX_FOTO and i['name'] not in feitas]
    if grandes: log(f'ignoradas por tamanho (> {MAX_FOTO // 1048576} MB): {len(grandes)}')
    lote = pend[:limite]
    ok = erros = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futuros = {pool.submit(enviar_foto, i, cfg): i for i in lote}
        for f, i in futuros.items():
            try:
                feitas.add(f.result()); ok += 1
            except Exception as e:
                erros += 1; log(f'  falhou {i["name"]}: {e}')
            if ok % 25 == 0: estado['fotos_v2'] = sorted(feitas); salvar_json(F_ESTADO, estado)
    estado['fotos_v2'] = sorted(feitas); salvar_json(F_ESTADO, estado)
    log(f'fotos: {len(itens)} na pasta, {len(pend)} pendentes, {ok} enviadas agora, {erros} com erro, {max(0, len(pend) - len(lote))} ficam para a próxima')


def carregar_cfg():
    cfg = ler_json(F_CONFIG, {})
    if not cfg.get('token') or not cfg.get('sb_key'): raise SystemExit(f'Faltou {F_CONFIG} com "token" e "sb_key".')
    return cfg


def sincronizar(limite_fotos):
    cfg, estado = carregar_cfg(), ler_json(F_ESTADO, {})
    tk = token_acesso()
    sincronizar_linhas(tk, cfg, estado)
    salvar_json(F_ESTADO, estado)
    sincronizar_fotos(listar_fotos(tk), cfg, estado, limite_fotos)


def sincronizar_pasta(origem, limite_fotos):
    """Modo manual (sem login Microsoft): usa arquivos que você baixou do OneDrive pelo navegador (.xlsx, fotos e/ou .zip)."""
    if not os.path.exists(origem): raise SystemExit(f'Não achei: {origem}')
    cfg, estado = carregar_cfg(), ler_json(F_ESTADO, {})
    linhas, fotos = fonte_local(origem)
    if linhas: enviar_linhas(linhas, cfg, estado)
    salvar_json(F_ESTADO, estado)
    sincronizar_fotos(fotos, cfg, estado, limite_fotos)


if __name__ == '__main__':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'sync'
    try:
        if cmd == 'login': fazer_login()
        elif cmd == 'sync': sincronizar(int(sys.argv[2]) if len(sys.argv) > 2 else 300)
        elif cmd == 'pasta' and len(sys.argv) > 2: sincronizar_pasta(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 100000)
        elif cmd == 'status':
            e = ler_json(F_ESTADO, {})
            print(f"linhas enviadas: {len(e.get('linhas', {}))} | fotos enviadas: {len(e.get('fotos_v2', []))} | pasta: {PASTA}")
        else: print(__doc__)
    except SystemExit: raise
    except Exception:
        log('ERRO: ' + traceback.format_exc().strip().splitlines()[-1]); log(traceback.format_exc()); sys.exit(1)
