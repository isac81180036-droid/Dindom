// Produtos do estoque (gerente e admin): cadastro, estoque ideal por dia de reposição, mínimo e estoque inicial.
(function () {
  var esc = UI.esc, fmt = UI.fmt;
  var UNITS = ['kg', 'un', 'pct', 'cx', 'lata', 'fardo', 'saco', 'L', 'maço', 'pote', 'balde', 'bisn.'];
  var q = '';

  function num(s) { var n = Number(String(s == null ? '' : s).trim().replace(',', '.')); return String(s).trim() === '' || isNaN(n) ? null : n; }
  function find(id) { return DB.get().products.filter(function (p) { return p.id === id; })[0]; }

  function restricted() {
    return { html: '<main class="screen">' + UI.topbar('Produtos', { back: '#estoque' }) + '<div class="card">' +
      UI.empty('shield', 'Acesso restrito', 'Só gerentes e o administrador cadastram produtos.') + '</div></main>', tab: 'estoque' };
  }

  function list() {
    var d = DB.get();
    var term = q.toLowerCase();
    var ps = d.products.filter(function (p) { return !term || p.name.toLowerCase().indexOf(term) >= 0; });
    var unset = d.products.filter(function (p) { return !p.kind; }).length;
    // Primeiro o tipo (preparo, montagem, apoio); dentro dele, as categorias. Sem tipo definido aparece antes, para classificar.
    var kinds = [{ id: '', label: 'Sem tipo definido' }].concat(DB.KINDS);
    var groups = kinds.map(function (k) {
      var ofKind = ps.filter(function (p) { return (p.kind ? DB.kindOf(p) : '') === k.id; });
      if (!ofKind.length) return '';
      var cats = d.categories.concat(ofKind.map(function (p) { return p.cat; })).filter(function (c, i, a) { return a.indexOf(c) === i; });
      return '<section class="section"><div class="section-head"><h2>' + esc(k.label) + '</h2><span class="card-meta num">' + ofKind.length + '</span></div>' +
        cats.map(function (c) {
          var items = ofKind.filter(function (p) { return p.cat === c; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
          if (!items.length) return '';
          return '<div class="count-sub"><div class="eyebrow">' + esc(c) + '</div><div class="list">' + items.map(function (p) {
            var ideal = d.deliveries.map(function (dl) { return dl.label.slice(0, 3) + ' ' + fmt(p.ideal[dl.id] || 0); }).join(' · ');
            var st = DB.station(p.station);
            return '<a class="row" href="#produtos/' + p.id + '" style="text-decoration:none;color:inherit"><div class="grow"><div class="card-title">' + esc(p.name) + '</div>' +
              '<div class="card-meta">Ideal: ' + esc(ideal) + ' ' + esc(p.unit) + ' · mínimo ' + fmt(p.crit) + (st ? ' · ' + icon('users', 'sm') + ' ' + esc(st.name) : '') + '</div></div>' + icon('chevronRight', 'sm') + '</a>';
          }).join('') + '</div></div>';
        }).join('') + '</section>';
    }).join('');

    var html = '<main class="screen wide">' + UI.topbar('Produtos', { back: '#estoque', sub: d.products.length + (d.products.length === 1 ? ' produto cadastrado' : ' produtos cadastrados') }) +
      '<a class="btn primary block cta" href="#produtos/novo" style="min-height:56px;font-size:var(--fs-lg)">' + icon('plus') + 'Novo produto</a>' +
      (d.products.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#produtos/organizar">' + icon('checklist', 'sm') + 'Organizar tipos e estações</a>' +
        '<a class="btn" href="#estacoes">' + icon('users', 'sm') + 'Estações e responsáveis</a></div>' : '') +
      (unset ? '<div class="banner">' + icon('alert', 'sm') + '<div class="grow">' + unset + (unset === 1 ? ' produto ainda sem tipo' : ' produtos ainda sem tipo') + ' (preparo, montagem ou apoio).</div>' +
        '<a class="btn sm" href="#produtos/organizar">Classificar</a></div>' : '') +
      (d.products.length ? '<label class="field"><span class="sr-only">Buscar produto</span><div style="position:relative">' +
        '<span style="position:absolute;left:14px;top:13px;color:var(--ink-3)">' + icon('search', 'sm') + '</span>' +
        '<input id="prod-q" class="input" type="search" placeholder="Buscar produto" style="padding-left:42px" value="' + esc(q) + '"></div></label>' +
        (groups || '<div class="card">' + UI.empty('search', 'Nenhum produto encontrado', 'Confira o nome digitado.') + '</div>')
        : '<div class="card">' + UI.empty('box', 'Nenhum produto ainda', 'Cadastre os itens que vocês contam no fechamento: queijos, carnes, farinha, embalagens… Com eles o app calcula a lista de compras.') + '</div>') +
      '</main>';
    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        var s = root.querySelector('#prod-q');
        if (s) s.addEventListener('input', function () { q = s.value; var pos = s.selectionStart; refresh(); var n = document.querySelector('#prod-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
      }
    };
  }

  function form(id) {
    var d = DB.get();
    var p = id ? find(id) : null;
    if (id && !p) return list();
    var v = p ? JSON.parse(JSON.stringify(p)) : { name: '', kind: 'montagem', cat: d.categories[0], unit: 'kg', ideal: {}, crit: null, station: null };
    var otherUnit = UNITS.indexOf(v.unit) < 0;

    var html = '<main class="screen no-nav">' + UI.topbar(p ? 'Editar produto' : 'Novo produto', { back: '#produtos' }) +
      '<div class="field" id="f-p-name"><label for="p-name">Nome do produto *</label><input id="p-name" class="input" maxlength="60" placeholder="Ex.: Queijo muçarela" value="' + esc(v.name) + '"><span class="err" hidden></span></div>' +
      '<div class="field"><span class="label">Tipo *</span><div class="kind-pick" data-kind>' + DB.KINDS.map(function (k) {
        return '<button type="button" data-v="' + k.id + '" aria-pressed="' + (k.id === v.kind) + '"><b>' + esc(k.label) + '</b><span>' + esc(k.hint) + '</span></button>';
      }).join('') + '</div></div>' +
      '<div class="field"><label for="p-station">Estação no fechamento</label><select id="p-station" class="select">' +
      '<option value="">Sem estação (qualquer pessoa conta)</option>' + d.stations.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (s.id === v.station ? ' selected' : '') + '>' + esc(s.name) + ((s.emps || []).length ? ' · ' + esc(s.emps.map(function (id) { var e = d.employees.filter(function (x) { return x.id === id; })[0]; return e ? e.name.split(' ')[0] : ''; }).filter(Boolean).join(', ')) : '') + '</option>';
      }).join('') + '</select><span class="hint">' + (d.stations.length ? 'Quem é da estação conta este produto no fechamento.' : 'Crie as estações em Produtos › Estações e responsáveis.') + '</span></div>' +
      '<div class="field"><span class="label">Categoria</span><div class="chips wrap" data-cat>' + d.categories.map(function (c) {
        return '<button type="button" class="chip" data-v="' + esc(c) + '" aria-pressed="' + (c === v.cat) + '">' + esc(c) + '</button>';
      }).join('') + '<button type="button" class="chip" data-newcat>' + icon('plus', 'sm') + 'Nova</button></div>' +
      '<input id="p-newcat" class="input" placeholder="Nome da nova categoria" hidden></div>' +
      '<div class="field"><span class="label">Unidade de medida</span><div class="chips wrap" data-unit>' + UNITS.map(function (u) {
        return '<button type="button" class="chip" data-v="' + esc(u) + '" aria-pressed="' + (u === v.unit) + '">' + esc(u) + '</button>';
      }).join('') + '<button type="button" class="chip" data-v="__outra" aria-pressed="' + otherUnit + '">Outra</button></div>' +
      '<input id="p-unit" class="input" placeholder="Ex.: garrafa" value="' + (otherUnit ? esc(v.unit) : '') + '"' + (otherUnit ? '' : ' hidden') + '></div>' +

      '<section class="section"><div class="eyebrow">Estoque ideal</div><p class="card-meta">Quanto precisa ter na loja para aguentar até cada reposição. O fechamento compra a diferença.</p>' +
      '<div class="ideal-grid">' + d.deliveries.map(function (dl) {
        return '<div class="field" id="f-i-' + dl.id + '"><label for="i-' + dl.id + '">Para ' + esc(dl.label.toLowerCase()) + '</label>' +
          '<div class="qty-unit"><input id="i-' + dl.id + '" class="input num" inputmode="decimal" placeholder="0" value="' + (v.ideal[dl.id] != null ? String(v.ideal[dl.id]).replace('.', ',') : '') + '"><span data-u-label>' + esc(v.unit) + '</span></div></div>';
      }).join('') + '</div>' +
      '<div class="field" id="f-p-crit"><label for="p-crit">Estoque mínimo (alerta de crítico)</label><div class="qty-unit"><input id="p-crit" class="input num" inputmode="decimal" placeholder="0" value="' + (v.crit != null ? String(v.crit).replace('.', ',') : '') + '"><span data-u-label>' + esc(v.unit) + '</span></div>' +
      '<span class="hint">Abaixo disso o produto aparece em vermelho no Início.</span><span class="err" hidden>Informe um número.</span></div></section>' +

      '<section class="section"><div class="eyebrow">Estoque atual</div><p class="card-meta">Opcional. Depois ele é atualizado pelo fechamento e pelas notas.</p><div class="ideal-grid">' +
      d.units.map(function (u) {
        var cur = (d.stock[u.id] || {})[p ? p.id : ''];
        return '<div class="field"><label for="s-' + u.id + '">' + esc(u.name) + '</label><div class="qty-unit"><input id="s-' + u.id + '" class="input num" inputmode="decimal" placeholder="—" value="' + (cur != null ? String(cur).replace('.', ',') : '') + '"><span data-u-label>' + esc(v.unit) + '</span></div></div>';
      }).join('') + '</div></section>' +
      (p ? '<button type="button" class="btn block" data-del style="color:var(--crit)">' + icon('x', 'sm') + 'Excluir produto</button>' : '') +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner"><button type="button" class="btn primary block" data-save style="min-height:56px">' + (p ? 'Salvar alterações' : 'Cadastrar produto') + '</button></div></div>';

    return {
      html: html, tab: 'estoque', nav: false,
      mount: function (root) {
        function $(s) { return root.querySelector(s); }
        function pick(group, attr) {
          root.querySelector(group).addEventListener('click', function (e) {
            var b = e.target.closest('[data-v]'); if (!b) return;
            root.querySelectorAll(group + ' [data-v]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
            attr(b.dataset.v);
          });
        }
        pick('[data-kind]', function (k) { v.kind = k; });
        pick('[data-cat]', function (c) { v.cat = c; $('#p-newcat').hidden = true; });
        pick('[data-unit]', function (u) {
          $('#p-unit').hidden = u !== '__outra';
          v.unit = u === '__outra' ? ($('#p-unit').value.trim() || '') : u;
          if (u === '__outra') $('#p-unit').focus();
          root.querySelectorAll('[data-u-label]').forEach(function (s) { s.textContent = v.unit; });
        });
        $('#p-unit').addEventListener('input', function () { v.unit = $('#p-unit').value.trim(); root.querySelectorAll('[data-u-label]').forEach(function (s) { s.textContent = v.unit; }); });
        $('[data-newcat]').addEventListener('click', function () {
          root.querySelectorAll('[data-cat] [data-v]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
          $('#p-newcat').hidden = false; $('#p-newcat').focus(); v.cat = null;
        });

        var del = $('[data-del]');
        if (del) del.addEventListener('click', function () {
          UI.confirm({ title: 'Excluir ' + p.name + '?', body: 'Ele sai do cadastro, do fechamento e da lista de compras. As notas já lançadas continuam no histórico.', ok: 'Excluir produto', danger: true,
            onOk: function () {
              DB.update(function (x) {
                x.products = x.products.filter(function (y) { return y.id !== p.id; });
                x.shopping.items = x.shopping.items.filter(function (i) { return i.pid !== p.id; });
                x.counts = x.counts.filter(function (c) { return c.id !== p.id; });
              });
              go('produtos', { replace: true }); UI.toast('Produto excluído');
            } });
        });

        $('[data-save]').addEventListener('click', function () {
          var name = $('#p-name').value.trim().replace(/\s+/g, ' ');
          var dup = DB.get().products.filter(function (y) { return y.name.toLowerCase() === name.toLowerCase() && (!p || y.id !== p.id); })[0];
          var f = $('#f-p-name'), msg = !name ? 'Dê um nome ao produto.' : dup ? 'Já existe um produto com esse nome.' : '';
          f.classList.toggle('error', !!msg); f.querySelector('.err').hidden = !msg; f.querySelector('.err').textContent = msg;
          if (!$('#p-newcat').hidden) v.cat = $('#p-newcat').value.trim() || null;
          if (!v.cat) { UI.toast('Escolha ou crie a categoria.', { tone: 'crit' }); return; }
          if (!v.kind) { UI.toast('Escolha o tipo: preparo, montagem ou apoio.', { tone: 'crit' }); return; }
          v.station = $('#p-station').value || null;
          if (!v.unit) { UI.toast('Informe a unidade de medida.', { tone: 'crit' }); return; }
          var crit = num($('#p-crit').value);
          var badCrit = crit == null || crit < 0;
          $('#f-p-crit').classList.toggle('error', badCrit); $('#f-p-crit .err').hidden = !badCrit;
          var ideal = {};
          var badIdeal = DB.get().deliveries.some(function (dl) { var n = num($('#i-' + dl.id).value); ideal[dl.id] = n == null ? 0 : n; return n != null && n < 0; });
          if (msg || badCrit || badIdeal) { (msg ? f : $('#f-p-crit')).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

          var pid = p ? p.id : 'p' + Date.now();
          DB.update(function (x) {
            if (x.categories.indexOf(v.cat) < 0) x.categories.push(v.cat);
            var rec = { id: pid, name: name, kind: v.kind, cat: v.cat, unit: v.unit, ideal: ideal, crit: crit, station: v.station };
            if (p) { var t = x.products.filter(function (y) { return y.id === pid; })[0]; Object.keys(rec).forEach(function (k) { t[k] = rec[k]; }); }
            else x.products.push(rec);
            x.units.forEach(function (u) {
              var n = num($('#s-' + u.id).value);
              x.stock[u.id] = x.stock[u.id] || {};
              if (n != null && n >= 0) x.stock[u.id][pid] = n;
            });
          });
          UI.buzz(15);
          if (p) { go('produtos', { replace: true }); UI.toast(name + ' atualizado'); }
          else {
            go('produtos/novo', { replace: true }); UI.toast(name + ' cadastrado. Cadastre o próximo ou volte.', { ms: 3200 });
          }
        });
        if (!p) $('#p-name').focus();
      }
    };
  }

  // Organizar em lote: tipo e estação de cada produto numa lista só. Cada toque já salva.
  var orgFilter = 'todos';
  function organize() {
    var d = DB.get();
    var ps = d.products.filter(function (p) {
      return orgFilter === 'semtipo' ? !p.kind : orgFilter === 'semestacao' ? !DB.station(p.station) : true;
    }).sort(function (a, b) { return (a.cat || '').localeCompare(b.cat || '', 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'); });
    var short = { preparo: 'Preparo', montagem: 'Montagem', apoio: 'Apoio' };
    var html = '<main class="screen wide">' + UI.topbar('Organizar produtos', { back: '#produtos', sub: 'Tipo e estação de cada produto. Cada toque já salva.' }) +
      '<div class="chips" role="toolbar" aria-label="Filtro">' + [['todos', 'Todos', d.products.length],
        ['semtipo', 'Sem tipo', d.products.filter(function (p) { return !p.kind; }).length],
        ['semestacao', 'Sem estação', d.products.filter(function (p) { return !DB.station(p.station); }).length]].map(function (f) {
        return '<button type="button" class="chip" data-of="' + f[0] + '" aria-pressed="' + (orgFilter === f[0]) + '">' + f[1] + ' <span class="count">' + f[2] + '</span></button>';
      }).join('') + '</div>' +
      (!d.stations.length ? '<div class="banner info">' + icon('users', 'sm') + '<div class="grow">Ainda não há estações. Crie primeiro para distribuir os produtos.</div><a class="btn sm" href="#estacoes">Criar estações</a></div>' : '') +
      (ps.length ? '<div class="list">' + ps.map(function (p) {
        return '<div class="row org-row" data-pid="' + p.id + '"><div class="grow"><div class="card-title">' + esc(p.name) + '</div><div class="card-meta">' + esc(p.cat) + '</div></div>' +
          '<div class="org-ctrl"><div class="seg sm" data-okind>' + DB.KINDS.map(function (k) {
            return '<button type="button" data-v="' + k.id + '" aria-pressed="' + (p.kind === k.id) + '">' + short[k.id] + '</button>';
          }).join('') + '</div>' +
          (d.stations.length ? '<select class="select sm" data-ost aria-label="Estação de ' + esc(p.name) + '"><option value="">Sem estação</option>' + d.stations.map(function (s) {
            return '<option value="' + esc(s.id) + '"' + (s.id === p.station ? ' selected' : '') + '>' + esc(s.name) + '</option>';
          }).join('') + '</select>' : '') + '</div></div>';
      }).join('') + '</div>' : '<div class="card">' + UI.empty('check', 'Tudo organizado', 'Nenhum produto neste filtro.') + '</div>') +
      '</main>';
    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        root.addEventListener('click', function (e) {
          var f = e.target.closest('[data-of]'); if (f) { orgFilter = f.dataset.of; return refresh(); }
          var b = e.target.closest('[data-okind] [data-v]'); if (!b) return;
          var row = b.closest('[data-pid]');
          DB.update(function (x) { x.products.forEach(function (y) { if (y.id === row.dataset.pid) y.kind = b.dataset.v; }); });
          row.querySelectorAll('[data-okind] [data-v]').forEach(function (y) { y.setAttribute('aria-pressed', String(y === b)); });
          UI.buzz(8);
        });
        root.addEventListener('change', function (e) {
          if (!e.target.matches('[data-ost]')) return;
          var pid = e.target.closest('[data-pid]').dataset.pid, sid = e.target.value || null;
          DB.update(function (x) { x.products.forEach(function (y) { if (y.id === pid) y.station = sid; }); });
          UI.buzz(8);
        });
      }
    };
  }

  Screens.produtos = function (params) {
    if (!UI.isManager()) return restricted();
    if (params[0] === 'organizar') return organize();
    if (params[0] === 'novo') return form(null);
    if (params[0]) return form(params[0]);
    return list();
  };
})();
