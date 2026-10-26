// Perfil e notificações.
(function () {
  var esc = UI.esc;

  function seg(name, opts, val) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === val) + '">' + (o[2] ? icon(o[2], 'sm') : '') + '<span>' + o[1] + '</span></button>';
    }).join('') + '</div>';
  }

  Screens.perfil = function () {
    var d = DB.get();
    var unit = d.units.filter(function (u) { return u.id === d.user.unit; })[0];
    var manager = UI.isManager();
    var unread = d.notifications.filter(function (n) { return !n.read; }).length;
    var html = '<main class="screen">' + UI.topbar('Perfil') +
      '<section class="card"><div class="card-row"><div class="avatar">' + esc(d.user.name.charAt(0)) + '</div>' +
      '<div class="grow"><div class="card-title" style="font-size:var(--fs-lg)">' + esc(d.user.name) + '</div>' +
      '<div class="card-meta">' + UI.ROLES[d.user.role] + ' · ' + esc(unit.name) + '</div></div></div></section>' +

      '<div class="list">' +
      '<a class="row" href="#notificacoes" style="text-decoration:none;color:inherit"><div class="tile">' + icon('bell') + '</div><div class="grow card-title">Notificações</div>' +
      (unread ? '<span class="pill accent no-dot num">' + unread + ' novas</span>' : '') + icon('chevronRight', 'sm') + '</a>' +
      '<div class="row"><div class="tile">' + icon('store') + '</div><div class="grow"><div class="card-title">Unidade</div><div class="card-meta">' + esc(unit.name) + '</div></div></div>' +
      '</div>' +

      '<section class="section"><div class="eyebrow">Aparência</div>' +
      seg('theme', [['system', 'Automático', 'sparkle'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']], d.prefs.theme) + '</section>' +

      '<section class="section"><div class="eyebrow">Visualizar como</div>' +
      seg('role', [['colaborador', 'Colaborador'], ['gerente', 'Gerente'], ['admin', 'Admin']], d.user.role) +
      '<p class="card-meta">Modo de demonstração: troca o perfil para conferir as duas versões das telas.</p></section>' +

      (UI.isAdmin() ? '<section class="section"><div class="eyebrow">Administração</div><div class="list">' +
        '<a class="row" href="#equipe" style="text-decoration:none;color:inherit"><div class="tile">' + icon('users') + '</div>' +
        '<div class="grow"><div class="card-title">Colaboradores</div><div class="card-meta">Cadastrar e gerenciar a equipe · ' + d.employees.filter(function (e) { return e.active; }).length + ' ativos</div></div>' + icon('chevronRight', 'sm') + '</a></div></section>' : '') +

      (manager ? '<section class="section"><div class="eyebrow">Permissões da equipe</div><div class="list">' +
        '<label class="row" for="perm-justify"><div class="grow"><div class="card-title">Finalizar checklist com pendências</div>' +
        '<div class="card-meta">Colaboradores podem justificar tarefas não feitas</div></div>' +
        '<input id="perm-justify" type="checkbox" class="switch"' + (d.settings.staffCanJustify ? ' checked' : '') + '></label></div></section>' : '') +

      '<div class="list"><a class="row" href="#login/senha" style="text-decoration:none;color:inherit"><div class="tile">' + icon('key') + '</div><div class="grow card-title">Alterar minha senha</div>' + icon('chevronRight', 'sm') + '</a>' +
      '<button type="button" class="row" data-reset><div class="tile">' + icon('refresh') + '</div><div class="grow card-title">Restaurar dados de exemplo</div></button>' +
      '<button type="button" class="row" data-logout style="color:var(--crit)"><div class="tile crit">' + icon('logout') + '</div><div class="grow card-title">Sair</div></button></div>' +
      '<p class="faint" style="text-align:center;font-size:var(--fs-xs)">Dindom · versão protótipo 0.1</p>' +
      '</main>';

    return {
      html: html, tab: 'perfil',
      mount: function (root) {
        root.querySelectorAll('[data-seg="theme"] button').forEach(function (b) {
          b.addEventListener('click', function () { DB.update(function (x) { x.prefs.theme = b.dataset.v; }); applyTheme(); refresh(); });
        });
        root.querySelectorAll('[data-seg="role"] button').forEach(function (b) {
          b.addEventListener('click', function () {
            DB.update(function (x) { x.user.role = b.dataset.v; });
            refresh(); UI.toast('Visualizando como ' + UI.ROLES[b.dataset.v].toLowerCase());
          });
        });
        var perm = root.querySelector('#perm-justify');
        if (perm) perm.addEventListener('change', function () {
          DB.update(function (x) { x.settings.staffCanJustify = perm.checked; }); UI.toast('Permissão atualizada');
        });
        root.querySelector('[data-reset]').addEventListener('click', function () {
          UI.confirm({ title: 'Restaurar dados de exemplo?', body: 'Contagens, checklists e chamados feitos neste aparelho serão apagados.', ok: 'Restaurar', danger: true,
            onOk: function () { DB.reset(); applyTheme(); go('inicio', { replace: true }); UI.toast('Dados de exemplo restaurados'); } });
        });
        root.querySelector('[data-logout]').addEventListener('click', function () {
          UI.confirm({ title: 'Sair do aplicativo?', body: 'O rascunho da contagem fica salvo neste aparelho.', ok: 'Sair', danger: true,
            onOk: function () { Auth.logout(); UI.toast('Você saiu. Até a próxima!', { icon: 'logout' }); } });
        });
      }
    };
  };

  Screens.notificacoes = function () {
    var d = DB.get();
    var html = '<main class="screen">' + UI.topbar('Notificações', { back: '#inicio', right: '<button type="button" class="btn ghost sm" data-all>Marcar lidas</button>' }) +
      (d.notifications.length ? '<div class="list">' + d.notifications.map(function (n) {
        return '<div class="row"><div class="tile ' + n.tone + '">' + icon(n.icon) + '</div><div class="grow"><div' + (n.read ? ' class="muted"' : ' class="card-title"') + '>' + esc(n.text) + '</div>' +
          '<div class="card-meta">' + esc(n.at) + '</div></div>' + (n.read ? '' : '<span class="unread-dot" aria-label="Não lida"></span>') + '</div>';
      }).join('') + '</div>' : UI.empty('bell', 'Sem notificações', 'Avisos de chamados, compras e checklists aparecem aqui.')) +
      '</main>';
    return {
      html: html, tab: 'inicio',
      mount: function (root) {
        root.querySelector('[data-all]').addEventListener('click', function () {
          DB.update(function (x) { x.notifications.forEach(function (n) { n.read = true; }); }); refresh();
        });
      }
    };
  };
})();
