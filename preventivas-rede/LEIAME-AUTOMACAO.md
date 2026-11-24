# Preventivas de Rede — atualização automática

```
Forms → planilha no OneDrive → Power Automate → função no Supabase → painel (tempo real)
```

## O que já está pronto (Supabase `giga-analytics`)
- Migração `supabase/migrations/0026_preventivas_rede.sql` (já aplicada): tabela `preventivas_respostas`, tabela `preventivas_tokens`
  e a função `preventivas_receber(p_token, p_dados)`.
- A função confere o token e grava a linha pelo **ID** da resposta (reenviar a mesma linha não duplica).
- Quem lê: qualquer usuário ativo do painel (login). Quem escreve direto: operador/admin. O Power Automate escreve só pela função, com o token.
- O painel (`preventivas-rede/index.html`) lê da nuvem quando há login, e recarrega sozinho a cada resposta nova (Realtime) e a cada 5 min.
  Sem login, mostra a cópia fixa embutida em `dados.js`.

## 1) Enviar o histórico (uma vez)
1. Entre no painel logado como operador ou administrador.
2. Baixe a planilha atual (Excel → Arquivo → Baixar uma cópia).
3. No painel, clique em **Carregar nova planilha** e escolha o arquivo. Ele manda tudo para a nuvem.

## 2) Criar o fluxo no Power Automate (make.powerautomate.com, conta que é dona da planilha)
1. **Criar → Fluxo de nuvem automatizado.** Nome: `Preventivas de Rede → Painel`.
2. Gatilho: **Excel Online (Business) → Quando uma nova linha é adicionada a uma tabela**
   - Local: OneDrive for Business · Biblioteca: OneDrive
   - Arquivo: `AÇÕES PREVENTIVAS - GESTÃO RAFAEL FRAGA.xlsx` (pasta *Aplicativos/Microsoft Forms/…*)
   - Tabela: a tabela criada pelo Forms (normalmente `Table1`)
   - Formato de data e hora: **ISO 8601** (o painel aceita os dois, mas ISO é mais seguro)
3. Ação: **HTTP**
   - Método: `POST`
   - URI: `https://wdbhqsenyegxercgihth.supabase.co/rest/v1/rpc/preventivas_receber`
   - Cabeçalhos:
     - `apikey` = a *publishable key* (a mesma de `js/supabaseClient.js`)
     - `Content-Type` = `application/json`
   - Corpo (cole no modo de texto; a parte `@{...}` é a expressão `triggerBody()` — digite em **Expressão**):
     ```
     {
       "p_token": "<TOKEN-SECRETO>",
       "p_dados": @{triggerBody()}
     }
     ```
4. Salvar e testar: adicione uma resposta no Forms (ou uma linha na tabela). Em alguns minutos o painel mostra "● Ao vivo" e a resposta nova.
   O gatilho só dispara para linhas **novas** depois que o fluxo é ligado — por isso o passo 1 (histórico).

Resposta esperada da ação HTTP: status `200` e corpo `1` (linhas gravadas). `403 token invalido` = token errado ou desativado.

## 3) Fotos visíveis sem login (cópia no Supabase)
As fotos originais ficam no OneDrive da empresa e só abrem com login Microsoft. Para o painel mostrá-las para qualquer usuário do painel,
cada foto é copiada (reduzida para ~200 KB, já girada certo) para o bucket **`preventivas-fotos`** pela Edge Function `preventivas-foto`
(migração `0027`, código em `supabase/functions/preventivas-foto/`). O painel procura a foto lá; se ainda não existir, o cartão mostra o
aviso e, dentro da ação, o link do original no SharePoint.

A função recebe `POST https://wdbhqsenyegxercgihth.supabase.co/functions/v1/preventivas-foto` com JSON
`{"token":"<TOKEN-SECRETO>","nome":"<nome do arquivo>","base64":"<conteúdo do arquivo em base64>"}` e responde `{"ok":true,...}`.

### Fluxo C — fotos novas (automático)
1. **Criar → Fluxo de nuvem automatizado.** Nome: `Preventivas — copiar foto nova`.
2. Gatilho: **OneDrive for Business → Quando um arquivo é criado**
   Pasta: `/Aplicativos/Microsoft Forms/AÇÕES PREVENTIVAS - GESTÃO RAFAEL FRAGA/Pergunta`
