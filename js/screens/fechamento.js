// Fechamento de estoque: cada colaborador conta a parte da sua estação; o app junta tudo numa lista de compras.
// A contagem é salva produto a produto (DB.setCount), então várias pessoas contam ao mesmo tempo.
(function () {
  var esc = UI.esc, fmt = UI.fmt;
  var scope = null; // 'mine' | 'all' | 'st:<estação>' | 'none' (produtos sem estação)

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

  function firstName(empId) {
    var e = DB.get().employees.filter(function (x) { return x.id === empId; })[0];
    return e ? e.name.split(' ')[0] : '';
  }
  function hm(ts) { var t = new Date(ts); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); }
  function countRec(pid) { return DB.get().counts.filter(function (c) { return c.id === pid; })[0]; }

  function defaultScope() { return Stats.myProducts(DB.get()) ? 'mine' : 'all'; }
  function inScope(d) {
    if (scope === 'mine') return Stats.myProducts(d) || d.products;
    if (scope === 'none') return d.products.filter(function (p) { return !DB.station(p.station); });
    if (scope && scope.indexOf('st:') === 0) { var id = scope.slice(3); return d.products.filter(function (p) { return p.station === id; }); }
    return d.products;
  }
  function scopeLabel() {
    if (scope === 'mine') return 'sua parte';
    if (scope === 'none') return 'produtos sem estação';
    if (scope && scope.indexOf('st:') === 0) { var s = DB.station(scope.slice(3)); return s ? s.name : 'estação'; }
    return 'loja toda';
  }

  function item(p, d) {
    var q = DB.countOf(p.id);
    var st = stockState(p, q, d.closing.delivery);
    var rec = countRec(p.id), mine = rec && rec.by === d.user.empId;
    var s = scope === 'all' ? DB.station(p.station) : null;
    return '<div class="count-row" data-pid="' + p.id + '" data-state="' + st.key + '">' +
      '<div class="count-info">' +
      '<div class="card-title">' + esc(p.name) + '</div>' +
      '<div class="card-meta">Ideal <span class="num">' + fmt(p.ideal[d.closing.delivery]) + '</span> ' + esc(p.unit) +
      (s ? ' · ' + esc(s.name) : '') + (rec && rec.by && !mine ? ' · contado por ' + esc(firstName(rec.by)) + ' às ' + hm(rec.at) : '') + '</div>' +
      '<div class="count-need"><span class="st-dot" aria-hidden="true"></span><span data-need>' + needText(p, st) + '</span>' +
      '<span class="sr-only" data-srstate>' + st.label + '</span></div>' +
      '</div>' +
      '<label class="count-input"><span class="sr-only">Quantidade encontrada de ' + esc(p.name) + '</span>' +
      '<input id="q-' + p.id + '" class="input num" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="0" value="' + (q == null ? '' : String(q).replace('.', ',')) + '">' +
      '<span class="unit">' + esc(p.unit) + '</span></label>' +
      '</div>';
  }

  function dockHtml(d) {
    var s = Stats.closing(d, inScope(d));
    var pend = s.total - s.counted;
    return '<div class="dock-inner"><div class="grow">' +
      '<div class="card-row" style="justify-content:space-between"><b class="num">' + s.counted + '/' + s.total + (scope === 'mine' ? ' da sua parte' : ' contados') + '</b>' +
      '<span class="card-meta num">' + (pend ? pend + ' pendentes' : 'Tudo contado') + '</span></div>' +
      UI.bar(s.pct, pend ? '' : 'ok') + '</div>' +
      '<button type="button" class="btn ' + (pend ? 'dark' : 'primary') + '" data-review>' + (scope === 'mine' && !pend ? 'Concluir' : 'Revisar') + '</button></div>';
  }

  function savedLabel(d) {
    var last = d.counts.reduce(function (m, c) { return c.at > m ? c.at : m; }, 0);
    return last ? 'Salvo automaticamente · última contagem às ' + hm(last) : 'Salvo automaticamente a cada número';
  }

  // Andamento de cada estação: quem conta, quanto falta. Toque filtra a lista.
  function stationsCard(d) {
    if (!d.stations.length) {
      return UI.isManager() ? '<div class="banner info">' + icon('users', 'sm') + '<div class="grow">Divida o fechamento entre a equipe: cada um conta só a sua estação.</div>' +
        '<a class="btn sm" href="#estacoes">Criar estações</a></div>' : '';
    }
    var rows = d.stations.map(function (s) {
      var ps = d.products.filter(function (p) { return p.station === s.id; });
      return { key: 'st:' + s.id, name: s.name, who: (s.emps || []).map(firstName).filter(Boolean).join(', ') || 'Sem responsável', st: Stats.closing(d, ps) };
    });
    var loose = d.products.filter(function (p) { return !DB.station(p.station); });
    if (loose.length) rows.push({ key: 'none', name: 'Sem estação', who: 'Qualquer pessoa conta', st: Stats.closing(d, loose) });
    return '<section class="section"><div class="section-head"><h2>Estações</h2>' + (UI.isManager() ? '<a class="btn ghost sm" href="#estacoes">' + icon('settings', 'sm') + 'Organizar</a>' : '') + '</div>' +
      '<div class="list">' + rows.map(function (r) {
        var done = r.st.total && r.st.counted === r.st.total;
        return '<button type="button" class="row" data-scope="' + r.key + '"' + (scope === r.key ? ' aria-current="true" style="background:var(--surface-2)"' : '') + '>' +
          '<div class="tile ' + (done ? 'ok' : r.st.counted ? 'info' : '') + '">' + icon(done ? 'check' : 'users') + '</div>' +
          '<div class="grow"><div class="card-row" style="justify-content:space-between"><span class="card-title">' + esc(r.name) + '</span><span class="card-meta num">' + r.st.counted + '/' + r.st.total + '</span></div>' +
          '<div class="card-meta">' + esc(r.who) + '</div>' + UI.bar(r.st.pct, done ? 'ok' : '') + '</div></button>';
      }).join('') + '</div></section>';
  }

  function finalize(d, buy, close) {
    var dl = d.deliveries.filter(function (x) { return x.id === d.closing.delivery; })[0];
    var counts = {};
    d.counts.forEach(function (c) { counts[c.id] = c.q; });
    DB.update(function (x) {
      x.shopping = {
        fromClosing: 'hoje, para ' + dl.label.toLowerCase() + ' ' + dl.date,
        items: buy.map(function (b) { return { pid: b.p.id, need: b.st.need, received: null }; })
      };
      x.lastCounts = counts;
      // A contagem vira o estoque oficial da unidade.
      x.stock[x.user.unit] = Object.assign({}, x.stock[x.user.unit], counts);
      x.counts = [];
      x.closing = { delivery: x.closing.delivery, finalizedAt: Date.now() };
    });
    close();
    UI.buzz(20);
    UI.toast('Fechamento finalizado. Lista de compras atualizada.');
    go('estoque/compras', { replace: true });
  }

  function review(root) {
    var d = DB.get();
    var part = inScope(d), sp = Stats.closing(d, part), all = Stats.closing(d);
    var pendHere = part.filter(function (p) { return DB.countOf(p.id) == null; });
    var pendAll = d.products.filter(function (p) { return DB.countOf(p.id) == null; });
    var buy = d.products.map(function (p) { return { p: p, st: stockState(p, DB.countOf(p.id), d.closing.delivery) }; })
      .filter(function (x) { return x.st.need > 0; });

    var html = '<h2>' + (scope === 'mine' ? 'Sua parte do fechamento' : 'Revisar fechamento') + '</h2>' +
      '<div class="stat-grid"><div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + sp.counted + '/' + sp.total + '</div><div class="card-meta">' + esc(scopeLabel()) + '</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + all.counted + '/' + all.total + '</div><div class="card-meta">loja toda</div></div></div>';

    if (pendHere.length) {
      html += '<div class="banner">' + icon('alert', 'sm') + '<div class="grow">Faltam ' + pendHere.length + ' produtos para contar' + (scope === 'all' ? '' : ' em ' + esc(scopeLabel())) + '.</div></div>' +
        '<button type="button" class="btn primary block" data-jump>Ir para o próximo pendente</button>';
    } else if (pendAll.length) {
      // Esta parte acabou; outras estações ainda contando.
      var byStation = {};
      pendAll.forEach(function (p) { var s = DB.station(p.station); var k = s ? s.name + ((s.emps || []).length ? ' (' + s.emps.map(firstName).join(', ') + ')' : '') : 'Sem estação'; byStation[k] = (byStation[k] || 0) + 1; });
      html += '<div class="banner ok">' + icon('check', 'sm') + '<div class="grow">' + (scope === 'all' ? 'Pronto.' : 'Sua parte está completa. Obrigado!') +
        ' A lista de compras sai quando todas as estações terminarem.</div></div>' +
        '<div class="section"><div class="eyebrow">Ainda contando</div><div class="list">' + Object.keys(byStation).map(function (k) {
          return '<div class="row"><div class="grow card-title">' + esc(k) + '</div><span class="card-meta num">faltam ' + byStation[k] + '</span></div>';
        }).join('') + '</div></div>' +
        (UI.isManager() ? '<button type="button" class="btn block" data-allpend>Ver e contar o que falta</button>' : '');
    } else {
      html += '<div class="section"><div class="eyebrow">Lista de compras de toda a loja</div><div class="list">' +
        (buy.length ? buy.map(function (x) {
          return '<div class="row"><div class="grow"><div class="card-title">' + esc(x.p.name) + '</div></div><b class="num">' + fmt(x.st.need) + ' ' + esc(x.p.unit) + '</b></div>';
        }).join('') : '<div class="row muted">Nenhuma compra necessária.</div>') + '</div></div>' +
        '<button type="button" class="btn primary block" data-finish>Finalizar fechamento</button>';
    }
    html += '<button type="button" class="btn block" data-close>' + (pendHere.length ? 'Continuar contando' : 'Fechar') + '</button>';

    UI.sheet(html, function (sheet, close) {
      var jump = sheet.querySelector('[data-jump]');
      if (jump) jump.addEventListener('click', function () {
        close();
        var el = root.querySelector('#q-' + pendHere[0].id);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(function () { el.focus(); }, 250);
      });
      var ap = sheet.querySelector('[data-allpend]');
      if (ap) ap.addEventListener('click', function () { close(); scope = 'all'; refresh(); var b = document.querySelector('[data-only-pend]'); if (b) b.click(); });
      var fin = sheet.querySelector('[data-finish]');
      if (fin) fin.addEventListener('click', function () { UI.busy(fin, function () { finalize(d, buy, close); }); });
    });
  }

  // Lista agrupada por tipo (preparo, montagem, apoio) e, dentro, por categoria.
  function groups(d, ps) {
    return DB.KINDS.map(function (k) {
      var ofKind = ps.filter(function (p) { return DB.kindOf(p) === k.id; });
      if (!ofKind.length) return '';
      var cats = d.categories.concat(ofKind.map(function (p) { return p.cat; })).filter(function (c, i, a) { return a.indexOf(c) === i; });
      return '<section class="section count-group" id="kind-' + k.id + '"><div class="section-head"><h2>' + esc(k.label) + '</h2><span class="card-meta num">' + ofKind.length + '</span></div>' +
        cats.map(function (c) {
          var items = ofKind.filter(function (p) { return p.cat === c; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
          return items.length ? '<div class="count-sub"><div class="eyebrow">' + esc(c) + '</div><div class="list">' + items.map(function (p) { return item(p, d); }).join('') + '</div></div>' : '';
        }).join('') + '</section>';
    }).join('');
  }

  Screens.estoque_fechamento = function () {
    var d = DB.get();
    if (!d.products.length) {
      return { html: '<main class="screen">' + UI.topbar('Fechamento', { back: '#estoque' }) + '<div class="card">' + UI.empty('box', 'Nenhum produto para contar',
        UI.isManager() ? 'Cadastre os produtos do estoque e o fechamento passa a calcular a lista de compras.' : 'O gerente ainda não cadastrou os produtos do estoque.',
        UI.isManager() ? '<a class="btn primary" href="#produtos/novo">Cadastrar produtos</a>' : '') + '</div></main>', tab: 'estoque' };
    }
    var mine = Stats.myProducts(d);
    if (!scope || (scope === 'mine' && !mine) || (scope.indexOf('st:') === 0 && !DB.station(scope.slice(3)))) scope = defaultScope();
    var ps = inScope(d);
    var myNames = DB.myStations().map(function (s) { return s.name; }).join(', ');

    var html = '<main class="screen has-dock">' +
      UI.topbar('Fechamento', { back: '#estoque', sub: savedLabel(d) }) +
      '<div class="field"><span class="label">Reposição para</span><div class="seg" data-delivery>' +
      d.deliveries.map(function (x) {
        return '<button type="button" data-d="' + x.id + '" aria-pressed="' + (x.id === d.closing.delivery) + '"><span>' + esc(x.label) + '</span><span class="faint num" style="font-weight:500">' + esc(x.date) + '</span></button>';
      }).join('') + '</div></div>' +
      (mine ? '<div class="seg" style="max-width:420px"><button type="button" data-scope="mine" aria-pressed="' + (scope === 'mine') + '">Minha parte</button>' +
        '<button type="button" data-scope="all" aria-pressed="' + (scope !== 'mine') + '">Loja toda</button></div>' +
        (scope === 'mine' ? '<p class="card-meta" style="margin:0">' + icon('users', 'sm') + ' Você conta: <b>' + esc(myNames) + '</b>. O resto fica com os colegas de cada estação.</p>' : '') : '') +
      (scope !== 'mine' ? stationsCard(d) : '') +
      '<div class="chips" role="toolbar" aria-label="Filtros">' +
      '<button type="button" class="chip" data-only-pend aria-pressed="false">Só pendentes</button>' +
      (scope !== 'all' && scope !== 'mine' ? '<button type="button" class="chip" data-scope="all">' + icon('x', 'sm') + esc(scopeLabel()) + '</button>' : '') +
      DB.KINDS.filter(function (k) { return ps.some(function (p) { return DB.kindOf(p) === k.id; }); }).map(function (k) {
        return '<button type="button" class="chip" data-kind="' + k.id + '">' + esc(k.label) + '</button>';
      }).join('') + '</div>' +
      (ps.length ? groups(d, ps) : '<div class="card">' + UI.empty('box', 'Nada para contar aqui', 'Nenhum produto nesta estação. O gerente distribui os produtos em Estações.') + '</div>') +
      '</main>' +
      '<div class="dock" data-dock>' + dockHtml(d) + '</div>';

    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        var dock = root.querySelector('[data-dock]');
        var sub = root.querySelector('.topbar .sub');
        // Cada número digitado já vale; salvar (e enviar aos outros aparelhos) espera a pessoa parar de digitar.
        var persist = UI.debounce(function () {
          DB.update(function () {});
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
            DB.setCount(p.id, q);
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
        root.querySelectorAll('[data-scope]').forEach(function (b) {
          b.addEventListener('click', function () { scope = b.dataset.scope; refresh(); });
        });

        var onlyPend = root.querySelector('[data-only-pend]');
        onlyPend.addEventListener('click', function () {
          var on = onlyPend.getAttribute('aria-pressed') !== 'true';
          onlyPend.setAttribute('aria-pressed', on);
          // Filtra no momento do toque: um item recém-contado não some enquanto o usuário digita.
          root.querySelectorAll('.count-sub').forEach(function (g) {
            var visible = 0;
            g.querySelectorAll('.count-row').forEach(function (r) {
              r.hidden = on && r.dataset.state !== 'pend';
              if (!r.hidden) visible++;
            });
            g.hidden = visible === 0;
          });
          root.querySelectorAll('.count-group').forEach(function (g) { g.hidden = !g.querySelector('.count-sub:not([hidden])'); });
        });
        root.querySelectorAll('[data-kind]').forEach(function (b) {
          b.addEventListener('click', function () {
            var el = root.querySelector('#kind-' + b.dataset.kind);
            if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' });
          });
        });
      }
    };
  };
})();
