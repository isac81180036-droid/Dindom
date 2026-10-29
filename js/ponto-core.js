// Ponto: regras de jornada, horas trabalhadas, banco de horas e atrasos.
// As marcações nunca são alteradas nem apagadas; correções entram como novas marcações do tipo "ajuste".
(function () {
  var TYPES = {
    entrada: { label: 'Entrada', verb: 'Registrar entrada', icon: 'logout' },
    intervalo: { label: 'Saída para intervalo', verb: 'Iniciar intervalo', icon: 'clock' },
    retorno: { label: 'Volta do intervalo', verb: 'Voltar do intervalo', icon: 'refresh' },
    saida: { label: 'Saída', verb: 'Encerrar expediente', icon: 'check' }
  };
  var ORDER = ['entrada', 'intervalo', 'retorno', 'saida'];
  var MAX_SHIFT = 16 * 3600000;   // uma jornada aberta há mais de 16 h é considerada sem saída
  var TOLERANCE = 10;             // minutos de tolerância para atraso

  function hhmm(ts) { var d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function dur(min) {
    min = Math.round(Math.abs(min));
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h' + (m ? String(m).padStart(2, '0') : '') : m + ' min';
  }
  function signed(min) { return (min > 0 ? '+' : min < 0 ? '−' : '') + dur(min); }

  var P = { TYPES: TYPES, ORDER: ORDER, TOLERANCE: TOLERANCE, hhmm: hhmm, dur: dur, signed: signed };

  P.employee = function (id) { return DB.get().employees.filter(function (e) { return e.id === id; })[0]; };
  P.me = function () { return P.employee(DB.get().user.empId); };
  function mins(hm) { var p = String(hm || '0:0').split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function clock(min) { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
  // Minutos entre entrada e saída; saída menor que a entrada é no dia seguinte.
  function span(start, end) { var s = mins(end) - mins(start); return s <= 0 ? s + 1440 : s; }

  // Horário do colaborador: entrada, saída e intervalo (min). Quem ainda não tem horário próprio usa o do turno.
  // hours = horas previstas por dia, já sem o intervalo.
  P.shift = function (emp) {
    var h = emp && emp.horario;
    if (h && h.start && h.end) {
      var pause = Number(h.pause) || 0;
      return { start: h.start, end: h.end, pause: pause, hours: Math.max(0, span(h.start, h.end) - pause) / 60, own: true };
    }
    var s = DB.get().shifts[emp && emp.shift] || DB.get().shifts.Noite;
    return { start: s.start, end: clock(mins(s.start) + s.hours * 60), pause: 0, hours: s.hours };
  };
  // Ex.: "17:30 às 23:30" ou "17:30 às 23:30 · intervalo 15 min".
  P.horarioLabel = function (emp, withPause) {
    var s = P.shift(emp);
    return s.start + ' às ' + s.end + (withPause && s.pause ? ' · intervalo ' + dur(s.pause) : '');
  };
  // Nome do turno pelo horário de entrada (usado em telas antigas e nas exportações).
  P.turnoOf = function (start) { var m = mins(start); return m < 12 * 60 ? 'Manhã' : m < 17 * 60 ? 'Tarde' : 'Noite'; };
  P.span = span;

  // Marcações que valem para a conta. Um ajuste do gerente substitui (replaces) ou anula (removed) uma marcação:
  // a original continua guardada, só sai da conta das horas.
  P.active = function (empId) {
    var all = DB.get().punches.filter(function (p) { return p.emp === empId; }), gone = {};
    all.forEach(function (p) { if (p.replaces) gone[p.replaces] = true; });
    return all.filter(function (p) { return !gone[p.id] && !p.removed; });
  };

  // Agrupa as marcações em jornadas. A jornada pertence ao dia da entrada (a saída pode ser depois da meia-noite).
  P.jornadas = function (empId) {
    var list = P.active(empId).sort(function (a, b) { return a.ts - b.ts; });
    var out = [], cur = null;
    list.forEach(function (p) {
      if (p.type === 'entrada' || !cur || p.ts - cur.start > MAX_SHIFT) {
        cur = { date: DB.iso(new Date(p.ts)), start: p.ts, marks: {}, list: [] };
        out.push(cur);
      }
      cur.marks[p.type] = p; cur.list.push(p);
    });
    return out;
  };

  // Minutos trabalhados: do início até agora (ou até a saída), descontando o intervalo.
  P.worked = function (j, now) {
    now = now || Date.now();
    var m = j.marks, start = m.entrada ? m.entrada.ts : j.start;
    var end = m.saida ? m.saida.ts : (P.isStale(j, now) ? (m.retorno || m.intervalo || m.entrada || {}).ts || start : now);
    var total = end - start;
    if (m.intervalo) total -= ((m.retorno ? m.retorno.ts : (m.saida ? m.saida.ts : (P.isStale(j, now) ? m.intervalo.ts : now))) - m.intervalo.ts);
    return Math.max(0, Math.round(total / 60000));
  };
  P.isStale = function (j, now) { return !j.marks.saida && (now || Date.now()) - j.start > MAX_SHIFT; };

  P.lateBy = function (j, emp) {
    if (!j.marks.entrada) return 0;
    var s = P.shift(emp).start.split(':'), d = new Date(j.marks.entrada.ts);
    var diff = d.getHours() * 60 + d.getMinutes() - (Number(s[0]) * 60 + Number(s[1]));
    return diff > TOLERANCE && diff < 6 * 60 ? diff : 0;
  };

  // Minutos que saiu antes do horário de saída (0 se saiu no horário, depois ou ainda não saiu).
  P.earlyBy = function (j, emp) {
    if (!j.marks.saida) return 0;
    var s = P.shift(emp), d = new Date(j.start);
    var st = s.start.split(':'); d.setHours(+st[0], +st[1], 0, 0);
    var due = d.getTime() + span(s.start, s.end) * 60000;
    var diff = Math.round((due - j.marks.saida.ts) / 60000);
    return diff > TOLERANCE && diff < 12 * 60 ? diff : 0;
  };

  // Situação atual e próximos registros possíveis.
  P.state = function (empId, now) {
    now = now || Date.now();
    var js = P.jornadas(empId), last = js[js.length - 1];
    var open = last && !last.marks.saida && !P.isStale(last, now) ? last : null;
    if (!open) return { status: 'fora', next: ['entrada'], today: last && last.date === DB.iso(new Date(now)) ? last : null, stale: js.filter(function (j) { return P.isStale(j, now); }) };
    var m = open.marks, next;
    if (m.intervalo && !m.retorno) next = ['retorno'];
    else if (m.retorno || m.intervalo) next = ['saida'];
    else next = ['intervalo', 'saida'];
    return { status: m.intervalo && !m.retorno ? 'intervalo' : 'trabalhando', next: next, today: open, stale: js.filter(function (j) { return P.isStale(j, now); }) };
  };

  // Registra uma marcação com número sequencial (NSR) e devolve o registro.
  // geo: resultado da trava de localização ({ dist, acc } ou { trusted: true }), guardado para conferência.
  P.punch = function (empId, type, method, ts, geo) {
    var rec;
    DB.update(function (x) {
      x.punchSeq = (x.punchSeq || 0) + 1;
      var emp = x.employees.filter(function (e) { return e.id === empId; })[0];
      rec = { id: 'pt' + Date.now() + Math.random().toString(36).slice(2, 6), emp: empId, ts: ts || Date.now(), type: type, unit: emp ? emp.unit : x.user.unit, method: method || 'app', nsr: (window.Cloud && Cloud.orgId) ? null : x.punchSeq }; // com servidor, o NSR vem do Supabase
      if (geo) rec.geo = geo;
      x.punches.push(rec);
    });
    if (window.Cloud && Cloud.orgId) Cloud.schedule(true); // ponto vai para o servidor na hora
    return rec;
  };

  // Última vez que o gerente zerou o banco de horas da pessoa (fica em "adjusts", tipo "banco"; desfeito não vale).
  P.bankZero = function (empId) {
    var list = (DB.get().adjusts || []).filter(function (a) { return a.kind === 'banco' && a.emp === empId && a.status === 'aplicado'; });
    return list.sort(function (a, b) { return a.ts - b.ts; })[list.length - 1] || null;
  };

  // Resumo de um período: dias trabalhados, horas, previsto, saldo e atrasos.
  // O saldo (banco de horas) só conta as jornadas que começaram depois do último "zerar banco".
  P.summary = function (empId, from, to) {
    var emp = P.employee(empId), hours = P.shift(emp).hours, zero = P.bankZero(empId);
    var js = P.jornadas(empId).filter(function (j) { return j.date >= from && j.date <= to; });
    var worked = 0, late = 0, lateCount = 0, missing = 0;
    js.forEach(function (j) {
      worked += P.worked(j);
      var l = P.lateBy(j, emp); if (l) { late += l; lateCount++; }
      if (P.isStale(j)) missing++;
    });
    var done = js.filter(function (j) { return j.marks.saida; });
    var expected = done.length * hours * 60;
    var counted = done.filter(function (j) { return !zero || j.start >= zero.ts; });
    var balance = counted.reduce(function (s, j) { return s + P.worked(j); }, 0) - counted.length * hours * 60;
    return { days: js.length, worked: worked, expected: expected, balance: balance, late: late, lateCount: lateCount, missing: missing, jornadas: js, zero: zero };
  };

  // Banco de horas acumulado (desde o último "zerar banco", ou desde o primeiro registro).
  P.bankTotal = function (empId) { return P.summary(empId, '0000-01-01', DB.iso(new Date())).balance; };

  // Corrige um dia (gerente): times = { entrada: 'HH:MM' ou '', intervalo, retorno, saida }.
  // Horário novo vira marcação "ajuste" que substitui a original; campo vazio anula a marcação daquele tipo.
  // Devolve quantas marcações mudaram, ou { error }.
  P.editDay = function (empId, date, times, reason, by) {
    var j = P.jornadas(empId).filter(function (x) { return x.date === date; })[0];
    var p = date.split('-'), base = new Date(+p[0], p[1] - 1, +p[2]);
    function tsOf(hm) { var t = hm.split(':'), d = new Date(base); d.setHours(+t[0], +t[1], 0, 0); return d.getTime(); }
    var ts = {};
    // Todos os campos vazios: anula o dia inteiro (ex.: ponto batido por engano numa folga).
    if (ORDER.some(function (t) { return times[t]; })) {
      if (!times.entrada) return { error: 'Informe o horário de entrada.' };
      if (times.retorno && !times.intervalo) return { error: 'Há volta do intervalo sem a saída para o intervalo.' };
      var start = tsOf(times.entrada), last = start;
      if (start > Date.now()) return { error: 'Essa entrada ainda não aconteceu.' };
      for (var i = 0; i < ORDER.length; i++) {
        var t = ORDER[i]; if (!times[t]) continue;
        var v = tsOf(times[t]);
        if (t !== 'entrada' && v <= start) v += 86400000; // depois da meia-noite: dia seguinte
        if (t !== 'entrada' && v <= last) return { error: TYPES[t].label + ' precisa ser depois do registro anterior.' };
        if (v - start > MAX_SHIFT) return { error: 'A jornada passa de 16 horas. Confira os horários.' };
        ts[t] = v; last = v;
      }
    } else if (!j) return { error: 'Informe pelo menos a entrada.' };
    var changes = [];
    ORDER.forEach(function (t) {
      var orig = j && j.marks[t];
      if (ts[t] && (!orig || orig.ts !== ts[t])) changes.push({ type: t, ts: ts[t], replaces: orig ? orig.id : null });
      else if (!ts[t] && orig) changes.push({ type: t, ts: orig.ts, replaces: orig.id, removed: true });
    });
    changes.forEach(function (c) {
      var rec = P.punch(empId, c.type, 'ajuste', c.ts);
      DB.update(function (x) {
        var r = x.punches.filter(function (y) { return y.id === rec.id; })[0];
        r.adjust = { reason: reason, by: by, at: Date.now() };
        if (c.replaces) r.replaces = c.replaces;
        if (c.removed) r.removed = true;
      });
    });
    if (changes.length && window.Cloud && Cloud.orgId) Cloud.schedule(true);
    return changes.length;
  };

  P.comprovante = function (rec) {
    var emp = P.employee(rec.emp), unit = DB.get().units.filter(function (u) { return u.id === rec.unit; })[0];
    var d = new Date(rec.ts);
    return 'Comprovante de registro de ponto\nDindom · ' + (unit ? unit.name : '') + '\nColaborador: ' + (emp ? emp.name : '') +
      '\nRegistro: ' + TYPES[rec.type].label + '\nData: ' + d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR') + '\nNSR: ' + (rec.nsr ? String(rec.nsr).padStart(9, '0') : 'gerando');
  };

  window.Ponto = P;
})();
