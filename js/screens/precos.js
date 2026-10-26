// Estoque › Onde comprar: compara os preços registrados (notas lançadas) e recomenda onde fazer a compra.
(function () {
  var esc = UI.esc, fmt = UI.fmt, money = UI.money;
  var MIN_SAVING = 25;   // R$: abaixo disso não vale a pena ir a duas lojas
  var MIN_SHARE = .05;   // ou menos de 5% do total

  function daysAgo(iso) { return Math.round((Cal.parse(Cal.today()) - Cal.parse(iso)) / 864e5); }

  // Preço mais recente de cada produto em cada loja.
  function priceTable() {
    var t = {};
    DB.get().prices.forEach(function (r) {
      t[r.pid] = t[r.pid] || {};
      var cur = t[r.pid][r.store];
      if (!cur || r.date > cur.date) t[r.pid][r.store] = r;
    });
    return t;
  }

  // Monta o comparativo e a recomendação para os itens pendentes da lista de compras.
  function analyze() {
    var d = DB.get();
    var items = d.shopping.items.filter(function (i) { return i.received == null; }).map(function (i) { return { pid: i.pid, need: i.need, p: DB.product(i.pid) }; });
    var table = priceTable();
    var stores = d.stores.map(function (s) {
      var total = 0, cover = 0, oldest = 0;
      items.forEach(function (it) {
        var r = table[it.pid] && table[it.pid][s.id];
        if (r) { total += it.need * r.price; cover++; oldest = Math.max(oldest, daysAgo(r.date)); }
      });
      return { s: s, total: total, cover: cover, oldest: oldest, wins: 0 };
    });
    // Quem tem o menor preço em cada item.
    items.forEach(function (it) {
      var best = null;
      stores.forEach(function (st) { var r = table[it.pid] && table[it.pid][st.s.id]; if (r && (!best || r.price < best.r.price)) best = { st: st, r: r }; });
      it.best = best;
      if (best) best.st.wins++;
    });
    var full = stores.filter(function (x) { return x.cover === items.length && items.length; }).sort(function (a, b) { return a.total - b.total; });
    var single = full[0] || null, priciest = full[full.length - 1] || null;

    // Melhor combinação de duas lojas: cada item na mais barata das duas.
    var pair = null;
    for (var a = 0; a < stores.length; a++) for (var b = a + 1; b < stores.length; b++) {
      var cost = 0, missing = 0, split = {}; split[stores[a].s.id] = []; split[stores[b].s.id] = [];
      items.forEach(function (it) {
        var ra = table[it.pid] && table[it.pid][stores[a].s.id], rb = table[it.pid] && table[it.pid][stores[b].s.id];
        if (!ra && !rb) { missing++; return; }
        var pick = !rb || (ra && ra.price <= rb.price) ? { st: stores[a], r: ra } : { st: stores[b], r: rb };
        cost += it.need * pick.r.price; split[pick.st.s.id].push({ it: it, r: pick.r });
      });
      if (missing || !split[stores[a].s.id].length || !split[stores[b].s.id].length) continue;
      if (!pair || cost < pair.cost) pair = { a: stores[a], b: stores[b], cost: cost, split: split };
    }

    var plan;
    var saving = single && pair ? single.total - pair.cost : 0;
    if (pair && (!single || (saving >= MIN_SAVING && saving >= single.total * MIN_SHARE))) {
      plan = { type: 'split', pair: pair, total: pair.cost, saving: saving };
    } else if (single) {
      plan = { type: 'single', store: single, total: single.total, vsPriciest: priciest ? priciest.total - single.total : 0 };
    }
    return { items: items, stores: stores.sort(function (x, y) { return (y.cover - x.cover) || (x.total - y.total); }), plan: plan, single: single, table: table };
  }

  function recoCard(A) {
    var pl = A.plan;
    if (!pl) return '<section class="card">' + UI.empty('tag', 'Ainda sem preços suficientes', 'Escaneie as notas das próximas compras: cada nota registra os preços daquela loja e a comparação melhora sozinha.', '<a class="btn primary" href="#estoque/nota">' + icon('scan', 'sm') + 'Escanear nota</a>') + '</section>';
    var head, text, tags = [];
    if (pl.type === 'split') {
      var a = pl.pair.a.s, b = pl.pair.b.s, na = pl.pair.split[a.id].length, nb = pl.pair.split[b.id].length;
      head = 'Divida entre ' + esc(a.name) + ' e ' + esc(b.name);
      text = na + ' ' + (na === 1 ? 'item' : 'itens') + ' no ' + esc(a.name) + ' e ' + nb + ' no ' + esc(b.name) + '. Sai ' + money(pl.saving) + ' mais barato do que comprar tudo no ' + esc(A.single ? A.single.s.name : 'mesmo lugar') + '.';
      if (a.dist === 'Entrega' || b.dist === 'Entrega') text += ' ' + esc(a.dist === 'Entrega' ? a.name : b.name) + ' entrega na loja, então é uma ida só.';
      tags.push('Economia de ' + money(pl.saving));
    } else {
      var s = pl.store.s;
      head = 'Compre tudo no ' + esc(s.name);
      text = 'É o menor total para a lista inteira' + (pl.vsPriciest > 1 ? ', ' + money(pl.vsPriciest) + ' a menos que a opção mais cara' : '') + '. Dividir entre duas lojas economizaria menos de ' + money(MIN_SAVING) + ', não compensa a viagem.';
      if (s.dist) tags.push(s.dist === 'Entrega' ? 'Entrega' : s.dist);
    }
    var stale = A.stores.some(function (x) { return x.cover && x.oldest > 7; });
    return '<section class="card hero reco">' +
      '<div class="eyebrow" style="color:inherit;opacity:.65">' + icon('sparkle', 'sm') + ' Recomendação</div>' +
      '<h2 style="font-size:var(--fs-xl)">' + head + '</h2>' +
      '<p class="muted">' + text + '</p>' +
      '<div class="reco-total"><span class="muted">Total estimado</span><b class="num">' + money(pl.total) + '</b></div>' +
      (tags.length ? '<div class="card-row" style="flex-wrap:wrap;gap:6px">' + tags.map(function (t) { return '<span class="pill no-dot reco-pill">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      (stale ? '<p class="muted" style="font-size:var(--fs-xs)">Alguns preços têm mais de uma semana. Confirme na loja.</p>' : '') +
      '<button type="button" class="btn primary block" data-copy>' + icon('copy', 'sm') + 'Copiar lista por loja</button>' +
      '</section>';
  }

  function storeList(A) {
    var bestId = A.plan ? (A.plan.type === 'single' ? A.plan.store.s.id : null) : null;
    return '<section class="section"><div class="section-head"><h2>Comparativo por loja</h2></div><div class="list">' + A.stores.map(function (x) {
      var complete = x.cover === A.items.length;
      return '<div class="row"><div class="tile">' + icon(x.s.kind === 'Fornecedor' ? 'truck' : 'store') + '</div>' +
        '<div class="grow"><div class="card-title">' + esc(x.s.name) + (x.s.id === bestId ? ' <span class="pill ok">Melhor opção</span>' : '') + '</div>' +
        '<div class="card-meta">' + esc(x.s.kind) + (x.s.dist ? ' · ' + esc(x.s.dist) : '') + ' · tem ' + x.cover + ' de ' + A.items.length + ' itens' + (x.wins ? ' · mais barato em ' + x.wins : '') + '</div></div>' +
        '<div style="text-align:right"><b class="num">' + (x.cover ? money(x.total) : '–') + '</b>' + (x.cover && !complete ? '<div class="card-meta">incompleto</div>' : '') + '</div></div>';
    }).join('') + '</div></section>';
  }

  function itemList(A) {
    return '<section class="section"><div class="section-head"><h2>Item a item</h2></div><div class="list">' + A.items.map(function (it) {
      var row = A.stores.filter(function (x) { return A.table[it.pid] && A.table[it.pid][x.s.id]; }).map(function (x) {
        var r = A.table[it.pid][x.s.id];
        var win = it.best && it.best.st.s.id === x.s.id;
        return '<span class="price-chip' + (win ? ' win' : '') + '" title="' + esc(x.s.name) + ', há ' + daysAgo(r.date) + ' dias">' +
          '<span>' + esc(x.s.name.split(' ').slice(0, 2).join(' ')) + '</span><b class="num">' + money(r.price) + '</b></span>';
      }).join('');
      return '<div class="row" style="flex-direction:column;align-items:stretch;gap:8px">' +
        '<div class="card-row"><div class="grow"><div class="card-title">' + esc(it.p.name) + '</div><div class="card-meta num">' + fmt(it.need) + ' ' + esc(it.p.unit) + '</div></div>' +
        (it.best ? '<b class="num">' + money(it.need * it.best.r.price) + '</b>' : '<span class="card-meta">sem preço</span>') + '</div>' +
        '<div class="price-chips">' + (row || '<span class="card-meta">Nenhuma nota com este produto ainda.</span>') + '</div></div>';
    }).join('') + '</div></section>';
  }

  function copyText(A) {
    var pl = A.plan; if (!pl) return '';
    var groups = [];
    if (pl.type === 'split') {
      [pl.pair.a, pl.pair.b].forEach(function (x) { groups.push({ name: x.s.name, list: pl.pair.split[x.s.id].map(function (o) { return { it: o.it, price: o.r.price }; }) }); });
    } else {
      groups.push({ name: pl.store.s.name, list: A.items.map(function (it) { return { it: it, price: A.table[it.pid][pl.store.s.id].price }; }) });
    }
    return groups.map(function (g) {
      return 'Comprar no ' + g.name + ':\n' + g.list.map(function (o) { return '- ' + o.it.p.name + ': ' + fmt(o.it.need) + ' ' + o.it.p.unit + ' (até ' + money(o.price) + '/' + o.it.p.unit + ')'; }).join('\n');
    }).join('\n\n');
  }

  Screens.estoque_precos = function () {
    var A = analyze();
    var html = '<main class="screen">' + UI.topbar('Onde comprar', { back: '#estoque/compras', sub: A.items.length + ' itens pendentes na lista de compras' }) +
      (A.items.length ? recoCard(A) + storeList(A) + itemList(A) +
        '<p class="card-meta">' + icon('receipt', 'sm') + ' Preços tirados das notas fiscais lançadas no app. Cada nota lançada atualiza a comparação.</p>'
        : '<div class="card">' + UI.empty('check', 'Nada para comprar agora', 'A lista de compras está toda recebida. O próximo fechamento gera uma nova lista.') + '</div>') +
      '</main>';
    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        var b = root.querySelector('[data-copy]');
        if (b) b.addEventListener('click', function () {
          var t = copyText(A);
          try {
            navigator.clipboard.writeText(t).then(function () { UI.toast('Lista copiada, separada por loja.'); },
              function () { UI.toast('Não foi possível copiar. Tente de novo.', { tone: 'crit' }); });
          } catch (e) { UI.toast('Não foi possível copiar. Tente de novo.', { tone: 'crit' }); }
        });
      }
    };
  };

  window.PriceAdvisor = { analyze: analyze };
})();
