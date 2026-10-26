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
  P.shift = function (emp) { return DB.get().shifts[emp.shift] || DB.get().shifts.Noite; };

  // Agrupa as marcações em jornadas. A jornada pertence ao dia da entrada (a saída pode ser depois da meia-noite).
  P.jornadas = function (empId) {
    var list = DB.get().punches.filter(function (p) { return p.emp === empId; }).sort(function (a, b) { return a.ts - b.ts; });
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
  P.punch = function (empId, type, method, ts) {
    var rec;
    DB.update(function (x) {
      x.punchSeq = (x.punchSeq || 0) + 1;
      var emp = x.employees.filter(function (e) { return e.id === empId; })[0];
      rec = { id: 'pt' + Date.now() + Math.random().toString(36).slice(2, 6), emp: empId, ts: ts || Date.now(), type: type, unit: emp ? emp.unit : x.user.unit, method: method || 'app', nsr: (window.Cloud && Cloud.orgId) ? null : x.punchSeq }; // com servidor, o NSR vem do Supabase
      x.punches.push(rec);
    });
    if (window.Cloud && Cloud.orgId) Cloud.schedule(true); // ponto vai para o servidor na hora
    return rec;
  };

  // Resumo de um período: dias trabalhados, horas, previsto, saldo e atrasos.
  P.summary = function (empId, from, to) {
    var emp = P.employee(empId), hours = P.shift(emp).hours;
    var js = P.jornadas(empId).filter(function (j) { return j.date >= from && j.date <= to; });
    var worked = 0, late = 0, lateCount = 0, missing = 0;
    js.forEach(function (j) {
      worked += P.worked(j);
      var l = P.lateBy(j, emp); if (l) { late += l; lateCount++; }
      if (P.isStale(j)) missing++;
    });
    var done = js.filter(function (j) { return j.marks.saida; }).length;
    var expected = done * hours * 60;
    var workedDone = js.filter(function (j) { return j.marks.saida; }).reduce(function (s, j) { return s + P.worked(j); }, 0);
    return { days: js.length, worked: worked, expected: expected, balance: workedDone - expected, late: late, lateCount: lateCount, missing: missing, jornadas: js };
  };

  P.comprovante = function (rec) {
    var emp = P.employee(rec.emp), unit = DB.get().units.filter(function (u) { return u.id === rec.unit; })[0];
    var d = new Date(rec.ts);
    return 'Comprovante de registro de ponto\nDindom · ' + (unit ? unit.name : '') + '\nColaborador: ' + (emp ? emp.name : '') +
      '\nRegistro: ' + TYPES[rec.type].label + '\nData: ' + d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR') + '\nNSR: ' + (rec.nsr ? String(rec.nsr).padStart(9, '0') : 'gerando');
  };

  window.Ponto = P;
})();
