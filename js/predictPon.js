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
  filtroCidade: 'TODAS', filtroJanela: 'RISCO', filtroSit: 'RUINS',
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
    PP.leitura = ult.data || null;
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

// Última O.S. (Reparo / Ativação / Mudança) de cada contrato, a partir das O.S. já carregadas no painel.
function ppOsPorContrato(){
  const mapa = new Map();
  const TIPOS = ['Reparo Corretivo', 'Ativação', 'Mudança de Endereço', 'Mudança de Cômodo'];
  (typeof getAllRows === 'function' ? getAllRows() : []).forEach(r => {
    if (!r.contrato || !TIPOS.includes(r.tipo)) return;
    const k = ppChave(r.contrato);
    const quando = r.fimDate || r.aberturaDate || (typeof parseDDMMYY === 'function' ? parseDDMMYY(r.data) : null);
    if (!quando) return;
    const m = mapa.get(k) || { ultima: null, aberta: null, cliente: '' };
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
    it.cidade = c.cidade || (it.ultima && it.ultima.cidade) || '';
    it.bairro = c.bairro || (it.ultima && it.ultima.bairro) || '';
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

  const cards = [
    { v: R.olts_degradadas || 0, l: 'OLTs degradadas', c: 'red' },
    { v: R.massivas || 0, l: 'Massivas', c: 'red' },
    { v: R.risco || 0, l: 'Risco de massiva', c: 'peach' },
    { v: R.olts_falha || 0, l: 'OLT sem conexão', c: 'red' },
    { v: ruins.length, l: 'Clientes c/ sinal ruim', c: 'yellow' },
    { v: emRisco.length, l: 'Vão reincidir (IRR/IFI)', c: 'red', clique: 'RISCO' }
  ];

  let html = '';
  if (idade.cor !== 'green'){
    html += `<div class="pp-aviso pp-${idade.cor}">⚠ A última coleta foi há <b>${idade.txt}</b>. A coleta depende do Chrome de quem roda a extensão estar aberto e logado no AutoISP.</div>`;
  }
  html += `<div class="pp-cards">${cards.map(k => `<div class="venc-card${k.clique ? ' clickable-card' : ''}" ${k.clique ? `data-pp-janela="${k.clique}"` : ''}><div class="value" style="color:var(--${k.v ? k.c : 'text-faint'})">${k.v}</div><div class="label">${k.l}</div></div>`).join('')}</div>`;

  // ---------- O que fazer agora ----------
  const top = alertas.filter(a => !a.pai).slice(0, 8);
  html += `<div class="panel"><div class="panel-head"><h3>O que fazer agora</h3><span class="desc">rede (OLT/PON) · pior primeiro · <span class="pp-idade pp-${idade.cor}">coleta há ${idade.txt}</span></span></div>`;
  html += top.length ? '<div class="pp-diag">' + top.map(a => {
    const n = PP_NIVEL[a.nivel] || {};
    const filhos = alertas.filter(f => f.pai === a.chave).map(f => f.pon);
    const onde = a.nivel === 'OLT_PONS' ? ppEsc(a.olt || '') : `${ppEsc(a.olt || '')}${a.pon ? ' · PON ' + ppEsc(a.pon) : ''}`;
    return `<div class="pp-dg" style="--c:var(--${n.c || 'text-dim'})"><div class="pp-dg-h"><b>${ppEsc(a.rotulo || a.nivel)}</b>${a.novo ? '<span class="pp-novo">novo</span>' : ''}<span class="pp-dg-onde">${onde}</span></div><div class="pp-dg-t">${ppEsc(a.detalhe)}</div>${filhos.length ? `<div class="pp-dg-onde" style="margin-top:4px">PONs: ${filhos.map(ppEsc).join(', ')}</div>` : ''}<div class="pp-dg-a">➜ ${ppEsc(n.acao || '')}</div></div>`;
  }).join('') + '</div>' : '<div class="muted" style="font-size:12.5px;">Nenhum alerta de OLT/PON na última coleta.</div>';
  html += '<div class="pp-nota">Os alertas de rede vêm da lista de ONUs com problema do AutoISP, que é quase toda de ONUs sem contrato. Servem como indício físico na PON. O sinal dos clientes de verdade está na tabela abaixo.</div></div>';

  html += ppGrade(L);

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
  html += `<div class="panel"><div class="panel-head"><h3>Clientes com sinal ruim × O.S.</h3><span class="desc">${PP.clientes.length} contratos consultados · última consulta ${ppHora(ultimaCli)}</span></div>
    <div class="pp-filtros">
      ${sel('ppFiltroJanela', PP.filtroJanela, [['RISCO', 'Vão reincidir (IRR/IFI)'], ['ABERTO', 'Já com reparo aberto'], ['TODAS', 'Qualquer janela']])}
      ${sel('ppFiltroSit', PP.filtroSit, [['RUINS', 'Sinal ruim (crítico/atenção/LoS)'], ['PIOROU', 'Sinal piorou'], ['ENERGIA', 'Sem energia/offline'], ['TODOS', 'Todos']])}
      ${sel('ppFiltroCidade', PP.filtroCidade, [['TODAS', 'Todas as cidades']].concat(cidades.map(c => [c, c])))}
      <button class="pp-btn" id="ppCsv">Exportar CSV</button>
    </div>
    <div class="table-scroll" style="max-height:520px;overflow-y:auto;"><table class="pivot compact-table pp-tab"><thead><tr>
      <th>Risco</th><th>Contrato</th><th>Cliente</th><th>Cidade · Bairro</th><th class="num">Sinal (dBm)</th><th>Situação</th><th>Mudou</th><th>Última O.S.</th><th>Técnico</th><th>OLT · PON</th><th></th>
    </tr></thead><tbody>${lista.slice(0, 500).map(ppLinha).join('') || '<tr><td colspan="11" class="muted" style="text-align:center;padding:18px;">Nenhum cliente neste filtro.</td></tr>'}</tbody></table></div>
    ${lista.length > 500 ? `<div class="pp-nota">Mostrando 500 de ${lista.length}. Use o CSV para ver todos.</div>` : ''}
    <div class="pp-nota">O sinal é a última leitura gravada no AutoISP, que só muda quando a OLT relê a ONU. "Abrir" leva à página do cliente no AutoISP, e abrir essa página faz a OLT reler o sinal.</div></div>`;

  // ---------- Mapa + PONs com mais clientes ruins ----------
  const porPon = new Map();
  PP.clientes.forEach(c => {
    if (!c.olt || !c.pon) return;
    const k = c.olt + ' · ' + c.pon;
    const p = porPon.get(k) || { olt: c.olt, pon: c.pon, total: 0, ruins: 0, crit: 0, cidade: c.cidade || '' };
    p.total++; if (PP_RUINS.includes(c.situacao)) p.ruins++; if (c.situacao === 'critico' || c.situacao === 'sem_sinal') p.crit++;
    porPon.set(k, p);
  });
  const pons = [...porPon.values()].filter(p => p.ruins >= 2).sort((a, b) => b.ruins - a.ruins || b.crit - a.crit).slice(0, 15);
  html += `<div class="pp-duas">
    <div class="panel"><div class="panel-head"><h3>Mapa dos clientes</h3><span class="desc">${PP.clientes.filter(c => c.lat != null).length} com coordenada · vermelho = crítico/LoS · amarelo = atenção</span></div><div id="ppMapa" class="pp-mapa"></div></div>
    <div class="panel"><div class="panel-head"><h3>PONs com mais clientes ruins</h3><span class="desc">2 ou mais clientes com sinal ruim na mesma PON = olhar CTO/troncal</span></div>
      <div class="table-scroll"><table class="pivot compact-table"><thead><tr><th>OLT · PON</th><th>Cidade</th><th class="num">Ruins</th><th class="num">Críticos/LoS</th><th class="num">Consultados</th></tr></thead><tbody>
      ${pons.map(p => `<tr><td>${ppEsc(p.olt)} · ${ppEsc(p.pon)}</td><td>${ppEsc(p.cidade)}</td><td class="num" style="color:var(--yellow);font-weight:700">${p.ruins}</td><td class="num" style="color:var(--red)">${p.crit}</td><td class="num">${p.total}</td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:14px;">Nenhuma PON com 2 ou mais clientes ruins.</td></tr>'}
      </tbody></table></div></div>
  </div>`;

  // ---------- Ranking por técnico + evolução ----------
  const porTec = new Map();
  itens.forEach(i => {
    if (!i.ultima || i.dias == null || i.dias > 30 || !i.ultima.recurso) return;
    const t = porTec.get(i.ultima.recurso) || { nome: i.ultima.recurso, total: 0, ruins: 0 };
    t.total++; if (i.ruim) t.ruins++;
    porTec.set(i.ultima.recurso, t);
  });
  const tecs = [...porTec.values()].filter(t => t.ruins).sort((a, b) => b.ruins - a.ruins || (b.ruins / b.total) - (a.ruins / a.total)).slice(0, 15);
  html += `<div class="pp-duas">
    <div class="panel"><div class="panel-head"><h3>Técnicos com mais clientes de sinal ruim</h3><span class="desc">O.S. concluídas nos últimos 30 dias</span></div>
      <div class="table-scroll"><table class="pivot compact-table"><thead><tr><th>Técnico</th><th class="num">Sinal ruim</th><th class="num">Consultados</th><th class="num">%</th></tr></thead><tbody>
      ${tecs.map(t => `<tr><td>${ppEsc(t.nome)}</td><td class="num" style="color:var(--yellow);font-weight:700">${t.ruins}</td><td class="num">${t.total}</td><td class="num">${Math.round(100 * t.ruins / t.total)}%</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:14px;">Sem dados ainda.</td></tr>'}
      </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h3>Evolução (48 h)</h3><span class="desc">por coleta</span></div>${ppGrafico()}</div>
  </div>`;

  el.innerHTML = html;

  el.querySelectorAll('[data-pp-janela]').forEach(c => c.onclick = () => { PP.filtroJanela = c.dataset.ppJanela; PP.filtroSit = 'RUINS'; renderPredictPon(); });
  document.getElementById('ppFiltroJanela').onchange = e => { PP.filtroJanela = e.target.value; renderPredictPon(); };
  document.getElementById('ppFiltroSit').onchange = e => { PP.filtroSit = e.target.value; renderPredictPon(); };
  document.getElementById('ppFiltroCidade').onchange = e => { PP.filtroCidade = e.target.value; renderPredictPon(); };
  document.getElementById('ppCsv').onclick = () => ppCsv(lista);
  ppDesenharMapa(itens);
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
  let h = `<div class="panel"><div class="panel-head"><h3>Grade de PONs</h3><span class="desc">linha = slot · quadrado = PON com problema · número de baixo = ONUs com alerta</span></div>`;
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
  return h + `<div class="pp-leg">${leg}</div><div class="pp-nota">Passe o mouse num quadrado para ver os alertas daquela PON. Muitas PONs de slots diferentes ao mesmo tempo apontam para a OLT (energia, temperatura, uplink), não para a rede externa.</div></div>`;
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
    <td>${mudou}</td><td>${os}</td><td>${ppEsc(i.ultima ? i.ultima.recurso : '')}</td><td>${ppEsc(c.olt || '')}${c.pon ? ' · ' + ppEsc(c.pon) : ''}</td>
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
  const cab = ['risco', 'faltam_dias', 'contrato', 'cliente', 'cidade', 'bairro', 'sinal_dbm', 'situacao', 'sinal_anterior', 'mudou_em', 'ultima_os', 'dias_desde_os', 'tecnico', 'olt', 'pon', 'serial', 'consultado_em'];
  const linhas = lista.map(i => [i.janela, i.faltam, i.c.contrato, i.cliente, i.cidade, i.bairro, i.c.rx_dbm, (PP_SIT[i.c.situacao] || {}).t || i.c.situacao, i.c.rx_anterior, i.c.mudou_em, i.ultima ? i.ultima.tipo : '', i.dias, i.ultima ? i.ultima.recurso : '', i.c.olt, i.c.pon, i.c.serial, i.c.checado_em]);
  const txt = '﻿' + [cab].concat(linhas).map(l => l.map(v => { const s = v == null ? '' : String(v).replace('.', typeof v === 'number' ? ',' : '.'); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = 'predict-pon-clientes-' + new Date().toISOString().slice(0, 10) + '.csv';
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
    m.bindPopup(`<b>${ppEsc(i.cliente || 'Contrato ' + i.c.contrato)}</b><br>Contrato ${ppEsc(i.c.contrato)}<br>${ppEsc(s.t)} · ${ppDbm(i.c.rx_dbm)} dBm<br>${ppEsc(i.c.olt || '')} ${i.c.pon ? '· PON ' + ppEsc(i.c.pon) : ''}${i.ultima ? '<br>' + ppEsc(i.ultima.tipo) + ' há ' + i.dias + 'd · ' + ppEsc(i.ultima.recurso) : ''}`);
    pontos.push([i.c.lat, i.c.lng]);
  });
  if (pontos.length) mapa.fitBounds(pontos, { padding: [20, 20], maxZoom: 15 });
  else mapa.setView([-23.96, -46.33], 10); // Baixada Santista
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
