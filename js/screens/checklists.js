// Checklists: cards por rotina e execução tarefa a tarefa.
(function () {
  var esc = UI.esc;

  function find(id) { return DB.get().checklists.filter(function (c) { return c.id === id; })[0]; }

  function status(c) {
    var s = Stats.checklist(c);
    if (c.finishedAt) return c.reason ? ['warn', 'Concluído com pendências'] : ['ok', 'Concluído'];
    if (s.done === 0) return ['', 'Não iniciado'];
    return ['info', 'Em andamento'];
  }

  function card(c) {
    var s = Stats.checklist(c);
    var st = status(c);
    return '<a class="card tap" href="#checklists/' + c.id + '" style="text-decoration:none;color:inherit">' +
      '<div class="card-row"><div class="tile ' + (c.finishedAt ? 'ok' : 'accent') + '">' + icon(c.finishedAt ? 'check' : c.icon) + '</div>' +
      '<div class="grow"><div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-meta">' + esc(c.period) + ' · até ' + esc(c.due) + '</div></div>' +
      '<span class="pill ' + st[0] + '">' + st[1] + '</span></div>' +
      '<div class="card-row"><div class="grow">' + UI.bar(s.pct, c.finishedAt ? 'ok' : '') + '</div><span class="card-meta num">' + s.done + '/' + s.total + '</span></div>' +
      '</a>';
  }

  function list() {
    var d = DB.get();
    var periods = ['Abertura', 'Durante o expediente', 'Fechamento'];
    var manager = UI.isManager();
    var html = '<main class="screen wide">' + UI.topbar('Checklists', { sub: 'Hoje', right: manager ? '<a class="btn sm" href="#checklists/editar">' + icon('settings', 'sm') + 'Modelos</a>' : '' }) +
      (d.checklists.length ? periods.map(function (p) {
        var cs = d.checklists.filter(function (c) { return c.period === p; });
        return cs.length ? '<section class="section"><div class="eyebrow">' + p + '</div><div class="card-grid">' + cs.map(card).join('') + '</div></section>' : '';
      }).join('') : '<div class="card">' + UI.empty('checklist', 'Nenhum checklist ainda', manager ? 'Crie as rotinas de abertura e fechamento. Dá para começar por um modelo pronto.' : 'O gerente ainda não criou as rotinas da loja.',
        manager ? '<a class="btn primary" href="#checklists/editar">Criar checklists</a>' : '') + '</div>') + '</main>';
    return { html: html, tab: 'checklists' };
  }

  function taskRow(c, t) {
    var done = !!c.done[t.id];
    var photo = c.photos[t.id];
    return '<div class="task' + (done ? ' done' : '') + '" data-t="' + t.id + '">' +
      '<button type="button" class="task-hit" role="checkbox" aria-checked="' + done + '">' +
      '<span class="box">' + icon('check', 'sm') + '</span>' +
      '<span class="grow"><span class="task-text">' + esc(t.text) + '</span>' +
      '<span class="task-tags">' + (t.required ? '' : '<span class="pill no-dot">Opcional</span>') +
      (t.photo ? '<span class="pill no-dot ' + (photo ? 'ok' : 'accent') + '">' + icon('camera', 'sm') + (photo ? 'Foto anexada' : 'Exige foto') + '</span>' : '') +
      '</span></span></button>' +
      (t.photo ? (photo
        ? '<div class="task-photo"><div class="thumbs">' + thumbHtml(photo, 0) + '</div></div>'
        : '<div class="task-photo"><button type="button" class="btn sm" data-cam>' + icon('camera', 'sm') + 'Tirar foto</button>' +
          '<button type="button" class="btn sm ghost" data-gal>' + icon('image', 'sm') + 'Galeria</button></div>') : '') +
      '</div>';
  }

  function missing(c) {
    return c.tasks.filter(function (t) { return t.required && (!c.done[t.id] || (t.photo && !c.photos[t.id])); });
  }

  function dock(c) {
    var s = Stats.checklist(c);
    var miss = missing(c);
    if (c.finishedAt) {
      return '<div class="dock-inner"><div class="grow"><b>Checklist concluído</b><span class="card-meta">' + (c.reason ? 'Com pendências justificadas' : 'Todas as tarefas feitas') + '</span></div>' +
        '<button type="button" class="btn" data-reopen>Reabrir</button></div>';
    }
    return '<div class="dock-inner"><div class="grow"><div class="card-row" style="justify-content:space-between"><b class="num">' + s.done + '/' + s.total + ' tarefas</b>' +
      '<span class="card-meta">' + (miss.length ? miss.length + ' obrigatórias faltando' : 'Pronto para finalizar') + '</span></div>' + UI.bar(s.pct, miss.length ? '' : 'ok') + '</div>' +
      '<button type="button" class="btn ' + (miss.length ? 'dark' : 'primary') + '" data-finish>Finalizar</button></div>';
  }

  function finishSheet(c) {
    var miss = missing(c);
    if (!miss.length) {
      UI.confirm({
        title: 'Finalizar ' + c.name + '?', body: 'Todas as tarefas obrigatórias foram feitas.', ok: 'Finalizar checklist',
        onOk: function () { DB.update(function () { find(c.id).finishedAt = Date.now(); }); UI.buzz(20); UI.toast('Checklist concluído'); go('checklists', { replace: true }); }
      });
      return;
    }
    var d = DB.get();
    var canJustify = UI.isManager() || d.settings.staffCanJustify;
    UI.sheet('<h2>Ainda há pendências</h2><p class="muted">Estas tarefas obrigatórias não foram feitas:</p>' +
      '<div class="list">' + miss.map(function (t) {
        return '<div class="row"><div class="tile warn">' + icon(t.photo && c.done[t.id] ? 'camera' : 'alert', 'sm') + '</div><div class="grow">' + esc(t.text) +
          (t.photo && c.done[t.id] ? '<div class="card-meta">Falta a foto</div>' : '') + '</div></div>';
      }).join('') + '</div>' +
      (canJustify ? '<div class="field" id="f-reason"><label for="reason">Motivo das pendências</label>' +
        '<textarea id="reason" class="textarea" placeholder="Ex.: câmara 2 em manutenção, sem como medir a temperatura"></textarea>' +
        '<span class="err" hidden>Explique o motivo em pelo menos 10 caracteres.</span></div>' +
        '<button type="button" class="btn dark block" data-force>Finalizar com pendências</button>' : '<p class="card-meta">Peça ao gerente para liberar a finalização.</p>') +
      '<button type="button" class="btn primary block" data-close>Voltar às tarefas</button>',
      function (sheet, close) {
        var f = sheet.querySelector('[data-force]');
        if (!f) return;
        f.addEventListener('click', function () {
          var r = sheet.querySelector('#reason').value.trim();
          var field = sheet.querySelector('#f-reason');
          if (r.length < 10) { field.classList.add('error'); field.querySelector('.err').hidden = false; return; }
          UI.busy(f, function () {
            DB.update(function () { var x = find(c.id); x.reason = r; x.finishedAt = Date.now(); });
            close(); UI.toast('Checklist concluído com pendências registradas'); go('checklists', { replace: true });
          });
        });
      });
  }

  function detail(id) {
    var c = find(id);
    if (!c) return list();
    var html = '<main class="screen has-dock">' + UI.topbar(c.name, { back: '#checklists', sub: c.period + ' · prazo ' + c.due }) +
      (c.reason ? '<div class="banner">' + icon('message', 'sm') + '<div class="grow">Motivo registrado: ' + esc(c.reason) + '</div></div>' : '') +
      '<div class="list tasks">' + c.tasks.map(function (t) { return taskRow(c, t); }).join('') + '</div></main>' +
      '<div class="dock" data-dock>' + dock(c) + '</div>';

    return {
      html: html, tab: 'checklists',
      mount: function (root) {
        function redraw() {
          var cur = find(id);
          root.querySelector('.tasks').innerHTML = cur.tasks.map(function (t) { return taskRow(cur, t); }).join('');
          root.querySelector('[data-dock]').innerHTML = dock(cur);
        }
        function attach(tid, cam) {
          pickMedia({ camera: cam }, function (m) {
            DB.update(function () { var x = find(id); x.photos[tid] = m; x.done[tid] = true; });
            redraw(); UI.buzz(); UI.toast('Foto anexada', { icon: 'camera' });
          });
        }
        root.addEventListener('click', function (e) {
          var row = e.target.closest('.task');
          var cur = find(id);
          if (e.target.closest('[data-finish]')) return finishSheet(cur);
          if (e.target.closest('[data-reopen]')) {
            DB.update(function () { var x = find(id); x.finishedAt = null; x.reason = ''; });
            return refresh();
          }
          if (!row || cur.finishedAt) return;
          var tid = row.dataset.t;
          var task = cur.tasks.filter(function (t) { return t.id === tid; })[0];
          if (e.target.closest('[data-cam]')) return attach(tid, true);
          if (e.target.closest('[data-gal]')) return attach(tid, false);
          if (e.target.closest('[data-rm]')) {
            DB.update(function () { var x = find(id); delete x.photos[tid]; x.done[tid] = false; });
            return redraw();
          }
          if (e.target.closest('.task-hit')) {
            // Tarefa com foto: marcar sem foto abre a câmera direto.
            if (task.photo && !cur.photos[tid] && !cur.done[tid]) return attach(tid, true);
            DB.update(function () { var x = find(id); x.done[tid] = !x.done[tid]; });
            UI.buzz(); redraw();
          }
        });
      }
    };
  }

  Screens.checklists = function (params) {
    if (params[0] === 'editar') return Screens.checklist_editor(params.slice(1));
    return params[0] ? detail(params[0]) : list();
  };
})();
