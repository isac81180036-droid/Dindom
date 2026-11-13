// Relatórios (gerente e administrador): a empresa inteira em gráficos e leituras com sugestão do que fazer.
// As contas e os textos ficam em js/rel-core.js; os gráficos, em js/charts.js. Esta tela busca os números
// (cw_relatorio e g_place, supabase/010_relatorios.sql), monta as áreas e cuida da ligação com o Google.
(function () {
  var esc = UI.esc, money = UI.money, fmt = UI.fmt;
  var SQL_FILE = 'supabase/010_relatorios.sql';
  var PERIODS = [['30d', '30 dias', 30], ['90d', '90 dias', 90], ['175d', '6 meses', 175]];
  var period = '30d';
  var cache = {};     // período + filtro de canais → { at, data, error }
  var loading = {};
  var google = { at: 0, data: null, loading: false, error: '' }; // nota buscada agora no Google (não fica guardada)
  var noSql = false;  // banco ainda sem o 010
  var last = null;    // última montagem (para abrir as listas sem refazer as contas)

  function ready() { return !!(window.Cloud && Cloud.orgId && Cloud.client); }
  function missingSql(err) { return /schema cache|does not exist|cw_relatorio|g_place|g_search|g_connect/i.test((err && err.message) || ''); }
  function netError(err) { return !err || /fetch|network|Failed to/i.test(String(err.message || err)); }
  function excl() { return (DB.get().prefs.cwExclude || []).slice().sort(); }
  function pinfo() { return PERIODS.filter(function (p) { return p[0] === period; })[0]; }
  function key() { return period + '|' + excl().join(','); }
  function onScreen() { return route().split('/')[0] === 'relatorios'; }

  // Período no "dia de trabalho" do app (vira às 5h): termina amanhã às 5h e volta N dias.
  function range() {
    var days = pinfo()[2], b = DB.businessDay().split('-');
    return [new Date(+b[0], b[1] - 1, +b[2] + 1 - days, DB.DAY_START_HOUR), new Date(+b[0], b[1] - 1, +b[2] + 1, DB.DAY_START_HOUR)];
  }

  // Redesenha só se a pessoa continua nos Relatórios, sem painel aberto e sem estar digitando.
  function redraw() {
    var a = document.activeElement;
    if (!onScreen() || document.querySelector('.sheet-wrap') || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    refresh();
  }

  function load() {
    var k = key();
    if (!ready() || loading[k]) return;
    loading[k] = true;
    var r = range(), ex = excl(), tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var args = { p_from: r[0].toISOString(), p_to: r[1].toISOString(), p_tz: tz };
    if (ex.length) args.p_exclude = ex;
    Cloud.client.rpc('cw_relatorio', args).then(function (res) {
      loading[k] = false;
      if (res.error) {
        var kind = missingSql(res.error) ? 'sql' : netError(res.error) ? 'network' : res.error.message;
        if (kind === 'sql') noSql = true;
        cache[k] = { at: Date.now(), error: kind, data: cache[k] && cache[k].data };
      } else { noSql = false; cache[k] = { at: Date.now(), data: res.data }; }
      redraw();
    }, function () {
      loading[k] = false;
      cache[k] = { at: Date.now(), error: 'network', data: cache[k] && cache[k].data };
      redraw();
    });
  }
  function stale(ms) { var e = cache[key()]; return !e || Date.now() - e.at > ms; }

  // Nota do Google: no máximo uma consulta a cada 30 minutos por aparelho (o servidor também limita por dia).
  // ---------- Mapa de calor das entregas (cw_mapa, supabase/011_mapa_calor.sql) ----------
  var MAP_SQL = 'supabase/011_mapa_calor.sql';
  var mapCache = {}, mapLoading = {}, mapMode = 'n'; // n = pedidos, v = faturamento
  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  var HEAT = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js';
  var leafletReady = null;

  function loadMap() {
    var k = key();
    if (!ready() || mapLoading[k]) return;
    mapLoading[k] = true;
    var r = range(), ex = excl(), args = { p_from: r[0].toISOString(), p_to: r[1].toISOString() };
    if (ex.length) args.p_exclude = ex;
    Cloud.client.rpc('cw_mapa', args).then(function (res) {
      mapLoading[k] = false;
      mapCache[k] = res.error ? { at: Date.now(), error: missingSql(res.error) || /cw_mapa/.test(res.error.message || '') ? 'sql' : netError(res.error) ? 'network' : res.error.message, data: mapCache[k] && mapCache[k].data }
        : { at: Date.now(), data: res.data };
      redraw();
    }, function () { mapLoading[k] = false; mapCache[k] = { at: Date.now(), error: 'network', data: mapCache[k] && mapCache[k].data }; redraw(); });
  }

  // Biblioteca do mapa (Leaflet) e do calor: baixadas só quando o mapa abre.
  function leaflet() {
    if (leafletReady) return leafletReady;
    function js(src) { return new Promise(function (ok, fail) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }); }
    if (!document.querySelector('link[data-leaflet]')) { var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.css'; css.setAttribute('data-leaflet', ''); document.head.appendChild(css); }
    leafletReady = (window.L ? Promise.resolve() : js(LEAFLET + 'leaflet.js')).then(function () { return window.L.heatLayer ? null : js(HEAT); });
    leafletReady.catch(function () { leafletReady = null; });
    return leafletReady;
  }

  // Tira pontos perdidos longe da cidade (endereço errado no cadastro), para o mapa não abrir afastado demais.
  function nearby(points) {
    if (points.length < 5) return points;
    function med(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }
    var la = med(points.map(function (p) { return +p.lat; })), lo = med(points.map(function (p) { return +p.lng; }));
    return points.filter(function (p) { return Math.abs(p.lat - la) < 0.25 && Math.abs(p.lng - lo) < 0.25; });
  }

  function mapBlock() {
    var m = mapCache[key()], d = m && m.data;
    var head = '<div class="ch-head"><h3>Mapa de calor das entregas</h3><p>De onde vêm os pedidos de entrega do período. Cada ponto é um quadrado de uns 110 m: o app não guarda rua nem número.</p></div>';
    if (!ready()) return '';
    if (m && m.error === 'sql' && !d) {
      return '<section class="card ch wide">' + head + (UI.isAdmin() ? '<div data-sqlhelp-map></div>' : '<p class="ch-none">Peça ao administrador para atualizar o banco (arquivo 011_mapa_calor.sql).</p>') + '</section>';
    }
    if (!d) return '<section class="card ch wide">' + head + (m && m.error ? '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">' + esc(m.error === 'network' ? 'Sem conexão com o servidor.' : m.error) + '</div></div>' : '<div class="skel" style="height:360px"></div>') + '</section>';
    var pts = nearby(d.points || []), withGeo = +d.with_geo || 0, total = +d.deliveries || 0;
    var note = +d.pending > 0 ? '<div class="banner info">' + icon('refresh', 'sm') + '<div class="grow">Buscando a localização de ' + fmt(+d.pending) + ' entregas antigas na Cardápio Web. O mapa vai se completando sozinho nas próximas horas.</div></div>' : '';
    if (!pts.length) return '<section class="card ch wide">' + head + note + '<p class="ch-none">' + (total ? 'Nenhuma entrega do período tem localização ainda.' : 'Nenhuma entrega no período.') + '</p></section>';
    var top = pts.slice().sort(function (a, b) { return mapMode === 'v' ? b.v - a.v : b.n - a.n; }).slice(0, 15);
    return '<section class="card ch wide">' + head + note +
      '<div class="rel-map-bar"><div class="seg sm" data-map-mode><button type="button" data-v="n" aria-pressed="' + (mapMode === 'n') + '">Pedidos</button><button type="button" data-v="v" aria-pressed="' + (mapMode === 'v') + '">Faturamento</button></div>' +
      '<div class="rel-map-scale" aria-hidden="true"><span>menos</span><i></i><span>mais</span></div></div>' +
      '<div class="rel-map" data-map role="img" aria-label="Mapa de calor com ' + fmt(withGeo) + ' entregas"><p class="ch-none">Carregando o mapa…</p></div>' +
      '<p class="card-meta">' + fmt(withGeo) + ' de ' + Rel.plural(total, 'entrega', 'entregas') + ' do período no mapa' + (total > withGeo + (+d.pending || 0) ? ' (pedidos de alguns apps chegam sem localização)' : '') + '. Mapa © colaboradores do OpenStreetMap.</p>' +
      Charts.table(['Área (bairro mais comum)', 'Pedidos', 'Faturamento'], top.map(function (p) { return [(p.nb || 'Sem bairro') + ' · ' + Number(p.lat).toFixed(3) + ', ' + Number(p.lng).toFixed(3), fmt(+p.n), money(+p.v)]; })) +
      '</section>';
  }

  // Desenha o mapa no quadro. Devolve a função que desmonta o mapa (ao sair da tela ou redesenhar).
  function mountMap(root) {
    var box = root.querySelector('[data-map]'), m = mapCache[key()];
    if (!box || !m || !m.data) return null;
    var pts = nearby(m.data.points || []), map = null, dead = false;
    leaflet().then(function () {
      if (dead || !box.isConnected) return;
      var L = window.L;
      box.textContent = '';
      // No celular, arrastar com um dedo rola a página; o mapa mexe pelos botões + e − e com dois dedos.
      map = L.map(box, { scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false, zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      var w = pts.map(function (p) { return mapMode === 'v' ? +p.v : +p.n; }).sort(function (a, b) { return a - b; });
      var cap = w[Math.floor(w.length * 0.95)] || w[w.length - 1] || 1; // um ponto muito forte não apaga o resto
      L.heatLayer(pts.map(function (p) { return [+p.lat, +p.lng, mapMode === 'v' ? +p.v : +p.n]; }), {
        radius: 22, blur: 18, maxZoom: 15, max: cap, minOpacity: 0.35,
        gradient: { 0.2: '#fde68a', 0.45: '#fbbf24', 0.65: '#f97316', 0.85: '#dc2626', 1: '#7f1d1d' }
      }).addTo(map);
      map.fitBounds(L.latLngBounds(pts.map(function (p) { return [+p.lat, +p.lng]; })).pad(0.08), { maxZoom: 15 });
    }, function () {
      if (!dead && box.isConnected) box.innerHTML = '<p class="ch-none">Não deu para carregar o mapa agora (precisa de internet). A tabela "Ver números" logo abaixo tem as áreas com mais pedidos.</p>';
    });
    return function () { dead = true; if (map) { map.remove(); map = null; } };
  }

  function loadGoogle(force) {
    if (!ready() || google.loading || (!force && google.at && Date.now() - google.at < 30 * 60000)) return;
    google.loading = true;
    Cloud.client.rpc('g_place').then(function (res) {
      google.loading = false; google.at = Date.now();
      if (res.error) { google.error = missingSql(res.error) ? 'sql' : netError(res.error) ? 'network' : res.error.message; if (google.error === 'sql') google.data = null; }
      else { google.error = ''; google.data = res.data; }
      redraw();
    }, function () { google.loading = false; google.at = Date.now(); google.error = 'network'; redraw(); });
  }

  function gmbLog() { var g = DB.get().gmb; return ((g && g.log) || []).slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; }); }

  function context() {
    var p = pinfo(), e = cache[key()], to = DB.businessDay();
    return {
      r: e && e.data ? e.data : null, d: DB.get(), admin: UI.isAdmin(),
      fin: UI.isAdmin() && window.FinReport ? FinReport.summary() : null,
      google: { live: google.data && google.data.connected ? google.data : null, log: gmbLog() },
      from: Rel.addDays(to, -(p[2] - 1)), to: to, days: p[2], label: 'últimos ' + p[1]
    };
  }

  // ---------- Peças da tela ----------

  function sections() { return Rel.SECTIONS.filter(function (s) { return !s.admin || UI.isAdmin(); }); }

  function tabs(active, built) {
    var crit = {};
    built.list.forEach(function (x) { if (x.tone === 'crit') crit[x.s] = (crit[x.s] || 0) + 1; });
    return '<nav class="chips rel-tabs" aria-label="Áreas do relatório">' +
      '<a class="chip" href="#relatorios"' + (!active ? ' aria-current="page"' : '') + '>Visão geral</a>' +
      sections().map(function (s) {
        return '<a class="chip" href="#relatorios/' + s.id + '"' + (s.id === active ? ' aria-current="page"' : '') + '>' + s.label +
          (crit[s.id] ? ' <span class="count num" title="Leituras que pedem atenção">' + crit[s.id] + '</span>' : '') + '</a>';
      }).join('') + '</nav>';
  }

  function chName(k) {
    var N = { catalog: 'Cardápio digital', store_front_catalog: 'Cardápio da loja', portal: 'Balcão', whatsapp_extension: 'WhatsApp', ifood: 'iFood', food99: '99Food', '99food': '99Food', keeta: 'Keeta', rappi: 'Rappi', aiqfome: 'aiqfome' };
    k = k == null ? '' : String(k);
    return N[k] || (/99/.test(k) ? '99Food' : k ? k.replace(/_/g, ' ') : 'Outros');
  }

  function filterRow(ctx) {
    var ex = excl(), all = (ctx.r && ctx.r.channels_all) || [];
    var rows = '<div class="rel-filter"><div class="chips" role="toolbar" aria-label="Período">' + PERIODS.map(function (p) {
      return '<button type="button" class="chip" data-period="' + p[0] + '" aria-pressed="' + (period === p[0]) + '">' + p[1] + '</button>';
    }).join('') + '</div><span class="card-meta">De ' + Rel.dm(ctx.from) + ' a ' + Rel.dm(ctx.to) + (ctx.days < 175 ? ', comparando com os ' + ctx.days + ' dias anteriores' : '') + '.</span></div>';
    // Canais: tocar tira ou põe o canal (ex.: 99Food) de todos os números, gráficos e avaliações. É o mesmo filtro de Vendas.
    if (all.length >= 2 || ex.length) {
      var seen = {};
      all.forEach(function (c) { seen[c.k == null ? '' : String(c.k)] = true; });
      var list = all.map(function (c) { return { k: c.k == null ? '' : String(c.k), n: +c.n }; });
      ex.forEach(function (k) { if (!seen[k]) list.push({ k: k, n: 0 }); });
      rows += '<div class="rel-filter"><span class="card-meta" style="flex:none;min-width:0">Canais na conta:</span><div class="chips cw-channels" role="toolbar" aria-label="Canais de venda">' + list.map(function (c) {
        var on = ex.indexOf(c.k) < 0;
        return '<button type="button" class="chip" data-ch="' + esc(c.k) + '" aria-pressed="' + on + '" title="' + (on ? 'Tirar da conta' : 'Pôr de volta') + '">' + icon(on ? 'check' : 'x', 'sm') + esc(chName(c.k)) + (c.n ? ' <span class="count num">' + c.n + '</span>' : '') + '</button>';
      }).join('') + '</div></div>' +
        (ex.length ? '<p class="card-meta" style="margin-top:-8px">Sem ' + esc(ex.map(chName).join(', ')) + ': pedidos, clientes e avaliações desses canais ficam fora de todo o relatório. O mesmo filtro vale em Vendas e fica só neste aparelho.</p>' : '');
    }
    return rows;
  }

  // Avisos sobre os números da Cardápio Web (sem servidor, SQL que falta, loja desligada, histórico chegando).
  function cwNotice(e, ctx) {
    if (!ready()) return '<div class="card">' + UI.empty('wifiOff', 'Precisa do servidor', 'As vendas e as avaliações chegam da Cardápio Web pelo servidor. Entre no app com a internet ligada.') + '</div>';
    if (noSql && !(e && e.data)) return UI.isAdmin() ? '<div data-sqlhelp></div>' : '<div class="card">' + UI.empty('chart', 'Relatórios ainda não ligados', 'Peça ao administrador para atualizar o banco (arquivo 010_relatorios.sql).') + '</div>';
    if (!e) return '<div class="skel" style="height:120px"></div><div class="skel" style="height:220px"></div>';
    if (!e.data) return '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">' + esc(e.error === 'network' ? 'Sem conexão com o servidor.' : e.error) + '</div><button type="button" class="btn sm" data-retry>Tentar de novo</button></div>';
    var st = e.data.status || {}, out = '';
    if (e.error === 'network') out += '<div class="banner crit">' + icon('wifiOff', 'sm') + '<div class="grow">Sem conexão. Mostrando o último cálculo.</div></div>';
    if (!st.connected && !st.has_orders) {
      return out + '<div class="card">' + (UI.isAdmin()
        ? UI.empty('receipt', 'Ligue a Cardápio Web', 'Vendas, clientes, sabores e avaliações entram no relatório assim que a loja for ligada.', '<a class="btn primary" href="#vendas/conexao">Conectar</a>')
        : UI.empty('receipt', 'Cardápio Web não ligada', 'Peça ao administrador para conectar a loja em Vendas.')) + '</div>';
    }
    if (st.history || +st.queue > 50) out += '<div class="banner info">' + icon('refresh', 'sm') + '<div class="grow">Ainda trazendo o histórico da Cardápio Web' + (+st.queue ? ' (faltam ' + fmt(+st.queue) + ' pedidos)' : '') + '. Os números se completam sozinhos nas próximas horas.</div></div>';
    return out;
  }
  function hasCw(e) { return !!(e && e.data && e.data.status && (e.data.status.connected || e.data.status.has_orders)); }

  function card(x) {
    return '<div class="card cw-ins"><div class="card-row"><div class="tile ' + (x.tone || '') + '">' + icon(x.ic) + '</div>' +
      '<div class="grow"><div class="card-meta">' + esc(x.title) + '</div><div class="cw-ins-value">' + esc(x.value) + '</div></div></div>' +
      '<p class="cw-ins-text">' + esc(x.text) + '</p>' +
      '<div class="cw-ins-do">' + icon('sparkle', 'sm') + '<span><b>O que fazer:</b> ' + esc(x.action) + '</span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (x.list && x.list.rows && x.list.rows.length ? '<button type="button" class="btn sm" data-list="' + x.i + '">Ver lista (' + x.list.rows.length + ')</button>' : '') +
      (x.href ? '<a class="btn sm" href="' + x.href + '">Abrir' + icon('chevronRight', 'sm') + '</a>' : '') + '</div></div>';
  }

  function listSheet(x) {
    UI.sheet('<h2>' + esc(x.list.title) + '</h2><div class="list">' + x.list.rows.map(function (r) {
      return '<div class="row"><div class="grow"><div class="card-title" style="overflow-wrap:anywhere">' + esc(r.name) + '</div><div class="card-meta">' + esc(r.meta || '') + '</div></div><span class="num" style="white-space:nowrap">' + esc(r.value) + '</span></div>';
    }).join('') + '</div><p class="card-meta">' + esc(x.action) + '</p><button type="button" class="btn block" data-close>Fechar</button>');
  }

  function chartsHtml(list) {
    if (!list || !list.length) return '';
    return '<div class="rel-charts">' + list.map(function (c) { return c.wide ? c.html.replace('class="card ch"', 'class="card ch wide"') : c.html; }).join('') + '</div>';
  }

  function decisions(built, min, max) {
    var top = built.list.filter(function (x) { return x.prio >= min; }).sort(function (a, b) { return b.prio - a.prio; }).slice(0, max);
    if (!top.length) return '';
    return '<section class="section"><div class="section-head"><h2>Decisões prioritárias</h2><span class="card-meta">o que mais pede atenção agora</span></div><div class="list">' + top.map(function (x, n) {
      var sec = Rel.SECTIONS.filter(function (s) { return s.id === x.s; })[0];
      return '<div class="row cw-decision"><span class="cw-decision-n num">' + (n + 1) + '</span><div class="grow"><div class="card-title">' + esc(x.action) + '</div>' +
        '<div class="card-meta">' + esc(sec ? sec.label + ' · ' : '') + esc(x.title) + ': ' + esc(x.value) + '</div></div>' +
        (x.list && x.list.rows && x.list.rows.length ? '<button type="button" class="btn sm ghost" data-list="' + x.i + '">Ver</button>' : '') + '</div>';
    }).join('') + '</div></section>';
  }

  function stars(v) { var n = Math.round(v); return '<span class="rel-stars" aria-label="' + n + ' de 5 estrelas">' + '★★★★★'.slice(0, n) + '<span style="opacity:.25">' + '★★★★★'.slice(n) + '</span></span>'; }

  // ---------- Visão geral ----------

  function overview(ctx, built, e) {
    var r = ctx.r, C = Charts, k = [], body = '';
    if (r && hasCw(e)) {
      var ins = r.ins, cur = ins.cur || {}, prev = ins.prev || {}, cmp = prev.orders > 0, rv = r.reviews || {}, cn = ins.cancel || {}, c = ins.customers || {};
      var ds = built.daily ? built.daily.cur.slice(0, -1) : [];
      k.push(C.kpi({ label: 'Faturamento', value: money(cur.revenue), delta: cmp ? Rel.pct(cur.revenue, prev.revenue) : null, sub: cmp ? 'antes ' + C.moneyK(prev.revenue) : ctx.label, spark: ds.map(function (d) { return d.v; }), href: '#relatorios/vendas' }));
      k.push(C.kpi({ label: 'Pedidos', value: fmt(cur.orders), delta: cmp ? Rel.pct(cur.orders, prev.orders) : null, sub: cmp ? 'antes ' + fmt(prev.orders) : ctx.label, spark: ds.map(function (d) { return d.n; }), href: '#relatorios/vendas' }));
      k.push(C.kpi({ label: 'Ticket médio', value: money(cur.orders ? cur.revenue / cur.orders : 0), delta: cmp && cur.orders ? Rel.pct(cur.revenue / cur.orders, prev.revenue / prev.orders) : null, sub: cmp ? 'antes ' + money(prev.revenue / prev.orders) : '', href: '#relatorios/vendas' }));
      k.push(C.kpi({ label: 'Clientes que pediram', value: fmt(cur.customers), delta: cmp && prev.customers ? Rel.pct(cur.customers, prev.customers) : null, sub: c['new'] != null ? fmt(c['new']) + ' novos' : '', href: '#relatorios/clientes' }));
      k.push(C.kpi({ label: 'Nota na Cardápio Web', value: +rv.n ? Rel.nota2(rv.avg) : '—', sub: +rv.n ? fmt(+rv.n) + ' avaliações' + (rv.pavg != null ? ' · antes ' + Rel.nota2(rv.pavg) : '') : 'sem avaliações no período', href: '#relatorios/avaliacoes' }));
    }
    var g = built.google;
    k.push(C.kpi({ label: 'Nota no Google', value: g ? Rel.nota(g.rating) : '—', sub: g ? fmt(g.count) + ' avaliações' + (g.src === 'log' ? ' · registro de ' + Rel.dm(g.d) : '') : 'ligar ou lançar a nota', href: '#relatorios/google' }));
    if (r && hasCw(e)) {
      var cn2 = r.ins.cancel || {}, c2 = r.ins.customers || {};
      if (cn2.total) k.push(C.kpi({ label: 'Cancelamentos', value: Rel.share(cn2.n, cn2.total) + '%', sub: fmt(cn2.n) + ' pedidos · ' + money(cn2.v), href: '#relatorios/vendas' }));
      if (c2.repurchase_base >= 5) k.push(C.kpi({ label: 'Taxa de recompra', value: Rel.share(c2.repurchase_back, c2.repurchase_base) + '%', sub: 'clientes novos que voltaram', href: '#relatorios/clientes' }));
    }
    if (built.team.worked > 0 && k.length < 8) k.push(C.kpi({ label: 'Horas trabalhadas', value: fmt(Math.round(built.team.worked / 60)) + ' h', sub: 'pelo ponto, no período', href: '#relatorios/equipe' }));
    body += cwNotice(e, ctx);
    body += '<div class="rel-kpis">' + k.join('') + '</div>';
    if (built.charts.vendas && built.charts.vendas[0]) body += chartsHtml([built.charts.vendas[0]]);
    body += decisions(built, 40, 8);

    // Áreas: quantas leituras cada uma tem e quantas pedem atenção.
    body += '<section class="section"><div class="section-head"><h2>Áreas do relatório</h2><span class="card-meta num">' + Rel.plural(built.list.length, 'leitura', 'leituras') + ' no total</span></div><div class="rel-areas">' +
      sections().map(function (s) {
        var items = built.list.filter(function (x) { return x.s === s.id; });
        var alert = items.filter(function (x) { return x.tone === 'crit' || x.tone === 'warn'; }).length, nc = (built.charts[s.id] || []).length;
        return '<a class="card tap rel-area" href="#relatorios/' + s.id + '"><div class="card-title"><span class="tile">' + icon(s.icon) + '</span>' + s.label + '</div>' +
          '<div class="card-meta num">' + Rel.plural(items.length, 'leitura', 'leituras') + (nc ? ' · ' + Rel.plural(nc, 'gráfico', 'gráficos') : '') + '</div>' +
          (alert ? '<span class="pill warn" style="align-self:flex-start">' + alert + (alert === 1 ? ' pede' : ' pedem') + ' atenção</span>' : items.length ? '<span class="pill ok" style="align-self:flex-start">tudo certo</span>' : '') + '</a>';
      }).join('') + '</div></section>';

    var good = built.list.filter(function (x) { return x.tone === 'ok'; }).slice(0, 6);
    if (good.length) body += '<section class="section"><div class="section-head"><h2>O que vai bem</h2></div><div class="list">' + good.map(function (x) {
      return '<div class="row"><div class="tile ok">' + icon(x.ic) + '</div><div class="grow"><div class="card-title">' + esc(x.title) + ': ' + esc(x.value) + '</div><div class="card-meta">' + esc(x.text) + '</div></div></div>';
    }).join('') + '</div></section>';
    return body;
  }

  // ---------- Uma área ----------

  function sectionBody(sec, ctx, built, e) {
    var body = '', cwArea = ['vendas', 'entrega', 'clientes', 'produtos', 'avaliacoes'].indexOf(sec.id) >= 0;
    if (cwArea) { body += cwNotice(e, ctx); if (!hasCw(e)) return body; }
    if (sec.id === 'google') body += googleBlock(ctx, built);
    if (sec.id === 'entrega') body += '<div class="rel-charts">' + mapBlock() + '</div>';
    if (sec.id === 'financeiro') body += financeNote(ctx);
    if (sec.id === 'avaliacoes') body += reviewsHero(ctx);
    body += chartsHtml(built.charts[sec.id]);
    var any = false;
    sec.groups.forEach(function (g) {
      var items = built.list.filter(function (x) { return x.g === g; });
      if (!items.length) return;
      any = true;
      body += '<section class="section">' + (sec.groups.length > 1 ? '<div class="rel-sub">' + esc(g) + '</div>' : '') + '<div class="card-grid">' + items.map(card).join('') + '</div></section>';
    });
    if (!any && !(built.charts[sec.id] || []).length && sec.id !== 'google') {
      var why = { equipe: 'As leituras aparecem quando a equipe estiver cadastrada e batendo o ponto pelo app.',
        operacao: 'As leituras aparecem conforme o app é usado: checklists, chamados de manutenção, fechamento de estoque, notas fiscais, fichas técnicas e reservas.',
        financeiro: 'Abra o Financeiro e cadastre os custos e as metas.' }[sec.id] || 'Ainda não há dados suficientes neste período. Tente um período maior.';
      body += '<div class="card">' + UI.empty('chart', 'Poucos dados ainda', why) + '</div>';
    }
    if (cwArea) body += '<p class="faint" style="text-align:center;font-size:var(--fs-xs)">Telefone e endereço dos clientes não são guardados no app: para falar com eles, procure pelo nome no Portal da Cardápio Web.</p>';
    return body;
  }

  function reviewsHero(ctx) {
    var rv = (ctx.r && ctx.r.reviews) || {};
    if (!+rv.all_n) return '';
    return '<section class="card"><div class="rel-google-hero"><div><div class="eyebrow">Cardápio Web</div><div class="big num">' + Rel.nota2(+rv.n ? rv.avg : rv.all_avg) + '</div>' + stars(+rv.n ? rv.avg : rv.all_avg) + '</div>' +
      '<div class="grow"><div class="card-title">' + (+rv.n ? Rel.plural(+rv.n, 'avaliação', 'avaliações') + ' no período' : 'Nenhuma avaliação no período') + '</div>' +
      '<div class="card-meta">Histórico guardado: ' + fmt(+rv.all_n) + ' avaliações, nota ' + Rel.nota2(rv.all_avg) + '.' + (rv.pavg != null ? ' Período anterior: ' + Rel.nota2(rv.pavg) + '.' : '') + '</div>' +
      '<div class="card-meta">Cada cliente dá nota de 1 a 5 em atendimento, qualidade, embalagem, tempo de entrega e custo/benefício.</div></div></div></section>';
  }

  function financeNote(ctx) {
    var f = ctx.fin;
    if (!f || !f.ready) {
      return f && f.sql ? '<a class="banner" href="#financeiro" style="text-decoration:none">' + icon('alert', 'sm') + '<div class="grow">O Financeiro ainda não foi ligado no banco. Abra <b>Financeiro</b> para ver o passo a passo.</div>' + icon('chevronRight', 'sm') + '</a>'
        : '<div class="skel" style="height:96px"></div>';
    }
    return '<p class="card-meta">Números de <b>' + esc(Fin.monthLabel(f.key)) + '</b>, os mesmos da tela <a href="#financeiro">Financeiro</a>' + (f.proj ? ' (com a projeção do mês no ritmo de hoje)' : '') + '. Só o administrador vê esta área.</p>';
  }

  // ---------- Google ----------

  function reviewLink(pid) { return 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(pid); }

  function googleBlock(ctx, built) {
    var g = google.data, live = g && g.connected ? g : null, now = built.google, log = ctx.google.log, out = '';
    if (google.error === 'network') out += '<div class="banner crit">' + icon('wifiOff', 'sm') + '<div class="grow">Sem conexão para consultar o Google agora.</div></div>';
    if (live && live.error) out += '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">' + esc(live.error) + '</div>' + (UI.isAdmin() ? '<button type="button" class="btn sm" data-g-connect>Conferir</button>' : '') + '</div>';
    if (live && live.limited) out += '<div class="banner">' + icon('clock', 'sm') + '<div class="grow">O limite de consultas ao Google de hoje foi atingido (para ficar na faixa gratuita). A nota volta a atualizar amanhã.</div></div>';

    if (now) {
      out += '<section class="card"><div class="rel-google-hero"><div><div class="eyebrow">Google</div><div class="big num">' + Rel.nota(now.rating) + '</div>' + stars(now.rating) + '</div>' +
        '<div class="grow"><div class="card-title">' + esc((live && live.name) || 'Sua loja no Google') + '</div>' +
        '<div class="card-meta">' + Rel.plural(now.count, 'avaliação', 'avaliações') + ' · ' + (now.src === 'live' ? 'consultado agora no Google' : 'seu registro de ' + Rel.dm(now.d)) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        (live && live.place_id ? '<button type="button" class="btn sm primary" data-g-copy="' + esc(reviewLink(live.place_id)) + '">' + icon('link', 'sm') + 'Copiar link "Avaliar no Google"</button>' : '') +
        (live && live.url ? '<a class="btn sm" href="' + esc(live.url) + '" target="_blank" rel="noopener">Abrir no Google Maps</a>' : '') +
        '<button type="button" class="btn sm" data-g-log>' + icon('plus', 'sm') + 'Registrar nota de hoje</button>' +
        (UI.isAdmin() ? '<button type="button" class="btn sm ghost" data-g-connect>' + icon('settings', 'sm') + (live ? 'Ligação' : 'Ligar ao Google') + '</button>' : '') +
        '</div></div></div></section>';
    } else if (google.loading && !google.at) {
      out += '<div class="skel" style="height:120px"></div>';
    } else {
      out += '<section class="card">' + UI.empty('star', 'Traga a nota do Google para o relatório',
        'Dois jeitos: ligar ao Google, e a nota e as avaliações em destaque aparecem sozinhas; ou lançar à mão a nota e o total de avaliações que aparecem no Google Maps.',
        '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' + (UI.isAdmin() && ready() ? '<button type="button" class="btn primary" data-g-connect>Ligar ao Google</button>' : '') +
        '<button type="button" class="btn" data-g-log>Lançar à mão</button></div>') + '</section>';
    }

    var fr = (live && live.reviews) || [];
    if (fr.length) {
      out += '<section class="section"><div class="section-head"><h2>Avaliações em destaque no Google</h2>' + (live.url ? '<a class="btn ghost sm" href="' + esc(live.url) + '" target="_blank" rel="noopener">Ver todas</a>' : '') + '</div><div class="list">' + fr.map(function (v) {
        var who = esc(v.author || 'Cliente do Google');
        return '<div class="row" style="align-items:flex-start">' + (v.photo ? '<img class="rel-avatar" src="' + esc(v.photo) + '" alt="" referrerpolicy="no-referrer" loading="lazy">' : '<div class="tile">' + icon('user') + '</div>') +
          '<div class="grow rel-quote"><div class="card-title">' + (v.author_url ? '<a href="' + esc(v.author_url) + '" target="_blank" rel="noopener" style="color:inherit">' + who + '</a>' : who) + '</div>' +
          '<div class="card-meta">' + stars(+v.rating) + (v.rel ? ' · ' + esc(v.rel) : '') + '</div>' + (v.text ? '<p>' + esc(v.text) + '</p>' : '') + '</div></div>';
      }).join('') + '</div><p class="faint" style="font-size:var(--fs-xs)">Avaliações escolhidas e fornecidas pelo Google. O app mostra na hora e não guarda cópia.</p></section>';
    }

    if (log.length) {
      out += '<section class="section"><div class="section-head"><h2>Seus registros</h2><span class="card-meta">para acompanhar a evolução</span></div><div class="list">' + log.slice().reverse().slice(0, 12).map(function (l) {
        return '<div class="row"><div class="grow"><div class="card-title num">' + Rel.dm(l.d) + '/' + l.d.slice(0, 4) + '</div><div class="card-meta num">' + Rel.plural(+l.count, 'avaliação', 'avaliações') + '</div></div>' +
          '<b class="num">' + Rel.nota(l.rating) + '</b><button type="button" class="icon-btn plain" data-g-rm="' + esc(l.d) + '" aria-label="Apagar o registro de ' + Rel.dm(l.d) + '">' + icon('x', 'sm') + '</button></div>';
      }).join('') + '</div></section>';
    } else if (now) {
      out += '<p class="card-meta">O Google não deixa guardar o histórico da nota automaticamente. Para ver a evolução, toque em <b>Registrar nota de hoje</b> uma vez por mês: leva dez segundos e o gráfico aparece a partir do segundo registro.</p>';
    }
    return out;
  }

  // Registro à mão: nota e total de avaliações, um por dia.
  function logSheet() {
    var live = google.data && google.data.connected && google.data.rating != null ? google.data : null, today = DB.iso(new Date());
    UI.sheet('<h2>Nota no Google hoje</h2><p class="muted">' + (live ? 'O Google mostra agora <b>' + Rel.nota(live.rating) + '</b> com <b>' + fmt(+live.count) + '</b> avaliações. Confira e registre para acompanhar a evolução.'
        : 'Procure a pizzaria no Google Maps e copie a nota e o número de avaliações que aparecem ao lado das estrelas.') + '</p>' +
      '<div class="field" id="f-gr"><label for="g-rating">Nota (de 1 a 5)</label><input id="g-rating" class="input num" inputmode="decimal" placeholder="Ex.: 4,6" autofocus><span class="err" hidden>Informe a nota, entre 1 e 5.</span></div>' +
      '<div class="field" id="f-gc"><label for="g-count">Total de avaliações</label><input id="g-count" class="input num" inputmode="numeric" placeholder="Ex.: 312"><span class="err" hidden>Informe quantas avaliações aparecem.</span></div>' +
      '<button type="button" class="btn primary block" data-ok>Registrar</button><button type="button" class="btn block" data-close>Voltar</button>',
      function (sheet, close) {
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          var r = CMV.parse(sheet.querySelector('#g-rating').value), c = CMV.parse(sheet.querySelector('#g-count').value);
          var badR = !(r >= 1 && r <= 5), badC = !(c >= 0) || c !== Math.round(c);
          sheet.querySelector('#f-gr').classList.toggle('error', badR); sheet.querySelector('#f-gr .err').hidden = !badR;
          sheet.querySelector('#f-gc').classList.toggle('error', badC); sheet.querySelector('#f-gc .err').hidden = !badC;
          if (badR || badC) return;
          DB.update(function (x) {
            var g = x.gmb = x.gmb || { log: [] };
            g.log = (g.log || []).filter(function (l) { return l.d !== today; });
            g.log.push({ d: today, rating: Math.round(r * 10) / 10, count: c });
          });
          close(); refresh(); UI.toast('Nota registrada');
        });
      });
  }

  // Ligação com o Google (só o administrador): chave da Places API e escolha da loja.
  function connectSheet() {
    var g = google.data, on = g && g.connected;
    if (google.error === 'sql' || noSql) {
      return UI.sheet('<h2>Ligar ao Google</h2><div data-sqlhelp></div><button type="button" class="btn block" data-close>Fechar</button>', function (sheet) {
        UI.sqlHelp(sheet.querySelector('[data-sqlhelp]'), SQL_FILE, 'Volte aqui e toque em <b>Ligar ao Google</b> de novo.');
        google.at = 0; google.error = ''; noSql = false;
      });
    }
    var org = (DB.get().org && DB.get().org.name) || 'Dindom';
    UI.sheet('<h2>' + (on ? 'Ligação com o Google' : 'Ligar ao Google') + '</h2>' +
      (on ? '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="card-row"><div class="tile ok">' + icon('check') + '</div><div class="grow"><div class="card-title">' + esc(g.name || 'Loja ligada') + '</div>' +
        '<div class="card-meta">A nota é consultada no Google quando o relatório abre.</div></div></div></div>'
        : '<ol class="rel-steps"><li>Abra o <b>Google Cloud</b> (console.cloud.google.com) com a conta da pizzaria, crie um projeto e cadastre a forma de pagamento. O Google pede um cartão, mas o uso do app fica na faixa gratuita.</li>' +
          '<li>Em <b>APIs e serviços › Biblioteca</b>, procure <b>Places API (New)</b> e clique em <b>Ativar</b>.</li>' +
          '<li>Em <b>APIs e serviços › Credenciais</b>, crie uma <b>Chave de API</b>. Em "Restrições de API", marque só a Places API (New).</li>' +
          '<li>Cole a chave aqui e procure a loja pelo nome.</li></ol>') +
      '<div class="field" id="f-gk"><label for="g-key">Chave da API' + (on ? ' <span class="faint">(deixe vazio para manter a atual)</span>' : '') + '</label>' +
      '<input id="g-key" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + (on ? 'Chave já guardada no servidor' : 'Cole a chave aqui') + '">' +
      '<span class="hint">Fica guardada só no servidor: depois de salva, ninguém consegue ver a chave pelo app.</span></div>' +
      '<div class="field"><label for="g-q">Nome da loja e cidade</label><input id="g-q" class="input" value="' + esc(org + ' pizzaria') + '"></div>' +
      '<p class="err" data-g-err hidden style="color:var(--crit);font-size:var(--fs-sm);font-weight:600"></p>' +
      '<button type="button" class="btn primary block" data-g-search>' + icon('search', 'sm') + 'Procurar a loja</button>' +
      '<div class="list rel-places" data-g-places hidden></div>' +
      (on ? '<button type="button" class="btn block" data-g-off style="color:var(--crit)">Desligar o Google</button>' : '') +
      '<button type="button" class="btn block" data-close>Fechar</button>',
      function (sheet, close) {
        var err = sheet.querySelector('[data-g-err]'), box = sheet.querySelector('[data-g-places]'), places = [];
        function fail(msg) { err.hidden = !msg; err.textContent = msg || ''; }
        function msgOf(e) { return netError(e) ? 'Sem conexão com o servidor. Tente de novo.' : e.message; }
        function keyVal() { return sheet.querySelector('#g-key').value.trim(); }
        sheet.querySelector('[data-g-search]').addEventListener('click', function (ev) {
          var b = ev.currentTarget, k = keyVal();
          if (!on && k.length < 20) return fail('Cole a chave da API criada no Google Cloud.');
          fail(''); b.classList.add('busy'); b.disabled = true;
          Cloud.client.rpc('g_search', { p_key: k, p_query: sheet.querySelector('#g-q').value }).then(function (r) {
            b.classList.remove('busy'); b.disabled = false;
            if (r.error && missingSql(r.error)) { close(); noSql = true; return connectSheet(); }
            if (r.error) return fail(msgOf(r.error));
            places = r.data || [];
            box.hidden = false;
            box.innerHTML = places.length ? places.map(function (p, i) {
              return '<button type="button" class="row" data-g-pick="' + i + '"><div class="tile">' + icon('mapPin') + '</div><div class="grow"><div class="card-title">' + esc(p.name) + '</div><div class="card-meta">' + esc(p.address || '') + '</div></div>' + icon('chevronRight', 'sm') + '</button>';
            }).join('') : '<div class="row muted">Nenhum local encontrado. Tente com o nome como aparece no Google Maps e a cidade.</div>';
          }, function () { b.classList.remove('busy'); b.disabled = false; fail('Sem conexão com o servidor. Tente de novo.'); });
        });
        box.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-g-pick]'); if (!b) return;
          var p = places[+b.dataset.gPick];
          fail(''); b.disabled = true;
          Cloud.client.rpc('g_connect', { p_key: keyVal(), p_place: p.id }).then(function (r) {
            b.disabled = false;
            if (r.error) return fail(msgOf(r.error));
            close(); google.at = 0; google.data = null; UI.buzz(20); UI.toast('Ligado a ' + r.data, { ms: 4000 }); loadGoogle(true); refresh();
          }, function () { b.disabled = false; fail('Sem conexão com o servidor. Tente de novo.'); });
        });
        var off = sheet.querySelector('[data-g-off]');
        if (off) off.addEventListener('click', function () {
          Cloud.client.rpc('g_disconnect').then(function (r) {
            if (r.error) return fail(msgOf(r.error));
            close(); google.data = { connected: false }; google.at = Date.now(); UI.toast('Google desligado'); refresh();
          }, function () { fail('Sem conexão com o servidor. Tente de novo.'); });
        });
      });
  }

  function copy(text, ok) {
    function manual() {
      UI.sheet('<h2>Link para avaliar no Google</h2><p class="muted">Copie o link abaixo e envie para os clientes, ou transforme em QR Code para colar na caixa.</p>' +
        '<input class="input" readonly value="' + esc(text) + '" data-sel><button type="button" class="btn block" data-close>Fechar</button>',
        function (sheet) { var i = sheet.querySelector('[data-sel]'); setTimeout(function () { i.focus(); i.select(); }, 80); });
    }
    try { navigator.clipboard.writeText(text).then(function () { UI.toast(ok, { icon: 'link', ms: 4500 }); UI.buzz(15); }, manual); } catch (e) { manual(); }
  }

  // ---------- Tela ----------

  Screens.relatorios = function (params) {
    if (!UI.isManager()) return Screens.inicio([]);
    var active = params[0] || '', sec = sections().filter(function (s) { return s.id === active; })[0];
    if (active && !sec) active = '';
    var e = cache[key()], ctx = context(), built = Rel.build(ctx);
    last = built;
    var busy = !!loading[key()] && e && e.data;
    var printBtn = '<button type="button" class="icon-btn plain" data-print aria-label="Imprimir ou salvar em PDF">' + icon('file') + '</button>';
    var body = sec ? sectionBody(sec, ctx, built, e) : overview(ctx, built, e);
    return {
      html: '<main class="screen wide rel">' + UI.topbar('Relatórios', { sub: (sec ? sec.label : 'Visão geral') + ' · ' + ctx.label, right: printBtn }) +
        tabs(active, built) + filterRow(ctx) + '<div class="section' + (busy ? ' rel-stale' : '') + '" style="gap:var(--sp-5)">' + body + '</div></main>',
      tab: 'relatorios',
      mount: function (root) {
        var box = root.querySelector('[data-sqlhelp]');
        if (box) UI.sqlHelp(box, SQL_FILE, 'Volte aqui e abra <b>Relatórios</b> de novo.');
        var offCharts = Charts.mount(root), offMap = active === 'entrega' ? mountMap(root) : null;
        var mb = root.querySelector('[data-sqlhelp-map]');
        if (mb) UI.sqlHelp(mb, MAP_SQL, 'Volte aqui e abra <b>Relatórios › Entrega e bairros</b> de novo.');
        root.addEventListener('click', function (ev) {
          var t = ev.target, b;
          if ((b = t.closest('[data-map-mode] [data-v]'))) { mapMode = b.dataset.v; return refresh(); }
          if ((b = t.closest('[data-ch]'))) {
            var ck = b.dataset.ch;
            DB.update(function (x) { var l = x.prefs.cwExclude = x.prefs.cwExclude || []; if (l.indexOf(ck) >= 0) l.splice(l.indexOf(ck), 1); else l.push(ck); });
            load(); return refresh();
          }
          if ((b = t.closest('[data-period]'))) { period = b.dataset.period; if (stale(120000)) load(); return refresh(); }
          if (t.closest('[data-retry]')) { delete cache[key()]; noSql = false; load(); return refresh(); }
          if (t.closest('[data-print]')) { root.querySelectorAll('details.ch-data').forEach(function (d) { d.open = false; }); return window.print(); }
          if ((b = t.closest('[data-list]'))) { var x = last && last.list[+b.dataset.list]; if (x && x.list) listSheet(x); return; }
          if (t.closest('[data-g-log]')) return logSheet();
          if (t.closest('[data-g-connect]')) return connectSheet();
          if ((b = t.closest('[data-g-copy]'))) return copy(b.dataset.gCopy, 'Link copiado. Mande para os clientes ou transforme em QR Code para a caixa.');
          if ((b = t.closest('[data-g-rm]'))) {
            var dd = b.dataset.gRm;
            return UI.confirm({ title: 'Apagar o registro de ' + Rel.dm(dd) + '?', ok: 'Apagar', danger: true,
              onOk: function () { DB.update(function (x) { if (x.gmb) x.gmb.log = (x.gmb.log || []).filter(function (l) { return l.d !== dd; }); }); refresh(); } });
          }
        });
        // Os números mudam devagar: recalcula no máximo a cada 2 minutos (ou quando o banco acabou de ser atualizado).
        if (ready() && (stale(120000) || (noSql && stale(15000)))) load();
        if (ready() && !noSql && (!active || active === 'google')) loadGoogle(false);
        if (ready() && active === 'entrega') { var mc = mapCache[key()]; if (!mc || Date.now() - mc.at > (mc.error === 'sql' ? 15000 : 120000)) loadMap(); }
        if (UI.isAdmin() && window.FinReport && (!active || active === 'financeiro')) FinReport.ensure(redraw);
        return function () { offCharts(); if (offMap) offMap(); };
      }
    };
  };
})();
