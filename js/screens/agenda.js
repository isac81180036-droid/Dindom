// Agenda: tela no estilo Google Agenda (dia, semana/3 dias, mês, programação).
(function () {
  var esc = UI.esc;
  var state = { view: null, cursor: null, mini: null };

  function desktop() { return window.isDesktop(); }
  function views() {
    return desktop()
      ? [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['lista', 'Programação']]
      : [['lista', 'Programação'], ['dia', 'Dia'], ['semana', '3 dias'], ['mes', 'Mês']];
  }
  function ensure() {
    if (!state.cursor) state.cursor = Cal.today();
    if (!state.mini) state.mini = state.cursor;
    // Lembra a última visão usada (uma para celular, outra para computador). Padrão: grade de horários, onde dá para arrastar.
    var saved = (DB.get().prefs.agendaView || {})[desktop() ? 'd' : 'm'];
    if (!state.view) state.view = saved || 'semana';
  }
  function setView(v) {
    state.view = v;
    DB.update(function (x) { x.prefs.agendaView = x.prefs.agendaView || {}; x.prefs.agendaView[desktop() ? 'd' : 'm'] = v; });
  }
  function hint() {
    if (DB.get().prefs.agendaHintSeen || state.view === 'mes' || state.view === 'lista') return '';
    return '<div class="ag-hint" role="note">' + icon('sparkle', 'sm') +
      '<span class="grow">' + (desktop() ? 'Clique e arraste num horário para criar um evento.' : 'Segure num horário e arraste para criar um evento.') + '</span>' +
      '<button type="button" class="icon-btn plain" data-hint-off aria-label="Fechar dica">' + icon('x', 'sm') + '</button></div>';
  }

  // Primeiro dia exibido e quantidade de dias na grade de horários.
  function span() {
    if (state.view === 'dia') return [state.cursor, 1];
    return desktop() ? [Cal.weekStart(state.cursor), 7] : [state.cursor, 3];
  }

  function title() {
    // Celular: só o mês (e o ano, quando não for o atual), para caber ao lado dos controles.
    if (!desktop()) {
      var c = Cal.parse(state.view === 'semana' ? span()[0] : state.cursor);
      var m = Cal.MONTHS[c.getMonth()].replace(/^./, function (x) { return x.toUpperCase(); });
      return c.getFullYear() === new Date().getFullYear() ? m : m + ' ' + c.getFullYear();
    }
    if (state.view === 'dia') return desktop() ? Cal.dayTitle(state.cursor) + ' de ' + Cal.parse(state.cursor).getFullYear() : Cal.monthTitle(state.cursor);
    if (state.view === 'semana') {
      var s = span(), a = Cal.parse(s[0]), b = Cal.parse(Cal.add(s[0], s[1] - 1));
      if (a.getMonth() === b.getMonth()) return Cal.monthTitle(s[0]);
      return Cal.MONTHS[a.getMonth()].slice(0, 3) + ' – ' + Cal.MONTHS[b.getMonth()].slice(0, 3) + ' de ' + b.getFullYear();
    }
    return Cal.monthTitle(state.cursor);
  }

  function step(dir) {
    if (state.view === 'dia') state.cursor = Cal.add(state.cursor, dir);
    else if (state.view === 'semana') state.cursor = Cal.add(state.cursor, dir * (desktop() ? 7 : 3));
    else if (state.view === 'lista') state.cursor = Cal.add(state.cursor, dir * 7);
    else { var d = Cal.parse(state.cursor); d.setDate(1); d.setMonth(d.getMonth() + dir); state.cursor = Cal.iso(d); }
    state.mini = state.cursor;
  }

  function body() {
    if (state.view === 'mes') return CalViews.month(state.cursor, desktop() ? 3 : 2);
    if (state.view === 'lista') return CalViews.list(state.cursor);
    var s = span();
    return CalViews.timeGrid(s[0], s[1]);
  }

  function calFilters() {
    var d = DB.get();
    return '<div class="cal-filters">' + d.calendars.map(function (c) {
      var on = !d.prefs.hiddenCals[c.id];
      return '<label class="cal-filter" style="--c:var(--cal-' + c.color + ')"><input type="checkbox" data-calfilter="' + c.id + '"' + (on ? ' checked' : '') + '><span class="box-c">' + icon('check', 'sm') + '</span>' + esc(c.name) + '</label>';
    }).join('') + '</div>';
  }

  function newEvent(date, startMin) {
    if (startMin == null) {
      var n = new Date();
      startMin = date === Cal.today() ? Math.min((n.getHours() + 1) * 60, 22 * 60) : 9 * 60;
    }
    CalForm.edit({ date: date, start: Cal.hhmm(startMin), end: Cal.hhmm(Math.min(startMin + 60, 23 * 60 + 45)) });
  }

  function rerender() { go('agenda', { replace: true }); }

  window.Agenda = { focus: function (date) { ensure(); state.cursor = date; state.mini = date; } };

  Screens.agenda = function () {
    ensure();
    var html = '<main class="screen full agenda-screen"><div class="ag-layout">' +
      '<aside class="ag-side desk-only">' +
      '<button type="button" class="btn primary" data-new style="align-self:flex-start;min-height:52px;padding:0 24px">' + icon('plus') + 'Criar</button>' +
      CalViews.mini(state.mini, state.cursor) +
      '<div class="section"><div class="eyebrow">Minhas agendas</div>' + calFilters() + '</div></aside>' +

      '<section class="ag-main">' +
      '<header class="ag-bar">' +
      '<button type="button" class="ag-title" data-pick><h1>' + esc(title()) + '</h1><span class="mobile-only">' + icon('chevronDown', 'sm') + '</span></button>' +
      '<span class="grow"></span>' +
      '<button type="button" class="btn sm" data-today>Hoje</button>' +
      '<button type="button" class="icon-btn plain" data-nav="-1" aria-label="Anterior">' + icon('chevronLeft') + '</button>' +
      '<button type="button" class="icon-btn plain" data-nav="1" aria-label="Próximo">' + icon('chevronRight') + '</button>' +
      '<div class="seg ag-views desk-only">' + views().map(function (v) {
        return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (state.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="icon-btn plain mobile-only" data-filters aria-label="Escolher agendas">' + icon('calendar') + '</button>' +
      '</header>' +
      '<div class="chips mobile-only" role="toolbar" aria-label="Visualização">' + views().map(function (v) {
        return '<button type="button" class="chip" data-view="' + v[0] + '" aria-pressed="' + (state.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div>' +
      hint() + (window.Reservas ? Reservas.conflictBanner() : '') +
      '<div class="ag-view view-' + state.view + '" data-scroll>' + body() + '</div>' +
      '</section></div></main>' +
      '<button type="button" class="fab mobile-only" data-new aria-label="Criar evento">' + icon('plus') + '</button>';

    return {
      html: html, tab: desktop() ? 'agenda' : 'inicio',
      mount: function (root) {
        var scroller = root.querySelector('[data-scroll]');
        // Abre a grade perto do horário útil: hora atual se hoje estiver na tela, senão 7h.
        if (scroller.querySelector('.tg')) {
          var now = scroller.querySelector('.now-line');
          var top = now ? Math.max(0, parseFloat(now.style.top) - 2 * CalViews.HOUR) : 7 * CalViews.HOUR;
          scroller.scrollTop = top;
          // Repete após o primeiro desenho, quando a altura final da área já está calculada.
          requestAnimationFrame(function () { scroller.scrollTop = top; });

          // Pressionar e arrastar num horário vazio cria o evento; o bloco fica na grade até o painel fechar.
          CalDrag.attach(scroller, function (date, s, e, ghost) {
            // Já aprendeu o gesto: a dica não aparece mais.
            if (!DB.get().prefs.agendaHintSeen) { DB.update(function (x) { x.prefs.agendaHintSeen = true; }); var h = root.querySelector('.ag-hint'); if (h) h.remove(); }
            CalForm.edit({ date: date, start: Cal.hhmm(s), end: Cal.hhmm(Math.min(e, 1439)) }, function () { ghost.remove(); });
          });
        }

        root.addEventListener('click', function (e) {
          var t = e.target;
          var ev = t.closest('[data-ev]');
          if (ev) return CalForm.detail(ev.dataset.ev, ev.dataset.date);
          var rv = t.closest('[data-rv]');
          if (rv) return Reservas.open(rv.dataset.rv);
          var g = t.closest('[data-goday]');
          if (g) {
            state.cursor = g.dataset.goday; state.mini = state.cursor;
            if (!t.closest('.mini')) state.view = 'dia';
            return rerender();
          }
          var m = t.closest('[data-mini]');
          if (m) { var d = Cal.parse(state.mini); d.setDate(1); d.setMonth(d.getMonth() + Number(m.dataset.mini)); state.mini = Cal.iso(d); return rerender(); }
          var v = t.closest('[data-view]');
          if (v) { setView(v.dataset.view); return rerender(); }
          if (t.closest('[data-hint-off]')) { DB.update(function (x) { x.prefs.agendaHintSeen = true; }); var h = root.querySelector('.ag-hint'); if (h) h.remove(); return; }
          var n = t.closest('[data-nav]');
          if (n) { step(Number(n.dataset.nav)); return rerender(); }
          if (t.closest('[data-today]')) { state.cursor = Cal.today(); state.mini = state.cursor; return rerender(); }
          if (t.closest('[data-new]')) return newEvent(state.view === 'mes' || state.view === 'lista' ? (state.cursor < Cal.today() ? Cal.today() : state.cursor) : state.cursor);
          if (t.closest('[data-pick]') && !desktop()) return pickSheet();
          if (t.closest('[data-filters]')) return filterSheet();

          // Horário vazio na grade: tratado em js/agenda/drag.js (toque, clique ou arraste).
          var cell = t.classList.contains('mg-cell') ? t : null;
          if (cell) {
            if (desktop()) return newEvent(cell.dataset.cell, 9 * 60);
            state.cursor = cell.dataset.cell; state.view = 'dia'; return rerender();
          }
        });
        bindFilters(root);
      }
    };
  };

  function bindFilters(scope) {
    scope.querySelectorAll('[data-calfilter]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        DB.update(function (x) { x.prefs.hiddenCals[cb.dataset.calfilter] = !cb.checked; });
        var view = document.querySelector('.ag-view');
        if (view) view.innerHTML = body();
      });
    });
  }

  function pickSheet() {
    UI.sheet('<div data-pickbox>' + CalViews.mini(state.mini, state.cursor) + '</div>', function (sheet, close) {
      sheet.addEventListener('click', function (e) {
        var m = e.target.closest('[data-mini]');
        if (m) {
          var d = Cal.parse(state.mini); d.setDate(1); d.setMonth(d.getMonth() + Number(m.dataset.mini)); state.mini = Cal.iso(d);
          sheet.querySelector('[data-pickbox]').innerHTML = CalViews.mini(state.mini, state.cursor);
          return;
        }
        var g = e.target.closest('[data-goday]');
        if (g) { state.cursor = g.dataset.goday; state.mini = state.cursor; close(); rerender(); }
      });
    });
  }

  function filterSheet() {
    UI.sheet('<h2>Agendas</h2><p class="muted">Escolha o que aparece na sua agenda.</p>' + calFilters() +
      '<button type="button" class="btn primary block" data-close>Pronto</button>', function (sheet) { bindFilters(sheet); });
  }
})();
