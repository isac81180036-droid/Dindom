// Ponto: bater o ponto, comprovante, espelho dos últimos dias e pedido de ajuste.
(function () {
  var esc = UI.esc, P = window.Ponto;
  var WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  function clockParts(d) {
    return { hm: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), s: String(d.getSeconds()).padStart(2, '0') };
  }
  function dayLabel(iso) { var d = Cal.parse(iso); return WD[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }
  function unitName(id) { var u = DB.get().units.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }

  function statusLine(st, emp) {
    var j = st.today;
    if (st.status === 'trabalhando') return 'Trabalhando desde ' + P.hhmm(j.marks.entrada ? j.marks.entrada.ts : j.start) + ' · <span data-worked>' + P.dur(P.worked(j)) + '</span> hoje';
    if (st.status === 'intervalo') return 'Em intervalo desde ' + P.hhmm(j.marks.intervalo.ts) + ' · <span data-worked>' + P.dur(P.worked(j)) + '</span> trabalhadas';
    if (j && j.marks.saida) return 'Expediente encerrado às ' + P.hhmm(j.marks.saida.ts) + ' · ' + P.dur(P.worked(j)) + ' hoje';
    return 'Você ainda não registrou o ponto hoje · turno ' + esc(emp.shift.toLowerCase()) + ', entrada ' + P.shift(emp).start;
  }

  // Confirmação antes de gravar: a marcação não pode ser apagada depois.
  function confirmPunch(empId, type, method, after) {
    var emp = P.employee(empId), now = new Date();
    UI.sheet('<div class="punch-confirm"><div class="eyebrow">' + esc(P.TYPES[type].label) + '</div>' +
      '<div class="punch-time num" data-ctime>' + clockParts(now).hm + '<small>:' + clockParts(now).s + '</small></div>' +
      '<p class="muted">' + esc(emp.name) + ' · ' + esc(unitName(emp.unit)) + '</p></div>' +
      '<button type="button" class="btn primary block" data-ok style="min-height:56px">Confirmar ' + esc(P.TYPES[type].label.toLowerCase()) + '</button>' +
      '<button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        var t = setInterval(function () { var c = clockParts(new Date()); var el = sheet.querySelector('[data-ctime]'); if (el) el.innerHTML = c.hm + '<small>:' + c.s + '</small>'; else clearInterval(t); }, 1000);
        var ok = sheet.querySelector('[data-ok]');
        ok.addEventListener('click', function () {
          if (ok.disabled) return;
          ok.disabled = true; // um toque só: evita duas marcações seguidas
          clearInterval(t);
          var rec = P.punch(empId, type, method);
          close(); UI.buzz(30);
          receipt(rec, after);
        });
      });
  }

  function receipt(rec, after) {
    var d = new Date(rec.ts);
    UI.sheet('<div class="punch-confirm"><div class="success-mark">' + icon('check', 'lg') + '</div>' +
      '<h2>' + esc(P.TYPES[rec.type].label) + ' registrada</h2>' +
      '<div class="punch-time num">' + d.toLocaleTimeString('pt-BR') + '</div>' +
      '<div class="receipt-box num"><span>' + esc(P.employee(rec.emp).name) + '</span><span>' + d.toLocaleDateString('pt-BR') + ' · ' + esc(unitName(rec.unit)) + '</span>' +
      '<span>NSR ' + String(rec.nsr).padStart(9, '0') + (rec.method === 'codigo' ? ' · por código' : '') + '</span></div></div>' +
      '<button type="button" class="btn block" data-copy>' + icon('copy', 'sm') + 'Copiar comprovante</button>' +
      '<button type="button" class="btn primary block" data-close>Pronto</button>',
      function (sheet) {
        sheet.querySelector('[data-copy]').addEventListener('click', function () {
          try { navigator.clipboard.writeText(P.comprovante(rec)).then(function () { UI.toast('Comprovante copiado'); }, function () { UI.toast('Não foi possível copiar.', { tone: 'crit' }); }); }
          catch (e) { UI.toast('Não foi possível copiar.', { tone: 'crit' }); }
        });
      }, function () { if (after) after(); else refresh(); });
  }

  function adjustSheet(empId, preset) {
    preset = preset || {};
    var y = new Date(); y.setDate(y.getDate() - 1);
    var type = preset.type || 'saida';
    UI.sheet('<h2>Solicitar ajuste</h2><p class="muted">Esqueceu de bater ou bateu errado? O gerente confere e aprova. O registro original continua guardado.</p>' +
      '<div class="field"><label for="aj-date">Dia</label><input id="aj-date" type="date" class="input" value="' + (preset.date || DB.iso(y)) + '" max="' + Cal.today() + '"></div>' +
      '<div class="field"><span class="label">Registro</span><div class="seg seg-wrap" data-type>' + P.ORDER.map(function (t) {
        return '<button type="button" data-v="' + t + '" aria-pressed="' + (t === type) + '">' + esc(P.TYPES[t].label.replace('Saída para intervalo', 'Intervalo').replace('Volta do intervalo', 'Volta')) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field" id="f-aj-time"><label for="aj-time">Horário correto</label><input id="aj-time" type="time" class="input num" value="' + (preset.time || '') + '"><span class="err" hidden>Informe o horário.</span></div>' +
      '<div class="field" id="f-aj-reason"><label for="aj-reason">Motivo</label><textarea id="aj-reason" class="textarea" placeholder="Ex.: o celular descarregou e não consegui registrar a saída."></textarea><span class="err" hidden>Explique o motivo em poucas palavras.</span></div>' +
      '<button type="button" class="btn primary block" data-send>Enviar ao gerente</button><button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        sheet.querySelector('[data-type]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]'); if (!b) return;
          sheet.querySelectorAll('[data-type] [data-v]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          type = b.dataset.v;
        });
        var send = sheet.querySelector('[data-send]');
        send.addEventListener('click', function () {
          var time = sheet.querySelector('#aj-time').value, reason = sheet.querySelector('#aj-reason').value.trim(), date = sheet.querySelector('#aj-date').value;
          var ft = sheet.querySelector('#f-aj-time'), fr = sheet.querySelector('#f-aj-reason');
          ft.classList.toggle('error', !time); ft.querySelector('.err').hidden = !!time;
          fr.classList.toggle('error', reason.length < 8); fr.querySelector('.err').hidden = reason.length >= 8;
          if (!time || reason.length < 8 || !date) return;
          UI.busy(send, function () {
            DB.update(function (x) { x.adjusts.push({ id: 'aj' + Date.now(), emp: empId, date: date, type: type, time: time, reason: reason, status: 'pendente', at: Date.now() }); });
            close(); refresh(); UI.toast('Pedido de ajuste enviado ao gerente');
          });
        });
      });
  }

  // Ponto por código: para um celular ou tablet da loja usado por todos.
  function codeSheet() {
    var code = '';
    UI.sheet('<h2>Ponto por código</h2><p class="muted">Digite seu código de 4 números.</p>' +
      '<div class="pin-dots" data-dots>' + '<i></i><i></i><i></i><i></i>' + '</div><p class="err pin-err" data-err hidden>Código não encontrado. Confira com o gerente.</p>' +
      '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, 'del'].map(function (k) {
        return k === '' ? '<span></span>' : '<button type="button" class="key num" data-k="' + k + '"' + (k === 'del' ? ' aria-label="Apagar"' : '') + '>' + (k === 'del' ? icon('chevronLeft') : k) + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="btn block" data-close>Fechar</button>',
      function (sheet, close) {
        var dots = sheet.querySelector('[data-dots]'), err = sheet.querySelector('[data-err]');
        function paint() { dots.querySelectorAll('i').forEach(function (d, i) { d.classList.toggle('on', i < code.length); }); }
        sheet.querySelector('.keypad').addEventListener('click', function (e) {
          var b = e.target.closest('[data-k]'); if (!b) return;
          UI.buzz(8); err.hidden = true;
          if (b.dataset.k === 'del') code = code.slice(0, -1); else if (code.length < 4) code += b.dataset.k;
          paint();
          if (code.length < 4) return;
          var emp = DB.get().employees.filter(function (x) { return x.active && x.pin === code; })[0];
          if (!emp) { dots.classList.add('shake'); setTimeout(function () { dots.classList.remove('shake'); code = ''; paint(); err.hidden = false; }, 420); UI.buzz(60); return; }
          close();
          var st = P.state(emp.id);
          UI.sheet('<h2>Olá, ' + esc(emp.name.split(' ')[0]) + '</h2><p class="muted">' + esc(statusLine(st, emp).replace(/<[^>]+>/g, '')) + '</p>' +
            st.next.map(function (t, i) { return '<button type="button" class="btn ' + (i ? '' : 'primary ') + 'block" data-t="' + t + '" style="min-height:56px">' + esc(P.TYPES[t].verb) + '</button>'; }).join('') +
            '<button type="button" class="btn block" data-close>Não sou eu</button>',
            function (s2, close2) {
              s2.querySelectorAll('[data-t]').forEach(function (b2) { b2.addEventListener('click', function () { close2(); confirmPunch(emp.id, b2.dataset.t, 'codigo'); }); });
            });
        });
      });
  }

  // self: true no ponto da própria pessoa (mostra o botão de pedir ajuste).
  function historyRows(empId, self) {
    var emp = P.employee(empId);
    var from = Cal.add(Cal.today(), -13);
    var js = P.jornadas(empId).filter(function (j) { return j.date >= from; }).reverse();
    if (!js.length) return '<div class="card">' + UI.empty('clock', 'Nenhum registro ainda', 'Os dias trabalhados aparecem aqui assim que você bater o ponto.') + '</div>';
    var hours = P.shift(emp).hours * 60;
    return '<div class="list">' + js.map(function (j) {
      var m = j.marks, w = P.worked(j), late = P.lateBy(j, emp), stale = P.isStale(j);
      var bal = m.saida ? w - hours : null;
      var flags = (late ? '<span class="pill warn no-dot">Atraso ' + late + ' min</span>' : '') +
        (stale ? '<span class="pill crit no-dot">Sem saída</span>' : '') +
        (j.list.some(function (p) { return p.method === 'ajuste'; }) ? '<span class="pill info no-dot">Ajustado</span>' : '') +
        (!m.saida && !stale ? '<span class="pill ok">Em andamento</span>' : '');
      return '<div class="row ponto-day"><div class="pd-date"><b>' + dayLabel(j.date).split(',')[0] + '</b><span class="num">' + dayLabel(j.date).split(', ')[1] + '</span></div>' +
        '<div class="grow"><div class="num pd-marks">' + P.ORDER.map(function (t) { return m[t] ? P.hhmm(m[t].ts) : '<span class="faint">--:--</span>'; }).join('<span class="faint"> · </span>') + '</div>' +
        (flags ? '<div class="card-row" style="flex-wrap:wrap;gap:6px;margin-top:4px">' + flags + '</div>' : '') +
        (stale && self ? '<button type="button" class="btn sm" data-fix="' + j.date + '" style="margin-top:6px">Solicitar ajuste da saída</button>' : '') + '</div>' +
        '<div class="pd-total"><b class="num">' + P.dur(w) + '</b>' + (bal != null ? '<span class="num ' + (bal >= 0 ? 'pos' : 'neg') + '">' + P.signed(bal) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function mine() {
    var d = DB.get(), emp = P.me();
    if (!emp) return { html: '<main class="screen">' + UI.topbar('Ponto') + '<div class="card">' + UI.empty('user', 'Sem cadastro de colaborador', 'Peça ao administrador para vincular seu usuário a um cadastro.') + '</div></main>', tab: 'ponto' };
    var st = P.state(emp.id), now = new Date(), c = clockParts(now);
    var month = Cal.today().slice(0, 8) + '01';
    var sum = P.summary(emp.id, month, Cal.today());
    var pend = d.adjusts.filter(function (a) { return a.emp === emp.id && a.status === 'pendente'; });
    var manager = UI.isManager();

    var html = '<main class="screen">' +
      UI.topbar('Ponto', { sub: unitName(emp.unit) + ' · turno ' + emp.shift.toLowerCase() }) +
      (manager ? '<div class="seg" style="max-width:360px"><button type="button" aria-pressed="true">Meu ponto</button><button type="button" data-team aria-pressed="false">Equipe</button></div>' : '') +
      (st.stale.length ? '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">Sem registro de saída em ' + dayLabel(st.stale[st.stale.length - 1].date) + '. Peça o ajuste para fechar o dia.</div><button type="button" class="btn sm" data-fix="' + st.stale[st.stale.length - 1].date + '">Ajustar</button></div>' : '') +
      '<section class="card hero ponto-hero">' +
      '<div class="ponto-clock num" data-clock>' + c.hm + '<small>:' + c.s + '</small></div>' +
      '<div class="muted">' + esc(Cal.dayTitle(Cal.today())) + '</div>' +
      '<p class="ponto-status"><span class="dot-' + st.status + '"></span>' + statusLine(st, emp) + '</p>' +
      '<div class="ponto-actions">' + st.next.map(function (t, i) {
        return '<button type="button" class="btn ' + (i ? 'ghost-inv' : 'primary') + ' block" data-punch="' + t + '" style="min-height:60px;font-size:var(--fs-lg)">' + esc(P.TYPES[t].verb) + '</button>';
      }).join('') + '</div></section>' +

      '<section class="section"><div class="section-head"><h2>Hoje</h2></div><div class="today-marks">' + P.ORDER.map(function (t) {
        var p = st.today && st.today.marks[t];
        return '<div class="tm' + (p ? ' done' : '') + '"><span class="eyebrow">' + esc(P.TYPES[t].label.replace('Saída para intervalo', 'Intervalo').replace('Volta do intervalo', 'Volta')) + '</span><b class="num">' + (p ? P.hhmm(p.ts) : '--:--') + '</b></div>';
      }).join('') + '</div></section>' +

      '<section class="section"><div class="section-head"><h2>Este mês</h2></div><div class="stat-grid three">' +
      '<div class="card"><div class="stat num">' + P.dur(sum.worked) + '</div><div class="card-meta">trabalhadas em ' + sum.days + ' dias</div></div>' +
      '<div class="card"><div class="stat num ' + (sum.balance >= 0 ? 'pos' : 'neg') + '">' + P.signed(sum.balance) + '</div><div class="card-meta">banco de horas</div></div>' +
      '<div class="card"><div class="stat num">' + sum.lateCount + '</div><div class="card-meta">' + (sum.lateCount === 1 ? 'atraso' : 'atrasos') + (sum.late ? ' · ' + P.dur(sum.late) : '') + '</div></div>' +
      '</div></section>' +

      (pend.length ? '<div class="banner" style="background:var(--info-soft);color:var(--info)">' + icon('clock', 'sm') + '<div class="grow">' + pend.length + (pend.length === 1 ? ' pedido de ajuste aguardando' : ' pedidos de ajuste aguardando') + ' o gerente.</div></div>' : '') +

      '<section class="section"><div class="section-head"><h2>Últimos 14 dias</h2><button type="button" class="btn ghost sm" data-adjust>Solicitar ajuste</button></div>' + historyRows(emp.id, true) + '</section>' +
      '<button type="button" class="btn block" data-code>' + icon('key', 'sm') + 'Ponto por código (celular da loja)</button>' +
      '<p class="card-meta">Cada registro gera um comprovante com número sequencial (NSR). Registros não podem ser apagados; correções entram como ajuste aprovado pelo gerente.</p>' +
      '</main>';

    return {
      html: html, tab: 'ponto',
      mount: function (root) {
        var clock = root.querySelector('[data-clock]'), worked = root.querySelector('[data-worked]');
        var timer = setInterval(function () {
          var n = clockParts(new Date()); clock.innerHTML = n.hm + '<small>:' + n.s + '</small>';
          if (worked && st.today) worked.textContent = P.dur(P.worked(st.today));
        }, 1000);
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-punch]'); if (b) return confirmPunch(emp.id, b.dataset.punch, 'app');
          var f = e.target.closest('[data-fix]'); if (f) return adjustSheet(emp.id, { date: f.dataset.fix, type: 'saida' });
          if (e.target.closest('[data-adjust]')) return adjustSheet(emp.id);
          if (e.target.closest('[data-code]')) return codeSheet();
          if (e.target.closest('[data-team]')) return go('ponto/equipe');
        });
        return function () { clearInterval(timer); };
      }
    };
  }

  window.PontoUI = { statusLine: statusLine, historyRows: historyRows, dayLabel: dayLabel, codeSheet: codeSheet, confirmPunch: confirmPunch };

  Screens.ponto = function (params) {
    if (params[0] === 'equipe') return Screens.ponto_equipe();
    return mine();
  };
})();
