// Admin › Colaboradores: cadastrar, editar, ativar/desativar e código de acesso.
(function () {
  var esc = UI.esc;
  var filter = { status: 'ativos', unit: 'todas', q: '' };
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var ROLE_HINT = {
    colaborador: 'Vê e executa as próprias tarefas: contagem, checklists, manutenção e agenda.',
    gerente: 'Tudo do colaborador, mais aprovações, status de chamados e permissões da equipe.',
    admin: 'Acesso total, incluindo cadastro de colaboradores e configurações das unidades.'
  };

  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function fmtPhone(s) {
    var d = digits(s).slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function initials(name) {
    var p = name.trim().split(/\s+/);
    return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function unitName(id) { var u = DB.get().units.filter(function (x) { return x.id === id; })[0]; return u ? u.name.replace('Unidade ', '') : ''; }
  function since(iso) { if (!iso) return ''; var p = iso.split('-'); return 'desde ' + MONTHS[+p[1] - 1] + '/' + p[0]; }
  function find(id) { return DB.get().employees.filter(function (e) { return e.id === id; })[0]; }
  function newPin() {
    var used = {}; DB.get().employees.forEach(function (e) { used[e.pin] = true; });
    var p; do { p = String(Math.floor(1000 + Math.random() * 9000)); } while (used[p]);
    return p;
  }

  function restricted() {
    return {
      html: '<main class="screen">' + UI.topbar('Colaboradores', { back: '#perfil' }) + '<div class="card">' +
        UI.empty('shield', 'Acesso restrito', 'Só administradores cadastram colaboradores. Em Perfil, troque a visualização para Admin para testar.', '<a class="btn primary" href="#perfil">Ir para o Perfil</a>') +
        '</div></main>',
      tab: 'equipe'
    };
  }

  // ---------- Lista ----------
  function card(e) {
    return '<a class="card tap emp-card' + (e.active ? '' : ' inactive') + '" href="#equipe/' + e.id + '" style="text-decoration:none;color:inherit">' +
      '<div class="card-row"><span class="avatar">' + esc(initials(e.name)) + '</span>' +
      '<div class="grow"><div class="card-title">' + esc(e.name) + '</div><div class="card-meta">' + esc(e.func) + ' · ' + esc(unitName(e.unit)) + '</div></div>' +
      icon('chevronRight', 'sm') + '</div>' +
      '<div class="card-row card-meta" style="flex-wrap:wrap;gap:6px">' +
      (e.active ? '' : '<span class="pill">Inativo</span>') +
      (e.role !== 'colaborador' ? '<span class="pill no-dot info">' + icon('shield', 'sm') + UI.ROLES[e.role] + '</span>' : '') +
      '<span class="num">' + esc(fmtPhone(e.phone)) + '</span><span>·</span><span>' + esc(since(e.admission)) + '</span></div></a>';
  }

  function listItems() {
    var q = filter.q.toLowerCase();
    var items = DB.get().employees.filter(function (e) {
      if (filter.status === 'ativos' && !e.active) return false;
      if (filter.status === 'inativos' && e.active) return false;
      if (filter.unit !== 'todas' && e.unit !== filter.unit) return false;
      return !q || e.name.toLowerCase().indexOf(q) >= 0 || e.func.toLowerCase().indexOf(q) >= 0 || digits(e.phone).indexOf(digits(q) || '#') >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
    return items.length ? '<div class="card-grid">' + items.map(card).join('') + '</div>'
      : '<div class="card">' + UI.empty('users', 'Ninguém encontrado', 'Confira o nome digitado ou mude os filtros.') + '</div>';
  }

  function list() {
    var d = DB.get();
    var act = d.employees.filter(function (e) { return e.active; }).length;
    var count = function (s) { return d.employees.filter(function (e) { return s === 'todos' || (s === 'ativos') === e.active; }).length; };
    var html = '<main class="screen wide">' +
      UI.topbar('Colaboradores', { sub: act + ' ativos em ' + d.units.length + ' unidades' }) +
      '<a class="btn primary block cta" href="#equipe/novo" style="min-height:56px;font-size:var(--fs-lg)">' + icon('userPlus') + 'Cadastrar colaborador</a>' +
      '<label class="field"><span class="sr-only">Buscar colaborador</span><div style="position:relative">' +
      '<span style="position:absolute;left:14px;top:13px;color:var(--ink-3)">' + icon('search', 'sm') + '</span>' +
      '<input id="emp-search" class="input" type="search" placeholder="Buscar por nome, função ou celular" style="padding-left:42px" value="' + esc(filter.q) + '"></div></label>' +
      '<div class="chips" role="toolbar" aria-label="Filtros">' +
      [['ativos', 'Ativos'], ['inativos', 'Inativos'], ['todos', 'Todos']].map(function (s) {
        return '<button type="button" class="chip" data-st="' + s[0] + '" aria-pressed="' + (filter.status === s[0]) + '">' + s[1] + ' <span class="count">' + count(s[0]) + '</span></button>';
      }).join('') + '<span class="chip-sep" aria-hidden="true"></span>' +
      [{ id: 'todas', name: 'Todas as unidades' }].concat(d.units).map(function (u) {
        return '<button type="button" class="chip" data-unit-f="' + u.id + '" aria-pressed="' + (filter.unit === u.id) + '">' + esc(u.name.replace('Unidade ', '')) + '</button>';
      }).join('') + '</div>' +
      '<div data-emps>' + listItems() + '</div></main>';
    return {
      html: html, tab: 'equipe',
      mount: function (root) {
        var box = root.querySelector('[data-emps]');
        root.querySelector('#emp-search').addEventListener('input', function (e) { filter.q = e.target.value; box.innerHTML = listItems(); });
        root.querySelectorAll('[data-st]').forEach(function (b) { b.addEventListener('click', function () { filter.status = b.dataset.st; refresh(); }); });
        root.querySelectorAll('[data-unit-f]').forEach(function (b) { b.addEventListener('click', function () { filter.unit = b.dataset.unitF; refresh(); }); });
      }
    };
  }

  // ---------- Formulário (novo e edição) ----------
  function chips(name, opts, val) {
    return '<div class="chips wrap" data-pick="' + name + '">' + opts.map(function (o) {
      return '<button type="button" class="chip" data-v="' + esc(o[0]) + '" aria-pressed="' + (o[0] === val) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function seg(name, opts, val) {
    return '<div class="seg" data-pick="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === val) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function form(id) {
    var d = DB.get();
    var cloud = !!(window.Cloud && Cloud.orgId); // com servidor, o login de cada pessoa fica no Supabase
    var e = id ? find(id) : null;
    if (id && !e) return list();
    var v = e ? JSON.parse(JSON.stringify(e)) : { name: '', phone: '', email: '', func: '', unit: d.user.unit, shift: 'Noite', role: 'colaborador', admission: Cal.today() };

    var html = '<main class="screen no-nav">' +
      UI.topbar(e ? 'Editar colaborador' : 'Novo colaborador', { back: '#equipe', sub: e ? (e.active ? 'Ativo' : 'Inativo') + ' · ' + since(e.admission) : 'Os campos com * são obrigatórios' }) +
      '<div class="field" id="f-name"><label for="emp-name">Nome completo *</label><input id="emp-name" class="input" autocomplete="name" autocapitalize="words" maxlength="60" placeholder="Ex.: Rafael Souza" value="' + esc(v.name) + '"><span class="err" hidden></span></div>' +
      '<div class="field" id="f-phone"><label for="emp-phone">Celular (WhatsApp) *</label><input id="emp-phone" class="input num" inputmode="tel" autocomplete="tel" placeholder="(11) 98765-4321" value="' + esc(fmtPhone(v.phone)) + '"><span class="hint">Para avisos pelo WhatsApp.</span><span class="err" hidden></span></div>' +
      '<div class="field" id="f-email"><label for="emp-email">E-mail *</label><input id="emp-email" class="input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" placeholder="nome@dindom.com.br" value="' + esc(v.email) + '"' + (cloud && e ? ' readonly' : '') + '><span class="hint">' + (cloud && e ? 'O e-mail de acesso não muda por aqui. Para trocar, cadastre a pessoa de novo com o e-mail novo.' : 'É com ele que a pessoa entra no app.') + '</span><span class="err" hidden></span></div>' +
      '<div class="field" id="f-func"><span class="label">Função *</span>' + chips('func', d.functions.map(function (f) { return [f, f]; }), v.func) + '<span class="err" hidden>Escolha a função.</span></div>' +
      '<div class="field"><span class="label">Unidade *</span>' + seg('unit', d.units.map(function (u) { return [u.id, u.name.replace('Unidade ', '')]; }), v.unit) + '</div>' +
      '<div class="field"><span class="label">Turno</span>' + seg('shift', [['Manhã', 'Manhã'], ['Tarde', 'Tarde'], ['Noite', 'Noite']], v.shift) + '</div>' +
      '<div class="field"><span class="label">Nível de acesso *</span>' + seg('role', [['colaborador', 'Colaborador'], ['gerente', 'Gerente'], ['admin', 'Admin']], v.role) +
      '<span class="hint" data-role-hint>' + ROLE_HINT[v.role] + '</span></div>' +
      '<div class="field"><label for="emp-adm">Data de admissão</label><input id="emp-adm" class="input" type="date" value="' + esc(v.admission) + '"></div>' +
      (e ? '<section class="section"><div class="eyebrow">Acesso</div><div class="list">' +
        '<div class="row"><div class="tile">' + icon('mail') + '</div><div class="grow"><div class="card-title">Entra com ' + esc(e.email || 'e-mail não cadastrado') + '</div><div class="card-meta">' + (e.mustChange ? 'Ainda com senha provisória' : (cloud || e.pass) ? 'Já criou a própria senha' : 'Sem senha: gere uma provisória') + '</div></div></div>' +
        '<button type="button" class="row" data-temppass><div class="tile">' + icon('key') + '</div><div class="grow"><div class="card-title">' + (cloud ? 'Enviar link para nova senha' : 'Gerar senha provisória') + '</div><div class="card-meta">' + (cloud ? 'Vai por e-mail, para quem esqueceu a senha' : 'Para quem esqueceu a senha') + '</div></div></button>' +
        '<div class="row"><div class="tile">' + icon('clock') + '</div><div class="grow"><div class="card-title">Código do ponto</div><div class="card-meta">Para bater o ponto no celular da loja</div></div>' +
        '<b class="pin num">' + esc(e.pin) + '</b></div>' +
        '<button type="button" class="row" data-newpin><div class="tile">' + icon('refresh') + '</div><div class="grow card-title">Gerar novo código do ponto</div></button>' +
        '<button type="button" class="row" data-toggle style="color:' + (e.active ? 'var(--crit)' : 'var(--ok)') + '"><div class="tile ' + (e.active ? 'crit' : 'ok') + '">' + icon(e.active ? 'logout' : 'check') + '</div>' +
        '<div class="grow"><div class="card-title">' + (e.active ? 'Desativar colaborador' : 'Reativar colaborador') + '</div><div class="card-meta" style="color:var(--ink-2)">' +
        (e.active ? 'Perde o acesso ao app. O histórico continua salvo.' : 'Volta a entrar com o mesmo e-mail e senha.') + '</div></div></button>' +
        '</div></section>' : '') +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner"><button type="button" class="btn primary block" data-save style="min-height:56px">' + (e ? 'Salvar alterações' : 'Cadastrar colaborador') + '</button></div></div>';

    return {
      html: html, tab: 'equipe', nav: false,
      mount: function (root) {
        function $(s) { return root.querySelector(s); }
        function setErr(fid, msg) {
          var f = $('#' + fid); f.classList.toggle('error', !!msg);
          var er = f.querySelector('.err'); er.hidden = !msg; if (msg) er.textContent = msg;
        }
        // Seletores mudam só o botão marcado: o que foi digitado nos campos não se perde.
        root.querySelectorAll('[data-pick]').forEach(function (g) {
          g.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-v]'); if (!b) return;
            g.querySelectorAll('[data-v]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
            v[g.dataset.pick] = b.dataset.v;
            if (g.dataset.pick === 'role') $('[data-role-hint]').textContent = ROLE_HINT[b.dataset.v];
            if (g.dataset.pick === 'func') setErr('f-func', '');
            // Função "Gerente" sugere o nível de acesso de gerente.
            if (g.dataset.pick === 'func' && b.dataset.v === 'Gerente' && v.role === 'colaborador') $('[data-pick="role"] [data-v="gerente"]').click();
          });
        });
        $('#emp-phone').addEventListener('input', function (ev) {
          var el = ev.target; el.value = fmtPhone(el.value); setErr('f-phone', '');
        });
        $('#emp-name').addEventListener('input', function () { setErr('f-name', ''); });

        var newpin = $('[data-newpin]');
        if (newpin) newpin.addEventListener('click', function () {
          UI.confirm({ title: 'Gerar novo código do ponto?', body: 'O código atual deixa de funcionar no celular da loja. Envie o novo para ' + esc(e.name.split(' ')[0]) + '.', ok: 'Gerar novo código',
            onOk: function () { var p = newPin(); DB.update(function () { find(id).pin = p; }); refresh(); UI.toast('Novo código do ponto: ' + p, { icon: 'key', ms: 4000 }); } });
        });
        var temp = $('[data-temppass]');
        if (temp && cloud) temp.addEventListener('click', function () {
          // Com servidor, a senha de outra pessoa só muda pelo link enviado ao e-mail dela.
          UI.confirm({ title: 'Enviar link para nova senha?', body: 'Vai um e-mail para ' + esc(e.email) + ' com um link para ' + esc(e.name.split(' ')[0]) + ' criar uma senha nova.', ok: 'Enviar e-mail',
            onOk: function () {
              Cloud.sendReset(e.email).then(function () { UI.toast('E-mail enviado para ' + e.email, { icon: 'mail', ms: 4000 }); },
                function (er) { UI.toast(er.message || 'Não foi possível enviar o e-mail.', { tone: 'crit', ms: 5000 }); });
            } });
        });
        if (temp && !cloud) temp.addEventListener('click', function () {
          UI.confirm({ title: 'Gerar senha provisória?', body: 'A senha atual de ' + esc(e.name.split(' ')[0]) + ' deixa de funcionar. No próximo acesso, a pessoa cria uma senha nova.', ok: 'Gerar senha provisória',
            onOk: function () {
              var pw = Auth.tempPassword();
              Auth.makePass(pw).then(function (pass) {
                DB.update(function () { var t = find(id); t.pass = pass; t.mustChange = true; });
                tempShown[id] = pw; go('equipe/ok/' + id + '/senha', { replace: true });
              });
            } });
        });
        var toggle = $('[data-toggle]');
        if (toggle) toggle.addEventListener('click', function () {
          var off = e.active;
          var run = function () {
            DB.update(function () { find(id).active = !off; });
            if (cloud) Cloud.updateMember(id, { active: !off }); // o servidor corta (ou devolve) o acesso na hora
            refresh(); UI.toast(e.name.split(' ')[0] + (off ? ' foi desativado' : ' foi reativado'));
          };
          if (off) UI.confirm({ title: 'Desativar ' + e.name.split(' ')[0] + '?', body: 'A pessoa perde o acesso ao app na hora. Contagens, checklists e chamados que ela fez continuam no histórico.', ok: 'Desativar', danger: true, onOk: run });
          else run();
        });

        var save = $('[data-save]');
        save.addEventListener('click', function () {
          v.name = $('#emp-name').value.trim().replace(/\s+/g, ' ');
          v.phone = digits($('#emp-phone').value);
          v.email = $('#emp-email').value.trim();
          v.admission = $('#emp-adm').value || v.admission;
          var bad = [];
          var dup = DB.get().employees.filter(function (x) { return x.phone === v.phone && (!e || x.id !== e.id); })[0];
          setErr('f-name', v.name.split(' ').length < 2 ? 'Informe nome e sobrenome.' : ''); if (v.name.split(' ').length < 2) bad.push('f-name');
          var phoneMsg = v.phone.length < 10 ? 'Informe o celular com DDD.' : dup ? 'Este celular já está cadastrado para ' + dup.name + '.' : '';
          setErr('f-phone', phoneMsg); if (phoneMsg) bad.push('f-phone');
          v.email = Auth.normEmail(v.email);
          var dupMail = DB.get().employees.filter(function (x) { return Auth.normEmail(x.email) === v.email && (!e || x.id !== e.id); })[0];
          var mailMsg = !v.email ? 'Informe o e-mail: é com ele que a pessoa entra.' : !Auth.validEmail(v.email) ? 'Confira o e-mail: falta o @ ou o domínio.' : dupMail ? 'Este e-mail já é de ' + dupMail.name + '.' : '';
          setErr('f-email', mailMsg); if (mailMsg) bad.push('f-email');
          setErr('f-func', v.func ? '' : 'Escolha a função.'); if (!v.func) bad.push('f-func');
          if (bad.length) { $('#' + bad[0]).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

          UI.busy(save, function () {
            if (e) {
              var roleChanged = e.role !== v.role;
              DB.update(function (x) { var t = x.employees.filter(function (y) { return y.id === e.id; })[0]; ['name', 'phone', 'email', 'func', 'unit', 'shift', 'role', 'admission'].forEach(function (k) { t[k] = v[k]; }); });
              if (cloud && roleChanged) Cloud.updateMember(e.id, { role: v.role });
              UI.buzz(20); UI.toast('Dados de ' + v.name.split(' ')[0] + ' atualizados'); go('equipe', { replace: true });
              return;
            }
            // Cadastro novo: senha provisória gerada aqui; no primeiro acesso a pessoa cria a própria.
            var pw = Auth.tempPassword(), newId = 'c' + Date.now();
            var rec = { id: newId, name: v.name, phone: v.phone, email: v.email, func: v.func, unit: v.unit, shift: v.shift, role: v.role, admission: v.admission, pin: newPin(), mustChange: true, active: true };
            if (cloud) {
              // Com servidor: cria o login da pessoa no Supabase e liga à equipe; a senha não fica no app.
              save.classList.add('busy'); save.disabled = true;
              Cloud.createUser(v.email, pw).then(function (uid) { return Cloud.addMember(uid, newId, v.role); }).then(function () {
                DB.update(function (x) { x.employees.push(rec); });
                Cloud.schedule(true);
                tempShown[newId] = pw; UI.buzz(20);
                go('equipe/ok/' + newId, { replace: true });
              }, function (er) {
                save.classList.remove('busy'); save.disabled = false;
                setErr('f-email', er.message || 'Não foi possível criar o acesso.');
                $('#f-email').scrollIntoView({ block: 'center', behavior: 'smooth' });
              });
              return;
            }
            Auth.makePass(pw).then(function (pass) {
              DB.update(function (x) { x.employees.push({ id: newId, name: v.name, phone: v.phone, email: v.email, func: v.func, unit: v.unit, shift: v.shift, role: v.role, admission: v.admission, pin: newPin(), pass: pass, mustChange: true, active: true }); });
              tempShown[newId] = pw; UI.buzz(20);
              go('equipe/ok/' + newId, { replace: true });
            });
          });
        });
      }
    };
  }

  // ---------- Confirmação do cadastro ----------
  // Senha provisória só fica na memória desta tela, para mostrar uma vez; no aparelho fica guardado só o hash.
  var tempShown = {};

  function accessText(e, pw) {
    return 'Olá, ' + e.name.split(' ')[0] + '! Seu acesso ao app da Dindom está pronto.\nE-mail: ' + e.email + (pw ? '\nSenha provisória: ' + pw + ' (no primeiro acesso você cria a sua)' : '') + '\nCódigo do ponto: ' + e.pin;
  }

  function done(id, reset) {
    var e = find(id);
    if (!e) return list();
    var pw = tempShown[id];
    var html = '<main class="screen no-nav" style="justify-content:center;align-items:center;text-align:center">' +
      '<div class="success-mark">' + icon('check', 'lg') + '</div>' +
      '<div class="section" style="align-items:center"><div class="eyebrow">' + (reset ? 'Senha provisória gerada' : 'Colaborador cadastrado') + '</div>' +
      '<h1 style="font-size:var(--fs-2xl)">' + esc(e.name) + '</h1>' +
      '<p class="muted">' + esc(e.func) + ' · ' + esc(unitName(e.unit)) + ' · ' + UI.ROLES[e.role] + '</p></div>' +
      '<div class="card access-card"><div class="eyebrow">Dados de acesso</div>' +
      '<div class="access-row"><span>E-mail</span><b>' + esc(e.email) + '</b></div>' +
      (pw ? '<div class="access-row"><span>Senha provisória</span><b class="num temp-pass">' + esc(pw) + '</b></div>' : '') +
      '<div class="access-row"><span>Código do ponto</span><b class="num">' + esc(e.pin) + '</b></div>' +
      '<p class="card-meta">' + (pw ? 'Anote ou copie agora: a senha provisória não aparece de novo. No primeiro acesso, ' + esc(e.name.split(' ')[0]) + ' cria a própria senha.' : 'A senha provisória já foi mostrada. Se precisar, gere outra no cadastro.') + '</p></div>' +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner" style="flex-direction:column;gap:8px">' +
      '<button type="button" class="btn primary block" data-copy>' + icon('copy', 'sm') + 'Copiar dados para enviar no WhatsApp</button>' +
      '<div style="display:flex;gap:8px;width:100%"><a class="btn block" href="#equipe/novo">Cadastrar outro</a><a class="btn block" href="#equipe">Ver equipe</a></div></div></div>';
    return {
      html: html, tab: 'equipe', nav: false,
      mount: function (root) {
        root.querySelector('[data-copy]').addEventListener('click', function () {
          try {
            navigator.clipboard.writeText(accessText(e, pw)).then(function () { UI.toast('Copiado. Cole na conversa com ' + e.name.split(' ')[0] + '.'); },
              function () { UI.toast('Não foi possível copiar. Anote os dados na tela.', { tone: 'crit', ms: 5000 }); });
          } catch (er) { UI.toast('Não foi possível copiar. Anote os dados na tela.', { tone: 'crit', ms: 5000 }); }
        });
      }
    };
  }

  Screens.equipe = function (params) {
    if (!UI.isAdmin()) return restricted();
    if (params[0] === 'novo') return form(null);
    if (params[0] === 'ok') return done(params[1], params[2] === 'senha');
    if (params[0]) return form(params[0]);
    return list();
  };
})();
