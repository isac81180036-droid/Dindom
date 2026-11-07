// Financeiro (só o administrador): custos fixos, folha, custos variáveis e metas → quanto faturou,
// quanto precisa faturar, ponto de equilíbrio e quanto tirar de lucro, investir em marketing e guardar.
// As contas ficam em js/fin-core.js. Os dados ficam na tabela "financeiro" (supabase/007_financeiro.sql),
// que só o administrador lê: não passam pela sincronização do resto do app.
(function () {
  var esc = UI.esc, money = CMV.money, pct = CMV.fmtPct;
  var SQL_FILE = 'supabase/007_financeiro.sql';
  var LOCAL = 'dindom:fin'; // sem servidor: guarda só neste aparelho

  var store = { status: 'idle', at: 0, cfg: null, months: {}, error: '' };
  var cw = {};   // mês → resumo da Cardápio Web { at, data, loading }
  var st = { month: null, view: 'proj' };

  function cloud() { return !!(window.Cloud && Cloud.enabled && Cloud.orgId && Cloud.client); }
  function missingTable(err) { return err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|schema cache|financeiro/i.test(err.message || '')); }

  function fill(o) {
    store.cfg = Fin.config(o.config);
    store.months = {};
    Object.keys(o).forEach(function (k) { if (k.indexOf('m-') === 0) store.months[k.slice(2)] = o[k]; });
  }
  function load(done) {
    if (store.status === 'loading') return;
    store.status = 'loading';
    if (!cloud()) {
      var raw = {};
      try { raw = JSON.parse(localStorage.getItem(LOCAL) || '{}'); } catch (e) {}
      fill(raw); store.status = 'ok'; store.at = Date.now();
      if (done) done();
      return;
    }
    Cloud.client.from('financeiro').select('id,data').eq('org_id', Cloud.orgId).then(function (r) {
      store.at = Date.now();
      if (r.error) { store.status = missingTable(r.error) ? 'sql' : store.cfg ? 'ok' : 'error'; store.error = r.error.message; }
      else {
        // Com alteração ainda por gravar, fica com a deste aparelho (senão o número digitado voltaria).
        if (!Object.keys(timers).length) { var o = {}; r.data.forEach(function (row) { o[row.id] = row.data; }); fill(o); }
        store.status = 'ok';
      }
      if (done) done();
    }, function () { store.at = Date.now(); store.status = store.cfg ? 'ok' : 'error'; store.error = 'Sem internet.'; if (done) done(); });
  }

  // Grava meio segundo depois da última alteração; cada linha (config ou mês) vai separada.
  var timers = {};
  function save(id) { clearTimeout(timers[id]); timers[id] = setTimeout(function () { delete timers[id]; write(id); }, 600); }
  function flush() { Object.keys(timers).forEach(function (id) { clearTimeout(timers[id]); delete timers[id]; write(id); }); }
  function write(id) {
    if (!cloud()) {
      var all = { config: store.cfg };
      Object.keys(store.months).forEach(function (k) { all['m-' + k] = store.months[k]; });
      try { localStorage.setItem(LOCAL, JSON.stringify(all)); } catch (e) {}
      return;
    }
    var data = id === 'config' ? store.cfg : store.months[id.slice(2)];
    Cloud.client.from('financeiro').upsert({ org_id: Cloud.orgId, id: id, data: data, updated_at: new Date().toISOString() }).then(function (r) {
      if (r.error) UI.toast('O financeiro não foi salvo: ' + r.error.message, { tone: 'crit', ms: 6000 });
    }, function () { UI.toast('Sem internet: o financeiro não foi salvo. Tente de novo.', { tone: 'crit', ms: 6000 }); });
  }

  function month(key) { return store.months[key] || (store.months[key] = { revenue: null, orders: null, extras: [] }); }

  // Faturamento do mês pela Cardápio Web (mesmo resumo da tela de Vendas).
  function cwLoad(key, done) {
    if (!cloud() || (cw[key] && cw[key].loading)) return;
    var p = key.split('-');
    var from = new Date(+p[0], +p[1] - 1, 1, DB.DAY_START_HOUR), to = new Date(+p[0], +p[1], 1, DB.DAY_START_HOUR);
    cw[key] = { loading: true, at: Date.now(), data: cw[key] && cw[key].data };
    Cloud.client.rpc('cw_report', { p_from: from.toISOString(), p_to: to.toISOString() }).then(function (r) {
      cw[key] = { at: Date.now(), data: r.error ? null : r.data };
      if (done) done();
    }, function () { cw[key] = { at: Date.now(), data: cw[key] && cw[key].data }; if (done) done(); });
  }
  function revenueOf(key) {
    var m = store.months[key] || {}, c = cw[key] && cw[key].data;
    var auto = c && c.status && c.status.connected ? c : null;
    if (m.revenue != null) return { value: +m.revenue, orders: m.orders || null, source: 'manual', auto: auto };
    if (auto) return { value: +auto.revenue || 0, orders: +auto.orders || 0, source: 'cw', auto: auto };
    return { value: 0, orders: null, source: cw[key] && cw[key].loading ? 'loading' : 'none', auto: null };
  }

  // CMV usado na conta: média das fichas técnicas, compras das notas do mês ÷ faturamento, ou o informado.
  function cmvInfo(key, revenue) {
    var c = store.cfg.cmv, d = DB.get();
    if (c.source === 'fichas' && window.CMV && d.cmv) {
      var rows = CMV.rows(CMV.env(d)).filter(function (r) { return r.pct != null; });
      if (rows.length) return { pct: rows.reduce(function (s, r) { return s + r.pct; }, 0) / rows.length, label: 'média das fichas técnicas' };
    }
    if (c.source === 'notas') {
      var compras = d.notas.filter(function (n) { return String(n.date || '').slice(0, 7) === key; }).reduce(function (s, n) { return s + (+n.total || 0); }, 0);
      if (revenue > 0) return { pct: compras / revenue, label: 'compras das notas no mês (' + money(compras) + ')' };
    }
    return { pct: +c.pct || 0, label: c.source === 'manual' ? 'informado por você' : 'informado por você (ainda sem dados para calcular)' };
  }

  function teamCount() { return DB.get().employees.filter(function (e) { return e.active && e.role !== 'contador'; }).length; }
  function today() { return DB.businessDay(); }
  function dayInfo(key) {
    var cur = Fin.monthKey(today()), days = Fin.daysIn(key);
    if (key === cur) return { day: +today().slice(8, 10), days: days, current: true };
    return { day: key < cur ? days : 0, days: days, current: false };
  }

  function result(key, revenueOverride) {
    var rv = revenueOf(key), m = store.months[key] || {}, di = dayInfo(key);
    var R = revenueOverride != null ? revenueOverride : rv.value;
    var cm = cmvInfo(key, rv.value);
    return Fin.calc(store.cfg, { revenue: R, cmvPct: cm.pct, team: teamCount(), extras: m.extras || [], orders: rv.orders, ticket: store.cfg.ticket || null, day: di.day, days: di.days });
  }

  function patch(root, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('[data-calc]').forEach(function (n) {
      var o = root.querySelector('[data-calc="' + n.getAttribute('data-calc') + '"]');
      if (o && o.innerHTML !== n.innerHTML) { o.innerHTML = n.innerHTML; o.className = n.className; }
    });
  }
  function pctVal(v) { return v == null ? '' : String(Math.round(v * 10000) / 100).replace('.', ','); }

  function tabs(active) {
    return '<nav class="chips cmv-tabs" aria-label="Seções do financeiro">' + [['', 'Resumo do mês'], ['custos', 'Custos e metas']].map(function (t) {
      return '<a class="chip" href="#financeiro' + (t[0] ? '/' + t[0] : '') + '"' + (t[0] === active ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
    }).join('') + '</nav>';
  }
  function shell(active, body) {
    return '<main class="screen wide cmv fin">' + UI.topbar('Financeiro', { sub: 'Só o administrador vê estes números' }) + tabs(active) + body + '</main>';
  }

  // Carregando, tabela que falta no Supabase ou erro: a mesma tela para as duas abas.
  function gate(active) {
    // Busca de novo a cada minuto (outro aparelho do administrador pode ter mudado). Com erro, só pelo botão.
    if ((store.status === 'idle' || store.status === 'ok') && !(store.cfg && Date.now() - store.at < 60000)) {
      load(function () {
        var a = document.activeElement;
        if (route().split('/')[0] === 'financeiro' && !document.querySelector('.sheet-wrap') && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) refresh();
      });
    }
    if (store.cfg && store.status !== 'sql') return null; // mostra o que já tem enquanto atualiza
    if (store.status === 'sql') {
      return {
        html: shell(active, '<div data-sqlhelp></div>'), tab: 'financeiro',
        mount: function (root) {
          UI.sqlHelp(root.querySelector('[data-sqlhelp]'), SQL_FILE, 'Volte aqui e abra o <b>Financeiro</b> de novo.');
          store.status = 'idle'; // na próxima abertura tenta de novo
        }
      };
    }
    if (store.status === 'error') {
      return { html: shell(active, '<div class="card">' + UI.empty('alert', 'Não deu para abrir o financeiro', store.error || 'Confira a internet.', '<button type="button" class="btn primary" data-retry>Tentar de novo</button>') + '</div>'),
        tab: 'financeiro', mount: function (root) { root.querySelector('[data-retry]').addEventListener('click', function () { store.status = 'idle'; refresh(); }); } };
    }
    return { html: shell(active, [1, 2, 3].map(function () { return '<div class="skel" style="height:96px"></div>'; }).join('')), tab: 'financeiro' };
  }

  // ---------- Resumo do mês ----------
  function kpi(label, value, sub, tone) {
    return '<div class="card cmv-kpi"><span class="card-meta">' + label + '</span><span class="stat num' + (tone ? ' tone-' + tone : '') + '">' + value + '</span><span class="card-meta">' + sub + '</span></div>';
  }
  function dreRow(label, value, R, cls, note) {
    return '<tr class="' + (cls || '') + '"><td>' + label + (note ? '<small class="fin-note">' + note + '</small>' : '') + '</td><td class="n">' + money(value) + '</td><td class="n">' + (R > 0 ? pct(value / R) : '–') + '</td></tr>';
  }

  function resumo() {
    var g = gate('');
    if (g) return g;
    var cur = Fin.monthKey(today()), key = st.month || cur;
    if (key > cur) key = cur;
    st.month = key;
    var di = dayInfo(key), rv = revenueOf(key), m = store.months[key] || { extras: [] };
    var base = result(key), cm = cmvInfo(key, rv.value);
    var useProj = di.current && st.view === 'proj' && base.projection != null;
    var dre = useProj ? result(key, base.projection) : base;
    var empty = !base.fixed;

    var nav = '<div class="fin-month"><button type="button" class="icon-btn" data-mon="-1" aria-label="Mês anterior">' + icon('chevronLeft') + '</button>' +
      '<b>' + esc(Fin.monthLabel(key)) + '</b>' +
      '<button type="button" class="icon-btn" data-mon="1" aria-label="Próximo mês"' + (key >= cur ? ' disabled' : '') + '>' + icon('chevronRight') + '</button></div>';

    var srcLine = rv.source === 'cw' ? 'Cardápio Web · ' + rv.orders + ' pedidos' + (rv.orders ? ' · ticket médio ' + money(rv.value / rv.orders) : '')
      : rv.source === 'manual' ? 'Lançado por você' + (rv.orders ? ' · ' + rv.orders + ' pedidos' : '') + (rv.auto ? ' · Cardápio Web marca ' + money(rv.auto.revenue) : '')
      : rv.source === 'loading' ? 'Buscando as vendas da Cardápio Web…' : 'Nenhum faturamento lançado neste mês';
    var hero = '<section class="card hero fin-hero"><div class="card-row"><div class="grow"><div class="eyebrow">Faturamento' + (di.current ? ' até hoje' : '') + '</div>' +
      '<div class="stat num">' + money(base.revenue) + '</div><div class="muted">' + esc(srcLine) + '</div></div>' +
      '<button type="button" class="btn sm" data-rev>' + (rv.source === 'manual' ? 'Corrigir' : 'Lançar') + '</button></div>' +
      (base.goal ? UI.bar(Math.min(100, (base.progress || 0) * 100), (base.progress || 0) >= 1 ? 'ok' : '') +
        '<div class="muted num">' + pct(base.progress) + ' da meta de ' + money(base.goal) + '</div>' : '') + '</section>';

    var kpis = '<section class="stat-grid fin-kpis">' +
      kpi('Meta do mês', base.goal ? money(base.goal) : '—', base.goal ? 'para ter ' + pct(store.cfg.metas.lucro) + ' de lucro, ' + pct(store.cfg.metas.marketing) + ' em marketing e ' + pct(store.cfg.metas.reserva) + ' guardado' : 'as metas passam de 100% do faturamento: revise') +
      kpi('Ponto de equilíbrio', base.breakEven ? money(base.breakEven) : '—', 'abaixo disso o mês dá prejuízo', base.revenue && base.breakEven && base.revenue < base.breakEven && !di.current ? 'high' : '') +
      (di.current
        ? kpi('Vender por dia', base.perDay != null ? money(base.perDay) : '—', base.perDay ? 'nos ' + base.daysLeft + ' dias que faltam (contando hoje)' : base.goal && base.revenue >= base.goal ? 'meta batida!' : '', base.goal && base.revenue >= base.goal ? 'ok' : '') +
          kpi('Projeção do mês', base.projection != null ? money(base.projection) : '—', base.projection != null && base.goal ? (base.projection >= base.goal ? 'no ritmo de hoje, bate a meta' : 'no ritmo de hoje, faltam ' + money(base.goal - base.projection)) : 'no ritmo de hoje',
            base.projection != null && base.goal ? (base.projection >= base.goal ? 'ok' : 'high') : '')
        : kpi('Resultado do mês', money(base.profit), base.profit >= base.profitGoal ? 'lucro na meta' : 'abaixo da meta de ' + money(base.profitGoal), base.profit >= base.profitGoal ? 'ok' : 'high') +
          kpi('Faturamento x meta', base.goal ? pct(base.progress) : '—', base.goal ? (base.revenue >= base.goal ? 'acima da meta' : 'faltaram ' + money(base.goal - base.revenue)) : '', base.goal ? (base.revenue >= base.goal ? 'ok' : 'high') : '')) +
      (base.ordersPerDay ? kpi('Pedidos por dia', String(Math.ceil(base.ordersPerDay)), 'para bater a meta, com ticket médio de ' + money(base.ticket)) : '') +
      '</section>';

    // O que fazer com o dinheiro do mês.
    var advice;
    if (!dre.revenue) advice = '';
    else if (dre.operating <= 0) {
      advice = '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">Com ' + money(dre.revenue) + (useProj ? ' (projeção)' : '') + ' de faturamento, faltam <b>' + money(-dre.operating) + '</b> para pagar os custos do mês. ' +
        'Não tire lucro agora: o mínimo para empatar é ' + money(dre.breakEven) + '.</div></div>';
    } else {
      var take = Math.max(0, dre.profit);
      advice = '<section class="section"><div class="eyebrow">O que fazer com o dinheiro' + (useProj ? ' (pela projeção)' : '') + '</div><div class="stat-grid fin-split">' +
        kpi('Lucro para retirar', money(take), take >= dre.profitGoal ? 'meta de ' + pct(store.cfg.metas.lucro) + ' alcançada' : 'meta era ' + money(dre.profitGoal), take >= dre.profitGoal ? 'ok' : 'high') +
        kpi('Investir em marketing', money(dre.marketing), pct(store.cfg.metas.marketing) + ' do faturamento') +
        kpi('Guardar (reserva e investimento)', money(dre.reserva), pct(store.cfg.metas.reserva) + ' do faturamento') +
        '</div>' +
        (dre.profit < 0 ? '<p class="card-meta">Depois de pagar os custos sobram ' + money(dre.operating) + ', menos do que o marketing e a reserva planejados. Divida esse valor entre marketing e reserva, sem retirada este mês.</p>' : '') +
        '</section>';
    }

    var dreHtml = '<section class="section"><div class="section-head"><h2>Resultado do mês</h2>' +
      (di.current && base.projection != null ? '<div class="seg sm" data-view><button type="button" data-v="proj" aria-pressed="' + useProj + '">Projeção do mês</button><button type="button" data-v="hoje" aria-pressed="' + !useProj + '">Até hoje</button></div>' : '') + '</div>' +
      '<div class="table-wrap"><table class="cmv-table fin-dre"><thead><tr><th></th><th class="n">R$</th><th class="n">% do faturamento</th></tr></thead><tbody>' +
      dreRow('Faturamento' + (useProj ? ' (projeção)' : ''), dre.revenue, dre.revenue, 'tot') +
      dreRow('− CMV (ingredientes e embalagens)', dre.cmv, dre.revenue, 'fx', esc(cm.label)) +
      dre.vars.filter(function (v) { return v.pct > 0; }).map(function (v) { return dreRow('− ' + esc(v.name), v.value, dre.revenue, 'fx'); }).join('') +
      dreRow('= Margem de contribuição', dre.contrib, dre.revenue, 'sub') +
      dreRow('− Folha de pagamento', dre.folha.total, dre.revenue, 'fx', dre.folha.n + (dre.folha.n === 1 ? ' pessoa' : ' pessoas') + ' com encargos e benefícios') +
      dreRow('− Custos fixos', dre.fixosBase, dre.revenue, 'fx') +
      (dre.extras ? dreRow('− Despesas extras do mês', dre.extras, dre.revenue, 'fx') : '') +
      dreRow('= Resultado operacional', dre.operating, dre.revenue, 'sub') +
      dreRow('− Marketing', dre.marketing, dre.revenue, 'fx') +
      dreRow('− Reserva e investimento', dre.reserva, dre.revenue, 'fx') +
      dreRow('= Lucro para retirar', dre.profit, dre.revenue, 'tot ' + (dre.profit >= 0 ? 'tone-ok' : 'tone-high')) +
      '</tbody></table></div></section>';

    var extras = '<section class="section"><div class="section-head"><h2>Despesas extras do mês</h2><button type="button" class="btn sm" data-add-extra>' + icon('plus', 'sm') + 'Despesa</button></div>' +
      ((m.extras || []).length ? '<div class="list">' + m.extras.map(function (e, i) {
        return '<div class="row"><div class="grow"><div class="card-title">' + esc(e.name) + '</div></div><b class="num">' + money(e.value) + '</b>' +
          '<button type="button" class="icon-btn plain" data-rm-extra="' + i + '" aria-label="Tirar ' + esc(e.name) + '">' + icon('x', 'sm') + '</button></div>';
      }).join('') + '</div>' : '<p class="card-meta">Gastos que não se repetem todo mês, como o conserto do forno ou uma compra de equipamento.</p>') + '</section>';

    var body = nav +
      (empty ? '<a class="banner" href="#financeiro/custos" style="text-decoration:none">' + icon('alert', 'sm') + '<div class="grow">Comece cadastrando os custos fixos, a folha e as metas em <b>Custos e metas</b>. Sem eles não dá para calcular a meta nem o lucro.</div>' + icon('chevronRight', 'sm') + '</a>' : '') +
      hero + kpis + advice + dreHtml + extras;

    return {
      html: shell('', body), tab: 'financeiro',
      mount: function (root) {
        if (!cw[key] || (!cw[key].loading && Date.now() - cw[key].at > 120000)) cwLoad(key, function () { if (route().split('/')[0] === 'financeiro' && !document.querySelector('.sheet-wrap')) refresh(); });
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-mon]');
          if (b && !b.disabled) { st.month = Fin.addMonth(key, +b.dataset.mon); st.view = 'proj'; return refresh(); }
          var v = e.target.closest('[data-view] [data-v]');
          if (v) { st.view = v.dataset.v; return refresh(); }
          if (e.target.closest('[data-rev]')) return revenueSheet(key);
          if (e.target.closest('[data-add-extra]')) return extraSheet(key);
          var rm = e.target.closest('[data-rm-extra]');
          if (rm) { month(key).extras.splice(+rm.dataset.rmExtra, 1); save('m-' + key); return refresh(); }
        });
        return flush;
      }
    };
  }

  function revenueSheet(key) {
    var m = month(key), rv = revenueOf(key);
    UI.sheet('<h2>Faturamento de ' + esc(Fin.monthLabel(key)) + '</h2>' +
      (rv.auto ? '<p class="muted">A Cardápio Web marca ' + money(rv.auto.revenue) + ' em ' + rv.auto.orders + ' pedidos. Lance aqui só se quiser somar as vendas de fora (balcão, mesas) ou corrigir.</p>'
        : '<p class="muted">Some tudo o que entrou no mês: delivery, balcão e mesas.</p>') +
      '<div class="field"><label for="rev-v">Faturamento do mês (R$)</label><input id="rev-v" class="input num" inputmode="decimal" placeholder="0,00" value="' + (m.revenue != null ? CMV.num2(m.revenue) : '') + '" autofocus></div>' +
      '<div class="field"><label for="rev-o">Pedidos no mês <span class="faint">(opcional, para o ticket médio)</span></label><input id="rev-o" class="input num" inputmode="numeric" value="' + (m.orders || '') + '"></div>' +
      '<div class="section"><button type="button" class="btn primary block" data-ok>Salvar</button>' +
      (m.revenue != null && rv.auto ? '<button type="button" class="btn block" data-auto>Usar o da Cardápio Web</button>' : '') +
      '<button type="button" class="btn block" data-close>Voltar</button></div>',
      function (sheet, close) {
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          var v = CMV.parse(sheet.querySelector('#rev-v').value), o = CMV.parse(sheet.querySelector('#rev-o').value);
          if (v == null || v < 0) { UI.toast('Informe o faturamento do mês.', { tone: 'crit' }); return; }
          m.revenue = Math.round(v * 100) / 100; m.orders = o > 0 ? Math.round(o) : null;
          save('m-' + key); close(); refresh(); UI.toast('Faturamento salvo');
        });
        var a = sheet.querySelector('[data-auto]');
        if (a) a.addEventListener('click', function () { m.revenue = null; m.orders = null; save('m-' + key); close(); refresh(); });
      });
  }

  function extraSheet(key) {
    UI.sheet('<h2>Despesa extra do mês</h2>' +
      '<div class="field"><label for="ex-n">O que foi</label><input id="ex-n" class="input" placeholder="Ex.: conserto do forno" autofocus></div>' +
      '<div class="field"><label for="ex-v">Valor (R$)</label><input id="ex-v" class="input num" inputmode="decimal" placeholder="0,00"></div>' +
      '<div class="section"><button type="button" class="btn primary block" data-ok>Adicionar</button><button type="button" class="btn block" data-close>Voltar</button></div>',
      function (sheet, close) {
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          var n = sheet.querySelector('#ex-n').value.trim(), v = CMV.parse(sheet.querySelector('#ex-v').value);
          if (!n || v == null || v <= 0) { UI.toast('Informe o que foi e o valor.', { tone: 'crit' }); return; }
          month(key).extras.push({ name: n, value: Math.round(v * 100) / 100 });
          save('m-' + key); close(); refresh();
        });
      });
  }

  // ---------- Custos e metas ----------
  function moneyIn(attrs, v) { return '<input class="cmv-in" inputmode="decimal" ' + attrs + ' value="' + (v ? CMV.num2(v) : '') + '" placeholder="0,00">'; }
  function pctIn(attrs, v) { return '<span class="cmv-qty"><input class="cmv-in" inputmode="decimal" ' + attrs + ' value="' + pctVal(v) + '" placeholder="0"><small>%</small></span>'; }

  // Totais e conclusão ao vivo (data-calc), recalculados a cada número digitado.
  function custosCalc() {
    var key = Fin.monthKey(today()), r = result(key), c = store.cfg, cm = cmvInfo(key, revenueOf(key).value);
    var fol = Fin.folha(c, teamCount());
    return '<b class="num" data-calc="fx">' + money(r.fixosBase) + '</b>' +
      '<b class="num" data-calc="fol">' + money(fol.total) + '</b>' +
      '<span data-calc="foln">' + fol.n + (fol.n === 1 ? ' pessoa' : ' pessoas') + ' × (' + money(c.folha.salary) + ' + ' + pct(c.folha.encargos) + ' de encargos + ' + money(c.folha.beneficios) + ' de benefícios)</span>' +
      '<b class="num" data-calc="vr">' + pct(r.varPct) + '</b>' +
      '<span data-calc="cmvp">' + pct(cm.pct) + ' · ' + esc(cm.label) + '</span>' +
      '<div class="banner ' + (r.goal ? 'info' : 'crit') + '" data-calc="sum">' + icon(r.goal ? 'sparkle' : 'alert', 'sm') + '<div class="grow">' +
      (r.goal ? 'Custo fixo do mês: <b>' + money(r.fixed) + '</b>. Custos variáveis: <b>' + pct(r.varPct) + '</b> do faturamento. Ponto de equilíbrio: <b>' + money(r.breakEven) + '</b>. ' +
        'Meta para ter o lucro, o marketing e a reserva que você quer: <b>' + money(r.goal) + '</b> por mês (' + money(r.goal / Fin.daysIn(key)) + ' por dia).'
        : 'Custos variáveis + metas passam de 100% do faturamento: não existe faturamento que pague tudo. Diminua as metas ou revise os percentuais.') + '</div></div>';
  }

  function custos() {
    var g = gate('custos');
    if (g) return g;
    var c = store.cfg, team = teamCount();
    var calc = document.createElement('div');
    calc.innerHTML = custosCalc();
    function piece(k) { var n = calc.querySelector('[data-calc="' + k + '"]'); return n ? n.outerHTML : ''; }
    function rowsOf(list, kind) {
      return list.map(function (x, i) {
        return '<tr><td><input class="cmv-in text" data-' + kind + '-name="' + i + '" value="' + esc(x.name) + '" aria-label="Nome"></td><td class="n">' +
          (kind === 'fx' ? moneyIn('data-fx-val="' + i + '" aria-label="Valor de ' + esc(x.name) + '"', x.value) : pctIn('data-vr-pct="' + i + '" aria-label="Percentual de ' + esc(x.name) + '"', x.pct)) +
          '</td><td><button type="button" class="icon-btn plain" data-rm-' + kind + '="' + i + '" aria-label="Tirar ' + esc(x.name) + '">' + icon('x', 'sm') + '</button></td></tr>';
      }).join('');
    }
    var CMV_SRC = [['fichas', 'Fichas técnicas'], ['notas', 'Compras das notas'], ['manual', 'Informar']];
    var body = piece('sum') +
      '<section class="section"><div class="section-head"><h2>Custos fixos do mês</h2>' + piece('fx') + '</div>' +
      '<p class="card-meta">O que você paga todo mês, vendendo muito ou pouco. Os salários da equipe ficam na folha, logo abaixo.</p>' +
      '<div class="table-wrap"><table class="cmv-table"><tbody>' + rowsOf(c.fixos, 'fx') + '</tbody></table></div>' +
      '<button type="button" class="btn sm" data-add-fx style="align-self:flex-start">' + icon('plus', 'sm') + 'Custo fixo</button></section>' +

      '<section class="section"><div class="section-head"><h2>Folha de pagamento</h2>' + piece('fol') + '</div>' +
      '<div class="card fin-folha">' +
      '<div class="field"><label for="f-count">Funcionários</label><input id="f-count" class="cmv-in" inputmode="numeric" data-fol="count" value="' + (c.folha.count != null ? c.folha.count : '') + '" placeholder="' + team + '">' +
      '<span class="hint">Vazio = os ' + team + ' ativos cadastrados na equipe.</span></div>' +
      '<div class="field"><label for="f-sal">Salário médio (R$)</label>' + moneyIn('id="f-sal" data-fol="salary"', c.folha.salary) + '</div>' +
      '<div class="field"><label for="f-enc">Encargos sobre o salário</label>' + pctIn('id="f-enc" data-fol="encargos"', c.folha.encargos) +
      '<span class="hint">FGTS, férias, 13º e INSS. No Simples Nacional fica perto de 30%.</span></div>' +
      '<div class="field"><label for="f-ben">Benefícios por pessoa (R$)</label>' + moneyIn('id="f-ben" data-fol="beneficios"', c.folha.beneficios) +
      '<span class="hint">Vale-transporte, alimentação, ajuda de custo.</span></div>' +
      '</div><p class="card-meta">' + piece('foln') + '</p></section>' +

      '<section class="section"><div class="section-head"><h2>Custos variáveis</h2>' + piece('vr') + '</div>' +
      '<p class="card-meta">Sobem e descem com as vendas: entram como % do faturamento.</p>' +
      '<div class="card"><div class="card-title">CMV (ingredientes e embalagens)</div>' +
      '<div class="seg sm" data-cmv-src>' + CMV_SRC.map(function (s) { return '<button type="button" data-v="' + s[0] + '" aria-pressed="' + (c.cmv.source === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="field" data-cmv-manual' + (c.cmv.source === 'manual' ? '' : ' hidden') + '><label for="cmv-pct">CMV</label>' + pctIn('id="cmv-pct" data-cmv-pct', c.cmv.pct) + '</div>' +
      '<p class="card-meta">Usado na conta: ' + piece('cmvp') + '</p>' +
      '<p class="card-meta">As fichas técnicas já incluem caixa, gás e energia de cada pizza. Se usar as fichas, deixe nos custos fixos só a parte da energia e do gás que não é do forno.</p></div>' +
      '<div class="table-wrap"><table class="cmv-table"><tbody>' + rowsOf(c.variaveis, 'vr') + '</tbody></table></div>' +
      '<button type="button" class="btn sm" data-add-vr style="align-self:flex-start">' + icon('plus', 'sm') + 'Custo variável</button></section>' +

      '<section class="section"><div class="section-head"><h2>Metas</h2></div>' +
      '<div class="card cmv-cmp">' +
      '<div><span class="card-meta">Lucro para retirar</span>' + pctIn('data-meta="lucro" aria-label="Meta de lucro"', c.metas.lucro) + '</div>' +
      '<div><span class="card-meta">Marketing</span>' + pctIn('data-meta="marketing" aria-label="Marketing"', c.metas.marketing) + '</div>' +
      '<div><span class="card-meta">Reserva e investimento</span>' + pctIn('data-meta="reserva" aria-label="Reserva"', c.metas.reserva) + '</div>' +
      '</div><p class="card-meta">Em % do faturamento. Pizzarias costumam mirar de 10% a 15% de lucro e de 2% a 5% em marketing.</p>' +
      '<div class="field"><label for="tk">Ticket médio (R$) <span class="faint">(opcional)</span></label>' + moneyIn('id="tk" data-ticket', c.ticket) +
      '<span class="hint">Vazio = o da Cardápio Web ou dos pedidos lançados. Serve para dizer quantos pedidos por dia bater a meta.</span></div></section>';

    return {
      html: shell('custos', body), tab: 'financeiro',
      mount: function (root) {
        root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('.cmv-in')) e.target.blur(); });
        root.addEventListener('input', function (e) {
          var t = e.target, ds = t.dataset, v = CMV.parse(t.value), ok = v == null || v >= 0;
          if (ds.fxName != null) { c.fixos[+ds.fxName].name = t.value; ok = true; }
          else if (ds.vrName != null) { c.variaveis[+ds.vrName].name = t.value; ok = true; }
          else if (ds.fxVal != null) { if (ok) c.fixos[+ds.fxVal].value = v || 0; }
          else if (ds.vrPct != null) { ok = ok && (v || 0) < 100; if (ok) c.variaveis[+ds.vrPct].pct = (v || 0) / 100; }
          else if (ds.fol) {
            if (ds.fol === 'count') { ok = v == null || (v >= 0 && v < 1000); if (ok) c.folha.count = v == null ? null : Math.round(v); }
            else if (ds.fol === 'encargos') { ok = ok && (v || 0) < 200; if (ok) c.folha.encargos = (v || 0) / 100; }
            else if (ok) c.folha[ds.fol] = v || 0;
          }
          else if (ds.meta) { ok = ok && (v || 0) < 100; if (ok) c.metas[ds.meta] = (v || 0) / 100; }
          else if (ds.cmvPct != null) { ok = ok && (v || 0) < 100; if (ok) c.cmv.pct = (v || 0) / 100; }
          else if (ds.ticket != null) { if (ok) c.ticket = v || null; }
          else return;
          t.classList.toggle('bad', !ok);
          if (!ok) return;
          save('config');
          patch(root, custosCalc());
        });
        root.addEventListener('click', function (e) {
          var s = e.target.closest('[data-cmv-src] [data-v]');
          if (s) { c.cmv.source = s.dataset.v; save('config'); return refresh(); }
          var b;
          if ((b = e.target.closest('[data-rm-fx]'))) { c.fixos.splice(+b.dataset.rmFx, 1); save('config'); return refresh(); }
          if ((b = e.target.closest('[data-rm-vr]'))) { c.variaveis.splice(+b.dataset.rmVr, 1); save('config'); return refresh(); }
          if (e.target.closest('[data-add-fx]')) { c.fixos.push({ id: 'f' + Date.now().toString(36), name: '', value: 0 }); save('config'); refresh(); return focusLast(root, '[data-fx-name]'); }
          if (e.target.closest('[data-add-vr]')) { c.variaveis.push({ id: 'v' + Date.now().toString(36), name: '', pct: 0 }); save('config'); refresh(); return focusLast(root, '[data-vr-name]'); }
        });
        return flush;
      }
    };
  }
  // Depois do refresh a tela é outra: procura o campo novo no documento.
  function focusLast(root, sel) {
    var all = document.querySelectorAll(sel), f = all[all.length - 1];
    if (f) f.focus();
  }

  Screens.financeiro = function (params) {
    if (!UI.isAdmin()) return Screens.inicio([]);
    return params[0] === 'custos' ? custos() : resumo();
  };
})();
