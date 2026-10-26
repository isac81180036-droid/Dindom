// Perfil e notificações.
(function () {
  var esc = UI.esc;

  function seg(name, opts, val) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === val) + '">' + (o[2] ? icon(o[2], 'sm') : '') + '<span>' + o[1] + '</span></button>';
    }).join('') + '</div>';
  }

  var fmtCnpj = UI.fmtCnpj, validCnpj = UI.validCnpj;

  // Dados da empresa: vão no cabeçalho do arquivo de ponto (AFD) e do espelho.
  function companySheet() {
    var o = DB.get().org || {};
    UI.sheet('<h2>Dados da empresa</h2><p class="muted">Aparecem no arquivo de ponto (AFD) e no espelho que a contabilidade exporta.</p>' +
      '<div class="field" id="f-legal"><label for="co-legal">Razão social</label><input id="co-legal" class="input" maxlength="150" placeholder="Ex.: Dindom Pizzaria Ltda" value="' + esc(o.legalName || '') + '"><span class="err" hidden>Informe a razão social.</span></div>' +
      '<div class="field" id="f-cnpj"><label for="co-cnpj">CNPJ</label><input id="co-cnpj" class="input num" inputmode="numeric" placeholder="00.000.000/0000-00" value="' + esc(fmtCnpj(o.cnpj)) + '"><span class="err" hidden>CNPJ inválido: confira os números.</span></div>' +
      '<button type="button" class="btn primary block" data-save>Salvar</button><button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        var cn = sheet.querySelector('#co-cnpj');
        cn.addEventListener('input', function () { cn.value = fmtCnpj(cn.value); sheet.querySelector('#f-cnpj').classList.remove('error'); sheet.querySelector('#f-cnpj .err').hidden = true; });
        sheet.querySelector('[data-save]').addEventListener('click', function () {
          var legal = sheet.querySelector('#co-legal').value.trim(), cnpj = cn.value.replace(/\D/g, '');
          var badL = !legal, badC = !validCnpj(cnpj);
          sheet.querySelector('#f-legal').classList.toggle('error', badL); sheet.querySelector('#f-legal .err').hidden = !badL;
          sheet.querySelector('#f-cnpj').classList.toggle('error', badC); sheet.querySelector('#f-cnpj .err').hidden = !badC;
          if (badL || badC) return;
          DB.update(function (x) { x.org = Object.assign({}, x.org, { legalName: legal, cnpj: cnpj }); });
          close(); refresh(); UI.toast('Dados da empresa salvos');
        });
      });
  }

  Screens.perfil = function () {
    var d = DB.get();
    var unit = d.units.filter(function (u) { return u.id === d.user.unit; })[0] || { name: '' };
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

      (manager ? '<section class="section"><div class="eyebrow">Administração</div><div class="list">' +
        '<a class="row" href="#produtos" style="text-decoration:none;color:inherit"><div class="tile">' + icon('box') + '</div>' +
        '<div class="grow"><div class="card-title">Produtos do estoque</div><div class="card-meta">' + d.products.length + ' cadastrados · estoque ideal e mínimo</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<a class="row" href="#checklists/editar" style="text-decoration:none;color:inherit"><div class="tile">' + icon('checklist') + '</div>' +
        '<div class="grow"><div class="card-title">Modelos de checklist</div><div class="card-meta">' + d.checklists.length + ' rotinas · tarefas, prazos e fotos</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        (UI.isAdmin() ? '<a class="row" href="#equipe" style="text-decoration:none;color:inherit"><div class="tile">' + icon('users') + '</div>' +
        '<div class="grow"><div class="card-title">Colaboradores</div><div class="card-meta">Cadastrar e gerenciar a equipe · ' + d.employees.filter(function (e) { return e.active && e.role !== 'contador'; }).length + ' ativos</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<a class="row" href="#parceiros" style="text-decoration:none;color:inherit"><div class="tile">' + icon('file') + '</div>' +
        '<div class="grow"><div class="card-title">Parceiros</div><div class="card-meta">Login da contabilidade · ' + d.employees.filter(function (e) { return e.active && e.role === 'contador'; }).length + ' com acesso</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<button type="button" class="row" data-company><div class="tile">' + icon('store') + '</div>' +
        '<div class="grow"><div class="card-title">Dados da empresa</div><div class="card-meta">' + (d.org && d.org.cnpj ? esc(d.org.legalName || '') + ' · CNPJ ' + esc(fmtCnpj(d.org.cnpj)) : 'Razão social e CNPJ, usados no arquivo de ponto (AFD)') + '</div></div>' + icon('chevronRight', 'sm') + '</button>' : '') +
        '</div></section>' : '') +

      (manager ? '<section class="section"><div class="eyebrow">Permissões da equipe</div><div class="list">' +
        '<label class="row" for="perm-justify"><div class="grow"><div class="card-title">Finalizar checklist com pendências</div>' +
        '<div class="card-meta">Colaboradores podem justificar tarefas não feitas</div></div>' +
        '<input id="perm-justify" type="checkbox" class="switch"' + (d.settings.staffCanJustify ? ' checked' : '') + '></label></div></section>' : '') +

      '<div class="list"><a class="row" href="#login/senha" style="text-decoration:none;color:inherit"><div class="tile">' + icon('key') + '</div><div class="grow card-title">Alterar minha senha</div>' + icon('chevronRight', 'sm') + '</a>' +
      '<button type="button" class="row" data-logout style="color:var(--crit)"><div class="tile crit">' + icon('logout') + '</div><div class="grow card-title">Sair</div></button></div>' +
      (UI.isAdmin() && !(window.Cloud && Cloud.orgId) ? '<div class="list"><button type="button" class="row" data-wipe style="color:var(--crit)"><div class="tile crit">' + icon('alert') + '</div><div class="grow"><div class="card-title">Apagar dados deste aparelho</div><div class="card-meta" style="color:var(--ink-2)">Volta para a primeira configuração</div></div></button></div>' : '') +
      '<p class="faint" style="text-align:center;font-size:var(--fs-xs)">Dindom · versão 1.0 · ' + (window.Cloud && Cloud.orgId ? 'dados sincronizados com o servidor' : 'dados salvos neste aparelho') + '</p>' +
      '</main>';

    return {
      html: html, tab: 'perfil',
      mount: function (root) {
        root.querySelectorAll('[data-seg="theme"] button').forEach(function (b) {
          b.addEventListener('click', function () { DB.update(function (x) { x.prefs.theme = b.dataset.v; }); applyTheme(); refresh(); });
        });
        var perm = root.querySelector('#perm-justify');
        if (perm) perm.addEventListener('change', function () {
          DB.update(function (x) { x.settings.staffCanJustify = perm.checked; }); UI.toast('Permissão atualizada');
        });
        var company = root.querySelector('[data-company]');
        if (company) company.addEventListener('click', companySheet);
        var wipe = root.querySelector('[data-wipe]');
        if (wipe) wipe.addEventListener('click', function () {
          UI.confirm({ title: 'Apagar todos os dados deste aparelho?', body: 'Produtos, colaboradores, estoque, pontos, checklists, chamados e agenda salvos aqui serão apagados de vez. Não dá para desfazer.', ok: 'Apagar tudo', danger: true,
            onOk: function () { DB.reset(); applyTheme(); go('setup', { replace: true }); UI.toast('Dados apagados'); } });
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
