/* ============================================================================
 * Módulo Predict PON — GIGA+ Analytics
 *
 * Mostra o que a extensão "Predict PON" (Chrome de um operador logado no AutoISP)
 * grava no Supabase (migração 0020):
 *   predict_pon_leituras  → alertas de OLT/PON (massiva, risco de massiva, OLT degradada…)
 *   predict_pon_clientes  → sinal real de cada contrato das O.S.
 * e cruza o sinal com as O.S. já carregadas no painel (getAllRows) para apontar
 * quem vai virar IRR (reparo em até 30 dias) ou IFI (até 15 dias da ativação/mudança).
 * Só leitura: este módulo não grava nada.
 * ========================================================================== */
const PP = {
  leitura: null, leituras: [], clientes: [], carregado: false, carregando: false, erro: null,
  filtroCidade: 'TODAS', filtroJanela: 'RISCO', filtroSit: 'RUINS', aba: 'rede', ponMin: 3, ponCidade: 'TODAS', ponAbertas: new Set(), oltAbertas: new Set(), slotAbertos: new Set(),
  mapa: null, camada: null, leafletPronto: null, timer: null
};
const PP_RUINS = ['critico', 'atencao', 'sem_sinal'];
const PP_SIT = {
  critico: { t: 'Crítico', c: 'red' }, sem_sinal: { t: 'Sem sinal (LoS)', c: 'red' }, atencao: { t: 'Atenção', c: 'yellow' },
  sem_energia: { t: 'Sem energia', c: 'peach' }, offline: { t: 'Offline', c: 'peach' }, ok: { t: 'OK', c: 'green' },
  nao_encontrado: { t: 'Não achado no AutoISP', c: 'text-faint' }
};
const PP_NIVEL = {
  OLT_PONS: { c: 'red', acao: 'Várias PONs da mesma OLT ao mesmo tempo: acionar NOC/backbone antes de mandar técnico de campo.' },
  MASSIVA: { c: 'red', acao: 'PON caída: abrir massiva e mandar rede externa no troncal/splitter primário.' },
  RISCO_PON: { c: 'peach', acao: 'PON degradando: preventiva no troncal/CTO antes de virar massiva.' },
  OLT: { c: 'red', acao: 'OLT sem conexão com o AutoISP: confirmar com NOC se é gerência ou queda real.' },
  ENERGIA: { c: 'yellow', acao: 'Falta de energia na região: não é fibra, acompanhar concessionária.' },
  CTO: { c: 'yellow', acao: 'Conector/splitter da CTO.' },
  ONU: { c: 'text-dim', acao: 'Drop/conector do cliente.' }
};
const PP_AUTOISP = 'https://auto.alloha.com';
const ppEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ppHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const ppDbm = v => v == null ? '-' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ppChave = c => String(c || '').trim().toUpperCase().replace(/^0+(?=.)/, '');

