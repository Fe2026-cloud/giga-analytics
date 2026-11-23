/* ============================================================================
 * Escala · camada de nuvem (Supabase): login, perfis, sincronização e Configurações.
 *
 * Modos:
 *   · nuvem  → site publicado (ou ?nuvem=1): exige login; os dados (nomes, escala, férias) só chegam depois dele.
 *   · local  → pasta com dados.js (uso do administrador): funciona como antes; Configurações → Nuvem publica tudo.
 * A segurança vem das regras (RLS) do banco; aqui só há a interface.
 * ========================================================================== */
(function () {
  'use strict';
  const CFG = window.ESCALA_CONFIG || {};
  const N = window.NUVEM = { modo: 'local', acesso: null, email: '', sb: null, versoes: {}, pendente: {}, timer: {}, todos: [] };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PAPEIS = { admin: 'Administrador', editor: 'Editor (GA/GO)', leitor: 'Leitor (só olha)' };

  /* ---------------------------------------------------------------- estilo */
  const CSS = `
  .nv-ov{position:fixed;inset:0;z-index:9999;background:var(--bg,#0b0f1a);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit}
  .nv-card{width:100%;max-width:400px;background:var(--surface,#12182a);color:var(--text,#e8ecf8);border:1px solid var(--border,#26304d);border-radius:16px;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .nv-card h2{margin:0 0 4px;font-size:20px}.nv-card .sub{font-size:13px;color:var(--text-2,#9fb0d6);margin-bottom:16px}
  .nv-card label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px;color:var(--text-2,#9fb0d6)}
  .nv-card input,.nv-card select{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border,#26304d);background:var(--surface-2,#0d1322);color:var(--text,#e8ecf8);font:inherit;font-size:14px}
  .nv-row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.nv-row .btn{flex:1}
  .nv-msg{margin-top:12px;font-size:13px;min-height:18px}.nv-msg.err{color:#ff7a8a}.nv-msg.ok{color:#4ade80}
  .nv-link{background:none;border:0;color:var(--hoje-borda,#9cc3ff);cursor:pointer;font:inherit;font-size:12.5px;padding:6px 0;text-decoration:underline}
  dialog#dlgCfg{width:min(980px,96vw);max-height:92vh;border:1px solid var(--border,#26304d);border-radius:16px;background:var(--surface,#12182a);color:var(--text,#e8ecf8);padding:0;overflow:hidden}
  dialog#dlgCfg::backdrop{background:rgba(0,0,0,.6)}
  .cfg-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#26304d)}
  .cfg-h h2{margin:0;font-size:18px}
  .cfg-tabs{display:flex;gap:6px;padding:10px 20px 0;flex-wrap:wrap}
  .cfg-tabs button{background:none;border:0;border-bottom:3px solid transparent;color:var(--text-2,#9fb0d6);padding:8px 12px;font:inherit;font-weight:600;cursor:pointer}
  .cfg-tabs button.on{color:var(--text,#fff);border-bottom-color:var(--hoje-borda,#9cc3ff)}
  .cfg-b{padding:16px 20px 22px;overflow:auto;max-height:calc(92vh - 130px)}
  .cfg-b h3{margin:18px 0 8px;font-size:14px}.cfg-b p{margin:6px 0;font-size:13px;color:var(--text-2,#9fb0d6);line-height:1.45}
  .cfg-b table{width:100%;border-collapse:collapse;font-size:13px}.cfg-b th,.cfg-b td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--grid,#1d2640);vertical-align:middle}
  .cfg-b input[type=text],.cfg-b input[type=email],.cfg-b select{padding:8px 10px;border-radius:8px;border:1px solid var(--border,#26304d);background:var(--surface-2,#0d1322);color:var(--text,#e8ecf8);font:inherit;font-size:13px}
  .cfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px 14px;margin:8px 0}
  .cfg-chk{display:flex;gap:6px;align-items:center;font-size:13px}.cfg-log{font:12px/1.5 ui-monospace,Consolas,monospace;background:var(--surface-2,#0d1322);border:1px solid var(--border,#26304d);border-radius:10px;padding:10px;max-height:240px;overflow:auto;white-space:pre-wrap;margin-top:10px}
  .nv-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;border:1px solid var(--border,#26304d);font-size:12px;color:var(--text-2,#9fb0d6);background:var(--surface-2,#0d1322)}
  .nv-pill.ok{color:#4ade80}.nv-pill.bad{color:#ff7a8a;border-color:#ff7a8a}
  .nv-url{font:11.5px ui-monospace,Consolas,monospace;word-break:break-all;color:var(--text-2,#9fb0d6)}
  .nv-banner{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9998;background:var(--surface,#12182a);border:1px solid var(--hoje-borda,#9cc3ff);color:var(--text,#fff);padding:12px 16px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-size:13.5px;max-width:92vw}
  .nv-banner .btn{margin-left:8px}`;
  function injetaCSS() { if ($('#nvcss')) return; const s = document.createElement('style'); s.id = 'nvcss'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------------------------------------------------------------- cliente */
  function carregarSupabase() {
    return new Promise((ok, err) => {
      if (window.supabase && window.supabase.createClient) return ok();
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = ok; s.onerror = () => err(new Error('Não foi possível carregar o Supabase (sem internet?)')); document.head.appendChild(s);
    });
  }
  async function cliente() {
    if (N.sb) return N.sb;
    await carregarSupabase();
    N.sb = window.supabase.createClient(CFG.url, CFG.chave, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'escala-auth' } });
    N.sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') setTimeout(telaNovaSenha, 0); });   // veio do link "Esqueci a senha"
    return N.sb;
  }
  const boardKey = id => (BOARDS[id].key || `escala-telecom-b-${id}-v1`);
  const podeLer = id => !!N.acesso && (N.acesso.papel === 'admin' || (N.acesso.boards || []).includes(id));
  const podeEditar = id => !!N.acesso && (N.acesso.papel === 'admin' || (N.acesso.papel === 'editor' && (N.acesso.boards || []).includes(id)));
  const nomeBoard = id => (typeof BOARDS !== 'undefined' && BOARDS[id] ? BOARDS[id].nome : id);

  /* ---------------------------------------------------------------- telas */
  function overlay(html) {
    injetaCSS(); let o = $('#nvov'); if (!o) { o = document.createElement('div'); o.id = 'nvov'; o.className = 'nv-ov'; document.body.appendChild(o); }
    o.innerHTML = `<div class="nv-card">${html}</div>`; return o;
  }
  const fechaOverlay = () => { const o = $('#nvov'); if (o) o.remove(); };
  function telaMsg(titulo, texto, botoes) {
    const o = overlay(`<h2>${esc(titulo)}</h2><div class="sub">${texto}</div><div class="nv-row">${(botoes || []).map((b, i) => `<button class="btn ${b.pri ? 'pri' : ''}" data-i="${i}">${esc(b.t)}</button>`).join('')}</div><div class="nv-msg" id="nvm"></div>`);
    (botoes || []).forEach((b, i) => $(`[data-i="${i}"]`, o).addEventListener('click', () => b.f(o)));
  }
  function msg(t, tipo) { const m = $('#nvm'); if (m) { m.textContent = t || ''; m.className = 'nv-msg ' + (tipo || ''); } }

  function telaLogin(bloqueante) {
    return new Promise(resolve => {
      const o = overlay(`<h2>Escala operacional</h2><div class="sub">Entre com seu e-mail e senha para acessar.</div>
        <label>E-mail</label><input id="nvEmail" type="email" autocomplete="username" placeholder="voce@empresa.com.br">
        <label>Senha</label><input id="nvSenha" type="password" autocomplete="current-password">
        <div class="nv-row"><button class="btn pri" id="nvEntrar">Entrar</button></div>
        <div class="nv-row" style="margin-top:6px"><button class="nv-link" id="nvCriar">Criar conta</button><button class="nv-link" id="nvEsq">Esqueci a senha</button>${bloqueante ? '' : '<button class="nv-link" id="nvCanc">Cancelar</button>'}</div>
        <div class="nv-msg" id="nvm"></div>`);
      const val = () => ({ email: $('#nvEmail', o).value.trim().toLowerCase(), senha: $('#nvSenha', o).value });
      const sb = N.sb;
      const entrar = async () => {
        const { email, senha } = val(); if (!email || !senha) return msg('Informe e-mail e senha.', 'err');
        msg('Entrando…'); const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) return msg(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message, 'err');
        fechaOverlay(); resolve(data.session);
      };
      $('#nvEntrar', o).addEventListener('click', entrar);
      $('#nvSenha', o).addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
      $('#nvCriar', o).addEventListener('click', async () => {
        const { email, senha } = val(); if (!email || senha.length < 8) return msg('Informe e-mail e uma senha de pelo menos 8 caracteres.', 'err');
        msg('Criando conta…'); const { data, error } = await sb.auth.signUp({ email, password: senha });
        if (error) return msg(/signups? not allowed/i.test(error.message) ? 'O cadastro automático está desligado. Use o e-mail e a senha que você já usa no painel GIGA+ ou peça ao administrador para criar o seu acesso.' : error.message, 'err');
        if (data.session) { fechaOverlay(); resolve(data.session); } else msg('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.', 'ok');
      });
      $('#nvEsq', o).addEventListener('click', async () => {
        const { email } = val(); if (!email) return msg('Digite seu e-mail e clique de novo.', 'err');
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('?')[0] });
        msg(error ? error.message : 'Enviamos um link para redefinir a senha.', error ? 'err' : 'ok');
      });
      const c = $('#nvCanc', o); if (c) c.addEventListener('click', () => { fechaOverlay(); resolve(null); });
      setTimeout(() => $('#nvEmail', o).focus(), 50);
    });
  }
  function telaNovaSenha() {
    const o = overlay(`<h2>Defina uma nova senha</h2><div class="sub">Escolha uma senha com pelo menos 8 caracteres.</div>
      <label>Nova senha</label><input id="nvNova" type="password" autocomplete="new-password">
      <label>Repita a senha</label><input id="nvNova2" type="password" autocomplete="new-password">
      <div class="nv-row"><button class="btn pri" id="nvGrava">Salvar nova senha</button></div><div class="nv-msg" id="nvm"></div>`);
    $('#nvGrava', o).addEventListener('click', async () => {
      const a = $('#nvNova', o).value, b = $('#nvNova2', o).value;
      if (a.length < 8) return msg('Use pelo menos 8 caracteres.', 'err'); if (a !== b) return msg('As senhas não conferem.', 'err');
      const { error } = await N.sb.auth.updateUser({ password: a });
      if (error) return msg(error.message, 'err'); msg('Senha alterada. Abrindo a escala…', 'ok'); setTimeout(() => { location.href = location.href.split('#')[0].split('?')[0]; }, 1200);
    });
  }
  async function sair() { try { await (await cliente()).auth.signOut(); } catch (e) { } location.reload(); }

  /* ---------------------------------------------------------------- boot */
  async function bootNuvem() {
    telaMsg('Escala operacional', 'Conectando…', []);
    const sb = await cliente();
    let { data: { session } } = await sb.auth.getSession();
    while (!session) session = await telaLogin(true);
    N.email = (session.user.email || '').toLowerCase();
    const r = await sb.rpc('esc_meu_acesso'); N.acesso = r.data || null;
    if (!N.acesso) {
      const { data: existe } = await sb.rpc('esc_existe_admin');
      const botoes = [];
      if (!existe) botoes.push({ t: 'Sou o administrador desta escala', pri: true, f: async () => { const { data } = await sb.rpc('esc_virar_admin'); if (data) location.reload(); else msg('Já existe um administrador.', 'err'); } });
      botoes.push({ t: 'Sair', f: sair });
      return telaMsg('Aguardando liberação', existe ? `A conta <b>${esc(N.email)}</b> ainda não tem acesso. Peça ao administrador para liberar este e-mail.` : `Ainda não existe administrador. Se você é o responsável pela escala, clique abaixo para assumir esse papel (só funciona uma vez).`, botoes);
    }
    // dados (nomes, gestores, férias, escala-base): só depois do login
    const { data: dj } = await sb.from('esc_config').select('valor').eq('chave', 'dados_js').maybeSingle();
    if (!dj) {
      return telaMsg('Escala ainda não publicada', N.acesso.papel === 'admin' ? 'Nenhum dado foi enviado para a nuvem. Abra a escala no computador do administrador (pasta com <code>dados.js</code>) e use <b>Configurações → Nuvem → Publicar tudo</b>.' : 'A escala ainda não foi publicada. Avise o administrador.', [{ t: 'Sair', f: sair }]);
    }
    const sc = document.createElement('script'); sc.textContent = dj.valor; document.head.appendChild(sc);
    N.todos = FRENTES.flatMap(f => f.boards);
    const { data: ct } = await sb.from('esc_config').select('valor').eq('chave', 'contatos').maybeSingle();
    try { if (ct) localStorage.setItem('escala-contatos', ct.valor); } catch (e) { }
    const { data: bs, error: eb } = await sb.from('esc_boards').select('id,estado,versao');
    if (eb) throw eb;
    (bs || []).forEach(b => { try { localStorage.setItem(boardKey(b.id), JSON.stringify(b.estado)); N.versoes[b.id] = b.versao; } catch (e) { } });
    if (N.acesso.papel !== 'admin') {   // cada um só enxerga as tabelas liberadas
      FRENTES.forEach(f => { f.boards = f.boards.filter(podeLer); });
      for (let i = FRENTES.length - 1; i >= 0; i--) if (!FRENTES[i].boards.length) FRENTES.splice(i, 1);
      if (!FRENTES.length) return telaMsg('Sem tabelas liberadas', 'Seu acesso ainda não inclui nenhuma tabela da escala. Peça ao administrador.', [{ t: 'Sair', f: sair }]);
    }
    const permitidas = FRENTES.flatMap(f => f.boards);
    try { const nav = localStorage.getItem('escala-nav'); if (!permitidas.includes(nav)) localStorage.setItem('escala-nav', permitidas[0]); } catch (e) { }
    window.__RO_FORCADO = N.acesso.papel === 'leitor';
    fechaOverlay(); N.modo = 'nuvem';
    window.__iniciarEscala();
    montaBarra(); tempoReal();
  }
  N._boot = bootNuvem;   // usado em testes
  window.__bootEscala = function () {
    injetaCSS();
    const local = !!window.DADOS_LOCAIS, forcaNuvem = /[?&]nuvem=1\b/.test(location.search);
    if (!CFG.nuvem || (local && !forcaNuvem)) { N.modo = 'local'; window.__iniciarEscala(); if (CFG.nuvem) montaBarra(); return; }
    bootNuvem().catch(e => { console.error(e); telaMsg('Não foi possível abrir a escala', esc(e.message || e), [{ t: 'Tentar de novo', pri: true, f: () => location.reload() }]); });
  };

  /* ---------------------------------------------------------------- sincronização */
  function status(t, tipo) { const el = $('#nvStatus'); if (el) { el.textContent = t; el.className = 'nv-pill ' + (tipo || ''); } }
  N.salvou = function (id, js) {
    if (N.modo !== 'nuvem' || !podeEditar(id)) return;
    N.pendente[id] = js; clearTimeout(N.timer[id]); N.timer[id] = setTimeout(() => enviar(id), 1500); status('Salvando…');
  };
  async function enviar(id) {
    const js = N.pendente[id]; if (js == null) return; N.pendente[id] = null;
    let r; try { r = await N.sb.rpc('esc_salvar_board', { p_id: id, p_estado: JSON.parse(js), p_versao: N.versoes[id] || 0 }); } catch (e) { r = { error: e }; }
    if (r.error) { status('Sem conexão: vou tentar de novo', 'bad'); N.pendente[id] = N.pendente[id] || js; N.timer[id] = setTimeout(() => enviar(id), 8000); return; }
    const d = r.data || {};
    if (d.ok) { N.versoes[id] = d.versao; status('✓ Sincronizado', 'ok'); }
    else if (d.erro === 'conflito') { N.pendente[id] = js; conflito(id, d.versao); }
    else status('Sem permissão para salvar esta tabela', 'bad');
  }
  function banner(html) { injetaCSS(); let b = $('#nvBanner'); if (!b) { b = document.createElement('div'); b.id = 'nvBanner'; b.className = 'nv-banner'; document.body.appendChild(b); } b.innerHTML = html; return b; }
  const fechaBanner = () => { const b = $('#nvBanner'); if (b) b.remove(); };
  function conflito(id, versaoAtual) {
    status('Conflito: outra pessoa salvou', 'bad');
    const b = banner(`<b>${esc(nomeBoard(id))}</b> foi alterada por outra pessoa enquanto você editava.
      <button class="btn pri" id="nvCarrega">Carregar a versão dela</button><button class="btn" id="nvMantem">Manter a minha</button>`);
    $('#nvCarrega', b).addEventListener('click', async () => { N.pendente[id] = null; fechaBanner(); await puxar(id); });
    $('#nvMantem', b).addEventListener('click', () => { N.versoes[id] = versaoAtual; fechaBanner(); enviar(id); });
  }
  async function puxar(id) {
    const { data } = await N.sb.from('esc_boards').select('estado,versao').eq('id', id).maybeSingle();
    if (!data) return;
    try { localStorage.setItem(boardKey(id), JSON.stringify(data.estado)); } catch (e) { }
    N.versoes[id] = data.versao;
    if (window.__escala && window.__escala.B && window.__escala.B.id === id) window.__escala.openBoard(id);
    status('✓ Atualizado', 'ok');
  }
  function tempoReal() {
    N.sb.channel('esc-versoes').on('postgres_changes', { event: '*', schema: 'public', table: 'esc_versoes' }, p => {
      const r = p.new; if (!r || !r.board || !podeLer(r.board)) return;
      if (r.por === N.email && r.versao <= (N.versoes[r.board] || 0)) return;
      if (r.versao <= (N.versoes[r.board] || 0)) return;
      if (N.pendente[r.board]) return conflito(r.board, r.versao);
      const aberta = window.__escala.B && window.__escala.B.id === r.board;
      puxar(r.board).then(() => { if (aberta) { const b = banner(`<b>${esc(nomeBoard(r.board))}</b> foi atualizada por ${esc(r.por || 'outra pessoa')}.`); setTimeout(fechaBanner, 4000); } });
    }).subscribe();
  }

  /* ---------------------------------------------------------------- barra: conta, status e Configurações */
  function montaBarra() {
    const row = document.querySelector('.top .row'); if (!row || $('#cfgBtn')) return;
    const frag = document.createDocumentFragment();
    if (N.modo === 'nuvem') { const st = document.createElement('span'); st.id = 'nvStatus'; st.className = 'nv-pill ok'; st.textContent = '✓ Sincronizado'; st.title = `Conectado como ${N.email} (${PAPEIS[N.acesso.papel]})`; frag.appendChild(st); }
    if (N.modo === 'local' || (N.acesso && N.acesso.papel === 'admin')) {
      const b = document.createElement('button'); b.className = 'btn'; b.id = 'cfgBtn'; b.textContent = 'Configurações'; b.addEventListener('click', abrirConfig); frag.appendChild(b);
    }
    if (N.modo === 'nuvem') { const u = document.createElement('button'); u.className = 'btn'; u.id = 'nvSair'; u.textContent = 'Sair'; u.title = N.email; u.addEventListener('click', sair); frag.appendChild(u); }
    const ref = $('#regras'); if (ref && ref.parentNode === row) row.insertBefore(frag, ref); else row.appendChild(frag);
  }

  /* ---------------------------------------------------------------- Configurações */
  const abas = () => N.modo === 'nuvem'
    ? [['acessos', 'Acessos'], ['links', 'Links dos técnicos'], ['nuvem', 'Publicação'], ['audit', 'Histórico'], ['conta', 'Minha conta']]
    : [['nuvem', 'Nuvem'], ['conta', 'Minha conta']];
  function abrirConfig() {
    injetaCSS(); let d = $('#dlgCfg'); if (!d) { d = document.createElement('dialog'); d.id = 'dlgCfg'; document.body.appendChild(d); }
    d.innerHTML = `<div class="cfg-h"><h2>Configurações da escala</h2><button class="btn" id="cfgX">Fechar</button></div>
      <div class="cfg-tabs">${abas().map(([k, t], i) => `<button data-k="${k}" class="${i ? '' : 'on'}">${t}</button>`).join('')}</div><div class="cfg-b" id="cfgB"></div>`;
    $('#cfgX', d).addEventListener('click', () => d.close());
    d.querySelectorAll('.cfg-tabs button').forEach(b => b.addEventListener('click', () => { d.querySelectorAll('.cfg-tabs button').forEach(x => x.classList.toggle('on', x === b)); aba(b.dataset.k); }));
    d.showModal(); aba(abas()[0][0]);
  }
  async function aba(k) { const b = $('#cfgB'); b.innerHTML = '<p>Carregando…</p>'; try { await ({ acessos: abaAcessos, links: abaLinks, nuvem: abaNuvem, audit: abaAudit, conta: abaConta }[k])(b); } catch (e) { b.innerHTML = `<p class="nv-msg err">${esc(e.message || e)}</p>`; } }
  const copiar = async t => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); return true; } };

  async function abaAcessos(b) {
    const sb = await cliente();
    const { data, error } = await sb.from('esc_acessos').select('*').order('email'); if (error) throw error;
    const todos = N.todos.length ? N.todos : Object.keys(BOARDS).filter(id => !['gj', 'sa', 'mg', 'cg', 'sb', 'ih', 'vr', 'cs', 'ss', 'ct', 'ib', 'vp'].includes(id));
    b.innerHTML = `<p>Quem entra com e-mail e senha para <b>editar</b> (GAs e GOs) ou <b>olhar</b> a escala. A pessoa cria a conta na tela de login e você libera o e-mail aqui. Administrador enxerga e edita tudo.</p>
      <table><thead><tr><th>E-mail</th><th>Nome</th><th>Perfil</th><th>Tabelas</th><th></th></tr></thead><tbody>${(data || []).map(a => `<tr><td>${esc(a.email)}</td><td>${esc(a.nome || '')}</td><td>${PAPEIS[a.papel]}</td><td>${a.papel === 'admin' ? 'todas' : (a.boards || []).map(nomeBoard).map(esc).join(', ') || '—'}</td>
        <td style="white-space:nowrap"><button class="btn" data-ed="${esc(a.email)}">Editar</button> <button class="btn" data-rm="${esc(a.email)}">Remover</button></td></tr>`).join('')}</tbody></table>
      <h3 id="fT">Liberar um e-mail</h3>
      <div class="cfg-grid"><div><label>E-mail</label><br><input type="email" id="aEmail" style="width:100%"></div><div><label>Nome</label><br><input type="text" id="aNome" style="width:100%"></div>
        <div><label>Perfil</label><br><select id="aPapel" style="width:100%"><option value="editor">Editor (GA/GO)</option><option value="leitor">Leitor (só olha)</option><option value="admin">Administrador</option></select></div></div>
      <label style="font-size:12px;font-weight:600">Tabelas liberadas</label>
      <div class="cfg-grid" id="aBoards">${todos.map(id => `<label class="cfg-chk"><input type="checkbox" value="${id}"> ${esc(nomeBoard(id))}</label>`).join('')}</div>
      <div class="nv-row" style="max-width:320px"><button class="btn pri" id="aSalvar">Salvar acesso</button></div><div class="nv-msg" id="aMsg"></div>`;
    const m = (t, c) => { const e = $('#aMsg', b); e.textContent = t; e.className = 'nv-msg ' + (c || ''); };
    b.querySelectorAll('[data-ed]').forEach(x => x.addEventListener('click', () => { const a = data.find(r => r.email === x.dataset.ed); $('#aEmail', b).value = a.email; $('#aNome', b).value = a.nome || ''; $('#aPapel', b).value = a.papel; b.querySelectorAll('#aBoards input').forEach(c => { c.checked = (a.boards || []).includes(c.value); }); $('#fT', b).scrollIntoView(); }));
    b.querySelectorAll('[data-rm]').forEach(x => x.addEventListener('click', async () => { if (x.dataset.rm === N.email) return alert('Você não pode remover o seu próprio acesso.'); if (!confirm('Remover o acesso de ' + x.dataset.rm + '?')) return; const { error } = await sb.from('esc_acessos').delete().eq('email', x.dataset.rm); if (error) return m(error.message, 'err'); aba('acessos'); }));
    $('#aSalvar', b).addEventListener('click', async () => {
      const email = $('#aEmail', b).value.trim().toLowerCase(), papel = $('#aPapel', b).value, boards = [...b.querySelectorAll('#aBoards input:checked')].map(c => c.value);
      if (!/^\S+@\S+\.\S+$/.test(email)) return m('Informe um e-mail válido.', 'err');
      if (papel !== 'admin' && !boards.length) return m('Marque pelo menos uma tabela.', 'err');
      const { error } = await sb.from('esc_acessos').upsert({ email, nome: $('#aNome', b).value.trim() || null, papel, boards: papel === 'admin' ? [] : boards, criado_por: N.email }, { onConflict: 'email' });
      if (error) return m(error.message, 'err'); m('Acesso salvo.', 'ok'); setTimeout(() => aba('acessos'), 600);
    });
  }

  async function urlPublica() {
    const sb = await cliente(); const { data } = await sb.from('esc_config').select('valor').eq('chave', 'url_publica').maybeSingle();
    return (data && data.valor) || (location.origin + location.pathname.replace(/[^/]*$/, ''));
  }
  async function abaLinks(b) {
    const sb = await cliente(); const base = (await urlPublica()).replace(/\/?$/, '/');
    const ids = N.todos.length ? N.todos : ['rls', 'rln', 'inf', 'ls', 'fn'];
    b.innerHTML = `<p>Cada técnico recebe um <b>link pessoal</b> que mostra só a escala dele (sem login). Quem tiver o link vê a escala daquela pessoa — então envie individualmente. Se um link vazar, use <b>Girar link</b>: o antigo para de funcionar.</p>
      <div class="cfg-grid"><div><label>Endereço público da escala</label><br><input type="text" id="lBase" value="${esc(base)}" style="width:100%"></div><div><label>Tabela</label><br><select id="lBoard" style="width:100%">${ids.map(id => `<option value="${id}">${esc(nomeBoard(id))}</option>`).join('')}</select></div></div>
      <div class="nv-row" style="max-width:520px"><button class="btn" id="lSalvaBase">Guardar endereço</button><button class="btn pri" id="lGerar">Gerar links que faltam</button><button class="btn" id="lCopiaTudo">Copiar todos</button></div><div class="nv-msg" id="lMsg"></div><div id="lTab"></div>`;
    const m = (t, c) => { const e = $('#lMsg', b); e.textContent = t; e.className = 'nv-msg ' + (c || ''); };
    const link = t => ($('#lBase', b).value.replace(/\/?$/, '/') + 'ver.html?t=' + t);
    let linhas = [];
    const lista = async () => {
      const id = $('#lBoard', b).value;
      const { data, error } = await sb.from('esc_tokens').select('*').eq('board', id).order('nome'); if (error) return m(error.message, 'err');
      linhas = data || [];
      $('#lTab', b).innerHTML = linhas.length ? `<table><thead><tr><th>Técnico</th><th>Link</th><th></th></tr></thead><tbody>${linhas.map(t => `<tr><td>${esc(t.nome)}</td><td class="nv-url">${esc(link(t.token))}</td><td style="white-space:nowrap"><button class="btn" data-c="${t.token}">Copiar</button> <button class="btn" data-w="${t.token}">WhatsApp</button> <button class="btn" data-g="${t.token}">Girar link</button></td></tr>`).join('')}</tbody></table>` : '<p>Nenhum link nesta tabela ainda. Clique em “Gerar links que faltam”.</p>';
      $('#lTab', b).querySelectorAll('[data-c]').forEach(x => x.addEventListener('click', async () => { await copiar(link(x.dataset.c)); x.textContent = 'Copiado ✓'; }));
      $('#lTab', b).querySelectorAll('[data-w]').forEach(x => x.addEventListener('click', () => { const t = linhas.find(r => r.token === x.dataset.w); window.open('https://wa.me/?text=' + encodeURIComponent(`Olá, ${t.nome.split(' ')[0]}! Esta é a sua escala (só a sua): ${link(t.token)}`), '_blank'); }));
      $('#lTab', b).querySelectorAll('[data-g]').forEach(x => x.addEventListener('click', async () => { if (!confirm('Girar o link? O link atual deixa de funcionar.')) return; const { error } = await sb.rpc('esc_rotacionar_token', { p_token: x.dataset.g }); if (error) return m(error.message, 'err'); lista(); }));
    };
    $('#lBoard', b).addEventListener('change', lista);
    $('#lSalvaBase', b).addEventListener('click', async () => { const { error } = await sb.from('esc_config').upsert({ chave: 'url_publica', valor: $('#lBase', b).value.trim(), atualizado_por: N.email }); m(error ? error.message : 'Endereço guardado.', error ? 'err' : 'ok'); lista(); });
    $('#lGerar', b).addEventListener('click', async () => { const { data, error } = await sb.rpc('esc_gerar_tokens', { p_board: $('#lBoard', b).value }); if (error) return m(error.message, 'err'); m(`${data} link(s) novo(s) criado(s).`, 'ok'); lista(); });
    $('#lCopiaTudo', b).addEventListener('click', async () => { await copiar(linhas.map(t => `${t.nome};${link(t.token)}`).join('\n')); m('Lista copiada (nome;link).', 'ok'); });
    if (/localhost|127\.0\.0\.1/.test(base)) m('Atenção: o endereço público ainda é o do seu computador. Ajuste para o endereço publicado antes de enviar os links.', 'err');
    lista();
  }

  async function abaNuvem(b) {
    const sb = await cliente(); const { data: { session } } = await sb.auth.getSession();
    const logado = !!session;
    let ac = N.acesso;
    if (logado && !ac) { const r = await sb.rpc('esc_meu_acesso'); ac = r.data || null; N.acesso = ac; N.email = (session.user.email || '').toLowerCase(); }
    const admin = !!ac && ac.papel === 'admin';
    b.innerHTML = `<p>${N.modo === 'nuvem' ? 'Você está na versão publicada.' : 'Você está na versão deste computador (com <code>dados.js</code>).'} Publicar envia nomes, gestores, férias, escala-base, contatos e o estado atual de todas as tabelas para a nuvem, e gera os links dos técnicos. Os dados ficam atrás do login; o site público não carrega nenhum nome.</p>
      <p>Situação: ${logado ? `conectado como <b>${esc(session.user.email)}</b> (${ac ? PAPEIS[ac.papel] : 'sem acesso liberado'})` : 'não conectado'}</p>
      <div class="nv-row" style="max-width:520px">${logado ? '' : '<button class="btn pri" id="nEntrar">Entrar na nuvem</button>'}${admin ? '<button class="btn pri" id="nPub">Publicar tudo</button>' : ''}${logado && !ac ? '<button class="btn pri" id="nAdm">Assumir como administrador</button>' : ''}</div>
      ${N.modo === 'nuvem' && admin ? `<h3>Enviar dados.js manualmente</h3><p>Use quando os nomes/férias mudarem e você tiver o arquivo atualizado.</p><input type="file" id="nArq" accept=".js">` : ''}
      <div class="cfg-log" id="nLog" hidden></div>`;
    const log = t => { const l = $('#nLog', b); l.hidden = false; l.textContent += t + '\n'; l.scrollTop = l.scrollHeight; };
    const e1 = $('#nEntrar', b); if (e1) e1.addEventListener('click', async () => { const dlg = $('#dlgCfg'); if (dlg) dlg.close(); await cliente(); await telaLogin(false); abrirConfig(); });
    const e2 = $('#nAdm', b); if (e2) e2.addEventListener('click', async () => { const { data } = await sb.rpc('esc_virar_admin'); if (data) { const r = await sb.rpc('esc_meu_acesso'); N.acesso = r.data; aba('nuvem'); } else alert('Já existe um administrador. Peça a ele para liberar o seu e-mail.'); });
    const pubBtn = $('#nPub', b); if (pubBtn) pubBtn.addEventListener('click', async () => { pubBtn.disabled = true; try { await publicarTudo(log); } catch (e) { log('ERRO: ' + (e.message || e)); } pubBtn.disabled = false; });
    const arq = $('#nArq', b); if (arq) arq.addEventListener('change', async () => { const f = arq.files[0]; if (!f) return; const txt = await f.text(); const { error } = await sb.from('esc_config').upsert({ chave: 'dados_js', valor: txt, atualizado_por: N.email }); log(error ? 'ERRO: ' + error.message : 'dados.js enviado. Recarregue a página para ver.'); });
  }

  async function publicarTudo(log) {
    const sb = await cliente(), E = window.__escala; const up = async (chave, valor) => { const { error } = await sb.from('esc_config').upsert({ chave, valor, atualizado_por: N.email }); if (error) throw error; };
    if (N.modo === 'local') {
      log('1/5 Enviando dados.js…'); const txt = await (await fetch('dados.js?' + Date.now())).text(); await up('dados_js', txt); log('   ok (' + Math.round(txt.length / 1024) + ' KB)');
    } else log('1/5 dados.js: já está na nuvem (use o envio manual para atualizar).');
    log('2/5 Contatos e plantonistas…'); await up('contatos', JSON.stringify(E.CONT || {})); await up('plantonistas', JSON.stringify(E.PLANT || [])); log('   ok');
    const ids = N.todos.length ? N.todos : FRENTES.flatMap(f => f.boards); const atual = E.B && E.B.id;
    log('3/5 Enviando as tabelas…');
    for (const id of ids) {
      E.openBoard(id); const raw = localStorage.getItem(boardKey(id)); if (!raw) { log(`   ${nomeBoard(id)}: sem dados locais, pulei`); continue; }
      const { data: v } = await sb.from('esc_boards').select('versao').eq('id', id).maybeSingle();
      const r = await sb.rpc('esc_salvar_board', { p_id: id, p_estado: JSON.parse(raw), p_versao: v ? v.versao : 0 });
      if (r.error || !(r.data && r.data.ok)) throw new Error(`${nomeBoard(id)}: ${r.error ? r.error.message : r.data && r.data.erro}`);
      N.versoes[id] = r.data.versao; log(`   ${nomeBoard(id)}: versão ${r.data.versao}`);
    }
    if (atual) E.openBoard(atual);
    log('4/5 Gerando links dos técnicos…'); for (const id of ids) { const { data, error } = await sb.rpc('esc_gerar_tokens', { p_board: id }); if (error) throw error; log(`   ${nomeBoard(id)}: ${data} novo(s)`); }
    log('5/5 Pronto. Abra Configurações → Links dos técnicos na versão publicada para enviar os links.');
  }

  async function abaAudit(b) {
    const sb = await cliente(); const { data, error } = await sb.from('esc_auditoria').select('*').order('quando', { ascending: false }).limit(60); if (error) throw error;
    b.innerHTML = `<p>Últimas ações registradas (salvamentos, acessos, links).</p><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Tabela</th></tr></thead><tbody>${(data || []).map(r => `<tr><td>${esc(new Date(r.quando).toLocaleString('pt-BR'))}</td><td>${esc(r.email || '')}</td><td>${esc(r.acao)}</td><td>${esc(r.board ? nomeBoard(r.board) : '')}</td></tr>`).join('')}</tbody></table>`;
  }
  async function abaConta(b) {
    const sb = await cliente(); const { data: { session } } = await sb.auth.getSession();
    b.innerHTML = session ? `<p>Conectado como <b>${esc(session.user.email)}</b>${N.acesso ? ' · ' + PAPEIS[N.acesso.papel] : ''}.</p><div class="nv-row" style="max-width:320px"><button class="btn" id="cSair">Sair desta conta</button></div>
      <h3>Trocar senha</h3><div class="cfg-grid"><div><input type="password" id="cNova" placeholder="Nova senha (mín. 8)" style="width:100%"></div></div><div class="nv-row" style="max-width:320px"><button class="btn pri" id="cTroca">Trocar senha</button></div><div class="nv-msg" id="cMsg"></div>` : '<p>Você não está conectado.</p>';
    const s = $('#cSair', b); if (s) s.addEventListener('click', sair);
    const t = $('#cTroca', b); if (t) t.addEventListener('click', async () => { const p = $('#cNova', b).value; const m = $('#cMsg', b); if (p.length < 8) { m.textContent = 'Use pelo menos 8 caracteres.'; m.className = 'nv-msg err'; return; } const { error } = await sb.auth.updateUser({ password: p }); m.textContent = error ? error.message : 'Senha alterada.'; m.className = 'nv-msg ' + (error ? 'err' : 'ok'); });
  }
})();
