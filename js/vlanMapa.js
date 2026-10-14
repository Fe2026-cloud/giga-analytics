/* ============================================================================
 * Módulo Mapa de VLANs — GIGA+ Analytics
 *
 * Desenha os bairros da Baixada Santista coloridos pela VLAN (ou pelo
 * equipamento ZTE/HUAWEI/NOKIA) da tabela em js/vlanDados.js, e busca
 * clientes (contrato, nome, endereço ou bairro) nas O.S. já carregadas no
 * painel (getAllRows) e no sinal do Predict PON (predict_pon_clientes),
 * respondendo bairro, VLAN e equipamento.
 *
 * Contorno dos bairros: OpenStreetMap (Nominatim), consultado pelo próprio
 * navegador uma vez e guardado no localStorage. Bairro sem contorno no OSM
 * vira um círculo aproximado com borda tracejada. Só leitura: não grava nada.
 * ========================================================================== */
const VM = {
  cidade: 'TODAS', vlan: 'TODAS', equip: 'TODOS', colorir: 'VLAN', busca: '',
  mapa: null, camada: null, leaflet: null, geo: {}, geocodando: false, progresso: null,
  camadasPorChave: {}, clientesPon: null, marcador: null
};
const VM_CACHE = 'vlanMapa:geo:v1:';
const VM_RAIO_APROX = 550;       // metros do círculo aproximado
const VM_EQUIP_COR = { ZTE: '#2F80ED', HUAWEI: '#E5484D', NOKIA: '#8E4EC6' };
const VM_PALETA = ['#2F80ED', '#E5484D', '#30A46C', '#8E4EC6', '#F76B15', '#0D9488', '#D6409F', '#946800',
  '#5B5BD6', '#12A594', '#CA244D', '#4C7A2E', '#AD5700', '#3E63DD', '#7C66DC', '#0090FF', '#E54666'];
const VM_CIDADES = ['Santos', 'São Vicente', 'Guarujá', 'Cubatão', 'Praia Grande', 'Bertioga', 'Itanhaém', 'Peruíbe'];
const vmEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Normaliza nome de bairro/cidade para comparar com o que vem das O.S. ("JD. BECHARA" → "JARDIM BECHARA").
const VM_ABREV = { JD: 'JARDIM', JDM: 'JARDIM', JARD: 'JARDIM', VL: 'VILA', V: 'VILA', PQ: 'PARQUE', PQE: 'PARQUE', PRQ: 'PARQUE',
  CJ: 'CONJUNTO', CONJ: 'CONJUNTO', RES: 'RESIDENCIAL', RESID: 'RESIDENCIAL', STA: 'SANTA', STO: 'SANTO', ST: 'SITIO',
  N: 'NOSSA', SRA: 'SENHORA', NSRA: 'NOSSA SENHORA', MRO: 'MORRO', CID: 'CIDADE', PCA: 'PRACA', SAO: 'SAO' };
const VM_VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
function vmNorm(s){
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map(p => VM_ABREV[p] || p).join(' ').split(' ').filter(p => !VM_VAZIAS.has(p)).join(' ');
}
const vmChaveGeo = d => vmNorm(d.cidade) + '|' + (d.bairro === '*' ? '*' : vmNorm(d.busca || d.bairro));
const vmVlans = v => String(v || '').split('/').map(x => x.trim()).filter(Boolean);