3. Ação: **OneDrive for Business → Obter conteúdo do arquivo** (usar o *Identificador* do gatilho).
4. Ação: **HTTP** — `POST` na URL acima, cabeçalho `Content-Type: application/json`, corpo:
   ```
   {
     "token": "<TOKEN-SECRETO>",
     "nome": @{triggerOutputs()?['body/Name']},
     "base64": @{body('Obter_conteúdo_do_arquivo')?['$content']}
   }
   ```
   (o nome do passo 3 pode variar; se renomeou, ajuste dentro de `body('...')`.)

### Fluxo D — histórico (rodar uma vez)
1. **Criar → Fluxo de nuvem instantâneo** (gatilho manual). Nome: `Preventivas — copiar fotos antigas`.
2. **OneDrive for Business → Listar arquivos na pasta** (mesma pasta `Pergunta`). Em *Configurações* da ação, ligue **Paginação** (limite 5000).
3. **Aplicar a cada um** (sobre `value` da lista). Em *Configurações*, ligue **Controle de simultaneidade** com grau **5**. Dentro dele:
   - **Obter conteúdo do arquivo** (pelo *Identificador*), e
   - a mesma ação **HTTP** do fluxo C, com `"nome": @{items('Aplicar_a_cada_um')?['Name']}`.
4. Execute. São ~2.200 fotos; deve levar de 30 a 60 min. Se o limite diário de ações do Power Automate acabar, ele pausa e você roda de novo no dia seguinte
   (reenviar a mesma foto só sobrescreve, não duplica).

> ⚠️ A ação **HTTP** é um conector *Premium* do Power Automate. Se a sua licença não incluir, a ação aparece com um diamante e o fluxo não salva — avise para planejarmos outra rota.

**Privacidade e custo:** o bucket é público só para leitura (quem tiver o link vê a foto; não dá para listar o bucket). Os nomes dos arquivos contêm data/hora e o nome
do técnico. Cada foto reduzida ocupa ~150–300 KB; confira a cota de Storage do seu plano Supabase (o plano gratuito tem 1 GB).

## 4) Plano B sem Power Automate Premium — `sincronizar_forms.py`
Sem a licença Premium (ação HTTP) e sem opção "Sincronizar" no OneDrive da empresa, o script `preventivas-rede/sincronizar_forms.py` faz o mesmo trabalho
(planilha → `preventivas_receber`, fotos → `preventivas-foto`). Config local em `%APPDATA%\preventivas-sync\config.json` (token + publishable key; fora do Git).

| Comando | Para quê |
|---|---|
| `python sincronizar_forms.py login` + `sync` | **Automático** pela Microsoft Graph (leitura). Exige que o admin do tenant libere o app usado no login — hoje bloqueado (erro `AADSTS50105`). Agendar `sync` a cada 10 min quando liberar. |
| `python sincronizar_forms.py pasta <pasta-ou-zip>` | **Manual, sem login Microsoft:** você baixa pelo navegador a pasta `Pergunta` (.zip) e/ou a planilha (.xlsx) e roda o comando. Só envia o que é novo (estado em `estado.json`). |
| `python sincronizar_forms.py status` | quantas linhas/fotos já foram enviadas |

Para liberar o modo automático, peça ao TI: *atribuir ao seu usuário o acesso ao aplicativo "Microsoft Graph Command Line Tools"* (ou registrar um app próprio com a permissão delegada `Files.Read`).

## Segurança
- A *publishable key* é pública por desenho. O que protege a escrita é o **token** (guardado só como hash SHA-256 no banco). Não coloque o token em arquivos do projeto.
- Trocar o token: gere outro, grave o hash em `preventivas_tokens` e desative o antigo:
  ```sql
  -- hash = sha256 do novo token (ex.: printf %s "NOVO" | sha256sum)
  insert into public.preventivas_tokens (nome, token_hash) values ('Power Automate v2', '<hash>');
  update public.preventivas_tokens set ativo = false where id = 1;
  ```

## Se algo não aparecer
- Painel mostra "Sem login": entre pelo link do aviso.
- "Nuvem vazia": ainda não houve envio (passo 1) nem linha nova.
- Linha chegou mas com bairro/cidade estranhos: são as regras de limpeza do painel (função `limpar` em `index.html`).
