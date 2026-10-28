// Modelos de checklist (gerente e admin): rotinas, prazo e tarefas (obrigatória / exige foto).
(function () {
  var esc = UI.esc;
  var PERIODS = [['Abertura', 'sun'], ['Durante o expediente', 'clock'], ['Fechamento', 'moon']];
  // Pontos de partida editáveis; nada é criado sem o gerente salvar.
  var STARTERS = [
    { name: 'Abertura da cozinha', period: 'Abertura', due: '17:30', tasks: [
      ['Ligar o forno e conferir a temperatura', true, false], ['Conferir a temperatura das câmaras frias', true, true],
      ['Higienizar bancadas e tábuas', true, false], ['Abrir as massas do dia', true, false],
      ['Repor molho e coberturas na linha', true, false], ['Conferir a validade dos insumos abertos', false, false], ['Foto da linha montada', true, true]] },
    { name: 'Fechamento da cozinha', period: 'Fechamento', due: '23:45', tasks: [
      ['Desligar forno e exaustor', true, false], ['Guardar coberturas em potes identificados', true, false],
      ['Lavar e secar os utensílios', true, false], ['Limpar o piso da cozinha', true, false],
      ['Retirar o lixo orgânico e o reciclável', true, false], ['Foto da cozinha limpa', true, true]] },
    { name: 'Abertura do salão', period: 'Abertura', due: '18:00', tasks: [
      ['Limpar mesas e cadeiras', true, false], ['Repor guardanapos e sachês', true, false],
      ['Ligar as máquinas de cartão e conferir a bateria', true, false], ['Conferir os banheiros', true, true]] }
  ];

  function iconFor(period) { var p = PERIODS.filter(function (x) { return x[0] === period; })[0]; return p ? p[1] : 'checklist'; }
  function find(id) { return DB.get().checklists.filter(function (c) { return c.id === id; })[0]; }
  var draft = null; // modelo em edição (mantido entre redesenhos)

  // ---------- Dias da semana (do checklist inteiro ou de uma tarefa) ----------
  var ORDER = [1, 2, 3, 4, 5, 6, 0]; // semana começando na segunda

  function dayPicker(days) {
    var all = DB.everyDay(days);
    return '<div class="day-pick" data-daypick>' +
      '<button type="button" class="chip" data-all aria-pressed="' + all + '">Todos os dias</button>' +
      '<div class="day-row">' + ORDER.map(function (n) {
        return '<button type="button" data-d="' + n + '" aria-pressed="' + (all || days.indexOf(n) >= 0) + '" aria-label="' + DB.WEEK[n] + '">' + DB.WEEK[n].slice(0, 3) + '</button>';
      }).join('') + '</div><span class="hint" data-daylabel></span></div>';
  }

  // "Todos os dias" ou dias soltos. Nenhum dia (ou os 7) = todos os dias.
  // Saindo de "todos os dias", o primeiro toque escolhe só aquele dia (não tira um dos 7).
  function bindDays(box, days, onChange) {
    var cur = DB.everyDay(days) ? [] : days.slice();
    function paint() {
      var all = DB.everyDay(cur);
      box.querySelector('[data-all]').setAttribute('aria-pressed', all);
      box.querySelectorAll('[data-d]').forEach(function (b) {
        b.setAttribute('aria-pressed', all || cur.indexOf(Number(b.dataset.d)) >= 0);
        b.classList.toggle('soft', all);
      });
      box.querySelector('[data-daylabel]').textContent = DB.daysLabel(cur);
      onChange(all ? [] : cur.slice().sort(function (a, b) { return a - b; }));
    }
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-all]')) { cur = []; return paint(); }
      var b = e.target.closest('[data-d]'); if (!b) return;
      var n = Number(b.dataset.d);
      if (DB.everyDay(cur)) cur = [n];
      else if (cur.indexOf(n) >= 0) cur = cur.filter(function (x) { return x !== n; });
      else cur.push(n);
      paint();
    });
    paint();
  }

  // Dias de uma tarefa: ex.: "Limpar a coifa" só terça e sexta, dentro do checklist de todo dia.
  function taskDays(v, i) {
    var t = v.tasks[i], pick = DB.everyDay(t.days) ? [] : t.days.slice();
    UI.sheet('<h2>Dias da tarefa</h2>' + (t.text.trim() ? '<p class="muted">' + esc(t.text) + '</p>' : '') +
      dayPicker(pick) +
      '<p class="card-meta">A tarefa só aparece no checklist nos dias marcados.' +
      (DB.everyDay(v.days) ? '' : ' O checklist acontece em: ' + esc(DB.daysLabel(v.days)).toLowerCase() + '.') + '</p>' +
      '<button type="button" class="btn primary block" data-ok>Pronto</button><button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        bindDays(sheet.querySelector('[data-daypick]'), pick, function (d) { pick = d; });
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          if (pick.length) t.days = pick; else delete t.days;
          close(); refresh();
        });
      });
  }

  function list() {
    var d = DB.get();
    var html = '<main class="screen wide">' + UI.topbar('Modelos de checklist', { back: '#checklists', sub: 'As rotinas da equipe e os dias de cada uma' }) +
      '<a class="btn primary block cta" href="#checklists/editar/novo" style="min-height:56px;font-size:var(--fs-lg)">' + icon('plus') + 'Novo checklist</a>' +
      (d.checklists.length ? '<div class="card-grid">' + d.checklists.map(function (c) {
        return '<a class="card tap" href="#checklists/editar/' + c.id + '" style="text-decoration:none;color:inherit"><div class="card-row"><div class="tile accent">' + icon(c.icon) + '</div>' +
          '<div class="grow"><div class="card-title">' + esc(c.name) + '</div><div class="card-meta">' + esc(c.period) + ' · até ' + esc(c.due) + ' · ' + c.tasks.length + ' tarefas · ' + esc(DB.daysLabel(c.days)) + '</div></div>' + icon('chevronRight', 'sm') + '</div></a>';
      }).join('') + '</div>'
        : '<section class="section"><div class="eyebrow">Comece por um modelo pronto</div><div class="card-grid">' + STARTERS.map(function (s, i) {
          return '<button type="button" class="card tap" data-starter="' + i + '" style="border:0;text-align:left"><div class="card-row"><div class="tile">' + icon(iconFor(s.period)) + '</div>' +
            '<div class="grow"><div class="card-title">' + esc(s.name) + '</div><div class="card-meta">' + s.tasks.length + ' tarefas · você edita antes de salvar</div></div>' + icon('plus', 'sm') + '</div></button>';
        }).join('') + '</div></section>') +
      '</main>';
    return {
      html: html, tab: 'checklists',
      mount: function (root) {
        root.querySelectorAll('[data-starter]').forEach(function (b) {
          b.addEventListener('click', function () {
            var s = STARTERS[Number(b.dataset.starter)];
            draft = { id: null, name: s.name, period: s.period, due: s.due, tasks: s.tasks.map(function (t, i) { return { id: 't' + Date.now() + i, text: t[0], required: t[1], photo: t[2] }; }) };
            go('checklists/editar/novo');
          });
        });
      }
    };
  }

  function taskRow(t, i, n) {
    return '<div class="task-edit" data-i="' + i + '">' +
      '<div class="te-order"><button type="button" class="icon-btn plain" data-up aria-label="Subir"' + (i ? '' : ' disabled') + '>' + icon('chevronLeft', 'sm') + '</button>' +
      '<button type="button" class="icon-btn plain" data-down aria-label="Descer"' + (i < n - 1 ? '' : ' disabled') + '>' + icon('chevronRight', 'sm') + '</button></div>' +
      '<div class="grow"><input class="input" data-text maxlength="90" placeholder="Descreva a tarefa" value="' + esc(t.text) + '">' +
      '<div class="te-flags"><label><input type="checkbox" data-req' + (t.required ? ' checked' : '') + '> Obrigatória</label>' +
      '<label><input type="checkbox" data-photo' + (t.photo ? ' checked' : '') + '> Exige foto</label>' +
      '<button type="button" class="te-days' + (DB.everyDay(t.days) ? '' : ' on') + '" data-days>' + icon('calendar', 'sm') + esc(DB.daysLabel(t.days)) + '</button></div></div>' +
      '<button type="button" class="icon-btn plain" data-rm aria-label="Remover tarefa">' + icon('x', 'sm') + '</button></div>';
  }

  function form(id) {
    var c = id ? find(id) : null;
    if (id && !c) return list();
    if (!draft || draft.id !== (c ? c.id : null)) {
      draft = c ? { id: c.id, name: c.name, period: c.period, due: c.due, days: (c.days || []).slice(), tasks: JSON.parse(JSON.stringify(c.tasks)) }
        : { id: null, name: '', period: 'Abertura', due: '18:00', days: [], tasks: [{ id: 't' + Date.now(), text: '', required: true, photo: false }] };
    }
    var v = draft;
    var html = '<main class="screen no-nav">' + UI.topbar(c ? 'Editar checklist' : 'Novo checklist', { back: '#checklists/editar' }) +
      '<div class="field" id="f-c-name"><label for="c-name">Nome da rotina *</label><input id="c-name" class="input" maxlength="50" placeholder="Ex.: Abertura da cozinha" value="' + esc(v.name) + '"><span class="err" hidden>Dê um nome à rotina.</span></div>' +
      '<div class="field"><span class="label">Período</span><div class="seg" data-period>' + PERIODS.map(function (p) {
        return '<button type="button" data-v="' + p[0] + '" aria-pressed="' + (p[0] === v.period) + '">' + icon(p[1], 'sm') + '<span>' + (p[0] === 'Durante o expediente' ? 'Durante' : p[0]) + '</span></button>';
      }).join('') + '</div></div>' +
      '<div class="field"><span class="label">Dias da semana</span>' + dayPicker(v.days || []) +
      '<span class="hint">Em que dias a equipe faz este checklist. Uma tarefa só de alguns dias? Toque no calendário dela, logo abaixo.</span></div>' +
      '<div class="field"><label for="c-due">Prazo para terminar</label><input id="c-due" type="time" class="input num" value="' + esc(v.due) + '"></div>' +
      '<section class="section"><div class="section-head"><h2>Tarefas</h2><span class="card-meta" data-count>' + v.tasks.length + '</span></div>' +
      '<div class="list" data-tasks>' + v.tasks.map(function (t, i) { return taskRow(t, i, v.tasks.length); }).join('') + '</div>' +
      '<button type="button" class="btn block" data-add>' + icon('plus', 'sm') + 'Adicionar tarefa</button>' +
      '<p class="err" data-terr hidden style="color:var(--crit);font-weight:600;font-size:var(--fs-sm)">Inclua pelo menos uma tarefa com descrição.</p>' +
      '<p class="err" data-derr hidden style="color:var(--crit);font-weight:600;font-size:var(--fs-sm)"></p></section>' +
      (c ? '<button type="button" class="btn block" data-del style="color:var(--crit)">' + icon('x', 'sm') + 'Excluir checklist</button>' : '') +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner"><button type="button" class="btn primary block" data-save style="min-height:56px">' + (c ? 'Salvar alterações' : 'Criar checklist') + '</button></div></div>';

    return {
      html: html, tab: 'checklists', nav: false,
      mount: function (root) {
        function $(s) { return root.querySelector(s); }
        function sync() { // guarda o que foi digitado antes de redesenhar
          v.name = $('#c-name').value; v.due = $('#c-due').value || v.due;
          root.querySelectorAll('[data-tasks] [data-i]').forEach(function (row) {
            var t = v.tasks[Number(row.dataset.i)];
            t.text = row.querySelector('[data-text]').value; t.required = row.querySelector('[data-req]').checked; t.photo = row.querySelector('[data-photo]').checked;
          });
        }
        $('[data-period]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]'); if (!b) return;
          root.querySelectorAll('[data-period] [data-v]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          v.period = b.dataset.v;
        });
        bindDays(root.querySelector('[data-daypick]'), v.days || [], function (days) { v.days = days; });
        $('[data-add]').addEventListener('click', function () {
          sync(); v.tasks.push({ id: 't' + Date.now(), text: '', required: true, photo: false }); refresh();
          var all = document.querySelectorAll('[data-tasks] [data-text]'); if (all.length) all[all.length - 1].focus();
        });
        $('[data-tasks]').addEventListener('click', function (e) {
          var row = e.target.closest('[data-i]'); if (!row) return;
          var i = Number(row.dataset.i);
          if (e.target.closest('[data-days]')) { sync(); return taskDays(v, i); }
          if (e.target.closest('[data-rm]')) { sync(); v.tasks.splice(i, 1); return refresh(); }
          if (e.target.closest('[data-up]') && i > 0) { sync(); v.tasks.splice(i - 1, 0, v.tasks.splice(i, 1)[0]); return refresh(); }
          if (e.target.closest('[data-down]') && i < v.tasks.length - 1) { sync(); v.tasks.splice(i + 1, 0, v.tasks.splice(i, 1)[0]); return refresh(); }
        });
        var del = $('[data-del]');
        if (del) del.addEventListener('click', function () {
          UI.confirm({ title: 'Excluir ' + c.name + '?', body: 'A rotina sai da lista da equipe. O histórico dos dias anteriores continua guardado.', ok: 'Excluir checklist', danger: true,
            onOk: function () { DB.update(function (x) { x.checklists = x.checklists.filter(function (y) { return y.id !== c.id; }); }); draft = null; go('checklists/editar', { replace: true }); UI.toast('Checklist excluído'); } });
        });
        $('[data-save]').addEventListener('click', function () {
          sync();
          var name = v.name.trim(), tasks = v.tasks.filter(function (t) { return t.text.trim(); }).map(function (t) {
            var o = { id: t.id, text: t.text.trim(), required: !!t.required, photo: !!t.photo };
            if (!DB.everyDay(t.days)) o.days = t.days.slice();
            return o;
          });
          var days = DB.everyDay(v.days) ? null : v.days.slice();
          // Tarefa marcada só em dias em que o checklist não acontece nunca apareceria.
          var never = days ? tasks.filter(function (t) { return t.days && !t.days.some(function (n) { return days.indexOf(n) >= 0; }); }) : [];
          $('#f-c-name').classList.toggle('error', !name); $('#f-c-name .err').hidden = !!name;
          $('[data-terr]').hidden = !!tasks.length;
          $('[data-derr]').hidden = !never.length;
          if (never.length) $('[data-derr]').textContent = 'A tarefa "' + never[0].text + '" nunca cai nos dias do checklist (' + DB.daysLabel(days).toLowerCase() + '). Ajuste os dias dela ou do checklist.';
          if (!name || !tasks.length || never.length) return;
          DB.update(function (x) {
            if (c) {
              var t = x.checklists.filter(function (y) { return y.id === c.id; })[0];
              t.name = name; t.period = v.period; t.due = v.due; t.icon = iconFor(v.period); t.tasks = tasks;
              if (days) t.days = days; else delete t.days;
            } else {
              var nc = { id: 'k' + Date.now(), name: name, period: v.period, due: v.due, icon: iconFor(v.period), tasks: tasks, runDate: DB.businessDay(), done: {}, photos: {}, reason: '', finishedAt: null };
              if (days) nc.days = days;
              x.checklists.push(nc);
            }
          });
          draft = null; UI.buzz(15);
          go('checklists/editar', { replace: true }); UI.toast(c ? 'Checklist atualizado' : days && !DB.runsOn(days) ? 'Checklist criado. Aparece para a equipe nos dias: ' + DB.daysLabel(days) + '.' : 'Checklist criado. A equipe já vê na lista de hoje.');
        });
      }
    };
  }

  Screens.checklist_editor = function (params) {
    if (!UI.isManager()) return Screens.checklists([]);
    if (params[0] === 'novo') return form(null);
    if (params[0]) return form(params[0]);
    return list();
  };
})();