// Áreas do mapa: linhas da tabela que caem no mesmo lugar (ex.: Itararé 326 e 351) viram uma área só.
function vmAreas(){
  if (VM._areas) return VM._areas;
  const por = {};
  VLAN_DADOS.forEach(d => {
    const k = vmChaveGeo(d);
    (por[k] = por[k] || { chave: k, cidade: d.cidade, nome: d.bairro === '*' ? 'Todos os bairros' : d.bairro, busca: d.busca || d.bairro, linhas: [] }).linhas.push(d);
  });
  Object.values(por).forEach(a => {
    a.vlans = [...new Set(a.linhas.flatMap(l => vmVlans(l.vlan)))];
    a.equips = [...new Set(a.linhas.map(l => l.equip))];
    a.rotulo = a.vlans.length ? a.vlans.join('/') : (a.linhas[0].bairro === '*' ? a.equips.join('/') : '?');
    a.conflito = new Set(a.linhas.map(l => l.vlan)).size > 1;
  });
  return (VM._areas = Object.values(por));
}
function vmCorVlan(v){
  const todas = [...new Set(VLAN_DADOS.flatMap(d => vmVlans(d.vlan)))].sort();
  const i = todas.indexOf(v);
  return i < 0 ? '#7A869A' : VM_PALETA[i % VM_PALETA.length];
}
const vmCorArea = a => VM.colorir === 'EQUIP' ? (VM_EQUIP_COR[a.equips[0]] || '#7A869A') : vmCorVlan(a.vlans[0]);

function vmFiltrar(){
  return vmAreas().filter(a =>
    (VM.cidade === 'TODAS' || a.cidade === VM.cidade) &&
    (VM.vlan === 'TODAS' || a.vlans.includes(VM.vlan)) &&
    (VM.equip === 'TODOS' || a.equips.includes(VM.equip)));
}

/* ----------------------------- Contorno dos bairros (OSM) ----------------------------- */
function vmLerCache(){
  try{
    vmAreas().forEach(a => { const v = localStorage.getItem(VM_CACHE + a.chave); if (v) VM.geo[a.chave] = JSON.parse(v); });
  }catch(e){ /* localStorage bloqueado: geocodifica de novo a cada visita */ }
}
function vmSalvarCache(chave, g){
  VM.geo[chave] = g;
  try{ localStorage.setItem(VM_CACHE + chave, JSON.stringify(g)); }catch(e){}
}
const vmDorme = ms => new Promise(r => setTimeout(r, ms));

async function vmNominatim(q){
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0002'
    + '&countrycodes=br&limit=6&bounded=1&viewbox=-47.25,-23.65,-45.85,-24.45&accept-language=pt-BR&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Nominatim ' + r.status);
  return r.json();
}
// Escolhe o resultado da cidade certa, preferindo quem tem contorno (polígono).
function vmEscolher(res, area){
  const cid = vmNorm(area.cidade);
  const daCidade = res.filter(x => {
    const ad = x.address || {};
    return [ad.city, ad.town, ad.municipality, ad.village].some(c => vmNorm(c) === cid);
  });
  const poli = x => x.geojson && /Polygon/.test(x.geojson.type);
  if (area.linhas[0].bairro === '*'){
    return daCidade.find(x => x.category === 'boundary' && poli(x)) || daCidade.find(poli) || daCidade[0] || null;
  }
  const nome = vmNorm(area.busca);
  const bate = x => vmNorm(x.name).includes(nome) || nome.includes(vmNorm(x.name));
  const sobra = daCidade.filter(x => !['city', 'town', 'municipality', 'administrative'].includes(x.type) || bate(x));
  return sobra.find(x => poli(x) && bate(x)) || sobra.find(bate) || sobra.find(poli) || sobra[0] || null;
}
async function vmGeocodificar(){
  if (VM.geocodando) return;
  const faltam = vmAreas().filter(a => !VM.geo[a.chave]);
  if (!faltam.length) return;
  VM.geocodando = true;
  let feitos = 0, falhas = 0;
  for (const a of faltam){
    VM.progresso = { feitos, total: faltam.length };
    vmAtualizarRodape();
    try{
      const q = (a.linhas[0].bairro === '*' ? '' : a.busca + ', ') + a.cidade + ', São Paulo, Brasil';
      const x = vmEscolher(await vmNominatim(q), a);
      if (!x) vmSalvarCache(a.chave, { t: 'nf' });
      else if (x.geojson && /Polygon/.test(x.geojson.type)) vmSalvarCache(a.chave, { t: 'poly', g: x.geojson, osm: x.osm_type + '/' + x.osm_id });
      else vmSalvarCache(a.chave, { t: 'pt', lat: +x.lat, lng: +x.lon });
    }catch(e){
      falhas++;
      console.warn('Mapa de VLANs: geocodificação falhou para', a.chave, e);
      if (falhas >= 5) break; // provável bloqueio de rede: para e tenta na próxima visita
    }
    feitos++;
    if (feitos % 6 === 0 && currentModule === 'mapa-vlan') vmDesenhar();
    await vmDorme(1100); // política do Nominatim: no máximo 1 consulta por segundo
  }
  VM.geocodando = false; VM.progresso = null;
  if (currentModule === 'mapa-vlan') vmDesenhar();
}
function vmRefazerContornos(){
  try{ Object.keys(localStorage).filter(k => k.startsWith(VM_CACHE)).forEach(k => localStorage.removeItem(k)); }catch(e){}
  VM.geo = {};
  vmDesenhar();
  vmGeocodificar();
}

