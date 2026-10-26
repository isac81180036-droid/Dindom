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
    var sh = P.shift(emp);
    if (st.status === 'trabalhando') return { key: 'on', label: 'Trabalhando desde ' + P.hhmm(j.marks.entrada ? j.marks.entrada.ts : j.start) + ' · sai às ' + sh.end, late: P.lateBy(j, emp), j: j };
    if (st.status === 'intervalo') return { key: 'pause', label: 'Em intervalo desde ' + P.hhmm(j.marks.intervalo.ts) + ' · sai às ' + sh.end, late: P.lateBy(j, emp), j: j };
    if (j && j.marks.saida) return { key: 'done', label: 'Saiu às ' + P.hhmm(j.marks.saida.ts) + ' · horário ' + sh.end, late: P.lateBy(j, emp), early: P.earlyBy(j, emp), j: j };
    var start = shiftStartTs(emp);
    if (now > start + P.TOLERANCE * 60000) return { key: 'missing', label: 'Não chegou · entrada ' + sh.start, late: Math.round((now - start) / 60000) };
    return { key: 'later', label: 'Entra às ' + sh.start + ' · sai às ' + sh.end };
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
    refresh(); UI.toast('Ajuste aprovado e registrado' + (rec.nsr ? ' (NSR ' + rec.nsr + ')' : ''));
  }

  function detailSheet(emp) {
    var s = P.summary(emp.id, Cal.today().slice(0, 8) + '01', Cal.today());
    UI.sheet('<div class="card-row"><span class="avatar">' + esc(initials(emp.name)) + '</span><div class="grow"><h2 style="font-size:var(--fs-lg)">' + esc(emp.name) + '</h2>' +
      '<div class="card-meta">' + esc(emp.func) + ' · ' + esc(unitShort(emp.unit)) + '</div></div></div>' +
      '<div class="row" style="border:1px solid var(--line);border-radius:var(--r-md)"><div class="tile">' + icon('clock') + '</div><div class="grow"><div class="card-title num">' + esc(P.horarioLabel(emp)) + '</div>' +
      '<div class="card-meta">Horário de trabalho' + (P.shift(emp).pause ? ' · intervalo ' + P.dur(P.shift(emp).pause) : '') + ' · ' + P.dur(P.shift(emp).hours * 60) + ' por dia</div></div>' +
      (UI.isAdmin() ? '<button type="button" class="btn sm" data-horario-edit>Alterar</button>' : '') + '</div>' +
      '<div class="stat-grid three"><div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + P.dur(s.worked) + '</div><div class="card-meta">no mês</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num ' + (s.balance >= 0 ? 'pos' : 'neg') + '">' + P.signed(s.balance) + '</div><div class="card-meta">banco</div></div>' +
      '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="stat num">' + s.lateCount + '</div><div class="card-meta">atrasos</div></div></div>' +
      PontoUI.historyRows(emp.id, false) + '<button type="button" class="btn block" data-close>Fechar</button>',
      function (sheet, close) {
        var ed = sheet.querySelector('[data-horario-edit]');
        if (ed) ed.addEventListener('click', function () { close(); PontoUI.horarioSheet(emp); });
      });
  }

  // Período da tabela e da exportação: mês atual, mês anterior ou datas escolhidas.
  var period = { mode: 'mes', from: null, to: null };
  function range() {
    var t = Cal.today(), d = Cal.parse(t);
    if (period.mode === 'anterior') return [DB.iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), DB.iso(new Date(d.getFullYear(), d.getMonth(), 0))];
    if (period.mode === 'custom' && period.from && period.to) return period.from <= period.to ? [period.from, period.to] : [period.to, period.from];
    return [t.slice(0, 8) + '01', t];
  }
  function br(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  function exportCard(from, to) {
    var c = PontoExport.count(from, to, unitFilter);
    function opt(kind, title, desc, ext, warn) {
      return '<button type="button" class="row" data-export="' + kind + '"><div class="tile">' + icon('file') + '</div>' +
        '<div class="grow"><div class="card-title">' + title + '</div><div class="card-meta">' + desc + '</div>' +
        (warn ? '<div class="card-meta" style="color:var(--warn);font-weight:600">' + warn + '</div>' : '') + '</div><span class="pill no-dot">' + (ext || 'CSV') + '</span></button>';
    }
    // O AFD precisa do CNPJ da empresa e do PIS de cada funcionário.
    var co = PontoExport.company(), afd = PontoExport.afd(from, to, unitFilter);
    var afdWarn = !co.cnpj ? 'Falta o CNPJ da empresa: o administrador cadastra em Perfil › Dados da empresa.'
      : afd.skipped.length ? afd.skipped.length + (afd.skipped.length === 1 ? ' funcionário sem PIS fica' : ' funcionários sem PIS ficam') + ' de fora: ' + esc(afd.skipped.join(', ')) + '.' : '';
    return '<section class="card export-card">' +
      '<div class="card-row"><div class="tile accent">' + icon('file') + '</div><div class="grow"><div class="card-title">Exportar para a contabilidade</div>' +
      '<div class="card-meta">Planilhas que abrem no Excel e entram nos sistemas de folha</div></div></div>' +
      '<div class="seg" data-period>' + [['mes', 'Mês atual'], ['anterior', 'Mês anterior'], ['custom', 'Escolher datas']].map(function (o) {
        return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (period.mode === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      (period.mode === 'custom' ? '<div class="ev-when" style="grid-template-columns:1fr 1fr"><div class="field"><label for="p-from">De</label><input id="p-from" type="date" class="input" value="' + from + '"></div>' +
        '<div class="field"><label for="p-to">Até</label><input id="p-to" type="date" class="input" value="' + to + '"></div></div>' : '') +
      '<p class="card-meta num">' + br(from) + ' a ' + br(to) + ' · ' + c.people + (c.people === 1 ? ' colaborador' : ' colaboradores') + ' · ' + c.days + ' dias com registro' +
      (unitFilter !== 'todas' ? ' · ' + esc(unitShort(unitFilter)) : '') + '</p>' +
      '<div class="list">' +
      opt('marcacoes', 'Marcações', 'Cada batida, com data, hora, tipo, origem e NSR') +
      opt('espelho', 'Espelho de ponto', 'Um dia por linha: entrada, intervalo, saída, horas e saldo') +
      opt('resumo', 'Resumo do período', 'Um colaborador por linha: horas, banco de horas e atrasos') +
      '</div>' +
      '<div class="eyebrow">Texto (TXT)</div><div class="list">' +
      opt('afd', 'AFD · arquivo de ponto', 'Para importar no sistema da contabilidade: cada batida com NSR, data, hora e PIS', 'TXT', afdWarn) +
      opt('espelhoTxt', 'Espelho de ponto em texto', 'Relatório por funcionário e por dia, com totais, para conferir ou arquivar', 'TXT') +
      '</div>' +
      '<p class="card-meta">Os sistemas de folha (Domínio, Alterdata e outros) importam planilhas como estas escolhendo as colunas. O arquivo oficial AFD/AEJ só é possível com o ponto registrado como REP-P.</p>' +
      '</section>';
  }

  Screens.ponto_equipe = function () {
    var acc = UI.isAccountant(); // contabilidade: só consulta e exporta
    if (!UI.isManager() && !acc) return Screens.ponto([]);
    var d = DB.get();
    var r = range(), from = r[0], to = r[1];
    var all = d.employees.filter(function (e) { return e.ponto !== false && e.role !== 'contador' && (unitFilter === 'todas' || e.unit === unitFilter); });
    var emps = all.filter(function (e) { return e.active; });
    var rows = emps.map(function (e) { return { e: e, t: today(e) }; });
    var count = function (k) { return rows.filter(function (x) { return x.t.key === k; }).length; };
    var order = { missing: 0, on: 1, pause: 2, later: 3, done: 4, off: 5 };
    rows.sort(function (a, b) { return order[a.t.key] - order[b.t.key] || a.e.name.localeCompare(b.e.name); });
    var pend = d.adjusts.filter(function (a) { return a.status === 'pendente'; });
    // Na tabela entram também quem saiu da empresa mas tem registro no período.
    var table = all.filter(function (e) { return e.active || P.summary(e.id, from, to).days; });

    var html = '<main class="screen wide">' + UI.topbar('Ponto da equipe', { sub: acc ? 'Acesso da contabilidade · somente consulta' : 'Hoje, ' + new Date().toLocaleDateString('pt-BR') }) +
      (!acc && P.me() && P.me().ponto !== false ? '<div class="seg" style="max-width:360px"><button type="button" data-mine aria-pressed="false">Meu ponto</button><button type="button" aria-pressed="true">Equipe</button></div>' : '') +
      '<div class="chips" role="toolbar" aria-label="Unidade">' + [{ id: 'todas', name: 'Todas as unidades' }].concat(d.units).map(function (u) {
        return '<button type="button" class="chip" data-uf="' + u.id + '" aria-pressed="' + (unitFilter === u.id) + '">' + esc(u.name.replace('Unidade ', '')) + '</button>';
      }).join('') + '</div>' +
      (acc ? exportCard(from, to) : '') +
      '<div class="stat-grid four">' +
      '<div class="card"><div class="stat num">' + count('on') + '</div><div class="card-meta">trabalhando agora</div></div>' +
      '<div class="card"><div class="stat num">' + count('pause') + '</div><div class="card-meta">em intervalo</div></div>' +
      '<div class="card"><div class="stat num' + (count('missing') ? ' neg' : '') + '">' + count('missing') + '</div><div class="card-meta">atrasados sem registro</div></div>' +
      '<div class="card"><div class="stat num">' + pend.length + '</div><div class="card-meta">' + (acc ? 'ajustes aguardando o gerente' : 'ajustes para aprovar') + '</div></div></div>' +

      (pend.length ? '<section class="section"><div class="section-head"><h2>' + (acc ? 'Ajustes aguardando o gerente' : 'Ajustes para aprovar') + '</h2></div><div class="card-grid">' + pend.map(function (a) {
        var e = P.employee(a.emp);
        return '<div class="card"><div class="card-row"><span class="avatar sm">' + esc(initials(e.name)) + '</span><div class="grow"><div class="card-title">' + esc(e.name) + '</div>' +
          '<div class="card-meta">' + esc(P.TYPES[a.type].label) + ' · ' + PontoUI.dayLabel(a.date) + ' às <b class="num">' + esc(a.time) + '</b></div></div></div>' +
          '<p class="muted">“' + esc(a.reason) + '”</p>' +
          (acc ? '<span class="pill warn no-dot" style="align-self:flex-start">Ainda não entra nas planilhas</span>'
            : '<div class="card-row"><button type="button" class="btn sm" data-rej="' + a.id + '">Recusar</button><button type="button" class="btn sm primary" data-apr="' + a.id + '">Aprovar ajuste</button></div>') + '</div>';
      }).join('') + '</div></section>' : '') +

      (!rows.length ? '<div class="card">' + UI.empty('users', 'Ninguém batendo ponto ainda', 'Os colaboradores cadastrados aparecem aqui com a situação do dia.', UI.isAdmin() ? '<a class="btn primary" href="#equipe/novo">Cadastrar colaborador</a>' : '') + '</div>' : '') +
      '<section class="section"' + (rows.length ? '' : ' hidden') + '><div class="section-head"><h2>Agora</h2></div><div class="card-grid">' + rows.map(function (x) {
        var pill = PILL[x.t.key];
        return '<button type="button" class="card tap team-card" data-emp="' + x.e.id + '"><div class="card-row"><span class="avatar sm">' + esc(initials(x.e.name)) + '</span>' +
          '<div class="grow"><div class="card-title">' + esc(x.e.name) + '</div><div class="card-meta">' + esc(x.e.func) + ' · ' + esc(unitShort(x.e.unit)) + ' · <span class="num">' + esc(P.horarioLabel(x.e)) + '</span></div></div>' +
          '<span class="pill ' + pill[0] + '">' + pill[1] + '</span></div>' +
          '<div class="card-meta">' + esc(x.t.label) + (x.t.j ? ' · ' + P.dur(P.worked(x.t.j)) + ' hoje' : '') + '</div>' +
          (x.t.late && x.t.key !== 'missing' ? '<span class="pill warn no-dot" style="align-self:flex-start">Chegou ' + x.t.late + ' min atrasado</span>' : '') +
          (x.t.early ? '<span class="pill warn no-dot" style="align-self:flex-start">Saiu ' + P.dur(x.t.early) + ' antes do horário</span>' : '') + '</button>';
      }).join('') + '</div></section>' +

      (acc ? '' : exportCard(from, to)) +
      '<section class="section"><div class="section-head"><h2 class="num">' + br(from) + ' a ' + br(to) + '</h2></div>' +
      '<div class="table-wrap"><table class="ponto-table"><thead><tr><th>Colaborador</th><th>Dias</th><th>Horas</th><th>Banco</th><th>Atrasos</th></tr></thead><tbody>' +
      (table.length ? table.map(function (e) {
        var s = P.summary(e.id, from, to);
        return '<tr data-emp="' + e.id + '"><td><b>' + esc(e.name) + '</b><span class="card-meta">' + esc(e.func) + (e.active ? '' : ' · inativo') + '</span></td><td class="num">' + s.days + '</td><td class="num">' + P.dur(s.worked) + '</td>' +
          '<td class="num ' + (s.balance >= 0 ? 'pos' : 'neg') + '">' + (P.signed(s.balance) || '0') + '</td><td class="num">' + s.lateCount + (s.missing ? ' <span class="pill crit no-dot">' + s.missing + ' sem saída</span>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Nenhum registro no período.</td></tr>') + '</tbody></table></div></section></main>';

    return {
      html: html, tab: 'ponto',
      mount: function (root) {
        root.addEventListener('click', function (e) {
          var t = e.target;
          if (t.closest('[data-mine]')) return go('ponto');
          var uf = t.closest('[data-uf]'); if (uf) { unitFilter = uf.dataset.uf; return refresh(); }
          var pm = t.closest('[data-period] [data-v]');
          if (pm) { period.mode = pm.dataset.v; if (pm.dataset.v === 'custom' && !period.from) { period.from = from; period.to = to; } return refresh(); }
          var ex = t.closest('[data-export]');
          if (ex) {
            var kind = ex.dataset.export, name = PontoExport.filename(kind, from, to, unitFilter), text, extra = '';
            if (kind === 'afd') {
              if (!PontoExport.company().cnpj) { UI.toast('Falta o CNPJ da empresa. O administrador cadastra em Perfil › Dados da empresa.', { tone: 'crit', ms: 5000 }); return; }
              var r = PontoExport.afd(from, to, unitFilter);
              text = r.text; extra = ' · ' + r.lines + ' marcações' + (r.skipped.length ? ' · ' + r.skipped.length + ' sem PIS de fora' : '');
            } else text = PontoExport[kind](from, to, unitFilter);
            if (PontoExport.download(name, text)) UI.toast('Arquivo baixado: ' + name + extra, { icon: 'file', ms: 5000 });
            else {
              try { navigator.clipboard.writeText(text).then(function () { UI.toast('O aparelho não permitiu baixar. A planilha foi copiada: cole no Excel.', { ms: 5000 }); }); }
              catch (er) { UI.toast('Não foi possível baixar a planilha neste aparelho.', { tone: 'crit' }); }
            }
            return;
          }
          var apr = t.closest('[data-apr]'), rej = t.closest('[data-rej]');
          if ((apr || rej) && !acc) {
            var a = DB.get().adjusts.filter(function (x) { return x.id === (apr || rej).dataset[apr ? 'apr' : 'rej']; })[0];
            if (apr) return UI.confirm({ title: 'Aprovar ajuste?', body: 'Será registrada a ' + esc(P.TYPES[a.type].label.toLowerCase()) + ' de ' + esc(P.employee(a.emp).name.split(' ')[0]) + ' em ' + PontoUI.dayLabel(a.date) + ' às ' + esc(a.time) + '. Fica marcado como ajuste.', ok: 'Aprovar', onOk: function () { approve(a, true); } });
            return approve(a, false);
          }
          var em = t.closest('[data-emp]'); if (em) detailSheet(P.employee(em.dataset.emp));
        });
        root.addEventListener('change', function (e) {
          if (e.target.id === 'p-from' && e.target.value) { period.from = e.target.value; refresh(); }
          if (e.target.id === 'p-to' && e.target.value) { period.to = e.target.value; refresh(); }
        });
      }
    };
  };
})();