async function ppCarregar(){
  if (PP.carregando) return;
  PP.carregando = true;
  try{
    const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
    const [ult, serie] = await Promise.all([
      supabaseClient.from('predict_pon_leituras').select('*').order('coletado_em', { ascending: false }).limit(1).maybeSingle(),
      supabaseClient.from('predict_pon_leituras').select('coletado_em, resumo').gte('coletado_em', desde).order('coletado_em')
    ]);
    if (ult.error) throw ult.error;
    PP.leitura = ppRegraMassiva(ult.data || null);
    PP.leituras = serie.data || [];
    const clientes = [];
    for (let de = 0; de < 50000; de += 1000){
      const { data, error } = await supabaseClient.from('predict_pon_clientes').select('*').order('contrato').range(de, de + 999);
      if (error) throw error;
      clientes.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    PP.clientes = clientes;
    PP.erro = null;
  }catch(e){
    console.error('Predict PON: falha ao carregar', e);
    PP.erro = /does not exist|schema cache|42P01/.test(String(e.message || e.code || e)) ? 'sem_tabela' : String(e.message || e);
  }finally{
    PP.carregando = false; PP.carregado = true;
  }
}

// Coletas de extensões antigas (< 0.3.3) marcam massiva com 4+ ONUs em LoS. A regra da operação é 16+:
// abaixo disso o alerta vira risco de massiva aqui no site, e o resumo é recontado.
function ppRegraMassiva(L){
  if (!L || !Array.isArray(L.alertas)) return L;
  let mudou = false;
  L.alertas = L.alertas.map(a => {
    if (a.nivel !== 'MASSIVA') return a;
    const m = /(\d+)\s*ONUs? em LoS/i.exec(a.detalhe || '');
    const los = m ? +m[1] : (a.qtd || 0);
    if (los >= PP_MASSIVA_LOS) return a;
    mudou = true;
    return Object.assign({}, a, { nivel: 'RISCO_PON', rotulo: 'Risco de massiva',
      detalhe: `${los} ONUs em LoS, abaixo das ${PP_MASSIVA_LOS} que fecham massiva. Verificar troncal/splitter antes de cair.` });
  });
  if (!mudou) return L;
  L.alertas = L.alertas.map(a => {
    if (a.nivel !== 'OLT_PONS' || !a.chave || !/massivas?,/.test(a.detalhe || '')) return a;
    const f = L.alertas.filter(x => x.pai === a.chave);
    const mas = f.filter(x => x.nivel === 'MASSIVA').length, ris = f.filter(x => x.nivel === 'RISCO_PON').length;
    return Object.assign({}, a, { detalhe: a.detalhe.replace(/\(\d+ massivas?, \d+ em risco\)/, `(${mas} massiva${mas === 1 ? '' : 's'}, ${ris} em risco)`) });
  });
  const ordem = a => { const i = PP_ORDEM.indexOf(a.nivel); return i < 0 ? 99 : i; };
  L.alertas = L.alertas.map((a, i) => [a, i]).sort((x, y) => ordem(x[0]) - ordem(y[0]) || x[1] - y[1]).map(x => x[0]);
  const conta = n => L.alertas.filter(a => a.nivel === n).length;
  L.resumo = Object.assign({}, L.resumo, { massivas: conta('MASSIVA'), risco: conta('RISCO_PON') });
  return L;
}

// Última O.S. (Reparo / Ativação / Mudança) de cada contrato, a partir das O.S. já carregadas no painel.
function ppOsPorContrato(){
  const mapa = new Map();
  const TIPOS = ['Reparo Corretivo', 'Ativação', 'Mudança de Endereço', 'Mudança de Cômodo'];
  (typeof getAllRows === 'function' ? getAllRows() : []).forEach(r => {
    if (!r.contrato) return;
    const k = ppChave(r.contrato);
    const quando = r.fimDate || r.aberturaDate || (typeof parseDDMMYY === 'function' ? parseDDMMYY(r.data) : null);
    if (!quando) return;
    const m = mapa.get(k) || { ultima: null, aberta: null, cliente: '', end: null };
    // endereço: o da O.S. mais recente do contrato, de qualquer tipo
    if (r.endereco && (!m.end || quando > m.end.quando)) m.end = { quando, endereco: r.endereco, bairro: r.bairro, cidade: r.cidade };
    mapa.set(k, m);
    if (!TIPOS.includes(r.tipo)) return;
    const aberta = (typeof BACKLOG_STATUSES !== 'undefined' ? BACKLOG_STATUSES : []).includes(r.status);
    if (aberta && r.tipo === 'Reparo Corretivo' && (!m.aberta || quando > m.aberta.quando)) m.aberta = { r, quando };
    if (r.status === 'concluído' && r.fimDate && (!m.ultima || r.fimDate > m.ultima.quando)) m.ultima = { r, quando: r.fimDate };
    if (r.cliente) m.cliente = r.cliente;
    mapa.set(k, m);
  });
  return mapa;
}

function ppClassificar(){
  const os = ppOsPorContrato();
  const agora = Date.now();
  // a extensão grava o id da OLT; o nome e as cidades vêm da lista de OLTs da última leitura
  const oltPorId = new Map(((PP.leitura && PP.leitura.olts) || []).map(o => [o.id, o]));
  return PP.clientes.map(c => {
    const o = os.get(ppChave(c.contrato)) || {};
    const it = { c, cliente: o.cliente || '', ultima: o.ultima ? o.ultima.r : null, aberta: o.aberta ? o.aberta.r : null, janela: 'FORA', dias: null, faltam: null, prio: 9 };
    if (o.ultima){
      it.dias = Math.floor((agora - o.ultima.quando.getTime()) / 864e5);
      if (o.ultima.r.tipo === 'Reparo Corretivo' && it.dias <= 30){ it.janela = 'IRR'; it.faltam = 30 - it.dias; }
      else if (o.ultima.r.tipo !== 'Reparo Corretivo' && it.dias <= 15){ it.janela = 'IFI'; it.faltam = 15 - it.dias; }
    }
    if (it.aberta) it.janela = 'ABERTO';
    const ruim = PP_RUINS.includes(c.situacao);
    it.ruim = ruim;
    it.prio = !ruim ? 9 : it.janela === 'IRR' || it.janela === 'IFI' ? (c.situacao === 'atencao' ? 2 : 1) : it.janela === 'ABERTO' ? 3 : (c.situacao === 'atencao' ? 5 : 4);
    const semNome = v => v && !/^\(sem /.test(v) ? v : '';
    const olt = oltPorId.get(c.olt_id);
    it.olt = c.olt || (olt && olt.hostname) || (c.olt_id != null ? 'OLT #' + c.olt_id : '');
    it.cidade = c.cidade || semNome(o.end && o.end.cidade) || semNome(it.ultima && it.ultima.cidade) || (olt && olt.cidades && olt.cidades.length === 1 ? olt.cidades[0].replace(/, [A-Z]{2}$/, '') : '');
    it.bairro = c.bairro || semNome(o.end && o.end.bairro) || semNome(it.ultima && it.ultima.bairro) || '';
    it.endereco = (o.end && o.end.endereco) || '';
    return it;
  });
}

function ppIdade(iso){
  if (!iso) return { txt: 'sem coleta', cor: 'red' };
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  const txt = min < 60 ? Math.round(min) + ' min' : min < 2880 ? Math.round(min / 60) + ' h' : Math.round(min / 1440) + ' dias';
  return { txt, cor: min <= 35 ? 'green' : min <= 120 ? 'yellow' : 'red' };
}

async function renderPredictPon(forcar){
  const el = document.getElementById('predictPonContainer');
  if (!el) return;
  if (!PP.carregado || forcar){
    if (!PP.carregado) el.innerHTML = '<div class="panel muted">Carregando o Predict PON…</div>';
    await ppCarregar();
  }
  const hint = document.getElementById('predictPonHint');
  if (PP.erro === 'sem_tabela'){
    el.innerHTML = '<div class="panel muted" style="text-align:center;padding:40px 20px;"><div style="font-size:26px;margin-bottom:10px;">🛰️</div><b>Predict PON ainda não está ativo no banco</b><div style="font-size:12.5px;margin-top:6px;">Falta rodar a migração 0020_predict_pon.sql no Supabase.</div></div>';
    return;
  }
  if (PP.erro){ el.innerHTML = '<div class="panel muted">Não consegui carregar o Predict PON: ' + ppEsc(PP.erro) + '</div>'; return; }
  if (!PP.leitura && !PP.clientes.length){
    el.innerHTML = '<div class="panel muted" style="text-align:center;padding:40px 20px;"><div style="font-size:26px;margin-bottom:10px;">🛰️</div><b>Nenhuma coleta recebida ainda</b><div style="font-size:12.5px;margin-top:6px;">A coleta vem da extensão Predict PON, no Chrome de quem está logado no AutoISP, com o login do GIGA+ feito na extensão.</div></div>';
    return;
  }

  const L = PP.leitura || { resumo: {}, alertas: [] };
  const R = L.resumo || {};
  const idade = ppIdade(L.coletado_em);
  const ultimaCli = PP.clientes.reduce((m, c) => !m || c.checado_em > m ? c.checado_em : m, null);
  if (hint) hint.textContent = 'Última coleta: ' + ppHora(L.coletado_em) + (L.coletor ? ' por ' + L.coletor : '') + (L.cidades && L.cidades.length ? ' · ' + L.cidades.join(', ') : '');

  const itens = ppClassificar();
  const ruins = itens.filter(i => i.ruim);
  const emRisco = ruins.filter(i => i.janela === 'IRR' || i.janela === 'IFI');
  const alertas = (L.alertas || []).filter(a => a.nivel !== 'ONU');

  // Massivas/riscos que pertencem a uma OLT degradada aparecem dentro do cartão da OLT, não soltos.
  const ppDentroOlt = nivel => { const n = alertas.filter(a => a.nivel === nivel && a.pai).length; return n ? `${n} dentro de OLT degradada` : ''; };
  const cards = [
    { v: R.olts_degradadas || 0, l: 'OLTs degradadas', c: 'red', aba: 'rede' },
    { v: R.massivas || 0, l: 'Massivas', c: 'red', sub: ppDentroOlt('MASSIVA'), aba: 'rede' },
    { v: R.risco || 0, l: 'Risco de massiva', c: 'peach', sub: ppDentroOlt('RISCO_PON'), aba: 'rede' },
    { v: R.olts_falha || 0, l: 'OLT sem conexão', c: 'red', aba: 'rede' },
    { v: ruins.length, l: 'Clientes c/ sinal ruim', c: 'yellow', aba: 'clientes', janela: 'TODAS' },
    { v: emRisco.length, l: 'Vão reincidir (IRR/IFI)', c: 'red', aba: 'clientes', janela: 'RISCO' }
  ];

  let html = '';
  if (idade.cor !== 'green'){
    html += `<div class="pp-aviso pp-${idade.cor}">⚠ A última coleta foi há <b>${idade.txt}</b>. A coleta depende do Chrome de quem roda a extensão estar aberto e logado no AutoISP.</div>`;
  }
  html += `<div class="pp-cards">${cards.map(k => `<div class="venc-card clickable-card pp-card" data-pp-ir="${k.aba}"${k.janela ? ` data-pp-janela="${k.janela}"` : ''} style="--c:var(--${k.v ? k.c : 'border'})"><div class="value" style="color:var(--${k.v ? k.c : 'text-faint'})">${k.v}</div><div class="label">${k.l}</div>${k.sub ? `<div class="pp-sub">${k.sub}</div>` : ''}</div>`).join('')}</div>`;

  // ---------- abas ----------
  const nAlertas = alertas.filter(a => !a.pai).length;
  const ABAS = [['rede', '🛰️ Rede (OLT/PON)', nAlertas], ['clientes', '👥 Clientes × O.S.', emRisco.length], ['mapa', '🗺️ Mapa e equipe', null]];
  if (!ABAS.some(a => a[0] === PP.aba)) PP.aba = 'rede';
  html += `<div class="pp-abas" role="tablist">${ABAS.map(a => `<button role="tab" class="pp-aba-btn${PP.aba === a[0] ? ' active' : ''}" data-pp-aba="${a[0]}">${a[1]}${a[2] ? `<span class="pp-aba-n">${a[2]}</span>` : ''}</button>`).join('')}</div>`;
  const aba = (id, conteudo) => `<div class="pp-aba" data-aba="${id}"${PP.aba === id ? '' : ' hidden'}>${conteudo}</div>`;
  let rede = '', cli = '', mapa = '';

  // ---------- O que fazer agora ----------
  const top = alertas.filter(a => !a.pai).slice(0, 10);
  const SIGLA = { OLT_PONS: 'OLT', MASSIVA: 'MAS', RISCO_PON: 'RIS', OLT: 'OLT', ENERGIA: 'ENE', CTO: 'CTO' };
  const cidadeOlt = nome => { const o = (L.olts || []).find(x => x.hostname === nome); return o && o.cidades && o.cidades[0] || ''; };
  rede += `<div class="panel"><div class="panel-head"><h3>O que fazer agora</h3><span class="desc">pior primeiro · <span class="pp-idade pp-${idade.cor}">coleta há ${idade.txt}</span> <span class="pp-i" title="Os alertas de rede vêm da lista de ONUs com problema do AutoISP, que é quase toda de ONUs sem contrato. Servem como indício físico na PON. O sinal dos clientes está na aba Clientes.">ⓘ</span></span></div>`;
  rede += top.length ? '<div class="pp-alertas">' + top.map(a => {
    const n = PP_NIVEL[a.nivel] || {};
    const filhos = a.chave ? alertas.filter(f => f.pai === a.chave) : [];
    const grupos = ['MASSIVA', 'RISCO_PON'].map(nv => [nv, filhos.filter(f => f.nivel === nv).map(f => f.pon)]).filter(g => g[1].length);
    const outros = filhos.filter(f => f.nivel !== 'MASSIVA' && f.nivel !== 'RISCO_PON').map(f => f.pon);
    if (outros.length) grupos.push(['', outros]);
    const cid = cidadeOlt(a.olt);
    const onde = `${ppEsc(a.olt || '')}${a.nivel !== 'OLT_PONS' && a.pon ? ' · PON ' + ppEsc(a.pon) : ''}${cid ? ` <span class="pp-al-cid">${ppEsc(cid)}</span>` : ''}`;
    const chips = grupos.map(g => `<div class="pp-al-chips"><span class="pp-al-chl" style="color:var(--${g[0] === 'MASSIVA' ? 'red' : g[0] ? 'peach' : 'text-dim'})">${g[0] === 'MASSIVA' ? 'Massivas' : g[0] ? 'Em risco' : 'PONs'} (${g[1].length})</span>${g[1].map(p => `<span class="pp-chip" style="--c:var(--${g[0] === 'MASSIVA' ? 'red' : g[0] ? 'peach' : 'text-dim'})">${ppEsc(p)}</span>`).join('')}</div>`).join('');
    return `<div class="pp-al" style="--c:var(--${n.c || 'text-dim'})">
      <div class="pp-al-ic">${SIGLA[a.nivel] || '!'}</div>
      <div class="pp-al-corpo"><div class="pp-al-t"><b>${ppEsc(a.rotulo || a.nivel)}</b>${a.novo ? '<span class="pp-novo">novo</span>' : ''}<span class="pp-al-onde">${onde}</span></div>
        <div class="pp-al-d">${ppEsc(a.detalhe)}</div>${chips}
        <div class="pp-al-a"><b>Ação:</b> ${ppEsc(n.acao || '')}</div>
        ${a.nivel === 'OLT_PONS' ? `<button class="pp-btn pp-dg-abrir" data-pp-abrir-olt="${ppEsc(a.olt)}">Abrir por slot e PON ↓</button>` : ''}</div>
      <div class="pp-al-n"><b>${a.qtd || 0}</b><span>ONUs</span></div></div>`;
  }).join('') + '</div>' : '<div class="muted" style="font-size:12.5px;">Nenhum alerta de OLT/PON na última coleta. 👍</div>';
  rede += '</div>';

  rede += ppDrillOlts(L, itens, alertas);

  // ---------- Clientes ----------
  const cidades = [...new Set(itens.map(i => i.cidade).filter(Boolean))].sort();
  if (PP.filtroCidade !== 'TODAS' && !cidades.includes(PP.filtroCidade)) PP.filtroCidade = 'TODAS';
  let lista = itens.filter(i => PP.filtroCidade === 'TODAS' || i.cidade === PP.filtroCidade);
  if (PP.filtroSit === 'RUINS') lista = lista.filter(i => i.ruim);
  else if (PP.filtroSit === 'ENERGIA') lista = lista.filter(i => ['sem_energia', 'offline'].includes(i.c.situacao));
  else if (PP.filtroSit === 'PIOROU') lista = lista.filter(i => i.c.rx_anterior != null && i.c.rx_dbm != null && i.c.rx_dbm < i.c.rx_anterior);
  if (PP.filtroJanela === 'RISCO') lista = lista.filter(i => i.janela === 'IRR' || i.janela === 'IFI');
  else if (PP.filtroJanela === 'ABERTO') lista = lista.filter(i => i.janela === 'ABERTO');
  lista.sort((a, b) => a.prio - b.prio || (a.faltam == null ? 99 : a.faltam) - (b.faltam == null ? 99 : b.faltam) || (a.c.rx_dbm || 0) - (b.c.rx_dbm || 0));

  const sel = (id, val, ops) => `<select id="${id}" class="pp-sel">${ops.map(o => `<option value="${ppEsc(o[0])}"${o[0] === val ? ' selected' : ''}>${ppEsc(o[1])}</option>`).join('')}</select>`;
  cli += `<div class="panel"><div class="panel-head"><h3>Clientes com sinal ruim × O.S.</h3><span class="desc">${PP.clientes.length} contratos consultados · última consulta ${ppHora(ultimaCli)} <span class="pp-i" title="O sinal é a última leitura gravada no AutoISP, que só muda quando a OLT relê a ONU. &quot;Abrir&quot; leva à página do cliente no AutoISP, e abrir essa página faz a OLT reler o sinal.">ⓘ</span></span></div>
    <div class="pp-filtros">
      ${sel('ppFiltroJanela', PP.filtroJanela, [['RISCO', 'Vão reincidir (IRR/IFI)'], ['ABERTO', 'Já com reparo aberto'], ['TODAS', 'Qualquer janela']])}
      ${sel('ppFiltroSit', PP.filtroSit, [['RUINS', 'Sinal ruim (crítico/atenção/LoS)'], ['PIOROU', 'Sinal piorou'], ['ENERGIA', 'Sem energia/offline'], ['TODOS', 'Todos']])}
      ${sel('ppFiltroCidade', PP.filtroCidade, [['TODAS', 'Todas as cidades']].concat(cidades.map(c => [c, c])))}
      <button class="pp-btn" id="ppCsv">Exportar CSV</button>
    </div>
    <div class="table-scroll" style="max-height:520px;overflow-y:auto;"><table class="pivot compact-table pp-tab"><thead><tr>
      <th>Risco</th><th>Contrato</th><th>Cliente</th><th>Cidade · Bairro</th><th class="num">Sinal (dBm)</th><th>Situação</th><th>Mudou</th><th>Última O.S.</th><th>Técnico</th><th>OLT · PON</th><th></th>
    </tr></thead><tbody>${lista.slice(0, 500).map(ppLinha).join('') || '<tr><td colspan="11" class="muted" style="text-align:center;padding:18px;">Nenhum cliente neste filtro.</td></tr>'}</tbody></table></div>
    ${lista.length > 500 ? `<div class="pp-nota">Mostrando 500 de ${lista.length}. Use o CSV para ver todos.</div>` : ''}</div>`;

  // ---------- PONs críticas: endereços e clientes ----------
  const criticas = ppPonsCriticas(itens, L);
  rede += criticas.html;
  rede += ppGrade(L);

  // ---------- Mapa ----------
  mapa += `<div class="panel"><div class="panel-head"><h3>Mapa dos clientes</h3><span class="desc">${PP.clientes.filter(c => c.lat != null).length} com coordenada · vermelho = crítico/LoS · amarelo = atenção</span></div><div id="ppMapa" class="pp-mapa"></div></div>`;

  // ---------- Ranking por técnico + evolução ----------
  const porTec = new Map();
  itens.forEach(i => {
    if (!i.ultima || i.dias == null || i.dias > 30 || !i.ultima.recurso) return;
    const t = porTec.get(i.ultima.recurso) || { nome: i.ultima.recurso, total: 0, ruins: 0 };
    t.total++; if (i.ruim) t.ruins++;
    porTec.set(i.ultima.recurso, t);
  });
  const tecs = [...porTec.values()].filter(t => t.ruins).sort((a, b) => b.ruins - a.ruins || (b.ruins / b.total) - (a.ruins / a.total)).slice(0, 15);
  mapa += `<div class="pp-duas">
    <div class="panel"><div class="panel-head"><h3>Técnicos com mais clientes de sinal ruim</h3><span class="desc">O.S. concluídas nos últimos 30 dias</span></div>
      <div class="table-scroll"><table class="pivot compact-table"><thead><tr><th>Técnico</th><th class="num">Sinal ruim</th><th class="num">Consultados</th><th class="num">%</th></tr></thead><tbody>
      ${tecs.map(t => `<tr><td>${ppEsc(t.nome)}</td><td class="num" style="color:var(--yellow);font-weight:700">${t.ruins}</td><td class="num">${t.total}</td><td class="num">${Math.round(100 * t.ruins / t.total)}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:14px;">Sem dados ainda.</td></tr>'}
      </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h3>Evolução (48 h)</h3><span class="desc">por coleta</span></div>${ppGrafico()}</div>
  </div>`;

  html += aba('rede', rede) + aba('clientes', cli) + aba('mapa', mapa);
  el.innerHTML = html;

  const irAba = id => {
    PP.aba = id;
    el.querySelectorAll('.pp-aba').forEach(d => { d.hidden = d.dataset.aba !== id; });
    el.querySelectorAll('.pp-aba-btn').forEach(b => b.classList.toggle('active', b.dataset.ppAba === id));
    if (id === 'mapa' && PP.mapaEnquadrar) setTimeout(PP.mapaEnquadrar, 0);
  };
  el.querySelectorAll('.pp-aba-btn').forEach(b => b.onclick = () => irAba(b.dataset.ppAba));
  el.querySelectorAll('[data-pp-ir]').forEach(c => c.onclick = () => {
    if (c.dataset.ppJanela){ PP.filtroJanela = c.dataset.ppJanela; PP.filtroSit = 'RUINS'; PP.aba = c.dataset.ppIr; renderPredictPon(); }
    else irAba(c.dataset.ppIr);
    el.querySelector('.pp-abas').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('ppFiltroJanela').onchange = e => { PP.filtroJanela = e.target.value; renderPredictPon(); };
  document.getElementById('ppFiltroSit').onchange = e => { PP.filtroSit = e.target.value; renderPredictPon(); };
  document.getElementById('ppFiltroCidade').onchange = e => { PP.filtroCidade = e.target.value; renderPredictPon(); };
  document.getElementById('ppCsv').onclick = () => ppCsv(lista);
  document.getElementById('ppPonMin').onchange = e => { PP.ponMin = +e.target.value; renderPredictPon(); };
  document.getElementById('ppPonCidade').onchange = e => { PP.ponCidade = e.target.value; renderPredictPon(); };
  document.getElementById('ppPonCsv').onclick = () => ppPonsCsv(criticas.pons);
  el.querySelectorAll('[data-pp-abrir-olt]').forEach(b => b.onclick = () => {
    const d = [...el.querySelectorAll('details[data-pp-olt]')].find(x => x.dataset.ppOlt === b.dataset.ppAbrirOlt);
    if (d){ d.open = true; PP.oltAbertas.add(d.dataset.ppOlt); d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  el.querySelectorAll('details[data-pp-olt]').forEach(d => d.ontoggle = () => { d.open ? PP.oltAbertas.add(d.dataset.ppOlt) : PP.oltAbertas.delete(d.dataset.ppOlt); });
  el.querySelectorAll('details[data-pp-slot]').forEach(d => d.ontoggle = () => { d.open ? PP.slotAbertos.add(d.dataset.ppSlot) : PP.slotAbertos.delete(d.dataset.ppSlot); });
  el.querySelectorAll('details[data-pp-pon]').forEach(d => d.ontoggle = () => { d.open ? PP.ponAbertas.add(d.dataset.ppPon) : PP.ponAbertas.delete(d.dataset.ppPon); });
  ppDesenharMapa(itens);
}

// ---------- OLT degradada aberta: OLT > slot > PON > clientes > atenuados > endereços ----------
const PP_LIMITE = -27; // dBm: sinal igual ou pior que isso = atenuado (mesmo limite da extensão)
const PP_MASSIVA_LOS = 16; // clientes sem sinal (LoS) na mesma PON = massiva (regra da operação GIGA+)
const ppMassivaClientes = n => ({ nivel: 'MASSIVA', rotulo: 'Massiva', qtd: n, porClientes: true });
const ppAtenuado = c => c.rx_dbm != null && Number(c.rx_dbm) <= PP_LIMITE;
function ppDrillOlts(L, itens, alertas){
  const grupos = alertas.filter(a => a.nivel === 'OLT_PONS' && a.olt);
  if (!grupos.length) return '';
  const html = grupos.map(g => {
    const doAlerta = new Map(alertas.filter(f => f.pai === g.chave && f.pon).map(f => [f.pon, f]));
    const daOlt = itens.filter(i => i.olt === g.olt && i.c.pon);
    const porPon = new Map();
    daOlt.forEach(i => { const l = porPon.get(i.c.pon) || []; l.push(i); porPon.set(i.c.pon, l); });
    // PONs do alerta + PONs desta OLT com cliente atenuado
    const pons = new Set([...doAlerta.keys()]);
    porPon.forEach((l, pon) => { if (l.some(i => ppAtenuado(i.c))) pons.add(pon); });
    const slots = new Map();
    [...pons].forEach(pon => {
      const cli = porPon.get(pon) || [];
      const los = cli.filter(i => i.c.situacao === 'sem_sinal').length;
      const p = { pon, alerta: (los >= PP_MASSIVA_LOS ? ppMassivaClientes(los) : null) || doAlerta.get(pon) || null, cli, aten: cli.filter(i => ppAtenuado(i.c)), los };
      const sl = ppSlot(pon); (slots.get(sl) || slots.set(sl, []).get(sl)).push(p);
    });
    const ordSlots = [...slots.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const tot = { pons: pons.size, cli: 0, aten: 0 };
    const htmlSlots = ordSlots.map(sl => {
      const lista = slots.get(sl).sort((a, b) => +ppPorta(a.pon) - +ppPorta(b.pon));
      const sCli = lista.reduce((n, p) => n + p.cli.length, 0), sAten = lista.reduce((n, p) => n + p.aten.length, 0);
      tot.cli += sCli; tot.aten += sAten;
      const kSlot = g.olt + '|' + sl;
      const linhasPon = lista.map(p => {
        const cor = p.alerta ? (p.alerta.nivel === 'MASSIVA' ? 'red' : 'peach') : 'text-dim';
        const end = p.aten.slice().sort((a, b) => ppRua(a.endereco).localeCompare(ppRua(b.endereco)) || Number(a.c.rx_dbm) - Number(b.c.rx_dbm)).map(i =>
          `<tr><td>${ppEsc(i.endereco) || '<span class="muted">sem O.S. carregada</span>'}</td><td>${ppEsc(i.bairro)}</td><td>${ppEsc(i.cliente) || '<span class="muted">—</span>'}</td><td class="mono">${ppEsc(i.c.contrato)}</td><td class="num" style="color:var(--${(PP_SIT[i.c.situacao] || {}).c || 'text'});font-weight:700">${ppDbm(i.c.rx_dbm)}</td></tr>`).join('');
        return `<div class="pp-dpon">
          <div class="pp-dpon-h"><b class="mono" style="color:var(--${cor})">PON ${ppEsc(p.pon)}</b>${p.alerta ? `<span class="pp-tag pp-${p.alerta.nivel === 'MASSIVA' ? 'red' : 'peach'}">${ppEsc(p.alerta.rotulo || p.alerta.nivel)} · ${p.alerta.qtd} ${p.alerta.porClientes ? 'clientes sem sinal' : 'ONUs'}</span>` : '<span class="pp-tag">fora do alerta</span>'}
            <span><b>${p.cli.length}</b> clientes consultados</span><span style="color:var(--${p.aten.length ? 'red' : 'text-dim'})"><b>${p.aten.length}</b> atenuados (≤ ${PP_LIMITE} dBm)</span>${p.los ? `<span class="muted">${p.los} em LoS</span>` : ''}</div>
          ${end ? `<div class="table-scroll"><table class="pivot compact-table pp-tab"><thead><tr><th>Endereço</th><th>Bairro</th><th>Cliente</th><th>Contrato</th><th class="num">Sinal</th></tr></thead><tbody>${end}</tbody></table></div>` : ''}
        </div>`;
      }).join('');
      return `<details class="pp-dslot" data-pp-slot="${ppEsc(kSlot)}"${PP.slotAbertos.has(kSlot) ? ' open' : ''}><summary><b>Slot ${ppEsc(sl)}</b><span>${lista.length} PON(s)</span><span>${sCli} clientes consultados</span><span style="color:var(--${sAten ? 'red' : 'text-dim'})">${sAten} atenuados</span></summary>${linhasPon}</details>`;
    }).join('');
    return `<details class="pp-dolt" data-pp-olt="${ppEsc(g.olt)}"${PP.oltAbertas.has(g.olt) ? ' open' : ''}><summary>
      <span class="pp-olt-tag" style="--c:var(--red)">${ppEsc(g.rotulo || 'OLT degradada')}</span><b class="mono">${ppEsc(g.olt)}</b>
      <span>${ordSlots.length} slots · ${tot.pons} PONs</span><span>${tot.cli} clientes consultados</span><span style="color:var(--red)"><b>${tot.aten}</b> atenuados</span></summary>${htmlSlots || '<div class="muted" style="padding:8px 12px;font-size:12.5px;">Nenhum cliente consultado nesta OLT ainda.</div>'}</details>`;
  }).join('');
  return `<div class="panel"><div class="panel-head"><h3>OLTs degradadas por slot e PON</h3><span class="desc">OLT › slot › PON › clientes › atenuados › endereços <span class="pp-i" title="&quot;Clientes consultados&quot; são os contratos com O.S. nos últimos 90 dias que a extensão já leu no AutoISP, não todos os clientes da PON. &quot;ONUs&quot; na etiqueta é quantas ONUs da PON estão na lista de problema do AutoISP. Endereço e nome vêm da última O.S. do contrato.">ⓘ</span></span></div>${html}</div>`;
}

// ---------- PONs críticas ----------
// Junta os clientes consultados por OLT + PON. Crítica = muitos clientes em crítico/LoS na mesma PON,
// ou a PON está como massiva/risco de massiva na última leitura. Dentro de cada PON, os clientes são
// agrupados por rua (logradouro sem número), que é o que ajuda a achar a CTO/caixa em campo.
const ppRua = end => {
  const t = String(end || '').replace(/\s+/g, ' ').trim();
  if (!t) return '(sem endereço na O.S.)';
  const m = t.match(/^(.*?)(?:,|\s+(?:n[º°o.]*\s*)?\d+\b|\s+-\s)/i);
  return ((m && m[1]) || t).trim().toLowerCase().replace(/(^|\s)(\S)(\S*)/g, (x, sp, a, b) => sp + (/^(d[aeo]s?|e)$/.test(a + b) && sp ? a : a.toUpperCase()) + b);
};
const PP_GRAVE = ['critico', 'sem_sinal'];
function ppPonsCriticas(itens, L){
  const alertaPon = new Map();
  (L.alertas || []).forEach(a => { if ((a.nivel === 'MASSIVA' || a.nivel === 'RISCO_PON') && a.olt && a.pon) alertaPon.set(a.olt + '|' + a.pon, a); });
  const mapa = new Map();
  itens.forEach(i => {
    if (!i.c.pon || !i.olt) return;
    const k = i.olt + '|' + i.c.pon;
    const p = mapa.get(k) || { k, olt: i.olt, pon: i.c.pon, itens: [], graves: 0, atencao: 0, energia: 0, risco: 0, cidades: new Map() };
    p.itens.push(i);
    if (PP_GRAVE.includes(i.c.situacao)) p.graves++;
    if (i.c.situacao === 'sem_sinal') p.los = (p.los || 0) + 1;
    if (i.c.situacao === 'atencao') p.atencao++;
    if (i.c.situacao === 'sem_energia' || i.c.situacao === 'offline') p.energia++;
    if (i.ruim && (i.janela === 'IRR' || i.janela === 'IFI')) p.risco++;
    if (i.cidade) p.cidades.set(i.cidade, (p.cidades.get(i.cidade) || 0) + 1);
    mapa.set(k, p);
  });
  let pons = [...mapa.values()].map(p => {
    p.alerta = (p.los >= PP_MASSIVA_LOS ? ppMassivaClientes(p.los) : null) || alertaPon.get(p.k) || null;
    p.cidade = [...p.cidades.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '';
    return p;
  }).filter(p => p.alerta || p.graves >= PP.ponMin);
  const cidades = [...new Set(pons.map(p => p.cidade).filter(Boolean))].sort();
  if (PP.ponCidade !== 'TODAS' && !cidades.includes(PP.ponCidade)) PP.ponCidade = 'TODAS';
  if (PP.ponCidade !== 'TODAS') pons = pons.filter(p => p.cidade === PP.ponCidade);
  const peso = p => (p.alerta ? (p.alerta.nivel === 'MASSIVA' ? 2000 : 1000) : 0) + p.graves * 10 + p.atencao;
  pons.sort((a, b) => peso(b) - peso(a) || b.risco - a.risco);

  const sel = (id, val, ops) => `<select id="${id}" class="pp-sel">${ops.map(o => `<option value="${ppEsc(o[0])}"${String(o[0]) === String(val) ? ' selected' : ''}>${ppEsc(o[1])}</option>`).join('')}</select>`;
  let h = `<div class="panel"><div class="panel-head"><h3>PONs críticas: endereços e clientes</h3><span class="desc">${pons.length} PON(s) · clientes agrupados por rua · clique para abrir <span class="pp-i" title="Endereço e nome vêm da O.S. mais recente do contrato carregada no painel (o AutoISP não manda endereço). Vários clientes ruins na mesma rua costumam ser a mesma CTO; espalhados pela PON, olhar troncal/splitter primário.">ⓘ</span></span></div>
    <div class="pp-filtros">
      ${sel('ppPonMin', PP.ponMin, [[2, '2+ clientes em crítico/LoS'], [3, '3+ clientes em crítico/LoS'], [5, '5+ clientes em crítico/LoS'], [10, '10+ clientes em crítico/LoS']])}
      ${sel('ppPonCidade', PP.ponCidade, [['TODAS', 'Todas as cidades']].concat(cidades.map(c => [c, c])))}
      <button class="pp-btn" id="ppPonCsv">Exportar CSV</button>
    </div>`;
  if (!pons.length){
    return { pons, html: h + '<div class="muted" style="font-size:12.5px;padding:8px 0;">Nenhuma PON crítica neste filtro.</div></div>' };
  }
  const MAX = 40;
  h += '<div class="pp-pons">' + pons.slice(0, MAX).map(p => {
    const ruas = new Map();
    p.itens.forEach(i => { const r = ppRua(i.endereco); const g = ruas.get(r) || { rua: r, bairros: new Set(), itens: [] }; g.itens.push(i); if (i.bairro) g.bairros.add(i.bairro); ruas.set(r, g); });
    const grupos = [...ruas.values()].map(g => Object.assign(g, { graves: g.itens.filter(i => PP_GRAVE.includes(i.c.situacao)).length }))
      .sort((a, b) => b.graves - a.graves || b.itens.length - a.itens.length);
    const bairros = [...new Set(p.itens.map(i => i.bairro).filter(Boolean))];
    const tag = p.alerta ? `<span class="pp-tag pp-${p.alerta.nivel === 'MASSIVA' ? 'red' : 'peach'}">${ppEsc(p.alerta.rotulo || p.alerta.nivel)}${p.alerta.porClientes ? ` · ${p.alerta.qtd} sem sinal` : ''}</span>` : '';
    const linhas = grupos.map(g => {
      const its = g.itens.slice().sort((a, b) => (PP_GRAVE.includes(b.c.situacao) - PP_GRAVE.includes(a.c.situacao)) || (a.c.rx_dbm || 0) - (b.c.rx_dbm || 0));
      return `<tr class="pp-rua"><td colspan="6"><b>${ppEsc(g.rua)}</b>${g.bairros.size ? ' · ' + ppEsc([...g.bairros].join(', ')) : ''} <span class="muted">· ${g.itens.length} cliente(s)${g.graves ? `, <span style="color:var(--red)">${g.graves} em crítico/LoS</span>` : ''}</span></td></tr>` +
        its.map(i => { const s = PP_SIT[i.c.situacao] || { t: i.c.situacao, c: 'text' };
          const risco = i.janela === 'IRR' ? `<span class="pp-tag pp-red">IRR ${i.faltam}d</span>` : i.janela === 'IFI' ? `<span class="pp-tag pp-yellow">IFI ${i.faltam}d</span>` : i.janela === 'ABERTO' ? '<span class="pp-tag pp-peach">reparo aberto</span>' : '';
          return `<tr><td>${ppEsc(i.cliente) || '<span class="muted">—</span>'}</td><td class="mono">${ppEsc(i.c.contrato)}</td><td>${ppEsc(i.endereco) || '<span class="muted">sem O.S. carregada</span>'}</td><td class="num" style="color:var(--${s.c});font-weight:700">${ppDbm(i.c.rx_dbm)}</td><td style="color:var(--${s.c})">${ppEsc(s.t)}</td><td>${risco}</td></tr>`; }).join('');
    }).join('');
    const corPon = p.alerta ? (p.alerta.nivel === 'MASSIVA' ? 'red' : 'peach') : p.graves >= 10 ? 'red' : 'yellow';
    return `<details class="pp-pon" style="--c:var(--${corPon})" data-pp-pon="${ppEsc(p.k)}"${PP.ponAbertas.has(p.k) ? ' open' : ''}><summary>
      <div class="pp-pon-h">${tag}<b class="mono">${ppEsc(p.olt)} · PON ${ppEsc(p.pon)}</b><span class="muted">${ppEsc(p.cidade)}</span></div>
      <div class="pp-pon-n"><span style="color:var(--red)"><b>${p.graves}</b> crítico/LoS</span><span style="color:var(--yellow)"><b>${p.atencao}</b> atenção</span>${p.energia ? `<span style="color:var(--peach)"><b>${p.energia}</b> sem energia/offline</span>` : ''}${p.risco ? `<span><b>${p.risco}</b> vão reincidir</span>` : ''}<span class="muted">${p.itens.length} consultados</span></div>
      <div class="pp-pon-b">${bairros.length ? 'Bairros: ' + ppEsc(bairros.slice(0, 6).join(', ')) + (bairros.length > 6 ? ` +${bairros.length - 6}` : '') + ' · ' : ''}Ruas: ${grupos.slice(0, 4).map(g => ppEsc(g.rua) + ' (' + g.itens.length + ')').join(', ')}${grupos.length > 4 ? ` +${grupos.length - 4}` : ''}</div>
    </summary><div class="table-scroll"><table class="pivot compact-table pp-tab"><thead><tr><th>Cliente</th><th>Contrato</th><th>Endereço</th><th class="num">Sinal</th><th>Situação</th><th>Risco</th></tr></thead><tbody>${linhas}</tbody></table></div></details>`;
  }).join('') + '</div>';
  if (pons.length > MAX) h += `<div class="pp-nota">Mostrando as ${MAX} piores de ${pons.length}. O CSV traz todas.</div>`;
  h += '</div>';
  return { pons, html: h };
}
function ppPonsCsv(pons){
  const cab = ['olt', 'pon', 'cidade_pon', 'alerta_pon', 'pon_critico_los', 'rua', 'endereco', 'bairro', 'cliente', 'contrato', 'sinal_dbm', 'situacao', 'risco', 'faltam_dias', 'consultado_em'];
  const linhas = [];
  pons.forEach(p => p.itens.forEach(i => linhas.push([p.olt, p.pon, p.cidade, p.alerta ? p.alerta.rotulo || p.alerta.nivel : '', p.graves, ppRua(i.endereco), i.endereco, i.bairro, i.cliente, i.c.contrato, i.c.rx_dbm, (PP_SIT[i.c.situacao] || {}).t || i.c.situacao, i.janela === 'FORA' ? '' : i.janela, i.faltam, i.c.checado_em])));
  ppBaixarCsv('predict-pon-pons-criticas-', cab, linhas);
}

// Grade de PONs por OLT (igual à da extensão): uma linha por slot, um quadrado por PON com alerta.
// Número de cima = porta da PON; de baixo = ONUs nos alertas daquela PON. Cor = pior alerta da PON.
const PP_ORDEM = ['OLT_PONS', 'MASSIVA', 'RISCO_PON', 'OLT', 'ENERGIA', 'CTO', 'ONU'];
const PP_COR_GRADE = { OLT_PONS: 'red', MASSIVA: 'red', RISCO_PON: 'peach', OLT: 'red', ENERGIA: 'yellow', CTO: 'accent', ONU: 'accent' };
const ppPior = lista => lista.reduce((m, a) => m == null || PP_ORDEM.indexOf(a.nivel) < PP_ORDEM.indexOf(m) ? a.nivel : m, null);
const ppSlot = pon => { const p = String(pon || '').split('/'); return p.length > 1 ? p.slice(0, -1).join('/') : '?'; };
const ppPorta = pon => { const p = String(pon || '').split('/'); return p[p.length - 1]; };
function ppGrade(L){
  const cidadeOlt = nome => { const o = (L.olts || []).find(x => x.hostname === nome); return o && o.cidades && o.cidades[0] || ''; };
  const porOlt = new Map();
  (L.alertas || []).forEach(a => {
    if (!a.olt) return;
    const o = porOlt.get(a.olt) || { olt: a.olt, alertas: [], onus: 0 };
    o.alertas.push(a);
    if (a.nivel !== 'OLT_PONS' && a.nivel !== 'OLT') o.onus += a.qtd || 0;
    porOlt.set(a.olt, o);
  });
  const olts = [...porOlt.values()].map(o => Object.assign(o, { pior: ppPior(o.alertas) }))
    .sort((a, b) => PP_ORDEM.indexOf(a.pior) - PP_ORDEM.indexOf(b.pior) || b.onus - a.onus);
  const leg = ['OLT_PONS', 'RISCO_PON', 'ENERGIA', 'ONU'].map(n => `<span><i style="background:var(--${PP_COR_GRADE[n]})"></i>${{ OLT_PONS: 'Massiva / OLT', RISCO_PON: 'Risco de massiva', ENERGIA: 'Energia', ONU: 'CTO / ONUs isoladas' }[n]}</span>`).join('');
  let h = `<div class="panel"><div class="panel-head"><h3>Grade de PONs</h3><span class="desc">linha = slot · quadrado = PON com problema · número de baixo = ONUs com alerta <span class="pp-i" title="Passe o mouse num quadrado para ver os alertas daquela PON. Muitas PONs de slots diferentes ao mesmo tempo apontam para a OLT (energia, temperatura, uplink), não para a rede externa.">ⓘ</span></span></div>`;
  if (!olts.length) return h + '<div class="muted" style="font-size:12.5px;">Nenhuma OLT com alerta na última coleta. 👍</div></div>';
  h += '<div class="pp-grade">' + olts.map(o => {
    const porPon = new Map();
    o.alertas.forEach(a => {
      if (!a.pon || a.nivel === 'OLT_PONS' || a.nivel === 'OLT') return;
      const p = porPon.get(a.pon) || { pon: a.pon, alertas: [], onus: 0 };
      p.alertas.push(a); p.onus += a.qtd || 0;
      porPon.set(a.pon, p);
    });
    const slots = new Map();
    porPon.forEach(p => { const sl = ppSlot(p.pon); (slots.get(sl) || slots.set(sl, []).get(sl)).push(p); });
    const linhas = [...slots.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(sl =>
      `<div class="pp-slot"><span class="pp-sl">slot ${ppEsc(sl)}</span>${slots.get(sl).sort((a, b) => +ppPorta(a.pon) - +ppPorta(b.pon)).map(p => {
        const n = ppPior(p.alertas);
        return `<span class="pp-pq" style="--c:var(--${PP_COR_GRADE[n] || 'text-dim'})" title="PON ${ppEsc(p.pon)} · ${ppEsc(p.alertas.map(a => (a.rotulo || a.nivel) + ': ' + (a.detalhe || '')).join(' | '))}">${ppEsc(ppPorta(p.pon))}<small>${p.onus}</small></span>`;
      }).join('')}</div>`).join('');
    const grupo = o.alertas.find(a => a.nivel === 'OLT_PONS' || a.nivel === 'OLT');
    const dx = grupo ? grupo.detalhe : `${porPon.size} PON(s) com alerta, ${o.onus} ONUs.`;
    const rot = (o.alertas.find(a => a.nivel === o.pior) || {}).rotulo || o.pior;
    return `<div class="pp-olt"><div class="pp-olt-h"><span class="pp-olt-tag" style="--c:var(--${PP_COR_GRADE[o.pior] || 'text-dim'})">${ppEsc(rot)}</span><b>${ppEsc(o.olt)}</b><span class="muted">${ppEsc(cidadeOlt(o.olt))}</span></div><div class="pp-olt-dx">${ppEsc(dx)}</div>${linhas}</div>`;
  }).join('') + '</div>';
  return h + `<div class="pp-leg">${leg}</div></div>`;
}

function ppLinha(i){
  const c = i.c, s = PP_SIT[c.situacao] || { t: c.situacao, c: 'text' };
  const risco = i.janela === 'IRR' ? `<span class="pp-tag pp-red">IRR · faltam ${i.faltam}d</span>`
    : i.janela === 'IFI' ? `<span class="pp-tag pp-yellow">IFI · faltam ${i.faltam}d</span>`
    : i.janela === 'ABERTO' ? '<span class="pp-tag pp-peach">reparo aberto</span>' : '<span class="pp-tag">preventiva</span>';
  const mudou = c.mudou_em && c.rx_anterior != null && c.rx_dbm != null
    ? `${ppDbm(c.rx_anterior)} → ${ppDbm(c.rx_dbm)} <small class="muted">${ppHora(c.mudou_em)}</small>`
    : c.situacao_anterior && c.mudou_em ? `${ppEsc((PP_SIT[c.situacao_anterior] || {}).t || c.situacao_anterior)} → ${ppEsc(s.t)}` : '';
  const os = i.ultima ? `${ppEsc(i.ultima.tipo)} · há ${i.dias}d` : '<span class="muted">sem O.S. carregada</span>';
  return `<tr>
    <td>${risco}</td><td class="mono">${ppEsc(c.contrato)}</td><td>${ppEsc(i.cliente)}</td><td>${ppEsc(i.cidade)}${i.bairro ? ' · ' + ppEsc(i.bairro) : ''}</td>
    <td class="num" style="color:var(--${s.c});font-weight:700">${ppDbm(c.rx_dbm)}</td><td style="color:var(--${s.c})">${ppEsc(s.t)}</td>
    <td>${mudou}</td><td>${os}</td><td>${ppEsc(i.ultima ? i.ultima.recurso : '')}</td><td>${ppEsc(i.olt || '')}${c.pon ? ' · ' + ppEsc(c.pon) : ''}</td>
    <td>${c.gpon_id ? `<a href="${PP_AUTOISP}/gpon_clients/${encodeURIComponent(c.gpon_id)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}</td></tr>`;
}

function ppGrafico(){
  const s = PP.leituras;
  if (s.length < 2) return '<div class="muted" style="font-size:12.5px;">Precisa de 2 coletas ou mais.</div>';
  const W = 520, H = 160, P = 24;
  const series = [['criticas', 'ONUs críticas', 'yellow'], ['massivas', 'Massivas', 'red'], ['risco', 'Risco de massiva', 'peach']];
  const t0 = new Date(s[0].coletado_em).getTime(), t1 = new Date(s[s.length - 1].coletado_em).getTime() || t0 + 1;
  const max = Math.max(1, ...s.flatMap(x => series.map(k => (x.resumo || {})[k[0]] || 0)));
  const X = t => P + (W - 2 * P) * (t - t0) / Math.max(1, t1 - t0), Y = v => H - P - (H - 2 * P) * v / max;
  const linhas = series.map(k => `<polyline fill="none" stroke="var(--${k[2]})" stroke-width="2" points="${s.map(x => X(new Date(x.coletado_em).getTime()).toFixed(1) + ',' + Y((x.resumo || {})[k[0]] || 0).toFixed(1)).join(' ')}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="pp-graf"><line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--border)"/><text x="${P}" y="${P - 8}" fill="var(--text-faint)" font-size="10">máx ${max}</text><text x="${P}" y="${H - 6}" fill="var(--text-faint)" font-size="10">${ppHora(s[0].coletado_em)}</text><text x="${W - P}" y="${H - 6}" fill="var(--text-faint)" font-size="10" text-anchor="end">${ppHora(s[s.length - 1].coletado_em)}</text>${linhas}</svg>
    <div class="pp-leg">${series.map(k => `<span><i style="background:var(--${k[2]})"></i>${k[1]}</span>`).join('')}</div>`;
}

function ppCsv(lista){
  const cab = ['risco', 'faltam_dias', 'contrato', 'cliente', 'cidade', 'bairro', 'endereco', 'sinal_dbm', 'situacao', 'sinal_anterior', 'mudou_em', 'ultima_os', 'dias_desde_os', 'tecnico', 'olt', 'pon', 'serial', 'consultado_em'];
  const linhas = lista.map(i => [i.janela, i.faltam, i.c.contrato, i.cliente, i.cidade, i.bairro, i.endereco, i.c.rx_dbm, (PP_SIT[i.c.situacao] || {}).t || i.c.situacao, i.c.rx_anterior, i.c.mudou_em, i.ultima ? i.ultima.tipo : '', i.dias, i.ultima ? i.ultima.recurso : '', i.olt, i.c.pon, i.c.serial, i.c.checado_em]);
  ppBaixarCsv('predict-pon-clientes-', cab, linhas);
}
function ppBaixarCsv(prefixo, cab, linhas){
  const txt = '\ufeff' + [cab].concat(linhas).map(l => l.map(v => { const s = v == null ? '' : String(v).replace('.', typeof v === 'number' ? ',' : '.'); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = prefixo + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Leaflet só é baixado quando alguém abre o módulo.
function ppLeaflet(){
  if (window.L) return Promise.resolve();
  if (PP.leafletPronto) return PP.leafletPronto;
  PP.leafletPronto = new Promise((ok, falha) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = ok; js.onerror = () => { PP.leafletPronto = null; falha(new Error('Leaflet não carregou')); };
    document.head.appendChild(js);
  });
  return PP.leafletPronto;
}
async function ppDesenharMapa(itens){
  const div = document.getElementById('ppMapa');
  if (!div) return;
  try{ await ppLeaflet(); }catch(e){ div.innerHTML = '<div class="muted" style="padding:20px;">Mapa indisponível (não consegui carregar o Leaflet).</div>'; return; }
  if (PP.mapa){ PP.mapa.remove(); PP.mapa = null; }
  const mapa = PP.mapa = L.map(div, { zoomControl: true });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }).addTo(mapa);
  const css = getComputedStyle(document.documentElement);
  const cor = n => css.getPropertyValue('--' + n).trim() || '#888';
  const pontos = [];
  itens.filter(i => i.c.lat != null && i.c.lng != null).sort((a, b) => b.prio - a.prio).forEach(i => {
    const s = PP_SIT[i.c.situacao] || { c: 'text-faint', t: i.c.situacao };
    const risco = i.janela === 'IRR' || i.janela === 'IFI';
    const m = L.circleMarker([i.c.lat, i.c.lng], { radius: i.ruim ? (risco ? 8 : 6) : 3, color: risco ? cor('text') : cor(s.c), weight: risco ? 2 : 1, fillColor: cor(s.c), fillOpacity: i.ruim ? 0.9 : 0.4 }).addTo(mapa);
    m.bindPopup(`<b>${ppEsc(i.cliente || 'Contrato ' + i.c.contrato)}</b><br>Contrato ${ppEsc(i.c.contrato)}<br>${ppEsc(s.t)} · ${ppDbm(i.c.rx_dbm)} dBm<br>${ppEsc(i.olt || '')} ${i.c.pon ? '· PON ' + ppEsc(i.c.pon) : ''}${i.ultima ? '<br>' + ppEsc(i.ultima.tipo) + ' há ' + i.dias + 'd · ' + ppEsc(i.ultima.recurso) : ''}`);
    pontos.push([i.c.lat, i.c.lng]);
  });
  // o mapa pode nascer numa aba escondida (tamanho 0): enquadra de novo quando a aba abrir
  PP.mapaEnquadrar = () => { mapa.invalidateSize(); if (pontos.length) mapa.fitBounds(pontos, { padding: [20, 20], maxZoom: 15 }); else mapa.setView([-23.96, -46.33], 10); };
  PP.mapaEnquadrar(); // Baixada Santista quando não há ponto
}

// Tempo real: canal próprio, para não derrubar o resto do painel se a migração 0020 não tiver rodado.
function ppIniciarRealtime(){
  supabaseClient
    .channel('painel-realtime-predict-pon')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'predict_pon_leituras' }, ppAgendar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'predict_pon_clientes' }, ppAgendar)
    .subscribe();
}
function ppAgendar(){
  PP.carregado = false;
  clearTimeout(PP.timer);
  PP.timer = setTimeout(() => { if (typeof currentModule !== 'undefined' && currentModule === 'predict-pon') renderPredictPon(true); }, 4000);
}
