// Estoque › Nota: conferir os itens lidos da nota e dar entrada no estoque da unidade.
(function () {
  var esc = UI.esc, fmt = UI.fmt, money = UI.money;
  var cache = {}; // por chave: { status, data, rows, unit, parsed }

  function fmtDate(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function unitName(id) { var u = DB.get().units.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }
  function onList(pid) { return DB.get().shopping.items.some(function (i) { return i.pid === pid && i.received == null; }); }

  function load(key) {
    if (cache[key]) return cache[key];
    var pend = NotaFlow.pending && NotaFlow.pending.parsed.key === key ? NotaFlow.pending : null;
    var parsed = pend ? pend.parsed : NFCe.parse(key);
    var c = cache[key] = { status: 'loading', parsed: parsed, unit: DB.get().user.unit };
    if (parsed.error) { c.status = 'error'; c.error = parsed.error; return c; }
    NFCe.fetchItems(parsed).then(function (data) {
      c.data = data;
      c.rows = data.items.map(function (it) {
        var m = NFCe.match(it.desc);
        var p = m && DB.product(m.pid);
        return { desc: it.desc, qty: it.qty, unit: it.unit, unitPrice: it.unitPrice, total: it.total,
          pid: m ? m.pid : null, learned: m && m.learned, include: !!m, addQty: p ? NFCe.convert(it.qty, it.unit, p) : it.qty };
      });
      c.status = 'ok';
      if (route() === 'estoque/nota/' + key) refresh();
    }, function () {
      c.status = 'error'; c.error = 'Não foi possível buscar a nota na SEFAZ. Confira a internet e tente de novo.';
      c.retry = true;
      if (route() === 'estoque/nota/' + key) refresh();
    });
    return c;
  }

  function header(c) {
    var p = c.parsed;
    return '<section class="card nota-head">' +
      '<div class="card-row"><div class="tile">' + icon('receipt') + '</div><div class="grow">' +
      '<div class="card-title">' + esc(c.data ? c.data.store.name : 'Buscando loja…') + '</div>' +
      '<div class="card-meta num">CNPJ ' + esc(NFCe.formatCnpj(p.cnpj)) + '</div></div>' +
      (c.data ? '<b class="num nota-total">' + money(c.data.total) + '</b>' : '') + '</div>' +
      '<div class="card-meta num">' + (p.model === '65' ? 'NFC-e' : 'NF-e') + ' nº ' + esc(p.number) + ' · ' + esc(p.uf) + (c.data ? ' · ' + fmtDate(c.data.date) : ' · ' + esc(p.period)) + '</div>' +
      '<div class="card-meta num nota-key">' + esc(NFCe.formatKey(p.key)) + '</div></section>';
  }

  function row(r, i) {
    var p = r.pid && DB.product(r.pid);
    return '<div class="nota-row' + (r.include ? '' : ' off') + '" data-i="' + i + '">' +
      '<label class="nota-check"><input type="checkbox" data-inc' + (r.include ? ' checked' : '') + (p ? '' : ' disabled') + '><span class="box">' + icon('check', 'sm') + '</span><span class="sr-only">Incluir</span></label>' +
      '<div class="grow">' +
      '<div class="nota-desc">' + esc(r.desc) + ' <span class="num">· ' + fmt(r.qty) + ' ' + esc(r.unit) + ' × ' + money(r.unitPrice) + '</span></div>' +
      (p ? '<button type="button" class="nota-prod" data-pick>' + icon('box', 'sm') + '<b>' + esc(p.name) + '</b>' + icon('chevronDown', 'sm') + '</button>' +
          '<div class="card-row nota-tags">' + (r.learned ? '<span class="pill no-dot info">Reconhecido pelo histórico</span>' : '') + (onList(r.pid) ? '<span class="pill no-dot ok">Na lista de compras</span>' : '') + '</div>'
        : '<button type="button" class="btn sm" data-pick>' + icon('plus', 'sm') + 'Associar a um produto</button><div class="card-meta">Não reconhecido. Se não for do estoque, deixe de fora.</div>') +
      '</div>' +
      (p ? '<label class="nota-qty"><span class="sr-only">Quantidade a somar</span><input class="input num" inputmode="decimal" data-qty value="' + String(r.addQty).replace('.', ',') + '"><span class="unit">' + esc(p.unit) + '</span></label>' : '') +
      '</div>';
  }

  function dockHtml(c) {
    var n = c.rows.filter(function (r) { return r.include && r.pid; }).length;
    return '<div class="dock-inner"><div class="grow"><b class="num">' + n + ' de ' + c.rows.length + ' itens</b><span class="card-meta">Entram em ' + esc(unitName(c.unit)) + '</span></div>' +
      '<button type="button" class="btn primary" data-apply' + (n ? '' : ' disabled') + '>Dar entrada</button></div>';
  }

  function pickSheet(c, i) {
    var r = c.rows[i];
    function listHtml(q) {
      q = (q || '').toLowerCase();
      return DB.get().products.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) >= 0; }).map(function (p) {
        return '<button type="button" class="row" data-pid="' + p.id + '"><div class="grow"><div class="card-title">' + esc(p.name) + '</div><div class="card-meta">' + esc(p.cat) + ' · ' + esc(p.unit) + '</div></div>' + (p.id === r.pid ? icon('check') : '') + '</button>';
      }).join('');
    }
    UI.sheet('<h2>Qual produto é este?</h2><p class="muted nota-desc">' + esc(r.desc) + '</p>' +
      '<input id="pick-q" class="input" type="search" placeholder="Buscar produto">' +
      '<div class="list" data-list style="max-height:46vh;overflow:auto">' + listHtml('') + '</div>' +
      (r.pid ? '<button type="button" class="btn block" data-none>Não é do estoque</button>' : '') +
      '<button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        sheet.querySelector('#pick-q').addEventListener('input', function (e) { sheet.querySelector('[data-list]').innerHTML = listHtml(e.target.value); });
        sheet.querySelector('[data-list]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-pid]'); if (!b) return;
          var p = DB.product(b.dataset.pid);
          r.pid = p.id; r.include = true; r.learned = false; r.addQty = NFCe.convert(r.qty, r.unit, p);
          NFCe.remember(r.desc, p.id); // na próxima nota, este item já vem reconhecido
          close(); refresh(); UI.toast('Associado a ' + p.name + '. Nas próximas notas será automático.');
        });
        var none = sheet.querySelector('[data-none]');
        if (none) none.addEventListener('click', function () { r.pid = null; r.include = false; close(); refresh(); });
      });
  }

  function apply(c) {
    var d = DB.get();
    var rows = c.rows.filter(function (r) { return r.include && r.pid && r.addQty > 0; });
    var by = d.user.name;
    var result = [];
    DB.update(function (x) {
      var store = x.stores.filter(function (s) { return s.cnpj === c.data.store.cnpj; })[0];
      if (!store) { store = { id: 's' + Date.now(), name: c.data.store.name, kind: 'Loja', cnpj: c.data.store.cnpj, dist: '' }; x.stores.push(store); }
      x.stock[c.unit] = x.stock[c.unit] || {};
      rows.forEach(function (r) {
        var before = x.stock[c.unit][r.pid] || 0;
        x.stock[c.unit][r.pid] = Math.round((before + r.addQty) * 1000) / 1000;
        result.push({ pid: r.pid, add: r.addQty, total: x.stock[c.unit][r.pid] });
        // Baixa na lista de compras (só na unidade de quem está logado, que é a da lista).
        if (c.unit === x.user.unit) x.shopping.items.forEach(function (it) { if (it.pid === r.pid && it.received == null) it.received = r.addQty; });
        // O preço pago entra na base que alimenta o "Onde comprar".
        // Preço por unidade do cadastro, calculado sobre o que a nota cobrou (não sobre a quantidade editada).
        var noteQty = NFCe.convert(r.qty, r.unit, DB.product(r.pid));
        var perUnit = noteQty ? r.total / noteQty : r.unitPrice;
        x.prices.push({ pid: r.pid, store: store.id, price: Math.round(perUnit * 100) / 100, date: c.data.date, source: 'nota' });
      });
      x.notas.push({ key: c.parsed.key, number: c.parsed.number, uf: c.parsed.uf, store: store.id, storeName: store.name, date: c.data.date,
        total: c.data.total, unit: c.unit, by: by, at: Date.now(), items: result });
    });
    UI.buzz(25);
    go('estoque/nota/ok/' + c.parsed.key, { replace: true });
  }

  function review(key) {
    var c = load(key);
    var dup = DB.get().notas.filter(function (n) { return n.key === key; })[0];
    var top = UI.topbar('Conferir nota', { back: '#estoque/nota', sub: 'Confira antes de dar entrada no estoque' });

    if (c.status === 'error') {
      return { html: '<main class="screen">' + top + '<div class="card">' + UI.empty('alert', 'Não deu para usar esta nota', c.error,
        c.retry ? '<button type="button" class="btn primary" data-retry>' + icon('refresh', 'sm') + 'Tentar de novo</button>' : '<a class="btn primary" href="#estoque/nota">Escanear de novo</a>') + '</div></main>',
        tab: 'estoque',
        mount: function (root) {
          var b = root.querySelector('[data-retry]');
          if (b) b.addEventListener('click', function () { delete cache[key]; refresh(); });
        } };
    }
    if (dup) {
      return { html: '<main class="screen">' + top + header(c) +
        '<div class="banner">' + icon('alert', 'sm') + '<div class="grow">Esta nota já foi lançada em ' + new Date(dup.at).toLocaleDateString('pt-BR') + ' por ' + esc(dup.by) + ', na ' + esc(unitName(dup.unit)) + '. Para não somar duas vezes, ela não pode entrar de novo.</div></div>' +
        '<a class="btn block" href="#estoque">Voltar ao estoque</a></main>', tab: 'estoque' };
    }
    if (c.status === 'loading') {
      return { html: '<main class="screen">' + top + header(c) +
        '<div class="section"><div class="card-meta">' + icon('refresh', 'sm') + ' Buscando os itens da nota na SEFAZ…</div>' +
        [1, 2, 3, 4].map(function () { return '<div class="skel" style="height:72px"></div>'; }).join('') + '</div></main>', tab: 'estoque', nav: false };
    }

    var matched = c.rows.filter(function (r) { return r.pid; }).length;
    var html = '<main class="screen has-dock no-nav">' + top + header(c) +
      (c.data.demo ? '<div class="banner" style="background:var(--info-soft);color:var(--info)">' + icon('sparkle', 'sm') + '<div class="grow">Nota de exemplo. No app com servidor, os itens vêm direto da SEFAZ.</div></div>' : '') +
      '<div class="field"><span class="label">Dar entrada na unidade</span><div class="seg" data-unitsel>' + DB.get().units.map(function (u) {
        return '<button type="button" data-u="' + u.id + '" aria-pressed="' + (u.id === c.unit) + '">' + esc(u.name.replace('Unidade ', '')) + '</button>';
      }).join('') + '</div></div>' +
      '<section class="section"><div class="section-head"><h2>Itens da nota</h2><span class="card-meta">' + matched + ' de ' + c.rows.length + ' reconhecidos</span></div>' +
      '<div class="list nota-list">' + c.rows.map(row).join('') + '</div></section></main>' +
      '<div class="dock no-nav" data-dock>' + dockHtml(c) + '</div>';

    return {
      html: html, tab: 'estoque', nav: false,
      mount: function (root) {
        var dock = root.querySelector('[data-dock]');
        root.querySelectorAll('[data-u]').forEach(function (b) { b.addEventListener('click', function () { c.unit = b.dataset.u; refresh(); }); });
        root.querySelector('.nota-list').addEventListener('click', function (e) {
          var el = e.target.closest('[data-i]'); if (!el) return;
          if (e.target.closest('[data-pick]')) pickSheet(c, Number(el.dataset.i));
        });
        root.querySelector('.nota-list').addEventListener('change', function (e) {
          var el = e.target.closest('[data-i]'); if (!el || !e.target.matches('[data-inc]')) return;
          c.rows[Number(el.dataset.i)].include = e.target.checked;
          el.classList.toggle('off', !e.target.checked);
          dock.innerHTML = dockHtml(c);
        });
        root.querySelector('.nota-list').addEventListener('input', function (e) {
          if (!e.target.matches('[data-qty]')) return;
          var n = Number(e.target.value.replace(',', '.'));
          var bad = isNaN(n) || n < 0;
          e.target.classList.toggle('bad', bad);
          if (!bad) c.rows[Number(e.target.closest('[data-i]').dataset.i)].addQty = n;
        });
        dock.addEventListener('click', function (e) {
          if (!e.target.closest('[data-apply]')) return;
          var n = c.rows.filter(function (r) { return r.include && r.pid; }).length;
          UI.confirm({ title: 'Dar entrada em ' + n + ' itens?', body: 'As quantidades serão somadas ao estoque da ' + esc(unitName(c.unit)) + '.', ok: 'Dar entrada no estoque', onOk: function () { apply(c); } });
        });
      }
    };
  }

  function done(key) {
    var n = DB.get().notas.filter(function (x) { return x.key === key; })[0];
    if (!n) return review(key);
    var received = n.unit === DB.get().user.unit ? n.items.filter(function (i) { return DB.get().shopping.items.some(function (s) { return s.pid === i.pid; }); }).length : 0;
    var html = '<main class="screen no-nav">' +
      '<div class="section" style="align-items:center;text-align:center;padding-top:var(--sp-6)"><div class="success-mark">' + icon('check', 'lg') + '</div>' +
      '<div class="eyebrow">Estoque atualizado</div><h1 style="font-size:var(--fs-2xl)">' + n.items.length + ' itens somados</h1>' +
      '<p class="muted">' + esc(n.storeName) + ' · ' + money(n.total) + ' · ' + esc(unitName(n.unit)) + '</p>' +
      (received ? '<span class="pill ok">' + received + ' itens da lista de compras recebidos</span>' : '') + '</div>' +
      '<div class="list">' + n.items.map(function (i) {
        var p = DB.product(i.pid);
        return '<div class="row"><div class="tile ok">' + icon('plus', 'sm') + '</div><div class="grow"><div class="card-title">' + esc(p.name) + '</div>' +
          '<div class="card-meta num">Agora: ' + fmt(i.total) + ' ' + esc(p.unit) + '</div></div><b class="num">+' + fmt(i.add) + ' ' + esc(p.unit) + '</b></div>';
      }).join('') + '</div></main>' +
      '<div class="dock no-nav"><div class="dock-inner" style="flex-direction:column;gap:8px">' +
      '<a class="btn primary block" href="#estoque/nota">' + icon('scan', 'sm') + 'Escanear outra nota</a>' +
      '<div style="display:flex;gap:8px;width:100%"><a class="btn block" href="#estoque/compras">Lista de compras</a><a class="btn block" href="#estoque">Estoque</a></div></div></div>';
    return { html: html, tab: 'estoque', nav: false };
  }

  Screens.estoque_nota = function (params) {
    if (!params[0]) return Screens.estoque_scan();
    if (params[0] === 'ok') return done(params[1]);
    return review(params[0]);
  };
})();
