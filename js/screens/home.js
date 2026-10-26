// Início: resumo do que precisa de atenção agora.
(function () {
  var esc = UI.esc;

  window.Stats = {
    closing: function (d) {
      var total = d.products.length;
      var counted = d.products.filter(function (p) { return d.closing.counts[p.id] != null; }).length;
      return { total: total, counted: counted, pct: total ? counted / total * 100 : 0 };
    },
    checklist: function (c) {
      var done = c.tasks.filter(function (t) { return c.done[t.id]; }).length;
      return { done: done, total: c.tasks.length, pct: done / c.tasks.length * 100 };
    },
    critical: function (d) {
      return d.products.filter(function (p) {
        var q = DB.stockOf(p.id);
        return q != null && q <= p.crit;
      });
    },
    shoppingPending: function (d) {
      return d.shopping.items.filter(function (i) { return i.received == null; });
    }
  };

  var PRIORITY = { urgente: ['crit', 'Urgente'], alta: ['warn', 'Alta'], media: ['info', 'Média'], baixa: ['', 'Baixa'] };
  var STATUS = { aberta: ['accent', 'Aberta'], andamento: ['info', 'Em andamento'], aguardando: ['warn', 'Aguardando peça'], resolvida: ['ok', 'Resolvida'] };
  window.MAINT = { PRIORITY: PRIORITY, STATUS: STATUS };

  function header(d) {
    var unit = d.units.filter(function (u) { return u.id === d.user.unit; })[0] || { name: '' };
    var unread = d.notifications.some(function (n) { return !n.read; });
    var bell = '<a class="icon-btn" href="#notificacoes" aria-label="Notificações">' + icon('bell') + (unread ? '<span class="dot"></span>' : '') + '</a>';
    // Celular: assinatura da marca no topo, com agenda e notificações. Computador: a marca já está no menu lateral.
    return '<div class="home-brand mobile-only"><img class="logo-ink" src="icons/wordmark-black.png" alt="Dindom"><span class="grow"></span>' +
      '<a class="icon-btn" href="#agenda" aria-label="Agenda">' + icon('calendar') + '</a>' + bell + '</div>' +
      '<header class="topbar">' +
      '<div style="flex:1;min-width:0">' +
      '<div class="sub">' + UI.greeting() + ',</div>' +
      '<h1 style="font-size:var(--fs-2xl)">' + esc(d.user.name.split(' ')[0]) + '</h1>' +
      '<button type="button" class="pill no-dot" data-unit style="border:0;margin-top:6px">' + icon('mapPin', 'sm') + esc(unit.name) + icon('chevronDown', 'sm') + '</button>' +
      '</div>' +
      '<span class="desk-only">' + bell + '</span>' +
      '</header>';
  }

  function closingCard(d) {
    if (!d.products.length) {
      return '<section class="card"><div class="card-row"><div class="tile">' + icon('box') + '</div><div class="grow"><div class="card-title">Fechamento de estoque</div>' +
        '<div class="card-meta">' + (UI.isManager() ? 'Cadastre os produtos para começar a contar o estoque.' : 'O gerente ainda não cadastrou os produtos do estoque.') + '</div></div></div>' +
        (UI.isManager() ? '<a class="btn primary block" href="#produtos/novo">' + icon('plus', 'sm') + 'Cadastrar produtos</a>' : '') + '</section>';
    }
    var s = Stats.closing(d);
    var dl = d.deliveries.filter(function (x) { return x.id === d.closing.delivery; })[0] || { label: '', date: '' };
    var started = s.counted > 0;
    return '<section class="card hero">' +
      '<div class="card-row"><div class="grow">' +
      '<div class="eyebrow" style="color:inherit;opacity:.6">Fechamento de estoque</div>' +
      '<h2 style="font-size:var(--fs-xl);margin-top:4px">' + (started ? 'Contagem em andamento' : 'Contagem não iniciada') + '</h2>' +
      '<p class="muted" style="margin-top:2px">Reposição de ' + esc(dl.label.toLowerCase()) + ', ' + esc(dl.date) + '</p>' +
      '</div><div class="ring" style="--p:' + s.pct + '"><span class="num">' + Math.round(s.pct) + '%</span></div></div>' +
      '<p class="muted num">' + s.counted + ' de ' + s.total + ' produtos contados</p>' +
      '<a class="btn primary block" href="#estoque/fechamento">' + (started ? 'Continuar fechamento' : 'Iniciar fechamento') + icon('chevronRight', 'sm') + '</a>' +
      '</section>';
  }

  function tasksSection(d) {
    if (!d.checklists.length) return '';
    var open = d.checklists.filter(function (c) { return !c.finishedAt; });
    if (!open.length) {
      return '<section class="section"><div class="section-head"><h2>Suas tarefas</h2></div><div class="card">' +
        UI.empty('check', 'Tudo em dia', 'Nenhum checklist pendente neste turno.') + '</div></section>';
    }
    var next = open[0];
    var s = Stats.checklist(next);
    return '<section class="section">' +
      '<div class="section-head"><h2>Suas tarefas</h2><a class="btn ghost sm" href="#checklists">Ver todas</a></div>' +
      '<a class="card tap" href="#checklists/' + next.id + '" style="text-decoration:none;color:inherit">' +
      '<div class="card-row"><div class="tile accent">' + icon(next.icon) + '</div>' +
      '<div class="grow"><div class="card-title">' + esc(next.name) + '</div>' +
      '<div class="card-meta">' + icon('clock', 'sm') + ' até ' + esc(next.due) + ' · <span class="num">' + s.done + '/' + s.total + '</span> tarefas</div></div>' +
      icon('chevronRight', 'sm') + '</div>' + UI.bar(s.pct) + '</a>' +
      (open.length > 1 ? '<p class="card-meta">E mais ' + (open.length - 1) + ' checklist' + (open.length > 2 ? 's' : '') + ' hoje.</p>' : '') +
      '</section>';
  }

  function stockSection(d) {
    if (!d.products.length) return '';
    var pend = Stats.shoppingPending(d);
    var crit = Stats.critical(d);
    return '<section class="section"><div class="section-head"><h2>Estoque</h2></div>' +
      '<div class="stat-grid">' +
      '<a class="card tap" href="#estoque/compras" style="text-decoration:none;color:inherit">' +
      '<div class="tile warn">' + icon('cart') + '</div><div class="stat num">' + pend.length + '</div><div class="card-meta">itens na lista de compras</div></a>' +
      '<a class="card tap" href="#estoque" style="text-decoration:none;color:inherit">' +
      '<div class="tile crit">' + icon('alert') + '</div><div class="stat num">' + crit.length + '</div><div class="card-meta">itens em nível crítico</div></a>' +
      '</div>' +
      (crit.length ? '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">' + crit.slice(0, 2).map(function (p) { return esc(p.name); }).join(', ') + (crit.length > 2 ? ' e mais ' + (crit.length - 2) : '') + ' abaixo do mínimo</div></div>' : '') +
      '</section>';
  }

  function maintSection(d) {
    var open = d.maintenance.filter(function (m) { return m.status !== 'resolvida'; });
    var last = open[0];
    return '<section class="section"><div class="section-head"><h2>Manutenção</h2><a class="btn ghost sm" href="#manutencao">' + open.length + ' abertas</a></div>' +
      (last ? '<a class="card tap" href="#manutencao/' + last.id + '" style="text-decoration:none;color:inherit"><div class="card-row">' +
        '<div class="tile info">' + icon('wrench') + '</div><div class="grow"><div class="card-title">' + esc(last.title) + '</div>' +
        '<div class="card-meta">' + esc(last.timeline[last.timeline.length - 1].text) + '</div></div></div></a>' : '') +
      '<a class="btn block" href="#manutencao/nova">' + icon('plus', 'sm') + 'Registrar problema</a>' +
      '</section>';
  }

  // Gerente: pendências, aprovações e ocorrências primeiro.
  function managerSummary(d) {
    var urgent = d.maintenance.filter(function (m) { return m.priority === 'urgente' && m.status !== 'resolvida'; });
    var lateLists = d.checklists.filter(function (c) { return !c.finishedAt; });
    var pend = Stats.shoppingPending(d);
    var rows = [
      { href: '#manutencao', tone: 'crit', ic: 'alert', title: urgent.length + ' ocorrência' + (urgent.length === 1 ? '' : 's') + ' urgente' + (urgent.length === 1 ? '' : 's'), meta: urgent[0] ? urgent[0].title : 'Nenhuma no momento' },
      { href: '#estoque/compras', tone: 'warn', ic: 'cart', title: pend.length ? 'Lista de compras' : 'Lista de compras em dia', meta: pend.length ? pend.length + (pend.length === 1 ? ' item' : ' itens') + ' a receber' + (d.shopping.fromClosing ? ' · fechamento de ' + d.shopping.fromClosing : '') : 'Nada pendente' },
      { href: '#checklists', tone: 'info', ic: 'checklist', title: lateLists.length + (lateLists.length === 1 ? ' checklist em aberto' : ' checklists em aberto'), meta: d.checklists.length ? 'Acompanhe a execução da equipe' : 'Nenhuma rotina criada ainda' }
    ];
    return '<section class="section"><div class="section-head"><h2>Precisa da sua atenção</h2></div><div class="list">' +
      rows.map(function (r) {
        return '<a class="row" href="' + r.href + '" style="text-decoration:none;color:inherit"><div class="tile ' + r.tone + '">' + icon(r.ic) + '</div>' +
          '<div class="grow"><div class="card-title">' + esc(r.title) + '</div><div class="card-meta">' + esc(r.meta) + '</div></div>' + icon('chevronRight', 'sm') + '</a>';
      }).join('') + '</div></section>';
  }

  function unitSheet() {
    var d = DB.get();
    UI.sheet('<h2>Trocar unidade</h2><div class="list">' + d.units.map(function (u) {
      return '<button type="button" class="row" data-u="' + u.id + '"><div class="tile">' + icon('store') + '</div><div class="grow card-title">' + esc(u.name) + '</div>' +
        (u.id === d.user.unit ? icon('check') : '') + '</button>';
    }).join('') + '</div>', function (sheet, close) {
      sheet.querySelectorAll('[data-u]').forEach(function (b) {
        b.addEventListener('click', function () {
          DB.update(function (x) { x.user.unit = b.dataset.u; });
          close(); refresh(); UI.toast('Unidade alterada');
        });
      });
    });
  }

  function agendaSection() {
    var t = Cal.today();
    var now = new Date();
    var nowM = now.getHours() * 60 + now.getMinutes();
    var list = Cal.occurrences(t, t).filter(function (o) { return o.ev.allDay || Cal.mins(o.ev.end) >= nowM; }).slice(0, 3);
    return '<section class="section"><div class="section-head"><h2>Agenda de hoje</h2><a class="btn ghost sm" href="#agenda">Abrir agenda</a></div>' +
      '<div class="list">' + (list.length ? list.map(function (o) {
        var c = Cal.calendar(o.ev.cal);
        return '<a class="row today-ev" href="#agenda" style="text-decoration:none;color:inherit;--c:var(--cal-' + c.color + ')">' +
          '<span class="time num">' + (o.ev.allDay ? 'Dia' : o.ev.start) + '</span><span class="ev-bar"></span>' +
          '<span class="grow"><span class="card-title">' + esc(o.ev.title) + '</span><span class="card-meta" style="display:block">' + Cal.timeRange(o.ev) + (o.ev.place ? ' · ' + esc(o.ev.place) : '') + '</span></span></a>';
      }).join('') : '<div class="row muted">Nada mais na agenda hoje.</div>') + '</div></section>';
  }

  // Sistema recém-configurado: mostra ao gestor os primeiros cadastros que faltam.
  function startCard(d) {
    if (!UI.isManager()) return '';
    var steps = [
      { done: d.products.length > 0, href: '#produtos/novo', ic: 'box', title: 'Cadastrar os produtos do estoque', meta: 'Itens contados no fechamento' },
      { done: d.checklists.length > 0, href: '#checklists/editar', ic: 'checklist', title: 'Criar os checklists', meta: 'Abertura, fechamento e rotinas' }
    ];
    if (UI.isAdmin()) steps.push({ done: d.employees.length > 1, href: '#equipe/novo', ic: 'users', title: 'Cadastrar a equipe', meta: 'Cada pessoa recebe e-mail e senha provisória' });
    if (steps.every(function (s) { return s.done; })) return '';
    var n = steps.filter(function (s) { return s.done; }).length;
    return '<section class="section"><div class="section-head"><h2>Comece por aqui</h2><span class="card-meta num">' + n + ' de ' + steps.length + '</span></div><div class="list">' +
      steps.map(function (s) {
        return '<a class="row" href="' + s.href + '" style="text-decoration:none;color:inherit"><div class="tile ' + (s.done ? 'ok' : 'accent') + '">' + icon(s.done ? 'check' : s.ic) + '</div>' +
          '<div class="grow"><div class="card-title"' + (s.done ? ' style="text-decoration:line-through;color:var(--ink-3)"' : '') + '>' + s.title + '</div><div class="card-meta">' + s.meta + '</div></div>' + (s.done ? '' : icon('chevronRight', 'sm')) + '</a>';
      }).join('') + '</div></section>';
  }

  // Ponto: a ação mais frequente do dia, logo no topo do Início.
  function pontoCard() {
    var emp = Ponto.me();
    if (!emp || emp.ponto === false) return '';
    var st = Ponto.state(emp.id);
    return '<section class="card ponto-mini"><div class="card-row"><div class="tile' + (st.status === 'trabalhando' ? ' ok' : st.status === 'intervalo' ? ' warn' : '') + '">' + icon('clock') + '</div>' +
      '<div class="grow"><div class="card-title">Ponto</div><div class="card-meta">' + PontoUI.statusLine(st, emp).replace(/<[^>]+>/g, '') + '</div></div>' +
      '<a class="btn ghost sm" href="#ponto">Ver</a></div>' +
      (st.stale.length ? '<div class="card-meta" style="color:var(--crit)">' + icon('alert', 'sm') + ' Falta a saída de ' + PontoUI.dayLabel(st.stale[st.stale.length - 1].date) + '. Ajuste em Ver.</div>' : '') +
      '<div class="ponto-mini-actions">' + st.next.map(function (t, i) {
        return '<button type="button" class="btn ' + (i ? '' : 'primary ') + 'block" data-home-punch="' + t + '">' + Ponto.TYPES[t].verb + '</button>';
      }).join('') + '</div></section>';
  }

  Screens.inicio = function () {
    var d = DB.get();
    var manager = UI.isManager();
    // No celular as colunas viram uma pilha só, na ordem: coluna 1, depois coluna 2.
    var cols = manager
      ? [startCard(d) + pontoCard() + managerSummary(d) + closingCard(d), agendaSection() + stockSection(d)]
      : [pontoCard() + closingCard(d) + tasksSection(d), agendaSection() + stockSection(d) + maintSection(d)];
    var html = '<main class="screen wide">' + header(d) +
      '<div class="home-grid"><div class="col">' + cols[0] + '</div><div class="col">' + cols[1] + '</div></div>' +
      '</main>';
    return {
      html: html, tab: 'inicio',
      mount: function (r) {
        r.querySelector('[data-unit]').addEventListener('click', unitSheet);
        r.querySelectorAll('[data-home-punch]').forEach(function (b) { b.addEventListener('click', function () { PontoUI.confirmPunch(Ponto.me().id, b.dataset.homePunch, 'app'); }); });
      }
    };
  };
})();
