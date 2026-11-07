// Ficha técnica & CMV: painel, insumos, fichas técnicas, resumo, simulador e parâmetros.
// As contas ficam em js/cmv-core.js e os dados iniciais em js/cmv-seed.js.
// Gerente e administrador editam; o resto da equipe só consulta.
(function () {
  var esc = UI.esc, money = CMV.money, pct = CMV.fmtPct;
  var TABS = [['', 'Painel'], ['insumos', 'Insumos'], ['fichas', 'Fichas técnicas'], ['resumo', 'Resumo CMV'], ['simulador', 'Simulador'], ['parametros', 'Parâmetros']];
  var TONE = { ok: 'ok', high: 'crit', low: 'info', none: '' };
  var STATUS = { high: 'Acima do máximo', ok: 'Na faixa', low: 'Abaixo do mínimo', none: 'Sem preço' };

  // Filtros, busca e simulação ficam guardados enquanto o app está aberto.
  var st = { insQ: '', insF: 'todos', resCat: 'todas', resSt: 'todos', impact: null, sim: null, focus: null };

  function can() { return UI.isManager(); }
  function E() { return CMV.env(DB.get()); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function dt(ts) {
    try { return new Date(ts).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }); } catch (e) { return new Date(ts).toLocaleDateString('pt-BR'); }
  }
  function isoBr(s) { return String(s || '').split('-').reverse().join('/'); }
  function val(n) { return n == null ? '' : String(n).replace('.', ','); }
  function pill(en, v) { return '<span class="pill no-dot num ' + TONE[CMV.status(en, v)] + '">' + pct(v) + '</span>'; }
  function byName(a, b) { return a.name.localeCompare(b.name, 'pt-BR'); }
  function itemOf(id) { return DB.get().cardapio.filter(function (x) { return x.id === id; })[0]; }
  function insOf(id) { return DB.get().insumos.filter(function (x) { return x.id === id; })[0]; }

  // Edições ao vivo (gramas, preços) mudam o estado na hora e gravam meio segundo depois de parar de digitar.
  var saveTimer = 0;
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
  function flush() { if (!saveTimer) return; clearTimeout(saveTimer); saveTimer = 0; DB.update(function () {}); }

  // Copia para a tela só os valores calculados (marcados com data-calc), sem mexer nos campos em edição.
  function patch(root, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('[data-calc]').forEach(function (n) {
      var o = root.querySelector('[data-calc="' + n.getAttribute('data-calc') + '"]');
      if (o && o.innerHTML !== n.innerHTML) { o.innerHTML = n.innerHTML; o.className = n.className; }
    });
  }

  function tabs(active) {
    return '<nav class="chips cmv-tabs" aria-label="Seções da ficha técnica">' + TABS.map(function (t) {
      return '<a class="chip" href="#cmv' + (t[0] ? '/' + t[0] : '') + '"' + (t[0] === active ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
    }).join('') + '</nav>';
  }
  function metaLine() { var p = DB.get().cmv; return 'Meta de CMV: ' + pct(p.min) + ' a ' + pct(p.max) + ' · alvo ' + pct(p.target); }
  function shell(active, body, o) {
    o = o || {};
    return '<main class="screen wide cmv">' + UI.topbar(o.title || 'Ficha técnica & CMV', { back: o.back, sub: o.sub || metaLine(), right: o.right }) +
      (o.back ? '' : tabs(active)) + body + '</main>';
  }

  // Grupos da lista: categorias de pizza na ordem dos parâmetros, depois itens únicos, bebidas e combos.
  function groupsOf(en) {
    var out = en.p.cats.map(function (c) { return { key: 'cat:' + c.id, name: c.name, items: [] }; });
    out.push({ key: 'unico', name: 'Itens únicos', items: [] }, { key: 'bebida', name: 'Bebidas', items: [] }, { key: 'combo', name: 'Combos', items: [] });
    var by = {};
    out.forEach(function (g) { by[g.key] = g; });
    en.items.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (it) {
      var g = by[CMV.groupKey(it)];
      if (g) g.items.push(it);
    });
    return out;
  }

  // ---------- Sem dados ainda ----------
  function emptyScreen() {
    var m = can();
    var html = '<main class="screen cmv">' + UI.topbar('Ficha técnica & CMV') + '<div class="card">' +
      UI.empty('pizza', 'Ficha técnica ainda vazia', m
        ? 'Carregue os insumos, as fichas das pizzas, os itens únicos, as bebidas e os combos da planilha da Dindom. Os preços marcados como estimativa podem ser trocados depois pelos das notas fiscais.'
        : 'O gerente ainda não carregou as fichas técnicas.',
      m ? '<button type="button" class="btn primary" data-seed>Carregar dados da Dindom</button>' : '') + '</div></main>';
    return {
      html: html, tab: 'cmv',
      mount: function (root) {
        var b = root.querySelector('[data-seed]');
        if (!b) return;
        b.addEventListener('click', function () {
          // Sem internet, este aparelho pode não ter as fichas que já estão no servidor: não sobrescreve.
          if (window.Cloud && Cloud.enabled && Cloud.status === 'offline') { UI.toast('Conecte à internet para carregar as fichas.', { tone: 'crit' }); return; }
          UI.busy(b, function () {
            DB.update(function (d) { CMV.seed(d, d.user.empId); });
            UI.toast('Fichas técnicas carregadas');
            refresh();
          });
        });
      }
    };
  }

  // ---------- Painel ----------
  function kpi(label, value, s, sub, href, attr) {
    var inner = '<span class="card-meta">' + esc(label) + '</span><span class="stat num tone-' + s + '">' + value + '</span><span class="card-meta">' + esc(sub) + '</span>';
    return href ? '<a class="card tap cmv-kpi" href="' + href + '"' + (attr || '') + '>' + inner + '</a>' : '<div class="card cmv-kpi">' + inner + '</div>';
  }
  function rowLink(en, r) {
    return '<a class="row" href="#cmv/fichas/' + esc(r.item.id) + '" style="text-decoration:none;color:inherit"><div class="grow">' +
      '<div class="card-title">' + esc(r.item.name) + (r.size ? ' · ' + esc(CMV.sizeName(en, r.size)) : '') + '</div>' +
      '<div class="card-meta">' + esc(CMV.group(en, r.item)) + ' · custo ' + money(r.cost) + ' · preço ' + money(r.price) + '</div></div>' +
      pill(en, r.pct) + icon('chevronRight', 'sm') + '</a>';
  }

  function painel() {
    var d = DB.get(), en = E(), rows = CMV.rows(en);
    var vals = rows.filter(function (r) { return r.pct != null; });
    var avg = vals.length ? vals.reduce(function (s, r) { return s + r.pct; }, 0) / vals.length : null;
    var n = { high: 0, ok: 0, low: 0 };
    rows.forEach(function (r) { if (n[r.status] != null) n[r.status]++; });
    var est = d.insumos.filter(function (x) { return x.origin !== 'nota'; }).length;
    var worst = vals.slice().sort(function (a, b) { return b.pct - a.pct; }).slice(0, 5);
    var body =
      '<section class="stat-grid cmv-kpis">' +
      kpi('CMV médio do cardápio', pct(avg), CMV.status(en, avg), vals.length + ' itens e tamanhos') +
      kpi('Acima do máximo', n.high, n.high ? 'high' : 'none', 'CMV acima de ' + pct(en.p.max), '#cmv/resumo', ' data-res="high"') +
      kpi('Dentro da faixa', n.ok, 'ok', pct(en.p.min) + ' a ' + pct(en.p.max), '#cmv/resumo', ' data-res="ok"') +
      kpi('Abaixo do mínimo', n.low, n.low ? 'low' : 'none', 'sobra margem', '#cmv/resumo', ' data-res="low"') +
      kpi('Insumos com preço estimado', est, est ? 'none' : 'ok', 'de ' + d.insumos.length + ' insumos', '#cmv/insumos', ' data-ins-f="estimativa"') +
      '</section>' +
      (est ? '<a class="banner" href="#cmv/insumos" data-ins-f="estimativa" style="text-decoration:none">' + icon('receipt', 'sm') +
        '<div class="grow">' + est + ' insumos ainda estão com preço estimado. Troque pelo valor da nota fiscal para o CMV ficar certo.</div>' + icon('chevronRight', 'sm') + '</a>' : '') +
      '<section class="section"><div class="eyebrow">5 itens com o pior CMV</div>' +
      (worst.length ? '<div class="list">' + worst.map(function (r) { return rowLink(en, r); }).join('') + '</div>' : '<div class="card">' + UI.empty('pizza', 'Nenhum item com preço', 'Cadastre os itens em Fichas técnicas.') + '</div>') +
      '</section>';
    return {
      html: shell('', body), tab: 'cmv',
      mount: function (root) {
        root.addEventListener('click', function (e) {
          var a = e.target.closest('[data-res]');
          if (a) { st.resSt = a.dataset.res; st.resCat = 'todas'; }
          var f = e.target.closest('[data-ins-f]');
          if (f) { st.insF = f.dataset.insF; st.insQ = ''; }
        });
      }
    };
  }

  // ---------- Insumos ----------
  function usage() {
    var u = {};
    DB.get().cardapio.forEach(function (it) {
      var seen = {};
      (it.lines || []).forEach(function (l) { if (!seen[l.ins]) { seen[l.ins] = 1; u[l.ins] = (u[l.ins] || 0) + 1; } });
    });
    return u;
  }
  // Último preço de nota fiscal do produto do estoque ligado ao insumo, quando é diferente e mais novo.
  // (As notas lançadas depois da ligação já atualizam o insumo sozinhas; isto cobre as notas de antes.)
  function notaPrice(x) {
    var p = x.pid && DB.product(x.pid), conv = p && CMV.convOf(p, x);
    if (!conv) return null;
    var best = null;
    DB.get().prices.forEach(function (r) { if (r.pid === x.pid && (!best || r.date > best.date)) best = r; });
    if (!best) return null;
    var price = Math.round(best.price / conv * 100) / 100;
    if (Math.abs(price - x.price) < 0.005 || best.date < DB.iso(new Date(x.updatedAt || 0))) return null;
    return { price: price, date: best.date, store: best.store };
  }
  // Produto do estoque de onde vem o preço das notas.
  function linkText(x) {
    var p = x.pid && DB.product(x.pid);
    if (!p) return 'sem produto do estoque';
    var conv = CMV.convOf(p, x);
    return 'estoque: ' + p.name + (conv == null ? ' (falta a conversão)' : conv !== 1 ? ' (1 ' + p.unit + ' = ' + UI.fmt(conv) + ' ' + x.unit + ')' : '');
  }
  function unlinked(d) { return d.insumos.filter(function (x) { var p = x.pid && DB.product(x.pid); return !p || !CMV.convOf(p, x); }); }
  function originBadge(x, m) {
    var nota = x.origin === 'nota', cls = 'pill no-dot ' + (nota ? 'ok' : 'warn'), label = nota ? 'Nota fiscal' : 'Estimativa';
    return m ? '<button type="button" class="' + cls + ' ins-origin" data-origin-toggle title="Tocar para trocar a origem do preço">' + label + '</button>'
      : '<span class="' + cls + '">' + label + '</span>';
  }
  function insRow(x, m, used) {
    var nota = notaPrice(x);
    var store = nota && DB.get().stores.filter(function (s) { return s.id === nota.store; })[0];
    return '<div class="row ins-row" data-ins="' + esc(x.id) + '" data-name="' + esc(CMV.slug(x.name)) + '" data-origin="' + (x.origin === 'nota' ? 'nota' : 'estimativa') + '">' +
      '<div class="grow"><button type="button" class="ins-name" data-edit-ins>' + esc(x.name) + '</button>' +
      '<div class="ins-meta">' + originBadge(x, m) + '<span class="card-meta">Atualizado em ' + dt(x.updatedAt) + ' · ' + (used[x.id] || 0) + ' itens · ' + esc(linkText(x)) + '</span></div>' +
      (nota ? '<div class="ins-nota">' + icon('receipt', 'sm') + 'Nota de ' + isoBr(nota.date) + (store ? ' (' + esc(store.name) + ')' : '') + ': <b class="num">' + money(nota.price) + '</b>' +
        (m ? '<button type="button" class="btn sm" data-use-nota="' + nota.price + '">Usar este preço</button>' : '') + '</div>' : '') +
      '</div>' +
      '<div class="ins-price">' + (m ? '<input class="cmv-in" inputmode="decimal" data-price value="' + CMV.num2(x.price) + '" aria-label="Preço de ' + esc(x.name) + '">'
        : '<b class="num">' + money(x.price) + '</b>') + '<span class="card-meta">por ' + (x.unit === 'kg' ? 'kg' : 'unidade') + '</span></div></div>';
  }

  // Grava o preço (e/ou a origem) e devolve quais itens tiveram o CMV alterado.
  function setPrice(id, v, origin) {
    var x = insOf(id);
    if (!x) return null;
    var priceChanged = Math.abs(v - x.price) >= 0.005;
    if (!priceChanged && (!origin || origin === x.origin)) return null;
    var before = snap(E()), old = x.price;
    DB.update(function (d) {
      var y = d.insumos.filter(function (i) { return i.id === id; })[0];
      if (priceChanged) {
        d.precoHist.push({ id: uid('ph-'), ins: id, from: y.price, to: v, ts: Date.now(), by: d.user.empId, byName: d.user.name });
        y.price = v;
      }
      if (origin) y.origin = origin;
      y.updatedAt = Date.now();
      y.by = d.user.empId;
    });
    return priceChanged ? { id: id, name: x.name, from: old, to: v, changes: diff(before, snap(E())) } : null;
  }
  function snap(en) { var o = {}; CMV.rows(en).forEach(function (r) { o[r.item.id + '|' + r.size] = r; }); return o; }
  // Um registro por item (o maior tamanho), só onde o CMV mudou.
  function diff(a, b) {
    var per = {}, order = [];
    Object.keys(b).forEach(function (k) {
      var x = a[k], y = b[k];
      if (!x || x.pct == null || y.pct == null || Math.abs(x.pct - y.pct) < 1e-9) return;
      if (!per[y.item.id]) order.push(y.item.id);
      per[y.item.id] = { item: y.item, size: y.size, from: x.pct, to: y.pct };
    });
    return order.map(function (id) { return per[id]; });
  }
  function impactHtml() {
    var r = st.impact;
    if (!r) return '';
    var en = E(), x = insOf(r.id), ch = r.changes, MAX = 8;
    return '<div class="banner info cmv-impact">' + icon('refresh', 'sm') + '<div class="grow"><b>' + esc(r.name) + '</b>: ' + money(r.from) + ' → ' + money(r.to) + '. ' +
      (ch.length ? ch.length + (ch.length === 1 ? ' item teve' : ' itens tiveram') + ' o CMV alterado:' : 'Nenhum item do cardápio usa este insumo.') +
      (ch.length ? '<ul>' + ch.slice(0, MAX).map(function (c) {
        return '<li><a href="#cmv/fichas/' + esc(c.item.id) + '">' + esc(c.item.name) + '</a>' + (c.size ? ' (' + esc(CMV.sizeName(en, c.size).toLowerCase()) + ')' : '') +
          ': ' + pct(c.from) + ' → ' + pill(en, c.to) + '</li>';
      }).join('') + (ch.length > MAX ? '<li>e mais ' + (ch.length - MAX) + ' itens</li>' : '') + '</ul>' : '') +
      (x && x.origin !== 'nota' && can() ? '<div style="margin-top:8px"><button type="button" class="btn sm" data-impact-nota>Este preço é da nota fiscal</button></div>' : '') +
      '</div><button type="button" class="icon-btn plain" data-impact-close aria-label="Fechar">' + icon('x', 'sm') + '</button></div>';
  }

  function insumos() {
    var d = DB.get(), m = can(), used = usage();
    var list = d.insumos.slice().sort(byName);
    var est = list.filter(function (x) { return x.origin !== 'nota'; }).length;
    var loose = unlinked(d), nByName = 0;
    if (m && loose.length) nByName = CMV.autoLink(clone({ insumos: d.insumos, products: d.products })); // só conta, numa cópia
    var body =
      (loose.length ? '<div class="banner">' + icon('receipt', 'sm') + '<div class="grow">' + loose.length + (loose.length === 1 ? ' insumo não está ligado' : ' insumos não estão ligados') +
        ' a um produto do estoque: o preço não atualiza sozinho quando o comprista escaneia a nota.' +
        (m ? ' Toque no nome do insumo para escolher o produto.' : '') +
        (nByName ? '<div style="margin-top:8px"><button type="button" class="btn sm" data-autolink>Ligar ' + nByName + ' com o mesmo nome no estoque</button></div>' : '') + '</div></div>' : '') +
      '<div class="field"><input class="input" type="search" data-q placeholder="Buscar insumo" value="' + esc(st.insQ) + '" aria-label="Buscar insumo"></div>' +
      '<div class="chips" data-ins-filter>' + [['todos', 'Todos', list.length], ['estimativa', 'Estimativa', est], ['nota', 'Nota fiscal', list.length - est]].map(function (f) {
        return '<button type="button" class="chip" data-f="' + f[0] + '" aria-pressed="' + (st.insF === f[0]) + '">' + f[1] + ' <span class="count">' + f[2] + '</span></button>';
      }).join('') + '</div>' +
      '<div data-impact>' + impactHtml() + '</div>' +
      (m ? '<p class="card-meta">Toque no preço para editar e saia do campo para gravar. Toque no selo para trocar entre estimativa e nota fiscal.</p>' : '') +
      '<div class="list" data-ins-list>' + list.map(function (x) { return insRow(x, m, used); }).join('') + '</div>' +
      '<div class="card" data-none hidden>' + UI.empty('search', 'Nenhum insumo encontrado', 'Tente outro nome ou limpe o filtro.') + '</div>';
    return {
      html: shell('insumos', body, { right: m ? '<button type="button" class="btn sm" data-new-ins>' + icon('plus', 'sm') + 'Insumo</button>' : '' }),
      tab: 'cmv',
      mount: function (root) {
        function apply() {
          var q = CMV.slug(st.insQ), shown = 0;
          root.querySelectorAll('[data-ins]').forEach(function (r) {
            var ok = (!q || r.dataset.name.indexOf(q) >= 0) && (st.insF === 'todos' || r.dataset.origin === st.insF);
            r.hidden = !ok;
            if (ok) shown++;
          });
          root.querySelector('[data-none]').hidden = shown > 0;
        }
        function redrawRow(id) {
          var row = root.querySelector('[data-ins="' + id + '"]');
          if (!row) return;
          var tmp = document.createElement('div');
          tmp.innerHTML = insRow(insOf(id), m, usage());
          row.replaceWith(tmp.firstChild);
          apply();
        }
        function done(r) {
          if (r) { st.impact = r; root.querySelector('[data-impact]').innerHTML = impactHtml(); }
        }
        apply();
        root.querySelector('[data-q]').addEventListener('input', function (e) { st.insQ = e.target.value; apply(); });
        root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur(); });
        root.addEventListener('change', function (e) {
          var t = e.target.closest('[data-price]');
          if (!t) return;
          var id = t.closest('[data-ins]').dataset.ins, v = CMV.parse(t.value);
          if (v == null || v < 0) { t.classList.add('bad'); UI.toast('Preço inválido. Use só números, por exemplo 36,90.', { tone: 'crit' }); return; }
          t.classList.remove('bad');
          var r = setPrice(id, Math.round(v * 100) / 100);
          redrawRow(id);
          done(r);
        });
        root.addEventListener('click', function (e) {
          var f = e.target.closest('[data-f]');
          if (f) {
            st.insF = f.dataset.f;
            root.querySelectorAll('[data-f]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === f)); });
            return apply();
          }
          if (e.target.closest('[data-new-ins]')) return insSheet(null);
          if (e.target.closest('[data-autolink]')) {
            var n = 0;
            DB.update(function (dd) { n = CMV.autoLink(dd); });
            UI.toast(n + (n === 1 ? ' insumo ligado' : ' insumos ligados') + ' ao estoque');
            return refresh();
          }
          if (e.target.closest('[data-impact-close]')) { st.impact = null; root.querySelector('[data-impact]').innerHTML = ''; return; }
          if (e.target.closest('[data-impact-nota]')) {
            var iid = st.impact.id;
            setPrice(iid, insOf(iid).price, 'nota');
            redrawRow(iid);
            root.querySelector('[data-impact]').innerHTML = impactHtml();
            return UI.toast('Marcado como preço de nota fiscal');
          }
          var row = e.target.closest('[data-ins]');
          if (!row) return;
          var id = row.dataset.ins, x = insOf(id);
          if (e.target.closest('[data-edit-ins]')) return insSheet(x);
          if (e.target.closest('[data-origin-toggle]')) {
            setPrice(id, x.price, x.origin === 'nota' ? 'estimativa' : 'nota');
            return redrawRow(id);
          }
          var u = e.target.closest('[data-use-nota]');
          if (u) { done(setPrice(id, +u.dataset.useNota, 'nota')); redrawRow(id); UI.toast('Preço da nota aplicado'); }
        });
      }
    };
  }

  // Cadastro do insumo: nome, unidade, preço, origem e o produto do estoque de onde vem o preço das notas.
  function insSheet(x) {
    var d = DB.get(), m = can(), isNew = !x;
    var v = x ? clone(x) : { name: '', unit: 'kg', price: null, origin: 'estimativa', pid: null };
    var hist = isNew ? [] : d.precoHist.filter(function (h) { return h.ins === x.id; }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 8);
    var usedBy = isNew ? [] : d.cardapio.filter(function (it) { return (it.lines || []).some(function (l) { return l.ins === x.id; }); });
    var histHtml = hist.length ? '<div class="section"><div class="eyebrow">Histórico de preço</div><div class="list">' + hist.map(function (h) {
      return '<div class="row"><div class="grow"><div class="num">' + money(h.from) + ' → <b>' + money(h.to) + '</b></div><div class="card-meta">' + dt(h.ts) + (h.source === 'nota' ? ' · nota fiscal' + (h.store ? ' de ' + esc(h.store) : '') : '') +
        (h.byName ? ' · ' + esc(h.byName) : '') + '</div></div></div>';
    }).join('') + '</div></div>' : '';
    var usedHtml = usedBy.length ? '<p class="card-meta">Usado em: ' + usedBy.map(function (it) { return esc(it.name); }).join(', ') + '.</p>' : '';
    if (!m) {
      UI.sheet('<h2>' + esc(x.name) + '</h2><p class="muted">' + money(x.price) + ' por ' + (x.unit === 'kg' ? 'kg' : 'unidade') + ' · ' + (x.origin === 'nota' ? 'nota fiscal' : 'estimativa') + ' · atualizado em ' + dt(x.updatedAt) + '</p>' +
        usedHtml + histHtml + '<button type="button" class="btn block" data-close>Fechar</button>');
      return;
    }
    function prodOptions() {
      return '<option value="">Nenhum</option>' + d.products.slice().sort(byName).map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === v.pid ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.unit) + ')</option>';
      }).join('');
    }
    function seg(name, opts, cur) {
      return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + '</button>'; }).join('') + '</div>';
    }
    UI.sheet('<h2>' + (isNew ? 'Novo insumo' : 'Editar insumo') + '</h2>' +
      '<div class="field" id="f-in-name"><label for="in-name">Nome</label><input id="in-name" class="input" value="' + esc(v.name) + '" placeholder="Ex.: Mussarela"' + (isNew ? ' autofocus' : '') + '><span class="err" hidden></span></div>' +
      '<div class="field"><span class="label">Unidade</span>' + seg('unit', [['kg', 'Quilo (kg)'], ['un', 'Unidade (un)']], v.unit) +
      '<span class="hint">Na ficha, insumo em kg entra em gramas; em unidade, pela quantidade.</span></div>' +
      '<div class="field" id="f-in-price"><label for="in-price" data-price-label>Preço por ' + (v.unit === 'kg' ? 'kg' : 'unidade') + ' (R$)</label>' +
      '<input id="in-price" class="input num" inputmode="decimal" placeholder="0,00" value="' + (v.price != null ? CMV.num2(v.price) : '') + '"><span class="err" hidden>Informe o preço.</span></div>' +
      '<div class="field"><span class="label">Origem do preço</span>' + seg('origin', [['nota', 'Nota fiscal'], ['estimativa', 'Estimativa']], v.origin) + '</div>' +
      '<div class="field"><label for="in-pid">Produto do estoque</label><select id="in-pid" class="select">' + prodOptions() + '</select>' +
      '<span class="hint">Ligado a um produto, o preço muda sozinho quando o comprista escaneia a nota e dá entrada no estoque.</span></div>' +
      '<div class="field" id="f-in-conv" hidden><label for="in-conv" data-conv-label></label>' +
      '<input id="in-conv" class="input num" inputmode="decimal" placeholder="Ex.: 6" value="' + val(v.conv) + '">' +
      '<span class="hint">Ex.: o fardo de refrigerante tem 6 unidades; a bisnaga de catupiry tem 1,5 kg. O preço do insumo = preço da nota ÷ este número.</span>' +
      '<span class="err" hidden>Informe quanto vem em cada unidade do produto.</span></div>' +
      usedHtml + histHtml +
      '<div class="section"><button type="button" class="btn primary block" data-save>' + (isNew ? 'Cadastrar insumo' : 'Salvar') + '</button>' +
      (!isNew && !usedBy.length ? '<button type="button" class="btn block" data-del>Excluir insumo</button>' : '') +
      '<button type="button" class="btn block" data-close>Voltar</button></div>',
      function (sheet, close) {
        sheet.querySelectorAll('[data-seg]').forEach(function (g) {
          g.addEventListener('click', function (e) {
            var b = e.target.closest('[data-v]');
            if (!b) return;
            v[g.dataset.seg] = b.dataset.v;
            g.querySelectorAll('[data-v]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
            if (g.dataset.seg === 'unit') {
              sheet.querySelector('[data-price-label]').textContent = 'Preço por ' + (v.unit === 'kg' ? 'kg' : 'unidade') + ' (R$)';
              syncConv();
            }
          });
        });
        // Produto em outra unidade (caixa, fardo, bisnaga…): pede quanto de insumo vem em cada uma.
        function convProduct() {
          var p = DB.product(sheet.querySelector('#in-pid').value);
          return p && String(p.unit || '').toLowerCase() !== v.unit ? p : null;
        }
        function syncConv() {
          var p = convProduct();
          sheet.querySelector('#f-in-conv').hidden = !p;
          if (p) sheet.querySelector('[data-conv-label]').textContent = '1 ' + p.unit + ' de ' + p.name + ' tem quantos ' + (v.unit === 'kg' ? 'kg' : 'unidades') + '?';
        }
        sheet.querySelector('#in-pid').addEventListener('change', syncConv);
        syncConv();
        var del = sheet.querySelector('[data-del]');
        if (del) del.addEventListener('click', function () {
          close();
          UI.confirm({
            title: 'Excluir ' + x.name + '?', body: 'Nenhuma ficha usa este insumo. O histórico de preço também sai.', ok: 'Excluir', danger: true,
            onOk: function () {
              DB.update(function (dd) { dd.insumos = dd.insumos.filter(function (i) { return i.id !== x.id; }); });
              UI.toast('Insumo excluído'); refresh();
            }
          });
        });
        sheet.querySelector('[data-save]').addEventListener('click', function () {
          var name = sheet.querySelector('#in-name').value.trim().replace(/\s+/g, ' ');
          var price = CMV.parse(sheet.querySelector('#in-price').value);
          var fn = sheet.querySelector('#f-in-name'), fp = sheet.querySelector('#f-in-price');
          var dup = DB.get().insumos.some(function (i) { return i.id !== v.id && i.name.toLowerCase() === name.toLowerCase(); });
          fn.classList.toggle('error', !name || dup);
          fn.querySelector('.err').hidden = !(!name || dup);
          fn.querySelector('.err').textContent = dup ? 'Já existe um insumo com este nome.' : 'Informe o nome.';
          fp.classList.toggle('error', price == null || price < 0);
          fp.querySelector('.err').hidden = !(price == null || price < 0);
          var cp = convProduct(), conv = cp ? CMV.parse(sheet.querySelector('#in-conv').value) : null, fc = sheet.querySelector('#f-in-conv');
          var badConv = !!cp && !(conv > 0);
          fc.classList.toggle('error', badConv);
          fc.querySelector('.err').hidden = !badConv;
          if (!name || dup || price == null || price < 0 || badConv) return;
          price = Math.round(price * 100) / 100;
          var pid = sheet.querySelector('#in-pid').value || null;
          if (isNew) {
            var id = 'in-' + CMV.slug(name);
            if (insOf(id)) id = uid('in-');
            DB.update(function (dd) { dd.insumos.push({ id: id, name: name, unit: v.unit, price: price, origin: v.origin, pid: pid, conv: conv, updatedAt: Date.now(), by: dd.user.empId }); });
            close(); UI.toast('Insumo cadastrado'); refresh();
            return;
          }
          var unitChanged = v.unit !== x.unit;
          var r = setPrice(x.id, price, v.origin);
          DB.update(function (dd) {
            var y = dd.insumos.filter(function (i) { return i.id === x.id; })[0];
            y.name = name; y.unit = v.unit; y.pid = pid; y.conv = conv;
            if (unitChanged) y.updatedAt = Date.now();
          });
          if (r) st.impact = r;
          close(); UI.toast(unitChanged ? 'Salvo. Confira as quantidades nas fichas: a unidade mudou.' : 'Insumo salvo'); refresh();
        });
      });
  }

  // ---------- Fichas técnicas ----------
  function sizePills(en, it) {
    return '<span class="cmv-sizes">' + CMV.sizesOf(en, it).map(function (s) {
      var v = CMV.pct(CMV.cost(en, it, s), CMV.price(en, it, s));
      return '<span class="cmv-sz">' + (s ? '<b>' + esc(s) + '</b>' : '') + pill(en, v) + '</span>';
    }).join('') + '</span>';
  }
  function fichaRow(en, it) {
    var sub = it.type === 'pizza' ? (+it.extra ? 'Acréscimo de ' + money(it.extra) : 'Sem acréscimo') + ' · ' + (it.lines || []).length + ' insumos'
      : it.type === 'combo' ? (it.parts || []).length + ' componentes · ' + money(it.price)
      : 'Custo ' + money(CMV.cost(en, it, '')) + ' · preço ' + money(it.price);
    return '<a class="row" href="#cmv/fichas/' + esc(it.id) + '" style="text-decoration:none;color:inherit"><div class="grow">' +
      '<div class="card-title">' + esc(it.name) + (it.active === false ? ' <span class="pill no-dot">Inativo</span>' : '') + '</div>' +
      '<div class="card-meta">' + sub + '</div></div>' + sizePills(en, it) + '</a>';
  }

  function fichas() {
    var en = E(), m = can();
    var groups = groupsOf(en).filter(function (g) { return g.items.length; });
    var body = groups.map(function (g) {
      return '<section class="section"><div class="eyebrow">' + esc(g.name) + ' · ' + g.items.length + '</div><div class="list">' +
        g.items.map(function (it) { return fichaRow(en, it); }).join('') + '</div></section>';
    }).join('') || '<div class="card">' + UI.empty('pizza', 'Nenhum item no cardápio', m ? 'Toque em Novo item para cadastrar.' : 'O gerente ainda não cadastrou os itens.') + '</div>';
    return {
      html: shell('fichas', '<p class="card-meta">CMV de cada tamanho: verde na faixa, vermelho acima do máximo, azul abaixo do mínimo.</p>' + body,
        { right: m ? '<button type="button" class="btn sm" data-new-item>' + icon('plus', 'sm') + 'Novo item</button>' : '' }),
      tab: 'cmv',
      mount: function (root) {
        var b = root.querySelector('[data-new-item]');
        if (b) b.addEventListener('click', function () { itemSheet(null); });
      }
    };
  }

  // Preço de venda acima da ficha: na pizza, o da categoria + o acréscimo do sabor.
  function saleHtml(en, it, edit) {
    if (it.type === 'pizza') {
      var c = CMV.cat(en, it.cat);
      return '<section class="card"><div class="card-row cmv-sale"><div class="grow"><div class="card-meta">Preço da categoria ' + esc(c ? c.name : '') + '</div>' +
        '<div class="num">' + en.p.sizes.map(function (s) { return esc(s.name) + ' ' + money(c ? c.prices[s.id] : 0); }).join(' · ') + '</div></div>' +
        '<div class="field"><label class="card-meta" for="sale">Acréscimo do sabor</label>' + (edit
          ? '<input id="sale" class="cmv-in" inputmode="decimal" data-sale value="' + CMV.num2(it.extra || 0) + '">'
          : '<b class="num">' + money(it.extra || 0) + '</b>') + '</div></div></section>';
    }
    return '<section class="card"><div class="card-row cmv-sale"><div class="grow"><div class="card-meta">' + esc(CMV.TYPES[it.type]) + '</div>' +
      '<div class="card-title">Preço de venda</div></div><div class="field">' + (edit
        ? '<input class="cmv-in" inputmode="decimal" data-sale value="' + CMV.num2(it.price || 0) + '" aria-label="Preço de venda">'
        : '<b class="num">' + money(it.price) + '</b>') + '</div></div></section>';
  }

  // Ficha em tabela. mode.edit: quantidades, custos extras e componentes editáveis; mode.sim: também os
  // preços dos insumos. base: ambiente de hoje, para comparar no simulador.
  function fichaHtml(en, it, mode, base) {
    var pz = it.type === 'pizza', sizes = CMV.sizesOf(en, it), ed = !!mode.edit;
    var span = 3, tail = ed ? '<td></td>' : '';
    function sizeCells(fn, key, cls) {
      return sizes.map(function (s) { return '<td class="n' + (cls ? ' ' + cls : '') + '"' + (key ? ' data-calc="' + key + s + '"' : '') + '>' + fn(s) + '</td>'; }).join('');
    }
    function factor(s) { var z = CMV.size(en, s); return pz ? (z ? +z.factor || 0 : 0) : 1; }
    var head = '<tr><th>' + (it.type === 'combo' ? 'Componente' : 'Insumo') + '</th><th class="n">Qtd' + (pz ? ' (G)' : '') + '</th><th class="n">' + (it.type === 'combo' ? 'Custo un.' : 'Preço') + '</th>' +
      sizes.map(function (s) { return '<th class="n">' + (pz ? 'Custo ' + esc(s) : 'Custo') + '</th>'; }).join('') + (ed ? '<th></th>' : '') + '</tr>';
    var body = '';

    if (it.type === 'combo') {
      body += (it.parts || []).map(function (p, i) {
        var q = +p.qty || 1, x = p.kind === 'item' ? CMV.item(en, p.id) : null, c = CMV.cat(en, p.cat);
        var label = p.kind === 'pizza' ? 'Pizza ' + (c ? c.name.toLowerCase() : '?') + ' ' + CMV.sizeName(en, p.size).toLowerCase() + ' <small>média dos sabores</small>'
          : (x ? esc(x.name) : '<span class="muted">Item removido</span>');
        var unit = p.kind === 'pizza' ? CMV.catAvg(en, p.cat, p.size, false) : (x ? CMV.cost(en, x, x.type === 'pizza' ? p.size : '') : 0);
        return '<tr><td>' + label + '</td><td class="n">' + (ed ? '<input class="cmv-in" inputmode="numeric" data-pq="' + i + '" value="' + q + '" aria-label="Quantidade">' : q) + '</td>' +
          '<td class="n" data-calc="pu' + i + '">' + money(unit) + '</td><td class="n" data-calc="pt' + i + '">' + money(q * unit) + '</td>' +
          (ed ? '<td><button type="button" class="icon-btn plain" data-rm-part="' + i + '" aria-label="Tirar componente">' + icon('x', 'sm') + '</button></td>' : '') + '</tr>';
      }).join('');
    } else {
      body += (it.lines || []).map(function (l, i) {
        var x = en.ins[l.ins], un = x && x.unit === 'un' ? 'un' : 'g';
        var qty = ed ? '<span class="cmv-qty"><input class="cmv-in" inputmode="decimal" data-q="' + i + '" value="' + val(l.q) + '" aria-label="Quantidade de ' + esc(x ? x.name : 'insumo') + '"><small>' + un + '</small></span>'
          : '<span class="num">' + UI.fmt(l.q) + '</span> <small>' + un + '</small>';
        var price = !x ? '–' : (mode.sim ? '<input class="cmv-in" inputmode="decimal" data-ip="' + esc(x.id) + '" value="' + CMV.num2(x.price) + '" aria-label="Preço de ' + esc(x.name) + '">' : money(x.price)) +
          '<small>/' + (x.unit === 'kg' ? 'kg' : 'un') + '</small>';
        return '<tr><td>' + (x ? esc(x.name) : '<span class="muted">Insumo removido</span>') + '</td><td class="n">' + qty + '</td><td class="n">' + price + '</td>' +
          sizeCells(function (s) { return money(CMV.lineCost(en, l) * factor(s)); }, 'l' + i + '-') +
          (ed ? '<td><button type="button" class="icon-btn plain" data-rm-line="' + i + '" aria-label="Tirar ' + esc(x ? x.name : 'insumo') + '">' + icon('x', 'sm') + '</button></td>' : '') + '</tr>';
      }).join('');
      if (!(it.lines || []).length) body += '<tr><td colspan="' + (span + sizes.length + (ed ? 1 : 0)) + '" class="muted">Nenhum insumo na ficha ainda.</td></tr>';
      var b = CMV.base(en, it);
      body += '<tr class="sub"><td colspan="' + span + '">' + (pz ? 'Ingredientes (× fator do tamanho)' : 'Ingredientes') + '</td>' + sizeCells(function (s) { return money(b * factor(s)); }, 'ing') + tail + '</tr>';
      if (pz) {
        CMV.FIXED.forEach(function (f) {
          body += '<tr class="fx"><td colspan="' + span + '">' + f[1] + '</td>' + sizeCells(function (s) { var z = CMV.size(en, s); return money(z ? z[f[0]] : 0); }) + tail + '</tr>';
        });
      }
      (it.extras || []).forEach(function (e, i) {
        var name = ed && !e.size ? '<input class="cmv-in text" data-xn="' + i + '" value="' + esc(e.name) + '" aria-label="Nome do custo">' : esc(e.name);
        var v = ed && !e.size ? '<input class="cmv-in" inputmode="decimal" data-xv="' + i + '" value="' + CMV.num2(e.value) + '" aria-label="Valor de ' + esc(e.name) + '">' : money(CMV.extra(en, e));
        body += '<tr class="fx"><td colspan="' + span + '">' + name + '</td><td class="n"' + (e.size ? ' data-calc="x' + i + '"' : '') + '>' + v + '</td>' +
          (ed ? '<td><button type="button" class="icon-btn plain" data-rm-x="' + i + '" aria-label="Tirar custo">' + icon('x', 'sm') + '</button></td>' : '') + '</tr>';
      });
    }

    function lbl(t) { return '<td colspan="' + span + '">' + t + '</td>'; }
    var foot =
      '<tr class="tot">' + lbl('Custo total') + sizeCells(function (s) { return money(CMV.cost(en, it, s)); }, 'tot') + tail + '</tr>' +
      '<tr>' + lbl('Preço de venda') + sizeCells(function (s) { return money(CMV.price(en, it, s)); }, 'pr') + tail + '</tr>' +
      '<tr>' + lbl('<b>CMV</b>') + sizeCells(function (s) { return pill(en, CMV.pct(CMV.cost(en, it, s), CMV.price(en, it, s))); }, 'cmv') + tail + '</tr>' +
      (base ? '<tr class="fx">' + lbl('CMV hoje (sem a simulação)') + sizeCells(function (s) {
        var o = CMV.item(base, it.id);
        return o ? pill(base, CMV.pct(CMV.cost(base, o, s), CMV.price(base, o, s))) : '–';
      }, 'hoje') + tail + '</tr>' : '') +
      '<tr class="fx">' + lbl('Preço sugerido') + sizeCells(function (s) { return money(CMV.suggest(en, it, s)); }, 'sg') + tail + '</tr>' +
      '<tr class="fx">' + lbl('CMV com o preço sugerido') + sizeCells(function (s) { return pill(en, CMV.pct(CMV.cost(en, it, s), CMV.suggest(en, it, s))); }, 'sgc') + tail + '</tr>';
    return '<div class="table-wrap"><table class="cmv-table' + (pz ? ' wide' : '') + '"><thead>' + head + '</thead><tbody>' + body + foot + '</tbody></table></div>';
  }

  function addButtons(it) {
    return '<div class="cmv-acts">' +
      (it.type === 'combo' ? '<button type="button" class="btn sm" data-add-part>' + icon('plus', 'sm') + 'Componente</button>'
        : '<button type="button" class="btn sm" data-add-line>' + icon('plus', 'sm') + 'Insumo</button>') +
      (it.type === 'unico' ? '<button type="button" class="btn sm" data-add-x>' + icon('plus', 'sm') + 'Custo extra</button>' : '') + '</div>';
  }

  // Liga os campos da ficha (tela do item e simulador). ctx.item() devolve o item a alterar,
  // ctx.ins(id, preço) muda o preço de um insumo (só no simulador), ctx.saved() grava,
  // ctx.calc() devolve o HTML com os valores novos e ctx.redraw() redesenha a tela.
  function bindFicha(root, ctx) {
    root.addEventListener('input', function (e) {
      var t = e.target, ds = t.dataset, it = ctx.item();
      if (!it || !ds) return;
      var v = CMV.parse(t.value), ok = v != null && v >= 0;
      if (ds.q != null) { if (ok) it.lines[+ds.q].q = v; }
      else if (ds.xv != null) { if (ok) it.extras[+ds.xv].value = v; }
      else if (ds.xn != null) { ok = true; it.extras[+ds.xn].name = t.value; }
      else if (ds.pq != null) { ok = ok && v >= 1; if (ok) it.parts[+ds.pq].qty = Math.round(v); }
      else if (ds.sale != null) { if (ok) { if (it.type === 'pizza') it.extra = v; else it.price = v; } }
      else if (ds.ip != null && ctx.ins) { if (ok) ctx.ins(ds.ip, v); }
      else return;
      t.classList.toggle('bad', !ok);
      if (!ok) return;
      ctx.saved();
      patch(root, ctx.calc());
    });
    root.addEventListener('click', function (e) {
      var it = ctx.item();
      if (!it) return;
      var b;
      if ((b = e.target.closest('[data-rm-line]'))) { it.lines.splice(+b.dataset.rmLine, 1); ctx.saved(true); return ctx.redraw(); }
      if ((b = e.target.closest('[data-rm-x]'))) { it.extras.splice(+b.dataset.rmX, 1); ctx.saved(true); return ctx.redraw(); }
      if ((b = e.target.closest('[data-rm-part]'))) { it.parts.splice(+b.dataset.rmPart, 1); ctx.saved(true); return ctx.redraw(); }
      if (e.target.closest('[data-add-line]')) {
        return pickInsSheet(it, function (x) {
          var cur = ctx.item();
          cur.lines = cur.lines || [];
          cur.lines.push({ ins: x.id, q: x.unit === 'un' ? 1 : 0 });
          st.focus = '[data-q="' + (cur.lines.length - 1) + '"]';
          ctx.saved(true); ctx.redraw();
        });
      }
      if (e.target.closest('[data-add-x]')) return extraSheet(function (x) { var cur = ctx.item(); cur.extras = cur.extras || []; cur.extras.push(x); ctx.saved(true); ctx.redraw(); });
      if (e.target.closest('[data-add-part]')) return partSheet(it, function (p) { var cur = ctx.item(); cur.parts = cur.parts || []; cur.parts.push(p); ctx.saved(true); ctx.redraw(); });
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('.cmv-in')) e.target.blur(); });
  }

  // Foca o campo recém-criado (ex.: as gramas do insumo que acabou de entrar na ficha).
  function focusNext(root) {
    if (!st.focus) return;
    var f = root.querySelector(st.focus);
    st.focus = null;
    if (f) { f.focus(); f.select(); }
  }

  function ficha(id) {
    var en = E(), it = CMV.item(en, id);
    if (!it) return fichas();
    var m = can();
    function inner() {
      var e2 = E(), x = CMV.item(e2, id);
      return saleHtml(e2, x, m) + fichaHtml(e2, x, { edit: m });
    }
    var note = it.type === 'pizza' ? '<p class="card-meta">Quantidades da pizza grande. A pequena e a média usam o fator das gramas de cada tamanho; caixa, guardanapo, gás e perdas vêm dos Parâmetros.</p>'
      : it.type === 'combo' ? '<p class="card-meta">Pizza do combo entra pela média do custo dos sabores da categoria naquele tamanho.</p>' : '';
    var html = shell('fichas', '<div data-ficha>' + inner() + '</div>' + (m ? addButtons(it) : '') + note +
      '<a class="btn sm ghost" href="#cmv/simulador/' + esc(id) + '" style="align-self:flex-start">' + icon('sparkle', 'sm') + 'Simular mudanças sem gravar</a>',
      {
        title: it.name, back: '#cmv/fichas', sub: CMV.group(en, it) + ' · ' + CMV.TYPES[it.type] + (it.active === false ? ' · inativo' : ''),
        right: m ? '<button type="button" class="btn sm" data-edit-item>' + icon('settings', 'sm') + 'Editar</button>' : ''
      });
    return {
      html: html, tab: 'cmv',
      mount: function (root) {
        if (m) {
          bindFicha(root, {
            item: function () { return itemOf(id); },
            saved: function (now) { persist(); if (now) flush(); },
            calc: inner,
            redraw: function () { flush(); refresh(); }
          });
          root.querySelector('[data-edit-item]').addEventListener('click', function () { itemSheet(itemOf(id)); });
        }
        focusNext(root);
        return flush;
      }
    };
  }

  // Escolha de insumo para entrar na ficha, com busca.
  function pickInsSheet(it, onPick) {
    var have = {};
    (it.lines || []).forEach(function (l) { have[l.ins] = 1; });
    var list = DB.get().insumos.filter(function (x) { return !have[x.id]; }).sort(byName);
    UI.sheet('<h2>Adicionar insumo</h2>' +
      '<input class="input" type="search" data-q placeholder="Buscar insumo" aria-label="Buscar insumo" autofocus>' +
      '<div class="list pick-list">' + list.map(function (x) {
        return '<button type="button" class="row" data-pick="' + esc(x.id) + '" data-name="' + esc(CMV.slug(x.name)) + '"><div class="grow"><div class="card-title">' + esc(x.name) + '</div>' +
          '<div class="card-meta">' + money(x.price) + ' por ' + (x.unit === 'kg' ? 'kg' : 'unidade') + '</div></div>' + icon('plus', 'sm') + '</button>';
      }).join('') + '</div>' +
      '<p class="card-meta">Não achou? Cadastre em Insumos e volte aqui.</p>' +
      '<button type="button" class="btn block" data-close>Voltar</button>',
      function (sheet, close) {
        sheet.querySelector('[data-q]').addEventListener('input', function (e) {
          var q = CMV.slug(e.target.value);
          sheet.querySelectorAll('[data-pick]').forEach(function (b) { b.hidden = q && b.dataset.name.indexOf(q) < 0; });
        });
        sheet.addEventListener('click', function (e) {
          var b = e.target.closest('[data-pick]');
          if (!b) return;
          close();
          onPick(insOf(b.dataset.pick));
        });
      });
  }

  function extraSheet(onAdd) {
    var sizes = DB.get().cmv.sizes, mode = 'value';
    UI.sheet('<h2>Custo extra</h2>' +
      '<div class="seg" data-mode><button type="button" data-v="value" aria-pressed="true">Valor fixo</button><button type="button" data-v="size" aria-pressed="false">Custos de uma pizza</button></div>' +
      '<div data-value><div class="field"><label for="x-name">Nome</label><input id="x-name" class="input" placeholder="Ex.: Guardanapo e sachês" autofocus></div>' +
      '<div class="field"><label for="x-val">Valor (R$)</label><input id="x-val" class="input num" inputmode="decimal" placeholder="0,00"></div></div>' +
      '<div data-size hidden><div class="field"><label for="x-size">Tamanho</label><select id="x-size" class="select">' + sizes.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<span class="hint">Soma caixa, guardanapo, gás e perdas desse tamanho, como está nos Parâmetros.</span></div></div>' +
      '<div class="section"><button type="button" class="btn primary block" data-ok>Adicionar</button><button type="button" class="btn block" data-close>Voltar</button></div>',
      function (sheet, close) {
        sheet.querySelector('[data-mode]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]');
          if (!b) return;
          mode = b.dataset.v;
          sheet.querySelectorAll('[data-mode] [data-v]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
          sheet.querySelector('[data-value]').hidden = mode !== 'value';
          sheet.querySelector('[data-size]').hidden = mode !== 'size';
        });
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          if (mode === 'size') {
            var sz = sheet.querySelector('#x-size').value, s = sizes.filter(function (z) { return z.id === sz; })[0];
            close(); onAdd({ name: 'Caixa, guardanapo, gás e perdas da pizza ' + s.name.toLowerCase(), size: sz });
            return;
          }
          var name = sheet.querySelector('#x-name').value.trim(), v = CMV.parse(sheet.querySelector('#x-val').value);
          if (!name || v == null || v < 0) { UI.toast('Informe o nome e o valor.', { tone: 'crit' }); return; }
          close(); onAdd({ name: name, value: Math.round(v * 100) / 100 });
        });
      });
  }

  function partSheet(it, onAdd) {
    var d = DB.get(), kind = 'pizza';
    var others = d.cardapio.filter(function (x) { return x.id !== it.id && (x.type === 'unico' || x.type === 'bebida'); }).sort(byName);
    function opts(list) { return list.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; }).join(''); }
    UI.sheet('<h2>Componente do combo</h2>' +
      '<div class="seg" data-kind><button type="button" data-v="pizza" aria-pressed="true">Pizza</button><button type="button" data-v="item" aria-pressed="false">Item ou bebida</button></div>' +
      '<div data-pizza><div class="field"><label for="p-cat">Categoria</label><select id="p-cat" class="select">' + opts(d.cmv.cats) + '</select></div>' +
      '<div class="field"><label for="p-size">Tamanho</label><select id="p-size" class="select">' + opts(d.cmv.sizes) + '</select>' +
      '<span class="hint">O custo é a média dos sabores da categoria nesse tamanho.</span></div></div>' +
      '<div data-item hidden><div class="field"><label for="p-item">Item</label><select id="p-item" class="select">' + opts(others) + '</select></div></div>' +
      '<div class="field"><label for="p-qty">Quantidade</label><input id="p-qty" class="input num" inputmode="numeric" value="1"></div>' +
      '<div class="section"><button type="button" class="btn primary block" data-ok>Adicionar</button><button type="button" class="btn block" data-close>Voltar</button></div>',
      function (sheet, close) {
        sheet.querySelector('[data-kind]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]');
          if (!b) return;
          kind = b.dataset.v;
          sheet.querySelectorAll('[data-kind] [data-v]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
          sheet.querySelector('[data-pizza]').hidden = kind !== 'pizza';
          sheet.querySelector('[data-item]').hidden = kind !== 'item';
        });
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          var q = Math.round(CMV.parse(sheet.querySelector('#p-qty').value) || 0);
          if (q < 1) { UI.toast('Quantidade mínima: 1.', { tone: 'crit' }); return; }
          if (kind === 'item') {
            var id = sheet.querySelector('#p-item').value;
            if (!id) { UI.toast('Cadastre o item antes.', { tone: 'crit' }); return; }
            close(); onAdd({ kind: 'item', id: id, qty: q });
            return;
          }
          close(); onAdd({ kind: 'pizza', cat: sheet.querySelector('#p-cat').value, size: sheet.querySelector('#p-size').value, qty: q });
        });
      });
  }

  // Novo item (nome, tipo, categoria) ou edição (nome, categoria, ativo, excluir).
  function itemSheet(it) {
    var d = DB.get(), isNew = !it, type = it ? it.type : 'pizza';
    var cats = d.cmv.cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (it && it.cat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    var inCombos = it ? d.cardapio.filter(function (x) { return x.type === 'combo' && (x.parts || []).some(function (p) { return p.id === it.id; }); }) : [];
    UI.sheet('<h2>' + (isNew ? 'Novo item do cardápio' : 'Editar item') + '</h2>' +
      '<div class="field" id="f-it-name"><label for="it-name">Nome</label><input id="it-name" class="input" value="' + esc(it ? it.name : '') + '" placeholder="Ex.: Calabresa Dindom"' + (isNew ? ' autofocus' : '') + '><span class="err" hidden>Informe o nome.</span></div>' +
      (isNew ? '<div class="field"><span class="label">Tipo</span><div class="seg seg-wrap" data-type>' + Object.keys(CMV.TYPES).map(function (k) {
        return '<button type="button" data-v="' + k + '" aria-pressed="' + (k === type) + '">' + CMV.TYPES[k] + '</button>';
      }).join('') + '</div></div>' : '') +
      '<div class="field" data-cat' + (type === 'pizza' ? '' : ' hidden') + '><label for="it-cat">Categoria</label><select id="it-cat" class="select">' + cats + '</select>' +
      (isNew ? '<span class="hint">O sabor novo já começa com a massa e o molho de toda pizza; ajuste depois.</span>' : '') + '</div>' +
      (isNew ? '' : '<div class="te-flags"><label><input type="checkbox" id="it-active"' + (it.active === false ? '' : ' checked') + '> Ativo no cardápio (entra no painel e no resumo)</label></div>') +
      '<div class="section"><button type="button" class="btn primary block" data-save>' + (isNew ? 'Criar e abrir a ficha' : 'Salvar') + '</button>' +
      (isNew ? '' : '<button type="button" class="btn block" data-del>Excluir item</button>') +
      '<button type="button" class="btn block" data-close>Voltar</button></div>',
      function (sheet, close) {
        var tp = sheet.querySelector('[data-type]');
        if (tp) tp.addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]');
          if (!b) return;
          type = b.dataset.v;
          tp.querySelectorAll('[data-v]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
          sheet.querySelector('[data-cat]').hidden = type !== 'pizza';
        });
        var del = sheet.querySelector('[data-del]');
        if (del) del.addEventListener('click', function () {
          close();
          UI.confirm({
            title: 'Excluir ' + it.name + '?',
            body: inCombos.length ? 'Ele faz parte de: ' + inCombos.map(function (x) { return esc(x.name); }).join(', ') + '. Nesses combos o componente fica sem custo.' : 'A ficha técnica deste item será apagada.',
            ok: 'Excluir', danger: true,
            onOk: function () {
              DB.update(function (dd) { dd.cardapio = dd.cardapio.filter(function (x) { return x.id !== it.id; }); });
              UI.toast('Item excluído'); go('cmv/fichas', { replace: true });
            }
          });
        });
        sheet.querySelector('[data-save]').addEventListener('click', function () {
          var name = sheet.querySelector('#it-name').value.trim().replace(/\s+/g, ' ');
          var f = sheet.querySelector('#f-it-name');
          f.classList.toggle('error', !name); f.querySelector('.err').hidden = !!name;
          if (!name) return;
          var cat = sheet.querySelector('#it-cat').value;
          if (isNew) {
            var id = uid('it-');
            DB.update(function (dd) {
              var order = dd.cardapio.reduce(function (n, x) { return Math.max(n, x.order || 0); }, 0) + 1;
              var have = {};
              dd.insumos.forEach(function (x) { have[x.id] = 1; });
              var o = { id: id, name: name, type: type, active: true, order: order };
              if (type === 'pizza') { o.cat = cat; o.extra = 0; o.lines = CMV.baseLines().filter(function (l) { return have[l.ins]; }); }
              else if (type === 'combo') { o.price = 0; o.parts = []; }
              else { o.price = 0; o.lines = []; o.extras = []; }
              dd.cardapio.push(o);
            });
            close(); UI.toast('Item criado. Monte a ficha e o preço.'); go('cmv/fichas/' + id);
            return;
          }
          DB.update(function (dd) {
            var x = dd.cardapio.filter(function (i) { return i.id === it.id; })[0];
            x.name = name;
            if (x.type === 'pizza') x.cat = cat;
            x.active = sheet.querySelector('#it-active').checked;
          });
          close(); UI.toast('Item salvo'); refresh();
        });
      });
  }

  // ---------- Resumo CMV ----------
  var RES_ST = [['todos', 'Todos'], ['high', 'Acima do máximo'], ['ok', 'Na faixa'], ['low', 'Abaixo do mínimo']];
  function resCats(en) {
    return [['todas', 'Todas']].concat(en.p.cats.map(function (c) { return ['cat:' + c.id, c.name]; }), [['unico', 'Itens únicos'], ['bebida', 'Bebidas'], ['combo', 'Combos']]);
  }
  function resRows(en) {
    return CMV.rows(en).filter(function (r) {
      return (st.resCat === 'todas' || CMV.groupKey(r.item) === st.resCat) && (st.resSt === 'todos' || r.status === st.resSt);
    });
  }
  var RES_HEAD = ['Categoria', 'Item', 'Tamanho', 'Custo hoje', 'Preço hoje', 'CMV hoje', 'Preço sugerido', 'CMV sugerido', 'Situação'];

  function resumo() {
    var en = E(), all = CMV.rows(en), rows = resRows(en);
    var cnt = { todos: 0, high: 0, ok: 0, low: 0 };
    all.forEach(function (r) { if (st.resCat === 'todas' || CMV.groupKey(r.item) === st.resCat) { cnt.todos++; if (cnt[r.status] != null) cnt[r.status]++; } });
    var catTable = '<section class="section"><div class="eyebrow">Preço das categorias: hoje → sugerido</div><div class="table-wrap"><table class="cmv-table"><thead><tr><th>Categoria</th>' +
      en.p.sizes.map(function (s) { return '<th class="n">' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      en.p.cats.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td>' + en.p.sizes.map(function (s) {
          var now = +c.prices[s.id] || 0, sg = CMV.suggestCat(en, c.id, s.id);
          return '<td class="n">' + money(now) + (sg > now ? ' → <b>' + money(sg) + '</b>' : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="card-meta">Sugestão = custo médio dos sabores sem acréscimo ÷ CMV alvo (' + pct(en.p.target) + '), arredondado para cima. Nunca abaixo do preço de hoje.</p></section>';
    var table = rows.length ? '<div class="table-wrap"><table class="cmv-table res"><thead><tr>' + RES_HEAD.map(function (h, i) { return '<th' + (i > 2 && i < 8 ? ' class="n"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr data-go="' + esc(r.item.id) + '"><td>' + esc(CMV.group(en, r.item)) + '</td><td><b>' + esc(r.item.name) + '</b></td><td>' + esc(r.size ? CMV.sizeName(en, r.size) : '—') + '</td>' +
          '<td class="n">' + money(r.cost) + '</td><td class="n">' + money(r.price) + '</td><td class="n">' + pill(en, r.pct) + '</td>' +
          '<td class="n">' + money(r.sugg) + '</td><td class="n">' + pill(en, r.suggPct) + '</td>' +
          '<td><span class="tone-' + r.status + '">' + STATUS[r.status] + '</span></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="card">' + UI.empty('search', 'Nenhum item neste filtro', 'Troque a categoria ou a situação.') + '</div>';
    var body =
      '<div class="chips" data-res-cat>' + resCats(en).map(function (c) { return '<button type="button" class="chip" data-v="' + c[0] + '" aria-pressed="' + (st.resCat === c[0]) + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="chips" data-res-st>' + RES_ST.map(function (s) {
        return '<button type="button" class="chip" data-v="' + s[0] + '" aria-pressed="' + (st.resSt === s[0]) + '">' + s[1] + ' <span class="count">' + cnt[s[0]] + '</span></button>';
      }).join('') + '</div>' + table + catTable;
    return {
      html: shell('resumo', body, { right: '<button type="button" class="btn sm" data-export>' + icon('file', 'sm') + 'Exportar</button>' }),
      tab: 'cmv',
      mount: function (root) {
        root.addEventListener('click', function (e) {
          var c = e.target.closest('[data-res-cat] [data-v]');
          if (c) { st.resCat = c.dataset.v; return refresh(); }
          var s = e.target.closest('[data-res-st] [data-v]');
          if (s) { st.resSt = s.dataset.v; return refresh(); }
          var tr = e.target.closest('tr[data-go]');
          if (tr) return go('cmv/fichas/' + tr.dataset.go);
          if (e.target.closest('[data-export]')) exportCsv(en, rows);
        });
      }
    };
  }

  // Exporta as mesmas colunas da tela, em CSV com ponto e vírgula (abre direto no Excel em português).
  function exportCsv(en, rows) {
    if (!rows.length) { UI.toast('Nada para exportar neste filtro.', { tone: 'crit' }); return; }
    function cell(v) { v = v == null ? '' : String(v); return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [RES_HEAD].concat(rows.map(function (r) {
      return [CMV.group(en, r.item), r.item.name, r.size ? CMV.sizeName(en, r.size) : '', CMV.num2(r.cost), CMV.num2(r.price), pct(r.pct), CMV.num2(r.sugg), pct(r.suggPct), STATUS[r.status]];
    }));
    var text = '﻿' + lines.map(function (l) { return l.map(cell).join(';'); }).join('\r\n') + '\r\n';
    var ok = window.PontoExport && PontoExport.download('dindom-cmv-' + DB.businessDay() + '.csv', text);
    UI.toast(ok ? 'Planilha baixada' : 'Este navegador não deixou baixar o arquivo.', ok ? { icon: 'file' } : { tone: 'crit' });
  }

  // ---------- Simulador ----------
  // Ambiente com a simulação por cima dos dados de hoje: o item em edição e os preços de insumo mexidos.
  function simEnv() {
    var d = DB.get(), ins = {};
    d.insumos.forEach(function (x) {
      var p = st.sim.ins[x.id];
      ins[x.id] = p == null ? x : { id: x.id, name: x.name, unit: x.unit, price: p, origin: x.origin };
    });
    return { ins: ins, p: d.cmv, items: d.cardapio.map(function (x) { return x.id === st.sim.id ? st.sim.item : x; }) };
  }

  function simulador(params) {
    var d = DB.get(), m = can();
    var id = params[0] || (st.sim && st.sim.id) || (d.cardapio[0] && d.cardapio[0].id);
    var it = itemOf(id);
    if (!it) return { html: shell('simulador', '<div class="card">' + UI.empty('pizza', 'Nenhum item para simular', 'Cadastre os itens em Fichas técnicas.') + '</div>'), tab: 'cmv' };
    if (!st.sim || st.sim.id !== id) st.sim = { id: id, item: clone(it), ins: {} };
    var en = E();
    function inner() { return fichaHtml(simEnv(), st.sim.item, { edit: true, sim: true }, E()); }
    function sale() { return saleHtml(simEnv(), st.sim.item, true); }
    var select = '<div class="field"><label for="sim-item">Item</label><select id="sim-item" class="select">' + groupsOf(en).filter(function (g) { return g.items.length; }).map(function (g) {
      return '<optgroup label="' + esc(g.name) + '">' + g.items.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '</select></div>';
    var body = select +
      '<div class="banner info">' + icon('sparkle', 'sm') + '<div class="grow">Mexa nas quantidades, nos preços dos insumos e no preço de venda. Nada é gravado até tocar em Aplicar.</div></div>' +
      '<div data-ficha>' + sale() + inner() + '</div>' + addButtons(it) +
      '<div class="cmv-acts">' + (m ? '<button type="button" class="btn primary" data-apply>' + icon('check', 'sm') + 'Aplicar</button>' : '') +
      '<button type="button" class="btn" data-reset>Desfazer a simulação</button>' +
      '<a class="btn ghost" href="#cmv/fichas/' + esc(id) + '">Ver a ficha gravada</a></div>' +
      (m ? '' : '<p class="card-meta">Só o gerente aplica as mudanças.</p>');
    return {
      html: shell('simulador', body), tab: 'cmv',
      mount: function (root) {
        root.querySelector('#sim-item').addEventListener('change', function (e) { st.sim = null; go('cmv/simulador/' + e.target.value, { replace: true }); });
        bindFicha(root, {
          item: function () { return st.sim.item; },
          ins: function (iid, v) { st.sim.ins[iid] = v; },
          saved: function () {},
          calc: inner,
          redraw: refresh
        });
        focusNext(root);
        root.addEventListener('click', function (e) {
          if (e.target.closest('[data-reset]')) { st.sim = null; UI.toast('Simulação desfeita'); return refresh(); }
          if (e.target.closest('[data-apply]')) applySim();
        });
      }
    };
  }

  function applySim() {
    var s = st.sim, changed = Object.keys(s.ins).filter(function (k) { var x = insOf(k); return x && Math.abs(x.price - s.ins[k]) >= 0.005; });
    UI.confirm({
      title: 'Aplicar a simulação?',
      body: 'A ficha de <b>' + esc(s.item.name) + '</b> será gravada' + (changed.length ? ' e ' + changed.length + (changed.length === 1 ? ' preço de insumo muda' : ' preços de insumo mudam') + ' para todo o cardápio' : '') + '.',
      ok: 'Aplicar',
      onOk: function () {
        changed.forEach(function (k) { setPrice(k, Math.round(s.ins[k] * 100) / 100); });
        DB.update(function (d) {
          d.cardapio = d.cardapio.map(function (x) { return x.id === s.id ? clone(s.item) : x; });
        });
        st.sim = null;
        UI.toast('Simulação aplicada');
        go('cmv/fichas/' + s.id);
      }
    });
  }

  // ---------- Parâmetros ----------
  var SIZE_F = [['name', 'Nome', 'text'], ['diam', 'Diâmetro (cm)'], ['slices', 'Fatias'], ['factor', 'Fator das gramas'],
    ['box', 'Caixa (R$)'], ['napkin', 'Guardanapo, sachês e etiqueta (R$)'], ['gas', 'Gás e energia (R$)'], ['loss', 'Perdas e sobras (R$)']];

  function paramsCalc() {
    var en = E(), rows = CMV.rows(en), n = { high: 0, ok: 0, low: 0 };
    rows.forEach(function (r) { if (n[r.status] != null) n[r.status]++; });
    return '<div class="banner info" data-calc="live">' + icon('refresh', 'sm') + '<div class="grow">Com estes parâmetros: <b class="tone-high">' + n.high + ' acima</b>, <b class="tone-ok">' + n.ok + ' na faixa</b> e <b class="tone-low">' + n.low + ' abaixo</b> da meta.</div></div>' +
      '<span data-calc="fx">' + en.p.sizes.map(function (s) { return esc(s.name) + ' ' + money(CMV.fixed(s)); }).join(' · ') + '</span>' +
      en.p.cats.map(function (c) {
        return '<span data-calc="cs-' + esc(c.id) + '">' + en.p.sizes.map(function (s) { return money(CMV.suggestCat(en, c.id, s.id)); }).join(' / ') + '</span>';
      }).join('');
  }

  function parametros() {
    var p = DB.get().cmv, m = can(), en = E();
    function num(v, dec) { return dec ? CMV.num2(v) : val(v); }
    function inp(attrs, v, cls) { return m ? '<input class="cmv-in' + (cls ? ' ' + cls : '') + '" ' + attrs + ' value="' + esc(v) + '">' : '<span class="num">' + esc(v) + '</span>'; }
    var calc = document.createElement('div');
    calc.innerHTML = paramsCalc();
    function piece(key) { var n = calc.querySelector('[data-calc="' + key + '"]'); return n ? n.outerHTML : ''; }
    var meta = '<section class="section"><div class="eyebrow">Meta de CMV</div><div class="card"><div class="cmv-cmp">' +
      [['min', 'CMV mínimo'], ['max', 'CMV máximo'], ['target', 'CMV alvo']].map(function (f) {
        return '<div><span class="card-meta">' + f[1] + '</span><span class="cmv-qty">' + inp('inputmode="decimal" data-pp="' + f[0] + '" aria-label="' + f[1] + '"', (p[f[0]] * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })) + '<small>%</small></span></div>';
      }).join('') + '</div><p class="card-meta" data-pp-err hidden style="color:var(--crit)">O mínimo precisa ser menor que o máximo, e o alvo ficar entre os dois.</p></div>' + piece('live') + '</section>';
    var sizes = '<section class="section"><div class="eyebrow">Tamanhos de pizza</div><div class="table-wrap"><table class="cmv-table"><thead><tr><th></th>' +
      p.sizes.map(function (s) { return '<th class="n">' + esc(s.id) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      SIZE_F.map(function (f) {
        return '<tr><td>' + f[1] + '</td>' + p.sizes.map(function (s) {
          var dec = ['box', 'napkin', 'gas', 'loss'].indexOf(f[0]) >= 0;
          return '<td class="n">' + inp((f[2] ? '' : 'inputmode="decimal" ') + 'data-sz="' + esc(s.id) + '" data-f="' + f[0] + '" aria-label="' + f[1] + ' ' + esc(s.name) + '"', f[2] ? s[f[0]] : num(s[f[0]], dec), f[2] ? 'text' : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><p class="card-meta">Custo fixo por pizza: ' + piece('fx') + '</p>' +
      '<p class="card-meta">O fator multiplica as gramas da ficha (feitas para a grande). Grande = 1.</p></section>';
    var cats = '<section class="section"><div class="eyebrow">Preço de venda das categorias</div><div class="table-wrap"><table class="cmv-table"><thead><tr><th>Categoria</th>' +
      p.sizes.map(function (s) { return '<th class="n">' + esc(s.name) + '</th>'; }).join('') + '<th>Sugerido</th>' + (m ? '<th></th>' : '') + '</tr></thead><tbody>' +
      p.cats.map(function (c) {
        var used = en.items.some(function (x) { return x.type === 'pizza' && x.cat === c.id; });
        return '<tr><td>' + inp('data-cn="' + esc(c.id) + '" aria-label="Nome da categoria"', c.name, 'text') + '</td>' + p.sizes.map(function (s) {
          return '<td class="n">' + inp('inputmode="decimal" data-cp="' + esc(c.id) + '" data-s="' + esc(s.id) + '" aria-label="Preço ' + esc(c.name) + ' ' + esc(s.name) + '"', num(c.prices[s.id], true)) + '</td>';
        }).join('') + '<td class="n">' + piece('cs-' + c.id) + '</td>' +
          (m ? '<td>' + (used ? '' : '<button type="button" class="icon-btn plain" data-rm-cat="' + esc(c.id) + '" aria-label="Excluir categoria">' + icon('x', 'sm') + '</button>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      (m ? '<button type="button" class="btn sm" data-add-cat style="align-self:flex-start">' + icon('plus', 'sm') + 'Categoria</button>' : '') + '</section>';
    return {
      html: shell('parametros', (m ? '' : '<p class="card-meta">Só o gerente altera os parâmetros.</p>') + meta + sizes + cats),
      tab: 'cmv',
      mount: function (root) {
        if (!m) return;
        root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('.cmv-in')) e.target.blur(); });
        root.addEventListener('input', function (e) {
          var t = e.target, ds = t.dataset, q = DB.get().cmv, v = CMV.parse(t.value), ok = v != null && v >= 0;
          if (ds.pp) {
            var next = { min: q.min, max: q.max, target: q.target };
            if (ok) next[ds.pp] = v / 100;
            var valid = ok && next.min < next.max && next.target >= next.min && next.target <= next.max && next.max < 1;
            root.querySelector('[data-pp-err]').hidden = valid || !ok;
            ok = valid;
            if (ok) { q.min = next.min; q.max = next.max; q.target = next.target; }
          } else if (ds.sz) {
            var s = q.sizes.filter(function (z) { return z.id === ds.sz; })[0];
            if (ds.f === 'name') { ok = !!t.value.trim(); if (ok) s.name = t.value.trim(); }
            else if (ok) s[ds.f] = v;
          } else if (ds.cn) {
            ok = !!t.value.trim();
            if (ok) q.cats.filter(function (c) { return c.id === ds.cn; })[0].name = t.value.trim();
          } else if (ds.cp) {
            if (ok) q.cats.filter(function (c) { return c.id === ds.cp; })[0].prices[ds.s] = v;
          } else return;
          t.classList.toggle('bad', !ok);
          if (!ok) return;
          persist();
          patch(root, paramsCalc());
        });
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-rm-cat]');
          if (b) {
            var id = b.dataset.rmCat;
            return UI.confirm({
              title: 'Excluir a categoria?', body: 'Nenhuma pizza está nela.', ok: 'Excluir', danger: true,
              onOk: function () { DB.update(function (d) { d.cmv.cats = d.cmv.cats.filter(function (c) { return c.id !== id; }); }); refresh(); }
            });
          }
          if (e.target.closest('[data-add-cat]')) {
            UI.sheet('<h2>Nova categoria</h2><div class="field"><label for="cat-name">Nome</label><input id="cat-name" class="input" placeholder="Ex.: Doce" autofocus></div>' +
              '<p class="card-meta">Os preços começam zerados; preencha na tabela.</p>' +
              '<div class="section"><button type="button" class="btn primary block" data-ok>Criar</button><button type="button" class="btn block" data-close>Voltar</button></div>',
              function (sheet, close) {
                sheet.querySelector('[data-ok]').addEventListener('click', function () {
                  var name = sheet.querySelector('#cat-name').value.trim();
                  if (!name) return;
                  DB.update(function (d) {
                    var id = CMV.slug(name) || uid('cat-');
                    if (d.cmv.cats.some(function (c) { return c.id === id; })) id = uid('cat-');
                    var prices = {};
                    d.cmv.sizes.forEach(function (s) { prices[s.id] = 0; });
                    d.cmv.cats.push({ id: id, name: name, prices: prices });
                  });
                  close(); refresh();
                });
              });
          }
        });
        return flush;
      }
    };
  }

  Screens.cmv = function (params) {
    flush();
    if (!DB.get().cmv) return emptyScreen();
    switch (params[0]) {
      case 'insumos': return insumos();
      case 'fichas': return params[1] ? ficha(params[1]) : fichas();
      case 'resumo': return resumo();
      case 'simulador': return simulador(params.slice(1));
      case 'parametros': return parametros();
      default: return painel();
    }
  };
})();
