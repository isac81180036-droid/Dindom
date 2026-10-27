// Vendas: pedidos da Cardápio Web. O servidor busca os pedidos a cada minuto (supabase/003_cardapioweb.sql)
// e esta tela só lê o resumo pronto. O token da API fica guardado no banco, nunca nos aparelhos.
(function () {
  var esc = UI.esc;
  var SQL_FILE = 'supabase/003_cardapioweb.sql';
  // Loja de teste pública, publicada na documentação da Cardápio Web, para experimentar antes de usar o token real.
  var SANDBOX_KEY = '7nSyGq49NVXuyZfgEQNPg3TdUqLNXTMNMNJwckvE';

  var STATUS = {
    waiting_confirmation: ['warn', 'Aguardando aceite'],
    pending_payment: ['warn', 'Aguardando pagamento'],
    pending_online_payment: ['warn', 'Pagamento online pendente'],
    scheduled_confirmed: ['info', 'Agendado'],
    confirmed: ['info', 'Em preparo'],
    ready: ['ok', 'Pronto'],
    waiting_to_catch: ['ok', 'Aguardando retirada'],
    released: ['accent', 'Saiu para entrega'],
    delivered: ['ok', 'Entregue'],
    closed: ['', 'Concluído'],
    canceling: ['crit', 'Cancelando'],
    canceled: ['crit', 'Cancelado']
  };
  var TYPES = { delivery: 'Entrega', takeout: 'Retirada', onsite: 'No local', closed_table: 'Mesa ou comanda' };
  var CHANNELS = { catalog: 'Cardápio digital', store_front_catalog: 'Cardápio da loja', portal: 'Balcão', whatsapp_extension: 'WhatsApp', ifood: 'iFood' };
  var PAY = { money: 'Dinheiro', credit_card: 'Crédito', debit_card: 'Débito', pix: 'Pix', pix_auto: 'Pix', meal_voucher: 'Vale-refeição',
    food_voucher: 'Vale-alimentação', bank_transfer: 'Transferência', bank_slip: 'Boleto', picpay: 'PicPay', debt_book: 'Fiado',
    online_credit_card: 'Cartão online', ifood: 'iFood', ifood_voucher: 'Vale iFood', food99: '99Food', food99_voucher: 'Vale 99Food' };
  var PERIODS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['mes', 'Este mês']];
  // Etapas do pedido em andamento, na ordem da cozinha.
  var STAGES = [
    { label: 'Aguardando aceite', st: ['waiting_confirmation', 'pending_payment'] },
    { label: 'Em preparo', st: ['confirmed', 'scheduled_confirmed'] },
    { label: 'Prontos', st: ['ready', 'waiting_to_catch'] },
    { label: 'Em entrega', st: ['released'] }
  ];

  var period = 'hoje';
  var cache = {};    // período → { at, data, error }
  var loading = {};
  var showForm = false; // tela de conexão: formulário aberto para trocar o token
  var channel = null, timer = 0, rtTimer = 0;

  function ready() { return !!(window.Cloud && Cloud.orgId && Cloud.client); }
  function missingSql(err) { return /schema cache|does not exist|cw_report|cw_connect/i.test((err && err.message) || ''); }
  function netError(err) { return !err || /fetch|network|Failed to/i.test(String(err.message || err)); }

  // Períodos no "dia de trabalho" do app: vira às 5h, então o movimento da madrugada conta no dia anterior.
  function range(p) {
    var b = DB.businessDay().split('-');
    var today = new Date(+b[0], b[1] - 1, +b[2], DB.DAY_START_HOUR);
    function add(n) { var x = new Date(today); x.setDate(x.getDate() + n); return x; }
    if (p === 'ontem') return [add(-1), today];
    if (p === '7d') return [add(-6), add(1)];
    if (p === 'mes') return [new Date(today.getFullYear(), today.getMonth(), 1, DB.DAY_START_HOUR), add(1)];
    return [today, add(1)];
  }

  // Busca o resumo do período no servidor e chama "done" quando chega.
  function load(p, done) {
    if (!ready() || loading[p]) return;
    loading[p] = true;
    var r = range(p);
    Cloud.client.rpc('cw_report', { p_from: r[0].toISOString(), p_to: r[1].toISOString() }).then(function (res) {
      loading[p] = false;
      if (res.error) cache[p] = { at: Date.now(), error: missingSql(res.error) ? 'sql' : netError(res.error) ? 'network' : res.error.message, data: cache[p] && cache[p].data };
      else cache[p] = { at: Date.now(), data: res.data };
      if (done) done();
    }, function () {
      loading[p] = false;
      cache[p] = { at: Date.now(), error: 'network', data: cache[p] && cache[p].data };
      if (done) done();
    });
  }
  function stale(p, ms) { return !cache[p] || Date.now() - cache[p].at > ms; }
  // Redesenha só se a pessoa continua na mesma tela, sem painel aberto e sem estar digitando.
  function redrawIf(path) {
    return function () {
      var a = document.activeElement;
      if (route() !== path || document.querySelector('.sheet-wrap') || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      refresh();
    };
  }

  // Tempo real: chegou ou mudou pedido → busca o resumo de novo (os outros períodos ficam para quando forem abertos).
  function watch() {
    if (!timer) timer = setInterval(function () { load(period, redrawIf('vendas')); }, 30000);
    if (channel || !ready()) return;
    channel = Cloud.client.channel('dindom-cw-' + Cloud.orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cw_orders', filter: 'org_id=eq.' + Cloud.orgId }, function () {
        clearTimeout(rtTimer);
        rtTimer = setTimeout(function () {
          Object.keys(cache).forEach(function (k) { cache[k].at = 0; });
          load(period, redrawIf('vendas'));
        }, 2000);
      })
      .subscribe();
  }
  function unwatch() {
    clearInterval(timer); timer = 0; clearTimeout(rtTimer);
    if (channel) { Cloud.client.removeChannel(channel); channel = null; }
  }

  function minsAgo(iso) { return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); }
  function ago(m) { return m < 1 ? 'agora' : m < 60 ? 'há ' + m + ' min' : 'há ' + Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); }
  function hm(iso) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------- Avisos sobre a ligação ----------

  function notices(e, st) {
    var out = [];
    var since = st.last_ok ? (Date.parse(st.now) - Date.parse(st.last_ok)) / 60000 : (Date.parse(st.now) - Date.parse(st.connected_at)) / 60000;
    if (e.error === 'network') out.push(['crit', 'wifiOff', 'Sem conexão com o servidor. Mostrando a última atualização.']);
    if (!st.connected) out.push(['', 'alert', 'A Cardápio Web está desligada. Mostrando os pedidos que já tinham chegado.']);
    else if (st.error) out.push(['crit', 'alert', st.error]);
    else if (since > 5) {
      out.push(['crit', 'alert', 'A busca automática de pedidos não roda há ' + Math.round(since) + ' min. ' +
        (UI.isAdmin() ? 'Confira no Supabase se a extensão pg_cron está ligada e rode de novo o ' + SQL_FILE + '.' : 'Avise o administrador.')]);
    } else if (!st.last_ok) out.push(['info', 'refresh', 'Ligado! Os primeiros pedidos chegam em até um minuto.']);
    if (st.connected && (st.history || st.queue > 30)) {
      out.push(['info', 'refresh', 'Trazendo os pedidos dos últimos 30 dias' + (st.queue ? ': faltam ' + st.queue : '') + '. Os totais se completam sozinhos nos próximos minutos.']);
    }
    return out.map(function (n) {
      return '<div class="banner' + (n[0] ? ' ' + n[0] : '') + '">' + icon(n[1], 'sm') + '<div class="grow">' + esc(n[2]) + '</div></div>';
    }).join('');
  }

  // ---------- Blocos do relatório ----------

  function kpi(value, label) { return '<div class="card"><div class="stat num">' + value + '</div><div class="card-meta">' + label + '</div></div>'; }

  function liveSection(live) {
    var counts = STAGES.map(function (s) { return live.filter(function (o) { return s.st.indexOf(o.status) >= 0; }).length; });
    return '<section class="section"><div class="section-head"><h2>Agora</h2><span class="card-meta">' + plural(live.length, 'pedido em andamento', 'pedidos em andamento') + '</span></div>' +
      '<div class="stat-grid four cw-stages">' + STAGES.map(function (s, i) {
        return '<div class="card"><div class="stat num">' + counts[i] + '</div><div class="card-meta">' + s.label + '</div></div>';
      }).join('') + '</div>' +
      (live.length ? '<div class="list">' + live.slice().reverse().map(function (o) {
        var m = minsAgo(o.created_at), late = o.est && m > o.est && ['released', 'ready', 'waiting_to_catch'].indexOf(o.status) < 0;
        var s = STATUS[o.status] || ['', o.status];
        return '<button type="button" class="row" data-order="' + o.id + '"><div class="tile">' + icon(o.order_type === 'delivery' ? 'truck' : 'store') + '</div>' +
          '<div class="grow"><div class="card-title"><span class="num">#' + esc(o.display_id || o.id) + '</span>' + (o.customer ? ' · ' + esc(o.customer) : '') + '</div>' +
          '<div class="card-meta">' + esc(TYPES[o.order_type] || '') + ' · <span class="num"' + (late ? ' style="color:var(--crit);font-weight:600"' : '') + '>' + ago(m) + (late ? ' (previsto ' + o.est + ' min)' : '') + '</span>' +
          (o.total != null ? ' · <span class="num">' + UI.money(o.total) + '</span>' : '') + '</div></div>' +
          '<span class="pill ' + s[0] + '">' + s[1] + '</span></button>';
      }).join('') + '</div>' : '<div class="card"><p class="muted" style="margin:0">Nenhum pedido em andamento.</p></div>') +
      '</section>';
  }

  // Lista com barra proporcional ao maior valor.
  function rank(title, rows, opts) {
    if (!rows.length) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return Number(opts.bar(r)) || 0; })) || 1;
    return '<section class="section"><div class="section-head"><h2>' + title + '</h2>' + (opts.hint ? '<span class="card-meta">' + opts.hint + '</span>' : '') + '</div><div class="list">' +
      rows.map(function (r) {
        return '<div class="row cw-rank"><div class="grow"><div class="cw-rank-head"><span class="card-title">' + esc(opts.name(r)) + '</span><span class="num">' + opts.value(r) + '</span></div>' +
          (opts.meta ? '<div class="card-meta">' + opts.meta(r) + '</div>' : '') + UI.bar((Number(opts.bar(r)) || 0) / max * 100) + '</div></div>';
      }).join('') + '</div></section>';
  }

  function chips() {
    return '<div class="chips" role="toolbar" aria-label="Período">' + PERIODS.map(function (p) {
      return '<button type="button" class="chip" data-period="' + p[0] + '" aria-pressed="' + (period === p[0]) + '">' + p[1] + '</button>';
    }).join('') + '</div>';
  }

  function report(e) {
    var d = e.data, st = d.status;
    var ticket = d.orders ? d.revenue / d.orders : 0;
    var kpis = '<div class="stat-grid four cw-kpis">' +
      kpi(UI.money(d.revenue), 'faturamento' + (d.pending ? ' · ' + d.pending + ' ainda somando' : '')) +
      kpi(d.orders, d.orders === 1 ? 'pedido' : 'pedidos') +
      kpi(UI.money(ticket), 'ticket médio') +
      kpi(d.canceled, (d.canceled === 1 ? 'cancelado' : 'cancelados') + (d.canceled ? ' · ' + UI.money(d.canceled_value) : '')) + '</div>';
    var money = function (r) { return UI.money(r.v); };
    var col1 = (st.connected ? liveSection(d.live || []) : '') +
      rank('Mais vendidos', d.top_items, { name: function (r) { return r.name; }, value: function (r) { return UI.fmt(r.q); }, meta: function (r) { return UI.money(r.v); }, bar: function (r) { return r.q; } });
    var col2 = rank('Sabores e complementos', d.top_options, { name: function (r) { return r.name; }, value: function (r) { return UI.fmt(r.q); }, meta: function (r) { return esc(r.grp || ''); }, bar: function (r) { return r.q; } }) +
      rank('Tipo de pedido', d.by_type, { name: function (r) { return TYPES[r.k] || r.k || 'Outros'; }, value: money, meta: function (r) { return plural(r.n, 'pedido', 'pedidos'); }, bar: function (r) { return r.v; } }) +
      rank('Canal de venda', d.by_channel, { name: function (r) { return CHANNELS[r.k] || r.k || 'Outros'; }, value: money, meta: function (r) { return plural(r.n, 'pedido', 'pedidos'); }, bar: function (r) { return r.v; } }) +
      rank('Formas de pagamento', d.payments, { name: function (r) { return PAY[r.k] || r.k || 'Outros'; }, value: money, meta: function (r) { return plural(r.n, 'pagamento', 'pagamentos'); }, bar: function (r) { return r.v; } });
    var empty = !d.orders && !d.canceled ? '<div class="card">' + UI.empty('receipt', 'Nenhum pedido no período', st.history ? 'O histórico ainda está chegando da Cardápio Web.' : 'Os pedidos aparecem aqui assim que entram na Cardápio Web.') + '</div>' : '';
    return notices(e, st) + chips() + kpis + empty +
      '<div class="home-grid"><div class="col">' + col1 + '</div><div class="col">' + col2 + '</div></div>' +
      '<p class="faint" style="text-align:center;font-size:var(--fs-xs)">' + (st.last_ok ? 'Pedidos atualizados às ' + hm(st.last_ok) + '. ' : '') +
      'Para aceitar, cancelar ou mudar o status de um pedido, use o Portal da Cardápio Web.</p>';
  }

  function orderSheet(o) {
    var s = STATUS[o.status] || ['', o.status];
    UI.sheet('<h2><span class="num">Pedido #' + esc(o.display_id || o.id) + '</span></h2>' +
      '<p class="muted">' + esc(TYPES[o.order_type] || '') + (o.customer ? ' · ' + esc(o.customer) : '') + ' · feito às <span class="num">' + hm(o.created_at) + '</span> · <span class="pill ' + s[0] + '">' + s[1] + '</span></p>' +
      '<div class="list">' + (o.items || []).map(function (i) {
        var opts = (i.options || []).map(function (x) { return x.name; }).join(', ');
        return '<div class="row"><div class="grow"><div class="card-title"><span class="num">' + UI.fmt(i.quantity) + '×</span> ' + esc(i.name) + (i.status === 'canceled' ? ' <span class="pill crit no-dot">cancelado</span>' : '') + '</div>' +
          (opts ? '<div class="card-meta">' + esc(opts) + '</div>' : '') + (i.observation ? '<div class="card-meta">Obs.: ' + esc(i.observation) + '</div>' : '') + '</div>' +
          '<span class="num">' + UI.money(i.total_price) + '</span></div>';
      }).join('') + (o.total != null ? '<div class="row"><div class="grow card-title">Total</div><b class="num">' + UI.money(o.total) + '</b></div>' : '<div class="row muted">Itens ainda chegando da Cardápio Web.</div>') + '</div>' +
      '<p class="card-meta">Para aceitar, cancelar ou mudar o status, use o Portal da Cardápio Web.</p>' +
      '<button type="button" class="btn block" data-close>Fechar</button>');
  }

  // ---------- Telas ----------

  function salesScreen() {
    var e = cache[period];
    // Período ainda não carregado: o cabeçalho vem do último período visto, para os filtros não sumirem.
    var seen = e || Object.keys(cache).map(function (k) { return cache[k]; }).filter(function (x) { return x.data; })[0];
    var st = seen && seen.data && seen.data.status;
    var gear = UI.isAdmin() && ready() ? '<a class="icon-btn plain" href="#vendas/conexao" aria-label="Conexão com a Cardápio Web">' + icon('settings') + '</a>' : '';
    var sub = st && st.merchant ? 'Cardápio Web · ' + st.merchant + (st.env === 'sandbox' ? ' (loja de teste)' : '') : 'Pedidos da Cardápio Web';
    var body;
    if (!ready()) body = '<div class="card">' + UI.empty('wifiOff', 'Precisa do servidor', 'As vendas chegam da Cardápio Web pelo servidor. Entre no app com a internet ligada.') + '</div>';
    else if (!e) body = (st ? chips() : '') + '<div class="card"><p class="muted" style="margin:0">Carregando as vendas…</p></div>';
    else if (e.error === 'sql') {
      body = UI.isAdmin() ? '<div data-sqlhelp></div>' : '<div class="card">' + UI.empty('receipt', 'Vendas ainda não configuradas', 'Peça ao administrador para ligar a Cardápio Web no app.') + '</div>';
    } else if (!e.data) {
      body = '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">' + esc(e.error === 'network' ? 'Sem conexão com o servidor.' : e.error) + '</div><button type="button" class="btn sm" data-retry>Tentar de novo</button></div>';
    } else if (!st.connected && !st.has_orders) {
      body = '<div class="card">' + (UI.isAdmin()
        ? UI.empty('receipt', 'Ligue a Cardápio Web', 'Faturamento, pedidos em andamento e os sabores mais vendidos, direto no app. Leva um minuto.', '<a class="btn primary" href="#vendas/conexao">Conectar</a>')
        : UI.empty('receipt', 'Cardápio Web não ligada', 'Peça ao administrador para conectar a loja em Vendas.')) + '</div>';
    } else body = report(e);

    return {
      html: '<main class="screen wide">' + UI.topbar('Vendas', { sub: sub, right: gear }) + body + '</main>',
      tab: 'vendas',
      mount: function (root) {
        var box = root.querySelector('[data-sqlhelp]');
        if (box) UI.sqlHelp(box, SQL_FILE, 'Volte aqui e toque em <b>Conectar</b> na tela de Vendas.');
        root.addEventListener('click', function (ev) {
          var p = ev.target.closest('[data-period]');
          if (p) { period = p.dataset.period; if (stale(period, 15000)) load(period, redrawIf('vendas')); return refresh(); }
          if (ev.target.closest('[data-retry]')) { delete cache[period]; refresh(); return; }
          var o = ev.target.closest('[data-order]');
          if (o) {
            var live = (cache[period].data.live || []).filter(function (x) { return String(x.id) === o.dataset.order; })[0];
            if (live) orderSheet(live);
          }
        });
        if (stale(period, 15000)) load(period, redrawIf('vendas'));
        watch();
        return function () { if (route() !== 'vendas') unwatch(); };
      }
    };
  }

  function connectionScreen() {
    var e = cache.hoje, st = e && e.data && e.data.status;
    var connected = st && st.connected;
    var card = connected ? '<section class="card"><div class="card-row"><div class="tile ok">' + icon('check') + '</div><div class="grow">' +
      '<div class="card-title">' + esc(st.merchant || 'Loja ligada') + '</div>' +
      '<div class="card-meta">' + (st.env === 'sandbox' ? 'Loja de teste da Cardápio Web' : 'Loja real') + (st.merchant_id ? ' nº <span class="num">' + esc(st.merchant_id) + '</span>' : '') + ' · ligada em ' + new Date(st.connected_at).toLocaleDateString('pt-BR') +
      (st.last_ok ? ' · pedidos atualizados às ' + hm(st.last_ok) : '') + '</div></div></div>' +
      (st.error ? '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">' + esc(st.error) + '</div></div>' : '') +
      (showForm ? '' : '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-change>' + icon('key', 'sm') + 'Trocar token</button>' +
        '<button type="button" class="btn" data-off style="color:var(--crit)">Desligar</button></div>') + '</section>' : '';
    var form = !connected || showForm ? '<section class="card"><div class="card-title">Como pegar o token</div>' +
      '<ol class="card-meta" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;color:var(--ink-2)">' +
      '<li>Entre no <b>Portal da Cardápio Web</b> com a conta da pizzaria.</li>' +
      '<li>Abra <b>Configurações › Integrações › API</b> e gere o token.</li>' +
      '<li>Copie o token e cole aqui embaixo.</li></ol></section>' +
      '<div class="field" id="f-key"><label for="cw-key">Token da API</label>' +
      '<input id="cw-key" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Cole o token aqui">' +
      '<span class="err" hidden></span><span class="hint">Fica guardado só no servidor: depois de salvo, nem o app nem os gerentes conseguem ver o token.</span></div>' +
      '<div class="field"><span class="label">Qual loja</span><div class="seg" data-env>' +
      '<button type="button" data-v="producao" aria-pressed="true">Loja real</button><button type="button" data-v="sandbox" aria-pressed="false">Loja de teste</button></div></div>' +
      '<div data-sqlhelp hidden></div>' +
      '<button type="button" class="btn primary block" data-connect>Conectar</button>' +
      (showForm ? '<button type="button" class="btn block" data-cancel>Cancelar</button>' : '<button type="button" class="btn ghost block" data-demo>Experimentar com a loja de teste da Cardápio Web</button>') : '';

    return {
      html: '<main class="screen">' + UI.topbar('Cardápio Web', { back: '#vendas', sub: 'Pedidos e vendas no app' }) +
        (ready() && !e ? '<div class="card"><p class="muted" style="margin:0">Carregando…</p></div>' : ready() ? card + form :'<div class="card">' + UI.empty('wifiOff', 'Precisa do servidor', 'Para ligar a Cardápio Web, entre no app com a internet ligada.') + '</div>') +
        '<p class="faint" style="font-size:var(--fs-xs)">O app só lê os pedidos: aceitar, cancelar e mudar status continuam no Portal da Cardápio Web. Telefone e endereço dos clientes não são guardados.</p></main>',
      tab: 'vendas', nav: false,
      mount: function (root) {
        if (!e && ready()) load('hoje', redrawIf('vendas/conexao'));
        var env = 'producao';
        function setEnv(v) { env = v; root.querySelectorAll('[data-env] button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); }
        function setErr(msg) {
          var f = root.querySelector('#f-key'); if (!f) return;
          f.classList.toggle('error', !!msg); var s = f.querySelector('.err'); s.hidden = !msg; s.textContent = msg || '';
        }
        root.addEventListener('click', function (ev) {
          var t = ev.target;
          var b = t.closest('[data-env] button'); if (b) return setEnv(b.dataset.v);
          if (t.closest('[data-change]')) { showForm = true; return refresh(); }
          if (t.closest('[data-cancel]')) { showForm = false; return refresh(); }
          if (t.closest('[data-demo]')) { root.querySelector('#cw-key').value = SANDBOX_KEY; setEnv('sandbox'); setErr(''); return; }
          if (t.closest('[data-off]')) {
            return UI.confirm({ title: 'Desligar a Cardápio Web?', body: 'O token é apagado do servidor e os pedidos novos deixam de chegar. Os que já chegaram continuam nos relatórios.', ok: 'Desligar', danger: true,
              onOk: function () {
                Cloud.client.rpc('cw_disconnect').then(function (r) {
                  if (r.error) return UI.toast(r.error.message, { tone: 'crit', ms: 5000 });
                  cache = {}; UI.toast('Cardápio Web desligada'); go('vendas', { replace: true });
                }, function () { UI.toast('Sem conexão com o servidor.', { tone: 'crit' }); });
              } });
          }
          var c = t.closest('[data-connect]');
          if (c) {
            var key = root.querySelector('#cw-key').value.trim();
            if (key.length < 10) return setErr('Cole o token gerado no Portal da Cardápio Web.');
            setErr('');
            c.classList.add('busy'); c.disabled = true;
            Cloud.client.rpc('cw_connect', { p_key: key, p_env: env }).then(function (r) {
              c.classList.remove('busy'); c.disabled = false;
              if (r.error && missingSql(r.error)) return UI.sqlHelp(root.querySelector('[data-sqlhelp]'), SQL_FILE, 'Volte aqui e toque em <b>Conectar</b> de novo.');
              if (r.error) return setErr(r.error.message);
              cache = {}; showForm = false; UI.buzz(20);
              UI.toast('Ligado à loja ' + r.data, { ms: 4000 });
              go('vendas', { replace: true });
            }, function () { c.classList.remove('busy'); c.disabled = false; setErr('Sem conexão com o servidor. Tente de novo.'); });
          }
        });
      }
    };
  }

  Screens.vendas = function (params) {
    if (!UI.isManager()) return Screens.inicio();
    if (params[0] === 'conexao' && UI.isAdmin()) return connectionScreen();
    return salesScreen();
  };

  // Cartão do Início (gerente e administrador): vendas de hoje e pedidos em andamento.
  window.CW = {
    homeCard: function () {
      if (!ready() || !UI.isManager()) return '';
      var e = cache.hoje, d = e && e.data, st = d && d.status;
      if (!st) {
        // Administrador ainda sem a integração: convite para ligar.
        return e && e.error === 'sql' && UI.isAdmin() ? '<a class="list" href="#vendas" style="text-decoration:none;color:inherit;display:block"><div class="row"><div class="tile accent">' + icon('receipt') + '</div>' +
          '<div class="grow"><div class="card-title">Ligar a Cardápio Web</div><div class="card-meta">Vendas e pedidos em andamento no app</div></div>' + icon('chevronRight', 'sm') + '</div></a>' : '';
      }
      if (!st.connected) {
        return UI.isAdmin() && !st.has_orders ? '<a class="list" href="#vendas/conexao" style="text-decoration:none;color:inherit;display:block"><div class="row"><div class="tile accent">' + icon('receipt') + '</div>' +
          '<div class="grow"><div class="card-title">Ligar a Cardápio Web</div><div class="card-meta">Vendas e pedidos em andamento no app</div></div>' + icon('chevronRight', 'sm') + '</div></a>' : '';
      }
      var live = (d.live || []).length;
      return '<a class="card tap" href="#vendas" style="text-decoration:none;color:inherit"><div class="card-row"><div class="grow">' +
        '<div class="eyebrow">Vendas de hoje</div><div class="stat num" style="margin-top:6px">' + UI.money(d.revenue) + '</div></div>' +
        (live ? '<span class="pill info">' + plural(live, 'em andamento', 'em andamento') + '</span>' : '') + '</div>' +
        '<div class="card-meta num">' + plural(d.orders, 'pedido', 'pedidos') + (d.orders ? ' · ticket médio ' + UI.money(d.revenue / d.orders) : '') +
        (st.error ? ' · <span style="color:var(--crit)">atualização com problema</span>' : '') + '</div></a>';
    },
    // Chamado no mount do Início: atualiza o cartão no máximo a cada minuto.
    homeLoad: function () { if (ready() && UI.isManager() && stale('hoje', 60000)) load('hoje', redrawIf('inicio')); }
  };
})();
