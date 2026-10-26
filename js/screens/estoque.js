// Estoque: atalhos, consulta de produtos e lista de compras.
(function () {
  var esc = UI.esc, fmt = UI.fmt;
  var STATE_PILL = { pend: ['', 'Sem contagem'], crit: ['crit', 'Crítico'], warn: ['warn', 'Repor'], ok: ['ok', 'Ok'] };

  // Estoque atual da unidade (atualizado pelo fechamento e pelas notas escaneadas).
  function lastQty(d, pid) {
    return DB.stockOf(pid);
  }

  function productRows(d, term) {
    term = (term || '').toLowerCase();
    var list = d.products.filter(function (p) { return !term || p.name.toLowerCase().indexOf(term) >= 0; });
    if (!list.length) return UI.empty('search', 'Nenhum produto encontrado', 'Confira a grafia ou busque por outro nome.');
    return '<div class="list">' + list.map(function (p) {
      var q = lastQty(d, p.id);
      var st = stockState(p, q, d.closing.delivery);
      var pill = STATE_PILL[st.key];
      return '<div class="row"><div class="grow"><div class="card-title">' + esc(p.name) + '</div>' +
        '<div class="card-meta">' + esc(p.cat) + ' · ' + (q == null ? 'sem contagem' : '<span class="num">' + fmt(q) + '</span> de ' + fmt(p.ideal[d.closing.delivery]) + ' ' + esc(p.unit)) + '</div></div>' +
        '<span class="pill ' + pill[0] + '">' + pill[1] + '</span></div>';
    }).join('') + '</div>';
  }

  function hub() {
    var d = DB.get();
    var s = Stats.closing(d);
    var pend = Stats.shoppingPending(d);
    var html = '<main class="screen">' + UI.topbar('Estoque', { sub: DB.get().units.filter(function (u) { return u.id === d.user.unit; })[0].name }) +
      // Ação mais frequente de quem volta das compras: escanear a nota.
      '<div class="quick-actions"><a class="btn primary block" href="#estoque/nota" style="min-height:56px;font-size:var(--fs-lg)">' + icon('scan') + 'Escanear nota fiscal</a>' +
      '<a class="btn block" href="#estoque/precos" style="min-height:56px">' + icon('tag', 'sm') + 'Onde comprar</a></div>' +
      '<div class="stat-grid">' +
      '<a class="card tap" href="#estoque/fechamento" style="text-decoration:none;color:inherit"><div class="tile accent">' + icon('checklist') + '</div>' +
      '<div class="card-title">Fechamento</div><div class="card-meta num">' + s.counted + '/' + s.total + ' contados</div>' + UI.bar(s.pct) + '</a>' +
      '<a class="card tap" href="#estoque/compras" style="text-decoration:none;color:inherit"><div class="tile warn">' + icon('cart') + '</div>' +
      '<div class="card-title">Compras</div><div class="card-meta num">' + pend.length + ' a receber</div>' + UI.bar(d.shopping.items.length ? (1 - pend.length / d.shopping.items.length) * 100 : 100, 'ok') + '</a>' +
      '</div>' +
      '<section class="section"><div class="section-head"><h2>Produtos</h2></div>' +
      '<label class="field"><span class="sr-only">Buscar produto</span><div style="position:relative">' +
      '<span style="position:absolute;left:14px;top:13px;color:var(--ink-3)">' + icon('search', 'sm') + '</span>' +
      '<input id="prod-search" class="input" type="search" placeholder="Buscar produto" style="padding-left:42px"></div></label>' +
      '<div data-products>' + productRows(d, '') + '</div></section></main>';
    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        var box = root.querySelector('[data-products]');
        root.querySelector('#prod-search').addEventListener('input', function (e) { box.innerHTML = productRows(DB.get(), e.target.value); });
      }
    };
  }

  function receiveSheet(i) {
    var d = DB.get();
    var it = d.shopping.items[i];
    var p = DB.product(it.pid);
    UI.sheet('<h2>Receber ' + esc(p.name) + '</h2><p class="muted">Pedido: <b class="num">' + fmt(it.need) + ' ' + esc(p.unit) + '</b></p>' +
      '<div class="field"><label for="rcv-q">Quantidade recebida</label>' +
      '<div class="stepper"><button type="button" class="icon-btn" data-step="-1" aria-label="Diminuir">' + icon('minus') + '</button>' +
      '<input id="rcv-q" class="input num" inputmode="decimal" value="' + String(it.need).replace('.', ',') + '">' +
      '<button type="button" class="icon-btn" data-step="1" aria-label="Aumentar">' + icon('plus') + '</button></div>' +
      '<span class="hint">' + esc(p.unit) + '. Ajuste se veio quantidade diferente do pedido.</span></div>' +
      '<button type="button" class="btn primary block" data-ok>Confirmar recebimento</button><button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        var inp = sheet.querySelector('#rcv-q');
        function val() { var n = Number(inp.value.replace(',', '.')); return isNaN(n) ? 0 : n; }
        sheet.querySelectorAll('[data-step]').forEach(function (b) {
          b.addEventListener('click', function () { inp.value = String(Math.max(0, val() + Number(b.dataset.step))).replace('.', ','); UI.buzz(); });
        });
        var ok = sheet.querySelector('[data-ok]');
        ok.addEventListener('click', function () {
          var q = val();
          UI.busy(ok, function () {
            DB.update(function (x) { x.shopping.items[i].received = q; });
            close(); refresh(); UI.buzz(20);
            UI.toast('Recebido: ' + fmt(q) + ' ' + p.unit + ' de ' + p.name, {
              action: 'Desfazer', ms: 4000,
              onAction: function () { DB.update(function (x) { x.shopping.items[i].received = null; }); refresh(); }
            });
          });
        });
      });
  }

  function listText(d) {
    return 'Lista de compras\n' + d.shopping.items.filter(function (i) { return i.received == null; }).map(function (i) {
      var p = DB.product(i.pid);
      return '- ' + p.name + ': ' + fmt(i.need) + ' ' + p.unit;
    }).join('\n');
  }

  function compras() {
    var d = DB.get();
    var pend = [], done = [];
    d.shopping.items.forEach(function (it, i) { (it.received == null ? pend : done).push({ it: it, i: i, p: DB.product(it.pid) }); });
    var pct = d.shopping.items.length ? done.length / d.shopping.items.length * 100 : 0;

    var html = '<main class="screen">' + UI.topbar('Lista de compras', { back: '#estoque', sub: 'Gerada no fechamento de ' + d.shopping.fromClosing }) +
      '<div class="card"><div class="card-row" style="justify-content:space-between"><b class="num">' + done.length + ' de ' + d.shopping.items.length + ' recebidos</b>' +
      '<button type="button" class="btn sm" data-copy>Copiar lista</button></div>' + UI.bar(pct, 'ok') + '</div>' +
      '<div class="quick-actions"><a class="btn primary block" href="#estoque/nota">' + icon('scan', 'sm') + 'Escanear nota da compra</a>' +
      '<a class="btn block" href="#estoque/precos">' + icon('tag', 'sm') + 'Onde comprar</a></div>' +
      (pend.length ? '<section class="section"><div class="eyebrow">A receber</div><div class="list">' + pend.map(function (x) {
        return '<div class="row"><div class="grow"><div class="card-title">' + esc(x.p.name) + '</div><div class="card-meta">' + esc(x.p.cat) + '</div></div>' +
          '<b class="num" style="white-space:nowrap">' + fmt(x.it.need) + ' ' + esc(x.p.unit) + '</b>' +
          '<button type="button" class="btn sm dark" data-rcv="' + x.i + '">Receber</button></div>';
      }).join('') + '</div></section>'
        : '<div class="card">' + UI.empty('truck', 'Tudo recebido', 'Todos os itens da lista chegaram. O próximo fechamento gera uma nova lista.') + '</div>') +
      (done.length ? '<section class="section"><div class="eyebrow">Recebidos</div><div class="list">' + done.map(function (x) {
        var diff = x.it.received !== x.it.need;
        return '<div class="row"><div class="tile ok">' + icon('check', 'sm') + '</div><div class="grow"><div class="card-title">' + esc(x.p.name) + '</div>' +
          '<div class="card-meta num">' + fmt(x.it.received) + ' de ' + fmt(x.it.need) + ' ' + esc(x.p.unit) + (diff ? ' · quantidade diferente do pedido' : '') + '</div></div>' +
          (diff ? '<span class="pill warn">Divergente</span>' : '') + '</div>';
      }).join('') + '</div></section>' : '') +
      '</main>';

    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        root.querySelectorAll('[data-rcv]').forEach(function (b) { b.addEventListener('click', function () { receiveSheet(Number(b.dataset.rcv)); }); });
        root.querySelector('[data-copy]').addEventListener('click', function () {
          var text = listText(DB.get());
          try {
            navigator.clipboard.writeText(text).then(function () { UI.toast('Lista copiada. Cole no WhatsApp do fornecedor.'); },
              function () { UI.toast('Não foi possível copiar. Tente de novo.', { tone: 'crit' }); });
          } catch (e) { UI.toast('Não foi possível copiar. Tente de novo.', { tone: 'crit' }); }
        });
      }
    };
  }

  Screens.estoque = function (params) {
    if (params[0] === 'fechamento') return Screens.estoque_fechamento();
    if (params[0] === 'compras') return compras();
    if (params[0] === 'nota') return Screens.estoque_nota(params.slice(1));
    if (params[0] === 'precos') return Screens.estoque_precos();
    return hub();
  };
})();
