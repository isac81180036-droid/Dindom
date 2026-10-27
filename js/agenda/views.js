// Agenda: HTML de cada visão. Só gera marcação; os cliques ficam em js/screens/agenda.js.
(function () {
  var esc = UI.esc;
  var HOUR = 48; // altura de uma hora na grade, em px (igual a --hour no CSS)

  function color(e) { return 'var(--cal-' + Cal.colorOf(e) + ')'; }
  function nowMins() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function isPast(o) {
    var t = Cal.today();
    if (o.date !== t) return o.date < t;
    return !o.ev.allDay && Cal.mins(o.ev.end) < nowMins();
  }
  function evAttrs(o, cls) {
    return 'class="' + cls + (isPast(o) ? ' past' : '') + '" data-ev="' + o.ev.id + '" data-date="' + o.date + '" style="--c:' + color(o.ev) + ';';
  }

  var Views = { HOUR: HOUR };

  // Grade de horários para 1, 3 ou 7 dias.
  Views.timeGrid = function (start, count) {
    var days = [];
    for (var i = 0; i < count; i++) days.push(Cal.add(start, i));
    var occ = Cal.occurrences(days[0], days[count - 1]);
    var t = Cal.today();
    var allDay = occ.filter(function (o) { return o.ev.allDay; });

    var head = '<div class="tg-head"><div class="tg-gutter"></div>' + days.map(function (d) {
      var dt = Cal.parse(d);
      return '<button type="button" class="tg-day' + (d === t ? ' today' : '') + '" data-goday="' + d + '" aria-label="' + esc(Cal.dayTitle(d)) + '">' +
        '<span class="dow">' + Cal.WEEK_SHORT[dt.getDay()] + '</span><span class="dnum num">' + dt.getDate() + '</span></button>';
    }).join('') + '</div>';

    var ad = allDay.length ? '<div class="tg-allday"><div class="tg-gutter"></div>' + days.map(function (d) {
      return '<div class="tg-ad-cell">' + allDay.filter(function (o) { return o.date === d; }).map(function (o) {
        return '<button type="button" ' + evAttrs(o, 'chip-ev') + '">' + esc(o.ev.title) + '</button>';
      }).join('') + '</div>';
    }).join('') + '</div>' : '';

    var hours = '<div class="tg-hours">' + Array.apply(null, Array(24)).map(function (_, h) {
      return '<span style="top:' + (h * HOUR) + 'px">' + (h ? String(h).padStart(2, '0') + ':00' : '') + '</span>';
    }).join('') + '</div>';

    var cols = days.map(function (d) {
      var items = Cal.layout(occ.filter(function (o) { return o.date === d; }));
      var evs = items.map(function (it) {
        var h = (it.e - it.s) / 60 * HOUR;
        var short = h < 40;
        return '<button type="button" ' + evAttrs(it.o, 'ev' + (short ? ' short' : '')) +
          'top:' + (it.s / 60 * HOUR) + 'px;height:' + (h - 2) + 'px;left:calc(' + it.col + ' * 100% / ' + it.cols + ');width:calc(100% / ' + it.cols + ' - 3px)">' +
          '<b>' + esc(it.o.ev.title) + '</b>' + (short ? '<span>, ' + it.o.ev.start + '</span>' : '<span class="num">' + Cal.timeRange(it.o.ev) + '</span>') +
          (!short && h > 70 && it.o.ev.place ? '<span>' + esc(it.o.ev.place) + '</span>' : '') + '</button>';
      }).join('');
      var now = d === t ? '<div class="now-line" style="top:' + (nowMins() / 60 * HOUR) + 'px"></div>' : '';
      return '<div class="tg-col' + (d === t ? ' today' : '') + '" data-date="' + d + '">' + evs + now + '</div>';
    }).join('');

    return '<div class="tg" style="--days:' + count + ';--hour:' + HOUR + 'px">' + head + ad +
      '<div class="tg-body">' + hours + cols + '</div></div>';
  };

  // Mês: grade 7 colunas com até N eventos por dia.
  Views.month = function (cursor, maxChips) {
    var first = Cal.parse(cursor); first.setDate(1);
    var firstIso = Cal.iso(first);
    var start = Cal.weekStart(firstIso);
    var dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var rows = Math.ceil((first.getDay() + dim) / 7);
    var end = Cal.add(start, rows * 7 - 1);
    var occ = Cal.occurrences(start, end);
    var t = Cal.today();
    var month = first.getMonth();

    var cells = '';
    for (var i = 0; i < rows * 7; i++) {
      var d = Cal.add(start, i);
      var dt = Cal.parse(d);
      var list = occ.filter(function (o) { return o.date === d; });
      var shown = list.slice(0, maxChips);
      cells += '<div class="mg-cell' + (dt.getMonth() !== month ? ' other' : '') + (d === t ? ' today' : '') + '" data-cell="' + d + '">' +
        '<button type="button" class="mg-num num" data-goday="' + d + '" aria-label="' + esc(Cal.dayTitle(d)) + '">' + dt.getDate() + '</button>' +
        shown.map(function (o) {
          return '<button type="button" ' + evAttrs(o, 'mg-ev' + (o.ev.allDay ? ' allday' : '')) + '">' +
            (o.ev.allDay ? '' : '<i></i><span class="num t">' + o.ev.start + '</span> ') + esc(o.ev.title) + '</button>';
        }).join('') +
        (list.length > maxChips ? '<button type="button" class="mg-more" data-goday="' + d + '">+' + (list.length - maxChips) + ' mais</button>' : '') +
        '</div>';
    }
    return '<div class="mg"><div class="mg-head">' + Cal.WEEK_SHORT.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="mg-grid" style="--rows:' + rows + '">' + cells + '</div></div>';
  };

  // Programação: lista contínua dos próximos dias com eventos.
  Views.list = function (cursor) {
    var from = cursor;
    var to = Cal.add(from, 45);
    var occ = Cal.occurrences(from, to);
    var t = Cal.today();
    var byDate = {};
    occ.forEach(function (o) { (byDate[o.date] = byDate[o.date] || []).push(o); });
    if (!byDate[t] && t >= from) byDate[t] = [];
    var dates = Object.keys(byDate).sort();
    var lastMonth = '';
    return '<div class="ag-list">' + dates.map(function (d) {
      var dt = Cal.parse(d);
      var m = Cal.monthTitle(d);
      var sep = m !== lastMonth ? '<h3 class="ag-month">' + m + '</h3>' : '';
      lastMonth = m;
      return sep + '<section class="ag-day' + (d === t ? ' today' : '') + '" id="ag-' + d + '">' +
        '<button type="button" class="ag-date" data-goday="' + d + '"><span class="dow">' + Cal.WEEK_SHORT[dt.getDay()] + '</span><span class="dnum num">' + dt.getDate() + '</span></button>' +
        '<div class="ag-items">' + (byDate[d].length ? byDate[d].map(function (o) {
          return '<button type="button" ' + evAttrs(o, 'ag-item') + '"><span class="ev-bar"></span><span class="grow"><b>' + esc(o.ev.title) + '</b>' +
            '<span class="card-meta num">' + Cal.timeRange(o.ev) + (o.ev.place ? ' · ' + esc(o.ev.place) : '') + '</span></span></button>';
        }).join('') : '<div class="ag-none">Nada na agenda hoje</div>') + '</div></section>';
    }).join('') + '</div>';
  };

  // Minicalendário (painel lateral no computador, seletor no celular).
  Views.mini = function (monthCursor, selected) {
    var first = Cal.parse(monthCursor); first.setDate(1);
    var start = Cal.weekStart(Cal.iso(first));
    var t = Cal.today();
    var end = Cal.add(start, 41);
    var has = {};
    Cal.occurrences(start, end).forEach(function (o) { has[o.date] = true; });
    var cells = '';
    for (var i = 0; i < 42; i++) {
      var d = Cal.add(start, i);
      var dt = Cal.parse(d);
      cells += '<button type="button" data-goday="' + d + '" class="' + (dt.getMonth() !== first.getMonth() ? 'other ' : '') + (d === t ? 'today ' : '') + (d === selected ? 'sel ' : '') + (has[d] ? 'has' : '') + '">' + dt.getDate() + '</button>';
    }
    return '<div class="mini"><div class="mini-head"><b>' + Cal.monthTitle(Cal.iso(first)) + '</b>' +
      '<button type="button" class="icon-btn plain" data-mini="-1" aria-label="Mês anterior">' + icon('chevronLeft', 'sm') + '</button>' +
      '<button type="button" class="icon-btn plain" data-mini="1" aria-label="Próximo mês">' + icon('chevronRight', 'sm') + '</button></div>' +
      '<div class="mini-grid">' + ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + cells + '</div></div>';
  };

  window.CalViews = Views;
})();
