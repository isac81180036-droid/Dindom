// Ponto › Equipe (gerente e admin): quem está trabalhando, atrasos, ajustes e relatório do mês.
(function () {
  var esc = UI.esc, P = window.Ponto;
  var unitFilter = 'todas';

  function initials(n) { var p = n.trim().split(/\s+/); return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }
  function unitShort(id) { var u = DB.get().units.filter(function (x) { return x.id === id; })[0]; return u ? u.name.replace('Unidade ', '') : ''; }
  function shiftStartTs(emp) { var s = P.shift(emp).start.split(':'), d = new Date(); d.setHours(+s[0], +s[1], 0, 0); return d.getTime(); }

  // Situação de cada pessoa hoje, na linguagem do dia a dia da loja.
  function today(emp) {
    var st = P.state(emp.id), j = st.today, now = Date.now();
    var dow = new Date().getDay();
    if (st.status === 'trabalhando') return { key: 'on', label: 'Trabalhando desde ' + P.hhmm(j.marks.entrada ? j.marks.entrada.ts : j.start), late: P.lateBy(j, emp), j: j };
    if (st.status === 'intervalo') return { key: 'pause', label: 'Em intervalo desde ' + P.hhmm(j.marks.intervalo.ts), late: P.lateBy(j, emp), j: j };
    if (j && j.marks.saida) return { key: 'done', label: 'Saiu às ' + P.hhmm(j.marks.saida.ts), late: P.lateBy(j, emp), j: j };
    if (dow === 1) return { key: 'off', label: 'Folga' };
    var start = shiftStartTs(emp);
    if (now > start + P.TOLERANCE * 60000) return { key: 'missing', label: 'Não chegou · entrada ' + P.shift(emp).start, late: Math.round((now - start) / 60000) };
    return { key: 'later', label: 'Entra às ' + P.shift(emp).start };
  }
  var PILL = { on: ['ok', 'Trabalhando'], pause: ['info', 'Intervalo'], done: ['', 'Encerrou'], off: ['', 'Folga'], missing: ['crit', 'Atrasado'], later: ['', 'Mais tarde'] };

  function approve(a, ok) {
    var emp = P.employee(a.emp);
    if (!ok) {
      DB.update(function (x) { var r = x.adjusts.filter(function (y) { return y.id === a.id; })[0]; r.status = 'recusado'; r.by = x.user.name; r.decidedAt = Date.now(); });
      refresh(); UI.toast('Ajuste recusado. ' + emp.name.split(' ')[0] + ' será avisado.'); return;
    }
    // O ajuste entra como uma marcação nova (método "ajuste"); a original, se houver, continua guardada.
    var t = a.time.split(':'), day = Cal.parse(a.date); day.setHours(+t[0], +t[1], 0, 0);
    var ts = day.getTime();
    var j = P.jornadas(a.emp).filter(function (x) { return x.date === a.date; })[0];
    if (j && a.type !== 'entrada' && ts < j.start) ts += 86400000; // saída depois da meia-noite pertence ao dia seguinte
    var rec = P.punch(a.emp, a.type, 'ajuste', ts);
    DB.update(function (x) {
      var p = x.punches.filter(function (y) { return y.id === rec.id; })[0]; p.adjust = { reason: a.reason, by: x.user.name, request: a.id };
      var r = x.adjusts.filter(function (y) { return y.id === a.id; })[0]; r.status = 'aprovado'; r.by = x.user.name; r.decidedAt = Date.now();
    });
    refresh(); UI.toast('Ajuste aprovado e registrado (NSR ' + rec.nsr + ')');
  }

  function report(list, from, to) {
    var lines = ['Colaborador;Função;Unidade;Dias;Horas trabalhadas;Horas previstas;Banco de horas;Atrasos;Dias sem saída'];
    list.forEach(function (e) {
      var s = P.summary(e.id, from, to);
      lines.push([e.name, e.func, unitShort(e.unit), s.days, P.dur(s.worked), P.dur(s.expected), P.signed(s.balance) || '0', s.lateCount, s.missing].join(';'));
    });
    return 'Espelho de ponto Dindom · ' + from.split('-').reverse().join('/') + ' a ' + to.split('-').reverse().join('/') + '\n' + lines.join('\n');
  }

  function detailSheet(emp) {
    var s = P.summary(emp.id, Cal.today().slice(0, 8) + '01', Cal.today());
    UI.sheet('<div class="card-row"><span class="avatar">' + esc(initials(emp.name)) + '</span><div class="grow"><h2 style="font-size:var(--fs-lg)">' + esc(emp.name) + '</h2>' +
      '<div class="card-meta">' + esc(emp.func) + ' · turno ' + esc(emp.shift.toLowerCase()) + ' · ' + esc(unitShort(emp.unit)) + '</div></div></div>' +
      '<div class="stat-grid three"><div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + P.dur(s.worked) + '</div><div class="card-meta">no mês</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num ' + (s.balance >= 0 ? 'pos' : 'neg') + '">' + P.signed(s.balance) + '</div><div class="card-meta">banco</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + s.lateCount + '</div><div class="card-meta">atrasos</div></div></div>' +
      PontoUI.historyRows(emp.id, false) + '<button type="button" class="btn block" data-close>Fechar</button>');
  }

  Screens.ponto_equipe = function () {
    if (!UI.isManager()) return Screens.ponto([]);
    var d = DB.get();
    var emps = d.employees.filter(function (e) { return e.active && e.ponto !== false && (unitFilter === 'todas' || e.unit === unitFilter); });
    var rows = emps.map(function (e) { return { e: e, t: today(e) }; });
    var count = function (k) { return rows.filter(function (r) { return r.t.key === k; }).length; };
    var order = { missing: 0, on: 1, pause: 2, later: 3, done: 4, off: 5 };
    rows.sort(function (a, b) { return order[a.t.key] - order[b.t.key] || a.e.name.localeCompare(b.e.name); });
    var pend = d.adjusts.filter(function (a) { return a.status === 'pendente'; });
    var from = Cal.today().slice(0, 8) + '01', to = Cal.today();

    var html = '<main class="screen wide">' + UI.topbar('Ponto da equipe', { sub: 'Hoje, ' + new Date().toLocaleDateString('pt-BR') }) +
      (P.me() && P.me().ponto !== false ? '<div class="seg" style="max-width:360px"><button type="button" data-mine aria-pressed="false">Meu ponto</button><button type="button" aria-pressed="true">Equipe</button></div>' : '') +
      '<div class="stat-grid four">' +
      '<div class="card"><div class="stat num">' + count('on') + '</div><div class="card-meta">trabalhando agora</div></div>' +
      '<div class="card"><div class="stat num">' + count('pause') + '</div><div class="card-meta">em intervalo</div></div>' +
      '<div class="card"><div class="stat num' + (count('missing') ? ' neg' : '') + '">' + count('missing') + '</div><div class="card-meta">atrasados sem registro</div></div>' +
      '<div class="card"><div class="stat num">' + pend.length + '</div><div class="card-meta">ajustes para aprovar</div></div></div>' +
      '<div class="chips" role="toolbar" aria-label="Unidade">' + [{ id: 'todas', name: 'Todas as unidades' }].concat(d.units).map(function (u) {
        return '<button type="button" class="chip" data-uf="' + u.id + '" aria-pressed="' + (unitFilter === u.id) + '">' + esc(u.name.replace('Unidade ', '')) + '</button>';
      }).join('') + '</div>' +

      (pend.length ? '<section class="section"><div class="section-head"><h2>Ajustes para aprovar</h2></div><div class="card-grid">' + pend.map(function (a) {
        var e = P.employee(a.emp);
        return '<div class="card"><div class="card-row"><span class="avatar sm">' + esc(initials(e.name)) + '</span><div class="grow"><div class="card-title">' + esc(e.name) + '</div>' +
          '<div class="card-meta">' + esc(P.TYPES[a.type].label) + ' · ' + PontoUI.dayLabel(a.date) + ' às <b class="num">' + esc(a.time) + '</b></div></div></div>' +
          '<p class="muted">“' + esc(a.reason) + '”</p>' +
          '<div class="card-row"><button type="button" class="btn sm" data-rej="' + a.id + '">Recusar</button><button type="button" class="btn sm primary" data-apr="' + a.id + '">Aprovar ajuste</button></div></div>';
      }).join('') + '</div></section>' : '') +

      '<section class="section"><div class="section-head"><h2>Agora</h2></div><div class="card-grid">' + rows.map(function (r) {
        var pill = PILL[r.t.key];
        return '<button type="button" class="card tap team-card" data-emp="' + r.e.id + '"><div class="card-row"><span class="avatar sm">' + esc(initials(r.e.name)) + '</span>' +
          '<div class="grow"><div class="card-title">' + esc(r.e.name) + '</div><div class="card-meta">' + esc(r.e.func) + ' · ' + esc(unitShort(r.e.unit)) + '</div></div>' +
          '<span class="pill ' + pill[0] + '">' + pill[1] + '</span></div>' +
          '<div class="card-meta">' + esc(r.t.label) + (r.t.j ? ' · ' + P.dur(P.worked(r.t.j)) + ' hoje' : '') + '</div>' +
          (r.t.late && r.t.key !== 'missing' ? '<span class="pill warn no-dot" style="align-self:flex-start">Chegou ' + r.t.late + ' min atrasado</span>' : '') + '</button>';
      }).join('') + '</div></section>' +

      '<section class="section"><div class="section-head"><h2>Mês até hoje</h2><button type="button" class="btn ghost sm" data-report>' + icon('copy', 'sm') + 'Copiar relatório</button></div>' +
      '<div class="table-wrap"><table class="ponto-table"><thead><tr><th>Colaborador</th><th>Dias</th><th>Horas</th><th>Banco</th><th>Atrasos</th></tr></thead><tbody>' +
      emps.map(function (e) {
        var s = P.summary(e.id, from, to);
        return '<tr data-emp="' + e.id + '"><td><b>' + esc(e.name) + '</b><span class="card-meta">' + esc(e.func) + '</span></td><td class="num">' + s.days + '</td><td class="num">' + P.dur(s.worked) + '</td>' +
          '<td class="num ' + (s.balance >= 0 ? 'pos' : 'neg') + '">' + (P.signed(s.balance) || '0') + '</td><td class="num">' + s.lateCount + (s.missing ? ' <span class="pill crit no-dot">' + s.missing + ' sem saída</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section></main>';

    return {
      html: html, tab: 'ponto',
      mount: function (root) {
        root.addEventListener('click', function (e) {
          var t = e.target;
          if (t.closest('[data-mine]')) return go('ponto');
          var uf = t.closest('[data-uf]'); if (uf) { unitFilter = uf.dataset.uf; return refresh(); }
          var apr = t.closest('[data-apr]'), rej = t.closest('[data-rej]');
          if (apr || rej) {
            var a = DB.get().adjusts.filter(function (x) { return x.id === (apr || rej).dataset[apr ? 'apr' : 'rej']; })[0];
            if (apr) return UI.confirm({ title: 'Aprovar ajuste?', body: 'Será registrada a ' + esc(P.TYPES[a.type].label.toLowerCase()) + ' de ' + esc(P.employee(a.emp).name.split(' ')[0]) + ' em ' + PontoUI.dayLabel(a.date) + ' às ' + esc(a.time) + '. Fica marcado como ajuste.', ok: 'Aprovar', onOk: function () { approve(a, true); } });
            return approve(a, false);
          }
          if (t.closest('[data-report]')) {
            try { navigator.clipboard.writeText(report(emps, from, to)).then(function () { UI.toast('Relatório copiado. Cole numa planilha ou mande ao contador.'); }, function () { UI.toast('Não foi possível copiar.', { tone: 'crit' }); }); }
            catch (er) { UI.toast('Não foi possível copiar.', { tone: 'crit' }); }
            return;
          }
          var em = t.closest('[data-emp]'); if (em) detailSheet(P.employee(em.dataset.emp));
        });
      }
    };
  };
})();
