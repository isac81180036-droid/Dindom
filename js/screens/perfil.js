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

  // Trava de localização do ponto (js/geo.js): local e raio de cada unidade, e o aparelho fixo da loja.
  function geoSheet() {
    var d = DB.get();
    function unitBlock(u) {
      var g = u.geo;
      return '<div class="card" style="box-shadow:none;background:var(--surface-2)" data-gu="' + esc(u.id) + '">' +
        '<div class="card-row"><div class="tile ' + (g ? 'ok' : '') + '">' + icon('mapPin') + '</div><div class="grow"><div class="card-title">' + esc(u.name) + '</div>' +
        '<div class="card-meta">' + (g ? 'Trava ligada: até ' + (g.radius || Geo.RADIUS) + ' m · <a href="' + Geo.mapLink(g) + '" target="_blank" rel="noopener">ver no mapa</a>' : 'Sem trava: o ponto pode ser batido de qualquer lugar') + '</div></div></div>' +
        '<button type="button" class="btn primary block" data-here>' + icon('mapPin', 'sm') + 'Estou na loja: usar a localização deste aparelho</button>' +
        '<div class="field"><label for="gc-' + esc(u.id) + '">Ou cole as coordenadas (latitude, longitude)</label>' +
        '<input id="gc-' + esc(u.id) + '" class="input num" data-coords placeholder="Ex.: 0.0812672, -51.0640875" value="' + (g ? g.lat + ', ' + g.lng : '') + '"></div>' +
        '<div class="field"><label for="gr-' + esc(u.id) + '">Distância máxima da loja</label><div class="qty-unit"><input id="gr-' + esc(u.id) + '" class="input num" data-radius inputmode="numeric" value="' + ((g && g.radius) || Geo.RADIUS) + '"><span>metros</span></div>' +
        '<span class="hint">O GPS do celular erra alguns metros; o app dá uma folga de até 20 m conforme a precisão do aparelho.</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-save-geo>Salvar</button>' + (g ? '<button type="button" class="btn" data-off-geo style="color:var(--crit)">Desligar a trava</button>' : '') + '</div></div>';
    }
    UI.sheet('<h2>Trava de localização do ponto</h2><p class="muted">Com a trava ligada, o colaborador só consegue bater o ponto perto da loja. A distância fica registrada em cada marcação.</p>' +
      d.units.map(unitBlock).join('') +
      '<label class="row" for="geo-trusted" style="padding-inline:0"><div class="grow"><div class="card-title">Este aparelho fica na loja</div>' +
      '<div class="card-meta">Marque no computador ou tablet do ponto por código: ele não tem GPS e não sai do estabelecimento, então não passa pela trava. Vale só para este aparelho.</div></div>' +
      '<input id="geo-trusted" type="checkbox" class="switch"' + (Geo.trusted() ? ' checked' : '') + '></label>' +
      '<button type="button" class="btn block" data-close>Fechar</button>',
      function (sheet, close) {
        function save(uid, geo) {
          DB.update(function (x) { x.units.forEach(function (u) { if (u.id === uid) { if (geo) u.geo = geo; else delete u.geo; } }); });
          close(); geoSheet();
        }
        sheet.querySelector('#geo-trusted').addEventListener('change', function (e) {
          Geo.setTrusted(e.target.checked);
          UI.toast(e.target.checked ? 'Este aparelho foi marcado como da loja' : 'Este aparelho passa pela trava de localização');
        });
        sheet.querySelectorAll('[data-gu]').forEach(function (box) {
          var uid = box.dataset.gu;
          function radius() { var r = parseInt(box.querySelector('[data-radius]').value, 10); return r >= 10 && r <= 1000 ? r : null; }
          box.querySelector('[data-here]').addEventListener('click', function (e) {
            var b = e.currentTarget; b.classList.add('busy'); b.disabled = true;
            Geo.here().then(function (pos) {
              b.classList.remove('busy'); b.disabled = false;
              if (pos.acc > 50) {
                UI.toast('Precisão baixa agora (erro de ' + pos.acc + ' m). Ligue o GPS em alta precisão, espere alguns segundos e tente de novo.', { tone: 'crit', ms: 6000 });
                return;
              }
              save(uid, { lat: Math.round(pos.lat * 1e7) / 1e7, lng: Math.round(pos.lng * 1e7) / 1e7, radius: radius() || Geo.RADIUS });
              UI.toast('Local da loja salvo (precisão de ' + pos.acc + ' m). A trava está ligada.', { ms: 4500 });
            }, function (er) {
              b.classList.remove('busy'); b.disabled = false;
              UI.toast(er.reason === 'denied' ? 'Permita a localização para este site e tente de novo.' : 'Não consegui pegar a localização deste aparelho.', { tone: 'crit', ms: 5000 });
            });
          });
          box.querySelector('[data-save-geo]').addEventListener('click', function () {
            var c = Geo.parse(box.querySelector('[data-coords]').value), r = radius();
            if (!c) return UI.toast('Coordenadas inválidas. Use o formato: 0.0812672, -51.0640875', { tone: 'crit', ms: 5000 });
            if (!r) return UI.toast('Informe uma distância entre 10 e 1000 metros.', { tone: 'crit' });
            save(uid, { lat: c.lat, lng: c.lng, radius: r });
            UI.toast('Trava de localização salva');
          });
          var off = box.querySelector('[data-off-geo]');
          if (off) off.addEventListener('click', function () { save(uid, null); UI.toast('Trava desligada: o ponto pode ser batido de qualquer lugar'); });
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
      (UI.isAccountant() ? '' : '<a class="row" href="#reservas" style="text-decoration:none;color:inherit"><div class="tile">' + icon('party') + '</div>' +
        '<div class="grow"><div class="card-title">Reservas</div><div class="card-meta">Pedidos do link público · copiar o link</div></div>' +
        (Reservas.pendingCount() ? '<span class="pill warn no-dot num">' + Reservas.pendingCount() + ' pendentes</span>' : '') + icon('chevronRight', 'sm') + '</a>') +
      '<div class="row"><div class="tile">' + icon('store') + '</div><div class="grow"><div class="card-title">Unidade</div><div class="card-meta">' + esc(unit.name) + '</div></div></div>' +
      '</div>' +

      '<section class="section"><div class="eyebrow">Aparência</div>' +
      seg('theme', [['system', 'Automático', 'sparkle'], ['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon']], d.prefs.theme) + '</section>' +

      (manager ? '<section class="section"><div class="eyebrow">Administração</div><div class="list">' +
        '<a class="row" href="#vendas" style="text-decoration:none;color:inherit"><div class="tile">' + icon('receipt') + '</div>' +
        '<div class="grow"><div class="card-title">Vendas</div><div class="card-meta">Pedidos da Cardápio Web · faturamento e mais vendidos</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<a class="row" href="#produtos" style="text-decoration:none;color:inherit"><div class="tile">' + icon('box') + '</div>' +
        '<div class="grow"><div class="card-title">Produtos do estoque</div><div class="card-meta">' + d.products.length + ' cadastrados · estoque ideal e mínimo</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<a class="row" href="#estacoes" style="text-decoration:none;color:inherit"><div class="tile">' + icon('users') + '</div>' +
        '<div class="grow"><div class="card-title">Estações do fechamento</div><div class="card-meta">' + (d.stations.length ? d.stations.length + ' estações · quem conta o quê' : 'Divida a contagem entre a equipe') + '</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<a class="row" href="#checklists/editar" style="text-decoration:none;color:inherit"><div class="tile">' + icon('checklist') + '</div>' +
        '<div class="grow"><div class="card-title">Modelos de checklist</div><div class="card-meta">' + d.checklists.length + ' rotinas · tarefas, prazos e fotos</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        (UI.isAdmin() ? '<a class="row" href="#equipe" style="text-decoration:none;color:inherit"><div class="tile">' + icon('users') + '</div>' +
        '<div class="grow"><div class="card-title">Colaboradores</div><div class="card-meta">Cadastrar e gerenciar a equipe · ' + d.employees.filter(function (e) { return e.active && e.role !== 'contador'; }).length + ' ativos</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<a class="row" href="#parceiros" style="text-decoration:none;color:inherit"><div class="tile">' + icon('file') + '</div>' +
        '<div class="grow"><div class="card-title">Parceiros</div><div class="card-meta">Login da contabilidade · ' + d.employees.filter(function (e) { return e.active && e.role === 'contador'; }).length + ' com acesso</div></div>' + icon('chevronRight', 'sm') + '</a>' +
        '<button type="button" class="row" data-geo><div class="tile">' + icon('mapPin') + '</div>' +
        '<div class="grow"><div class="card-title">Trava de localização do ponto</div><div class="card-meta">' + (d.units.some(function (u) { return u.geo; }) ? 'Ligada: ponto só perto da loja' : 'Desligada: ponto de qualquer lugar') + (Geo.trusted() ? ' · este é o aparelho da loja' : '') + '</div></div>' + icon('chevronRight', 'sm') + '</button>' +
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
        var geo = root.querySelector('[data-geo]');
        if (geo) geo.addEventListener('click', geoSheet);
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
      // Mais recentes primeiro; avisos com destino (ex.: reserva nova) abrem a tela certa.
      (d.notifications.length ? '<div class="list">' + d.notifications.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).map(function (n) {
        var inner = '<div class="tile ' + n.tone + '">' + icon(n.icon) + '</div><div class="grow"><div' + (n.read ? ' class="muted"' : ' class="card-title"') + '>' + esc(n.text) + '</div>' +
          '<div class="card-meta">' + esc(n.at) + '</div></div>' + (n.read ? '' : '<span class="unread-dot" aria-label="Não lida"></span>');
        return n.href ? '<a class="row" href="' + esc(n.href) + '" data-nid="' + esc(n.id) + '" style="text-decoration:none;color:inherit">' + inner + icon('chevronRight', 'sm') + '</a>' : '<div class="row">' + inner + '</div>';
      }).join('') + '</div>' : UI.empty('bell', 'Sem notificações', 'Avisos de chamados, compras e checklists aparecem aqui.')) +
      '</main>';
    return {
      html: html, tab: 'inicio',
      mount: function (root) {
        root.querySelector('[data-all]').addEventListener('click', function () {
          DB.update(function (x) { x.notifications.forEach(function (n) { n.read = true; }); }); refresh();
        });
        // Abrir um aviso marca como lido.
        root.querySelectorAll('[data-nid]').forEach(function (a) {
          a.addEventListener('click', function () {
            DB.update(function (x) { x.notifications.forEach(function (n) { if (String(n.id) === a.dataset.nid) n.read = true; }); });
          });
        });
      }
    };
  };
})();
