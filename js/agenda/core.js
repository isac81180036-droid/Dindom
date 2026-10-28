// Agenda: datas, repetições e posicionamento de eventos sobrepostos.
(function () {
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var WEEK_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return DB.iso(d); }
  function add(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function today() { return iso(new Date()); }
  function weekStart(s) { var d = parse(s); return add(s, -d.getDay()); }
  function mins(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }

  var Cal = {
    MONTHS: MONTHS, WEEK: WEEK, WEEK_SHORT: WEEK_SHORT,
    parse: parse, iso: iso, add: add, today: today, weekStart: weekStart, mins: mins, hhmm: hhmm,

    monthTitle: function (s) { var d = parse(s); return MONTHS[d.getMonth()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' de ' + d.getFullYear(); },
    dayTitle: function (s) { var d = parse(s); return WEEK[d.getDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + ', ' + d.getDate() + ' de ' + MONTHS[d.getMonth()]; },
    timeRange: function (e) { return e.allDay ? 'Dia inteiro' : e.start + ' – ' + e.end; },
    repeatLabel: function (e) {
      if (e.repeat === 'daily') return 'Todos os dias';
      if (e.repeat === 'weekly') return 'Toda ' + WEEK[parse(e.date).getDay()];
      return '';
    },

    calendar: function (id) { return DB.get().calendars.filter(function (c) { return c.id === id; })[0] || DB.get().calendars[0]; },
    // Cores que o evento pode ter; sem cor própria, o evento usa a cor da agenda.
    COLORS: [[1, 'Laranja'], [2, 'Azul'], [3, 'Roxo'], [4, 'Verde'], [5, 'Rosa'], [6, 'Vermelho'], [7, 'Amarelo'], [8, 'Grafite']],
    colorOf: function (e) { return e.color || Cal.calendar(e.cal).color; },
    // Cor para o CSS. Reserva pelo link público tem cor própria (dourado), diferente de todas as agendas.
    css: function (e) { return e.reserva ? 'var(--rv)' : 'var(--cal-' + Cal.colorOf(e) + ')'; },

    // Ocorrências visíveis entre duas datas (inclusive), já expandindo repetições.
    occurrences: function (from, to) {
      var d = DB.get();
      var hidden = d.prefs.hiddenCals || {};
      var out = [];
      d.events.forEach(function (e) {
        if (hidden[e.cal]) return;
        if (e.repeat === 'none') {
          if (e.date >= from && e.date <= to) out.push({ ev: e, date: e.date });
          return;
        }
        var step = e.repeat === 'daily' ? 1 : 7;
        var first = e.date;
        if (first < from) first = add(e.date, Math.ceil(diffDays(e.date, from) / step) * step);
        for (var s = first; s <= to; s = add(s, step)) out.push({ ev: e, date: s });
      });
      return out.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (!!a.ev.allDay !== !!b.ev.allDay) return a.ev.allDay ? -1 : 1;
        return (a.ev.start || '') < (b.ev.start || '') ? -1 : 1;
      });
    },

    // Distribui eventos sobrepostos em colunas lado a lado, como no Google Agenda.
    layout: function (list) {
      var items = list.filter(function (o) { return !o.ev.allDay; }).map(function (o) {
        var s = mins(o.ev.start), e = Math.max(mins(o.ev.end), s + 20);
        return { o: o, s: s, e: e, col: 0, cols: 1 };
      }).sort(function (a, b) { return a.s - b.s || b.e - a.e; });

      var group = [], groupEnd = -1;
      function close() {
        var colsEnd = [];
        group.forEach(function (it) {
          var c = 0;
          while (colsEnd[c] > it.s) c++;
          it.col = c;
          colsEnd[c] = it.e;
        });
        group.forEach(function (it) { it.cols = colsEnd.length; });
        group = [];
      }
      items.forEach(function (it) {
        if (it.s >= groupEnd) { close(); groupEnd = -1; }
        group.push(it);
        groupEnd = Math.max(groupEnd, it.e);
      });
      close();
      return items;
    }
  };

  window.Cal = Cal;
})();