/* ----------------------------- Ponto dentro do bairro ----------------------------- */
function vmDentroAnel(lng, lat, anel){
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++){
    const [xi, yi] = anel[i], [xj, yj] = anel[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function vmDentroGeo(lat, lng, g){
  const polis = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polis.some(p => vmDentroAnel(lng, lat, p[0]) && !p.slice(1).some(b => vmDentroAnel(lng, lat, b)));
}
function vmDistM(a, b, c, d){
  const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}
// Área de um ponto: primeiro contorno real, depois círculo aproximado; bairros antes de "todos os bairros".
function vmAreaDoPonto(lat, lng){
  const areas = vmAreas().filter(a => VM.geo[a.chave]);
  const especificas = areas.filter(a => a.linhas[0].bairro !== '*');
  return especificas.find(a => VM.geo[a.chave].t === 'poly' && vmDentroGeo(lat, lng, VM.geo[a.chave].g))
    || especificas.find(a => VM.geo[a.chave].t === 'pt' && vmDistM(lat, lng, VM.geo[a.chave].lat, VM.geo[a.chave].lng) <= VM_RAIO_APROX)
    || areas.find(a => a.linhas[0].bairro === '*' && VM.geo[a.chave].t === 'poly' && vmDentroGeo(lat, lng, VM.geo[a.chave].g))
    || null;
}

/* ----------------------------- Bairro (texto) → área ----------------------------- */
function vmAreaDoTexto(cidade, bairro){
  const c = vmNorm(cidade), b = vmNorm(bairro);
  const daCidade = vmAreas().filter(a => vmNorm(a.cidade) === c);
  if (!daCidade.length) return null;
  const todas = daCidade.find(a => a.linhas[0].bairro === '*');
  if (b){
    const nomes = a => [...new Set(a.linhas.flatMap(l => [l.bairro, l.busca]).filter(Boolean).map(vmNorm))];
    const exata = daCidade.find(a => nomes(a).includes(b));
    if (exata) return exata;
    // "VILA VOTURUA II" → Vila Voturua; o nome mais longo que bate ganha (evita "Centro" engolir tudo).
    let melhor = null, tam = 0;
    daCidade.forEach(a => nomes(a).forEach(n => {
      if (n.length >= 5 && n.length > tam && (b.includes(n) || n.includes(b) && b.length >= 5)){ melhor = a; tam = n.length; }
    }));
    if (melhor) return melhor;
  }
  return todas || null;
}

/* ----------------------------- Busca de clientes ----------------------------- */
async function vmCarregarClientesPon(){
  if (VM.clientesPon) return VM.clientesPon;
  VM.clientesPon = {};
  try{
    for (let de = 0; de < 50000; de += 1000){
      const { data, error } = await supabaseClient.from('predict_pon_clientes')
        .select('contrato, olt, pon, cidade, bairro, lat, lng, rx_dbm, situacao').order('contrato').range(de, de + 999);
      if (error) break; // sem a migração 0020 a busca segue só com as O.S.
      (data || []).forEach(c => { VM.clientesPon[vmChaveContrato(c.contrato)] = c; });
      if (!data || data.length < 1000) break;
    }
  }catch(e){ console.warn('Mapa de VLANs: sem dados do Predict PON', e); }
  return VM.clientesPon;
}
const vmChaveContrato = c => String(c || '').trim().toUpperCase().replace(/^0+(?=.)/, '');

function vmBuscar(termo){
  const t = vmNorm(termo), tc = vmChaveContrato(termo);
  if (t.length < 3) return [];
  const pon = VM.clientesPon || {};
  const porContrato = {};
  (typeof getAllRows === 'function' ? getAllRows() : []).forEach(r => {
    const k = vmChaveContrato(r.contrato) || ('OS ' + r.os);
    const atual = porContrato[k];
    if (!atual || String(r.abertura_at || r.data || '') > String(atual.abertura_at || atual.data || '')) porContrato[k] = r;
  });
  const achados = [];
  Object.entries(porContrato).forEach(([k, r]) => {
    const texto = vmNorm([r.cliente, r.endereco, r.bairro, r.cidade].join(' '));
    if (k === tc || (tc.length >= 4 && k.includes(tc)) || texto.includes(t)) achados.push(vmMontarCliente(k, r, pon[k]));
  });
  // Contratos que só existem no Predict PON (sem O.S. carregada no painel).
  Object.entries(pon).forEach(([k, c]) => {
    if (porContrato[k]) return;
    if (k === tc || (tc.length >= 4 && k.includes(tc)) || vmNorm([c.bairro, c.cidade, c.olt].join(' ')).includes(t)) achados.push(vmMontarCliente(k, null, c));
  });
  return achados.sort((a, b) => (a.cliente || '').localeCompare(b.cliente || '')).slice(0, 60);
}
function vmMontarCliente(k, os, pon){
  const cidade = (os && os.cidade) || (pon && pon.cidade) || '';
  const bairro = (os && os.bairro) || (pon && pon.bairro) || '';
  let area = null, como = '';
  if (pon && pon.lat != null && pon.lng != null){ area = vmAreaDoPonto(pon.lat, pon.lng); if (area) como = 'pela localização'; }
  if (!area){ area = vmAreaDoTexto(cidade, bairro); if (area) como = area.linhas[0].bairro === '*' ? 'pela cidade' : 'pelo bairro'; }
  return { contrato: k, cliente: os ? os.cliente : '', endereco: os ? os.endereco : '', cidade, bairro, pon, area, como };
}

/* ----------------------------- Tela ----------------------------- */
function vmLeaflet(){
  if (window.L) return Promise.resolve();
  if (VM.leaflet) return VM.leaflet;
  VM.leaflet = new Promise((ok, falha) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = ok; js.onerror = () => { VM.leaflet = null; falha(new Error('Leaflet não carregou')); };
    document.head.appendChild(js);
  });
  return VM.leaflet;
}

async function renderMapaVlan(){
  const el = document.getElementById('mapaVlanContainer');
  if (!el) return;
  const opt = (v, t, sel) => `<option value="${vmEsc(v)}"${v === sel ? ' selected' : ''}>${vmEsc(t)}</option>`;
  const vlans = [...new Set(VLAN_DADOS.flatMap(d => vmVlans(d.vlan)))].sort();
  if (!el.dataset.montado){
    el.dataset.montado = '1';
    el.innerHTML = `
      <div class="panel vm-filtros">
        <label>Cidade<select id="vmCidade" onchange="VM.cidade=this.value;vmDesenhar(true)">${opt('TODAS', 'Todas', VM.cidade)}${VM_CIDADES.map(c => opt(c, c, VM.cidade)).join('')}</select></label>
        <label>VLAN<select id="vmVlan" onchange="VM.vlan=this.value;vmDesenhar(true)">${opt('TODAS', 'Todas', VM.vlan)}${vlans.map(v => opt(v, v, VM.vlan)).join('')}</select></label>
        <label>Equipamento<select id="vmEquip" onchange="VM.equip=this.value;vmDesenhar(true)">${opt('TODOS', 'Todos', VM.equip)}${['ZTE', 'HUAWEI', 'NOKIA'].map(v => opt(v, v, VM.equip)).join('')}</select></label>
        <label>Colorir por<select id="vmColorir" onchange="VM.colorir=this.value;vmDesenhar()">${opt('VLAN', 'VLAN', VM.colorir)}${opt('EQUIP', 'Equipamento', VM.colorir)}</select></label>
        <label class="vm-busca">Buscar cliente<input type="text" id="vmBusca" placeholder="contrato, nome, endereço ou bairro" autocomplete="off" oninput="vmAoDigitar(this.value)"></label>
      </div>
      <div id="vmResultados"></div>
      <div class="panel" style="padding:0;overflow:hidden;"><div id="vmMapa" class="vm-mapa"></div></div>
      <div id="vmRodape" class="vm-rodape"></div>
      <div id="vmLegenda" class="vm-legenda"></div>
      <div class="panel"><div class="panel-head"><h3>Tabela bairro × VLAN</h3><span class="desc">${vmEsc(VLAN_DADOS_REV)} · clique na linha para ver no mapa</span></div><div class="table-scroll" id="vmTabela"></div></div>`;
  }
  vmLerCache();
  await vmDesenhar(true);
  vmGeocodificar();
  vmCarregarClientesPon();
}

async function vmDesenhar(enquadrar){
  const div = document.getElementById('vmMapa');
  if (!div) return;
  try{ await vmLeaflet(); }catch(e){ div.innerHTML = '<div class="muted" style="padding:20px;">Mapa indisponível (não consegui carregar o Leaflet).</div>'; vmTabela(); return; }
  if (!VM.mapa){
    VM.mapa = L.map(div, { zoomControl: true }).setView([-23.97, -46.35], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(VM.mapa);
  }
  setTimeout(() => VM.mapa && VM.mapa.invalidateSize(), 50);
  if (VM.camada) VM.camada.remove();
  VM.camada = L.layerGroup().addTo(VM.mapa);
  VM.camadasPorChave = {};
  const areas = vmFiltrar();
  // Cidade inteira por baixo, bairros por cima.
  const ordem = [...areas].sort((a, b) => (b.linhas[0].bairro === '*') - (a.linhas[0].bairro === '*'));
  const limites = [];
  ordem.forEach(a => {
    const g = VM.geo[a.chave];
    if (!g || g.t === 'nf') return;
    const cor = vmCorArea(a), cidadeToda = a.linhas[0].bairro === '*';
    const estilo = { color: cor, weight: cidadeToda ? 1.5 : 2, fillColor: cor, fillOpacity: cidadeToda ? 0.12 : 0.35 };
    let camada;
    if (g.t === 'poly') camada = L.geoJSON(g.g, { style: estilo });
    else camada = L.circle([g.lat, g.lng], Object.assign({}, estilo, { radius: cidadeToda ? 3000 : VM_RAIO_APROX, dashArray: '6 5' }));
    camada.bindPopup(vmPopup(a)).addTo(VM.camada);
    const b = camada.getBounds();
    const centro = g.t === 'pt' ? L.latLng(g.lat, g.lng) : b.getCenter();
    L.marker(centro, { interactive: false, icon: L.divIcon({ className: 'vm-rot', html: `<span style="background:${cor}">${vmEsc(a.rotulo)}</span>`, iconSize: null }) }).addTo(VM.camada);
    VM.camadasPorChave[a.chave] = camada;
    limites.push(b);
  });
  if (VM.marcador) VM.marcador.addTo(VM.mapa);
  if (enquadrar && limites.length){
    const tudo = limites.reduce((acc, b) => acc.extend(b), L.latLngBounds(limites[0].getSouthWest(), limites[0].getNorthEast()));
    VM.mapa.fitBounds(tudo, { padding: [20, 20], maxZoom: 15 });
  }
  vmAtualizarRodape();
  vmLegenda(areas);
  vmTabela();
}
function vmPopup(a){
  const linhas = a.linhas.map(l => `<tr><td>${vmEsc(l.bairro === '*' ? 'Todos os bairros' : l.bairro)}${l.grupo ? '<br><small>' + vmEsc(l.grupo) + '</small>' : ''}</td><td><b>${vmEsc(l.vlan || '—')}</b></td><td>${vmEsc(l.equip)}</td></tr>`).join('');
  const g = VM.geo[a.chave];
  return `<b>${vmEsc(a.nome)}</b> · ${vmEsc(a.cidade)}<table class="vm-pop">${linhas}</table>`
    + (a.conflito ? '<div class="vm-alerta">A planilha tem VLANs diferentes para este bairro.</div>' : '')
    + (g && g.t === 'pt' ? '<small>Área aproximada: o OpenStreetMap não tem o contorno deste bairro.</small>' : '');
}
function vmAtualizarRodape(){
  const el = document.getElementById('vmRodape');
  if (!el) return;
  const areas = vmFiltrar();
  const poli = areas.filter(a => VM.geo[a.chave] && VM.geo[a.chave].t === 'poly').length;
  const aprox = areas.filter(a => VM.geo[a.chave] && VM.geo[a.chave].t === 'pt').length;
  const sem = areas.filter(a => VM.geo[a.chave] && VM.geo[a.chave].t === 'nf');
  const pend = areas.filter(a => !VM.geo[a.chave]).length;
  let t = `${poli + aprox} bairro(s) no mapa (${poli} com o contorno do OpenStreetMap; ${aprox} com área aproximada, borda tracejada).`;
  if (VM.progresso) t += ` Localizando bairros no OpenStreetMap: ${VM.progresso.feitos}/${VM.progresso.total} (só na primeira vez, fica salvo neste navegador).`;
  else if (pend) t += ` ${pend} ainda sem localização.`;
  if (sem.length) t += ' Sem localização: ' + sem.map(a => `${a.nome} (${a.cidade})`).join(', ') + '.';
  el.innerHTML = vmEsc(t) + ' <a href="#" onclick="vmRefazerContornos();return false;">Refazer contornos</a>';
}
function vmLegenda(areas){
  const el = document.getElementById('vmLegenda');
  if (!el) return;
  const itens = VM.colorir === 'EQUIP'
    ? [...new Set(areas.flatMap(a => a.equips))].map(e => [VM_EQUIP_COR[e], e])
    : [...new Set(areas.map(a => a.vlans[0]).filter(Boolean))].sort().map(v => [vmCorVlan(v), 'VLAN ' + v])
      .concat(areas.some(a => !a.vlans.length) ? [['#7A869A', 'VLAN não informada']] : []);
  el.innerHTML = itens.map(([c, t]) => `<span><i style="background:${c}"></i>${vmEsc(t)}</span>`).join('');
}
function vmTabela(){
  const el = document.getElementById('vmTabela');
  if (!el) return;
  const areas = new Set(vmFiltrar().map(a => a.chave));
  const linhas = VLAN_DADOS.filter(d => areas.has(vmChaveGeo(d)) && (VM.vlan === 'TODAS' || vmVlans(d.vlan).includes(VM.vlan)) && (VM.equip === 'TODOS' || d.equip === VM.equip));
  const obs = d => d.obs === 'vermelho' ? '<span class="vm-tag vm-red">sem VLAN na planilha</span>' : d.obs === 'laranja' ? '<span class="vm-tag vm-peach">destacado na planilha</span>' : '';
  el.innerHTML = `<table class="pivot"><thead><tr><th>Cidade</th><th>Região</th><th>Bairro</th><th>VLAN</th><th>Equipamento</th><th></th></tr></thead><tbody>`
    + linhas.map(d => `<tr class="vm-linha" onclick="vmIrPara('${vmEsc(vmChaveGeo(d))}')"><td>${vmEsc(d.cidade)}</td><td>${vmEsc(d.grupo)}</td><td>${vmEsc(d.bairro === '*' ? 'Todos os bairros' : d.bairro)}</td><td class="num"><b>${vmEsc(d.vlan || '—')}</b></td><td>${vmEsc(d.equip)}</td><td>${obs(d)}</td></tr>`).join('')
    + '</tbody></table>';
}
function vmIrPara(chave, lat, lng){
  const c = VM.camadasPorChave[chave];
  if (VM.marcador){ VM.marcador.remove(); VM.marcador = null; }
  if (lat != null && lng != null && window.L){
    VM.marcador = L.marker([lat, lng]).addTo(VM.mapa);
    VM.mapa.setView([lat, lng], 16);
  } else if (c){
    VM.mapa.fitBounds(c.getBounds(), { maxZoom: 16 });
  }
  if (c) c.openPopup();
  document.getElementById('vmMapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

let vmTimerBusca = null;
function vmAoDigitar(v){
  VM.busca = v;
  clearTimeout(vmTimerBusca);
  vmTimerBusca = setTimeout(async () => { await vmCarregarClientesPon(); vmMostrarResultados(); }, 250);
}
function vmMostrarResultados(){
  const el = document.getElementById('vmResultados');
  if (!el) return;
  const termo = VM.busca.trim();
  if (vmNorm(termo).length < 3){ el.innerHTML = ''; return; }
  const res = vmBuscar(termo);
  // Sem cliente: talvez seja o nome de um bairro.
  const bairros = vmAreas().filter(a => a.linhas.some(l => vmNorm(l.bairro).includes(vmNorm(termo)) || vmNorm(l.busca).includes(vmNorm(termo)))).slice(0, 10);
  if (!res.length && !bairros.length){
    el.innerHTML = `<div class="panel muted">Nada encontrado para "${vmEsc(termo)}". A busca usa as O.S. carregadas no painel e os contratos lidos pelo Predict PON.</div>`;
    return;
  }
  const lin = r => {
    const a = r.area, l = a ? a.linhas : [];
    const vlan = a ? (a.vlans.join('/') || '—') : '—', eq = a ? a.equips.join('/') : '—';
    const onde = r.pon && r.pon.lat != null ? `vmIrPara('${vmEsc(a ? a.chave : '')}',${+r.pon.lat},${+r.pon.lng})` : (a ? `vmIrPara('${vmEsc(a.chave)}')` : '');
    return `<tr class="vm-linha" ${onde ? `onclick="${onde}"` : ''}><td class="num">${vmEsc(r.contrato)}</td><td>${vmEsc(r.cliente || '—')}</td><td>${vmEsc(r.endereco || '')}</td>`
      + `<td>${vmEsc(r.bairro || '—')}<br><small class="muted">${vmEsc(r.cidade)}</small></td>`
      + `<td><b>${vmEsc(vlan)}</b>${a && a.conflito ? ' <span class="vm-tag vm-peach">confirmar</span>' : ''}</td><td>${vmEsc(eq)}</td>`
      + `<td><small class="muted">${a ? vmEsc((a.linhas[0].bairro === '*' ? a.cidade : a.nome) + ' · ' + r.como) : 'bairro fora da tabela'}</small></td>`
      + `<td>${r.pon && r.pon.olt ? vmEsc(r.pon.olt) + (r.pon.pon ? '<br><small>PON ' + vmEsc(r.pon.pon) + '</small>' : '') : ''}</td></tr>`;
  };
  el.innerHTML = '<div class="panel">'
    + (res.length ? `<div class="panel-head"><h3>${res.length === 60 ? '60+' : res.length} cliente(s)</h3><span class="desc">clique para ver no mapa</span></div>
      <div class="table-scroll"><table class="pivot"><thead><tr><th>Contrato</th><th>Cliente</th><th>Endereço</th><th>Bairro</th><th>VLAN</th><th>Equip.</th><th>Achado</th><th>OLT</th></tr></thead><tbody>${res.map(lin).join('')}</tbody></table></div>` : '')
    + (bairros.length ? `<div class="vm-bairros">Bairros: ${bairros.map(a => `<a href="#" onclick="vmIrPara('${vmEsc(a.chave)}');return false;">${vmEsc(a.nome)} (${vmEsc(a.cidade)}) · <b>${vmEsc(a.rotulo)}</b> ${vmEsc(a.equips.join('/'))}</a>`).join('')}</div>` : '')
    + '</div>';
}
