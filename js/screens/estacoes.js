// Estações do fechamento (gerente e admin): divide os produtos entre a equipe. Cada colaborador
// conta só os produtos das estações em que está; o fechamento junta tudo numa lista de compras.
(function () {
  var esc = UI.esc;
  var q = '';

  // Sugestão inicial, a partir do tipo e da categoria dos produtos.
  var SUGGESTED = [
    { name: 'Preparo e produção', match: function (p) { return DB.kindOf(p) === 'preparo'; } },
    { name: 'Montagem das pizzas', match: function (p) { return DB.kindOf(p) === 'montagem'; } },
    { name: 'Apoio e atendimento', match: function (p) { return DB.kindOf(p) === 'apoio' && !/embalag|limpeza/i.test(p.cat); } },
    { name: 'Embalagens e limpeza', match: function (p) { return DB.kindOf(p) === 'apoio' && /embalag|limpeza/i.test(p.cat); } }
  ];

  function team(d) { return d.employees.filter(function (e) { return e.active && e.role !== 'contador'; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); }); }
  function firstNames(d, ids) {
    return (ids || []).map(function (id) { var e = d.employees.filter(function (x) { return x.id === id; })[0]; return e ? e.name.split(' ')[0] : ''; }).filter(Boolean);
  }

  function restricted() {
    return { html: '<main class="screen">' + UI.topbar('Estações', { back: '#produtos' }) + '<div class="card">' +
      UI.empty('shield', 'Acesso restrito', 'Só gerentes e o administrador organizam as estações.') + '</div></main>', tab: 'estoque' };
  }

  function list() {
    var d = DB.get();
    var loose = d.products.filter(function (p) { return !DB.station(p.station); });
    var html = '<main class="screen wide">' + UI.topbar('Estações', { back: '#produtos', sub: 'Quem conta o quê no fechamento' }) +
      '<p class="muted" style="margin:0">Cada colaborador conta só os produtos da sua estação no fechamento. O app junta tudo numa lista de compras única.</p>' +
      '<a class="btn primary block cta" href="#estacoes/nova" style="min-height:56px;font-size:var(--fs-lg)">' + icon('plus') + 'Nova estação</a>' +
      (!d.stations.length && d.products.length ? '<section class="card"><div class="card-title">Começar pelas estações sugeridas</div>' +
        '<p class="card-meta" style="margin:0">Cria ' + SUGGESTED.map(function (s) { return '<b>' + esc(s.name) + '</b>'; }).join(', ') +
        ' e já distribui os produtos pelo tipo de cada um. Depois é só escolher os responsáveis.</p>' +
        '<button type="button" class="btn block" data-suggest>' + icon('sparkle', 'sm') + 'Criar estações sugeridas</button></section>' : '') +
      (d.stations.length ? '<div class="card-grid">' + d.stations.map(function (s) {
        var ps = d.products.filter(function (p) { return p.station === s.id; });
        var who = firstNames(d, s.emps);
        var kinds = DB.KINDS.map(function (k) { var n = ps.filter(function (p) { return DB.kindOf(p) === k.id; }).length; return n ? n + ' ' + k.label.split(' ')[0].toLowerCase() : ''; }).filter(Boolean).join(' · ');
        return '<a class="card tap" href="#estacoes/' + esc(s.id) + '" style="text-decoration:none;color:inherit"><div class="card-row"><div class="tile accent">' + icon('users') + '</div>' +
          '<div class="grow"><div class="card-title">' + esc(s.name) + '</div><div class="card-meta">' + (who.length ? esc(who.join(', ')) : '<span style="color:var(--warn)">Sem responsável</span>') + '</div></div>' + icon('chevronRight', 'sm') + '</div>' +
          '<div class="card-meta">' + ps.length + (ps.length === 1 ? ' produto' : ' produtos') + (kinds ? ' · ' + esc(kinds) : '') + '</div></a>';
      }).join('') + '</div>' : (d.products.length ? '' : '<div class="card">' + UI.empty('box', 'Cadastre os produtos primeiro', 'As estações reúnem produtos do estoque.', '<a class="btn primary" href="#produtos/novo">Cadastrar produtos</a>') + '</div>')) +
      (d.stations.length && loose.length ? '<div class="banner">' + icon('alert', 'sm') + '<div class="grow">' + loose.length + (loose.length === 1 ? ' produto sem estação: qualquer pessoa pode contar.' : ' produtos sem estação: qualquer pessoa pode contar.') + '</div>' +
        '<a class="btn sm" href="#produtos/organizar">Distribuir</a></div>' : '') +
      '</main>';
    return {
      html: html, tab: 'estoque',
      mount: function (root) {
        var sg = root.querySelector('[data-suggest]');
        if (sg) sg.addEventListener('click', function () {
          var made = 0;
          DB.update(function (x) {
            SUGGESTED.forEach(function (s, i) {
              var ps = x.products.filter(function (p) { return !p.station && s.match(p); });
              if (!ps.length) return;
              var id = 'st' + Date.now() + i;
              x.stations.push({ id: id, name: s.name, emps: [] });
              ps.forEach(function (p) { p.station = id; });
              made++;
            });
          });
          UI.buzz(15); refresh();
          UI.toast(made ? made + ' estações criadas. Agora escolha os responsáveis de cada uma.' : 'Nenhum produto para distribuir.', { ms: 4000 });
        });
      }
    };
  }

  function form(id) {
    var d = DB.get();
    var s = id ? DB.station(id) : null;
    if (id && !s) return list();
    var v = s ? JSON.parse(JSON.stringify(s)) : { name: '', emps: [] };
    var chosen = {};
    d.products.forEach(function (p) { if (s && p.station === s.id) chosen[p.id] = true; });

    function productList() {
      var term = q.toLowerCase();
      return DB.KINDS.map(function (k) {
        var ps = d.products.filter(function (p) { return DB.kindOf(p) === k.id && (!term || p.name.toLowerCase().indexOf(term) >= 0); })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
        if (!ps.length) return '';
        return '<div class="count-sub"><div class="eyebrow">' + esc(k.label) + '</div><div class="list">' + ps.map(function (p) {
          var other = p.station && (!s || p.station !== s.id) ? DB.station(p.station) : null;
          return '<label class="row" for="sp-' + p.id + '"><div class="grow"><div class="card-title">' + esc(p.name) + '</div>' +
            '<div class="card-meta">' + esc(p.cat) + (other ? ' · hoje em <b>' + esc(other.name) + '</b>' : '') + '</div></div>' +
            '<input id="sp-' + p.id + '" type="checkbox" class="switch" data-p="' + p.id + '"' + (chosen[p.id] ? ' checked' : '') + '></label>';
        }).join('') + '</div></div>';
      }).join('') || '<div class="card">' + UI.empty('search', 'Nenhum produto encontrado', 'Confira o nome digitado.') + '</div>';
    }

    var html = '<main class="screen no-nav">' + UI.topbar(s ? 'Editar estação' : 'Nova estação', { back: '#estacoes' }) +
      '<div class="field" id="f-st-name"><label for="st-name">Nome da estação *</label><input id="st-name" class="input" maxlength="40" placeholder="Ex.: Apoio e atendimento" value="' + esc(v.name) + '"><span class="err" hidden></span></div>' +
      '<div class="field"><span class="label">Responsáveis</span><span class="hint" style="margin-top:-2px">Quem conta os produtos desta estação no fechamento. Pode ser mais de uma pessoa.</span>' +
      '<div class="chips wrap" data-emps>' + team(d).map(function (e) {
        return '<button type="button" class="chip" data-e="' + esc(e.id) + '" aria-pressed="' + (v.emps.indexOf(e.id) >= 0) + '">' + esc(e.name) + '</button>';
      }).join('') + '</div></div>' +
      '<section class="section"><div class="section-head"><h2>Produtos</h2><span class="card-meta num" data-nsel>' + Object.keys(chosen).length + ' escolhidos</span></div>' +
      '<p class="card-meta" style="margin:0">Cada produto fica em uma estação só. Marcar um produto que está em outra estação muda ele para esta.</p>' +
      '<label class="field"><span class="sr-only">Buscar produto</span><div style="position:relative"><span style="position:absolute;left:14px;top:13px;color:var(--ink-3)">' + icon('search', 'sm') + '</span>' +
      '<input id="st-q" class="input" type="search" placeholder="Buscar produto" style="padding-left:42px" value="' + esc(q) + '"></div></label>' +
      '<div data-plist>' + productList() + '</div></section>' +
      (s ? '<button type="button" class="btn block" data-del style="color:var(--crit)">' + icon('x', 'sm') + 'Excluir estação</button>' : '') +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner"><button type="button" class="btn primary block" data-save style="min-height:56px">' + (s ? 'Salvar estação' : 'Criar estação') + '</button></div></div>';

    return {
      html: html, tab: 'estoque', nav: false,
      mount: function (root) {
        function $(x) { return root.querySelector(x); }
        function bindChecks() {
          root.querySelectorAll('[data-p]').forEach(function (c) {
            c.addEventListener('change', function () {
              if (c.checked) chosen[c.dataset.p] = true; else delete chosen[c.dataset.p];
              $('[data-nsel]').textContent = Object.keys(chosen).length + ' escolhidos';
            });
          });
        }
        bindChecks();
        $('[data-emps]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-e]'); if (!b) return;
          var i = v.emps.indexOf(b.dataset.e);
          if (i >= 0) v.emps.splice(i, 1); else v.emps.push(b.dataset.e);
          b.setAttribute('aria-pressed', String(i < 0));
        });
        $('#st-q').addEventListener('input', function (e) { q = e.target.value; $('[data-plist]').innerHTML = productList(); bindChecks(); });

        var del = $('[data-del]');
        if (del) del.addEventListener('click', function () {
          UI.confirm({ title: 'Excluir a estação ' + s.name + '?', body: 'Os produtos dela ficam sem estação (qualquer pessoa pode contar). Nenhum produto é apagado.', ok: 'Excluir estação', danger: true,
            onOk: function () {
              DB.update(function (x) {
                x.stations = x.stations.filter(function (y) { return y.id !== s.id; });
                x.products.forEach(function (p) { if (p.station === s.id) p.station = null; });
              });
              q = ''; go('estacoes', { replace: true }); UI.toast('Estação excluída');
            } });
        });

        $('[data-save]').addEventListener('click', function () {
          var name = $('#st-name').value.trim().replace(/\s+/g, ' ');
          var dup = DB.get().stations.filter(function (y) { return y.name.toLowerCase() === name.toLowerCase() && (!s || y.id !== s.id); })[0];
          var f = $('#f-st-name'), msg = !name ? 'Dê um nome à estação.' : dup ? 'Já existe uma estação com esse nome.' : '';
          f.classList.toggle('error', !!msg); f.querySelector('.err').hidden = !msg; f.querySelector('.err').textContent = msg;
          if (msg) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
          var sid = s ? s.id : 'st' + Date.now();
          DB.update(function (x) {
            if (s) { var t = x.stations.filter(function (y) { return y.id === sid; })[0]; t.name = name; t.emps = v.emps.slice(); }
            else x.stations.push({ id: sid, name: name, emps: v.emps.slice() });
            x.products.forEach(function (p) {
              if (chosen[p.id]) p.station = sid;
              else if (p.station === sid) p.station = null;
            });
          });
          UI.buzz(15); q = '';
          go('estacoes', { replace: true });
          UI.toast(name + (s ? ' atualizada' : ' criada') + ' · ' + Object.keys(chosen).length + ' produtos' + (v.emps.length ? '' : ' · falta escolher os responsáveis'), { ms: 3500 });
        });
        if (!s) $('#st-name').focus();
      }
    };
  }

  Screens.estacoes = function (params) {
    if (!UI.isManager()) return restricted();
    if (params[0] === 'nova') return form(null);
    if (params[0]) return form(params[0]);
    return list();
  };
})();
