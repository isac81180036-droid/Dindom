// Fechamento de estoque: contagem em lista única, com rascunho salvo automaticamente.
(function () {
  var esc = UI.esc, fmt = UI.fmt;

  function parseQty(v) {
    v = String(v).trim().replace(',', '.');
    if (v === '') return null;
    var n = Number(v);
    return isNaN(n) || n < 0 ? NaN : n;
  }

  // Situação de um produto a partir da quantidade encontrada.
  window.stockState = function (p, q, delivery) {
    var ideal = p.ideal[delivery];
    if (q == null) return { key: 'pend', label: 'Pendente', need: null };
    var need = Math.max(0, Math.round((ideal - q) * 100) / 100);
    if (q <= p.crit) return { key: 'crit', label: 'Crítico', need: need };
    if (need > 0) return { key: 'warn', label: 'Repor', need: need };
    return { key: 'ok', label: 'Ok', need: 0 };
  };

  function needText(p, st) {
    if (st.key === 'pend') return '<span class="faint">Informe a quantidade</span>';
    if (st.need > 0) return 'Comprar <b class="num">' + fmt(st.need) + ' ' + esc(p.unit) + '</b>';
    return 'Estoque suficiente';
  }

  function item(p, d) {
    var q = d.closing.counts[p.id];
    var st = stockState(p, q, d.closing.delivery);
    return '<div class="count-row" data-pid="' + p.id + '" data-state="' + st.key + '">' +
      '<div class="count-info">' +
      '<div class="card-title">' + esc(p.name) + '</div>' +
      '<div class="card-meta">Ideal <span class="num">' + fmt(p.ideal[d.closing.delivery]) + '</span> ' + esc(p.unit) + '</div>' +
      '<div class="count-need"><span class="st-dot" aria-hidden="true"></span><span data-need>' + needText(p, st) + '</span>' +
      '<span class="sr-only" data-srstate>' + st.label + '</span></div>' +
      '</div>' +
      '<label class="count-input"><span class="sr-only">Quantidade encontrada de ' + esc(p.name) + '</span>' +
      '<input id="q-' + p.id + '" class="input num" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="0" value="' + (q == null ? '' : String(q).replace('.', ',')) + '">' +
      '<span class="unit">' + esc(p.unit) + '</span></label>' +
      '</div>';
  }

  function dockHtml(d) {
    var s = Stats.closing(d);
    var pend = s.total - s.counted;
    return '<div class="dock-inner"><div class="grow">' +
      '<div class="card-row" style="justify-content:space-between"><b class="num">' + s.counted + '/' + s.total + ' contados</b>' +
      '<span class="card-meta num">' + (pend ? pend + ' pendentes' : 'Tudo contado') + '</span></div>' +
      UI.bar(s.pct, pend ? '' : 'ok') + '</div>' +
      '<button type="button" class="btn ' + (pend ? 'dark' : 'primary') + '" data-review>Revisar</button></div>';
  }

  function savedLabel(d) {
    if (!d.closing.updatedAt) return 'Rascunho salvo automaticamente';
    var t = new Date(d.closing.updatedAt);
    return 'Rascunho salvo às ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }

  function review(root) {
    var d = DB.get();
    var s = Stats.closing(d);
    var pend = d.products.filter(function (p) { return d.closing.counts[p.id] == null; });
    var buy = d.products.map(function (p) { return { p: p, st: stockState(p, d.closing.counts[p.id], d.closing.delivery) }; })
      .filter(function (x) { return x.st.need > 0; });

    var html = '<h2>Revisar fechamento</h2>' +
      '<div class="stat-grid"><div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + s.counted + '</div><div class="card-meta">produtos contados</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + buy.length + '</div><div class="card-meta">itens para comprar</div></div></div>';

    if (pend.length) {
      html += '<div class="banner">' + icon('alert', 'sm') + '<div class="grow">Faltam ' + pend.length + ' produtos para contar. Conte todos antes de finalizar.</div></div>' +
        '<button type="button" class="btn primary block" data-jump>Ir para o próximo pendente</button>';
    } else {
      html += '<div class="section"><div class="eyebrow">Lista de compras gerada</div><div class="list">' +
        (buy.length ? buy.map(function (x) {
          return '<div class="row"><div class="grow"><div class="card-title">' + esc(x.p.name) + '</div></div><b class="num">' + fmt(x.st.need) + ' ' + esc(x.p.unit) + '</b></div>';
        }).join('') : '<div class="row muted">Nenhuma compra necessária.</div>') + '</div></div>' +
        '<button type="button" class="btn primary block" data-finish>Finalizar fechamento</button>';
    }
    html += '<button type="button" class="btn block" data-close>Continuar contando</button>';

    UI.sheet(html, function (sheet, close) {
      var jump = sheet.querySelector('[data-jump]');
      if (jump) jump.addEventListener('click', function () {
        close();
        var el = root.querySelector('#q-' + pend[0].id);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(function () { el.focus(); }, 250);
      });
      var fin = sheet.querySelector('[data-finish]');
      if (fin) fin.addEventListener('click', function () {
        UI.busy(fin, function () {
          var dl = d.deliveries.filter(function (x) { return x.id === d.closing.delivery; })[0];
          DB.update(function (x) {
            x.shopping = {
              fromClosing: 'hoje, para ' + dl.label.toLowerCase() + ' ' + dl.date,
              items: buy.map(function (b) { return { pid: b.p.id, need: b.st.need, received: null }; })
            };
            x.lastCounts = x.closing.counts;
            // A contagem vira o estoque oficial da unidade.
            x.stock[x.user.unit] = Object.assign({}, x.stock[x.user.unit], x.closing.counts);
            x.closing = { delivery: x.closing.delivery, counts: {}, updatedAt: null, finalizedAt: Date.now() };
          });
          close();
          UI.buzz(20);
          UI.toast('Fechamento finalizado. Lista de compras atualizada.');
          go('estoque/compras', { replace: true });
        });
      });
    });
  }

  Screens.estoque_fechamento = function () {
    var d = DB.get();
    var groups = d.categories.map(function (c) {
      var items = d.products.filter(function (p) { return p.cat === c; });
      return items.length ? '<section class="section count-group" id="cat-' + d.categories.indexOf(c) + '"><div class="eyebrow">' + esc(c) + '</div>' +
        '<div class="list">' + items.map(function (p) { return item(p, d); }).join('') + '</div></section>' : '';
    }).join('');

    var html = '<main class="screen has-dock">' +
      UI.topbar('Fechamento', { back: '#estoque', sub: savedLabel(d) }) +
      '<div class="field"><span class="label">Reposição para</span><div class="seg" data-delivery>' +
      d.deliveries.map(function (x) {
        return '<button type="button" data-d="' + x.id + '" aria-pressed="' + (x.id === d.closing.delivery) + '"><span>' + esc(x.label) + '</span><span class="faint num" style="font-weight:500">' + esc(x.date) + '</span></button>';
      }).join('') + '</div></div>' +
      '<div class="chips" role="toolbar" aria-label="Filtros">' +
      '<button type="button" class="chip" data-only-pend aria-pressed="false">Só pendentes</button>' +
      d.categories.map(function (c, i) { return '<button type="button" class="chip" data-cat="' + i + '">' + esc(c) + '</button>'; }).join('') +
      '</div>' + groups + '</main>' +
      '<div class="dock" data-dock>' + dockHtml(d) + '</div>';

    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        var dock = root.querySelector('[data-dock]');
        var sub = root.querySelector('.topbar .sub');
        var persist = UI.debounce(function () {
          DB.update(function (x) { x.closing.updatedAt = Date.now(); });
          sub.textContent = savedLabel(DB.get());
        }, 400);

        function bindDock() { dock.querySelector('[data-review]').addEventListener('click', function () { review(root); }); }
        bindDock();

        var inputs = Array.prototype.slice.call(root.querySelectorAll('.count-row input'));
        inputs.forEach(function (inp, idx) {
          var row = inp.closest('.count-row');
          var p = DB.product(row.dataset.pid);
          inp.addEventListener('focus', function () { inp.select(); });
          inp.addEventListener('input', function () {
            var q = parseQty(inp.value);
            var field = inp.closest('.count-input');
            if (isNaN(q)) { field.classList.add('bad'); return; }
            field.classList.remove('bad');
            DB.get().closing.counts[p.id] = q;
            if (q == null) delete DB.get().closing.counts[p.id];
            var d2 = DB.get();
            var st = stockState(p, q, d2.closing.delivery);
            row.dataset.state = st.key;
            row.querySelector('[data-need]').innerHTML = needText(p, st);
            row.querySelector('[data-srstate]').textContent = st.label;
            dock.innerHTML = dockHtml(d2);
            bindDock();
            persist();
          });
          inp.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var next = inputs[idx + 1];
            if (next) { next.focus(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
            else { inp.blur(); review(root); }
          });
        });

        root.querySelectorAll('[data-d]').forEach(function (b) {
          b.addEventListener('click', function () {
            DB.update(function (x) { x.closing.delivery = b.dataset.d; });
            refresh();
          });
        });

        var onlyPend = root.querySelector('[data-only-pend]');
        onlyPend.addEventListener('click', function () {
          var on = onlyPend.getAttribute('aria-pressed') !== 'true';
          onlyPend.setAttribute('aria-pressed', on);
          // Filtra no momento do toque: um item recém-contado não some enquanto o usuário digita.
          root.querySelectorAll('.count-group').forEach(function (g) {
            var visible = 0;
            g.querySelectorAll('.count-row').forEach(function (r) {
              r.hidden = on && r.dataset.state !== 'pend';
              if (!r.hidden) visible++;
            });
            g.hidden = visible === 0;
          });
        });
        root.querySelectorAll('[data-cat]').forEach(function (b) {
          b.addEventListener('click', function () {
            var el = root.querySelector('#cat-' + b.dataset.cat);
            if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' });
          });
        });
      }
    };
  };
})();
