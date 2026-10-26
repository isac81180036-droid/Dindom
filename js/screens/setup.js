// Primeira configuração: unidades, dias de reposição e a conta do administrador.
// Aparece uma única vez por aparelho, antes do login.
(function () {
  var esc = UI.esc;
  var DAYS = [['0', 'Dom'], ['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb']];

  function unitInput(i, value) {
    return '<div class="unit-line" data-line><input class="input" data-unit-name maxlength="40" placeholder="' + (i ? 'Ex.: Unidade Jardins' : 'Ex.: Unidade Centro') + '" value="' + esc(value || '') + '">' +
      (i ? '<button type="button" class="icon-btn plain" data-rm-unit aria-label="Remover unidade">' + icon('x', 'sm') + '</button>' : '') + '</div>';
  }

  Screens.setup = function () {
    var L = window.LoginUI;
    var html = '<main class="login">' + L.brand('Bem-vindo!', 'Vamos deixar o sistema da sua pizzaria pronto para usar. Leva um minuto.') +
      '<section class="login-card"><form class="login-form setup-form" novalidate>' +
      '<div class="eyebrow">Primeira configuração</div><h1>Configurar</h1>' +

      '<div class="setup-step"><span class="step-n">1</span><div class="grow"><h3>Unidades</h3><p class="muted">Os nomes das lojas da pizzaria.</p></div></div>' +
      '<div class="field" id="f-units"><div data-units>' + unitInput(0, '') + '</div>' +
      '<button type="button" class="btn ghost sm" data-add-unit style="align-self:flex-start;padding:0">' + icon('plus', 'sm') + 'Adicionar outra unidade</button>' +
      '<span class="err" hidden>Informe o nome da unidade.</span></div>' +

      '<div class="setup-step"><span class="step-n">2</span><div class="grow"><h3>Dias de reposição</h3><p class="muted">Em quais dias as compras chegam? O fechamento do estoque calcula o que comprar para cada um.</p></div></div>' +
      '<div class="field" id="f-days"><div class="chips wrap" data-days>' + DAYS.map(function (d) {
        return '<button type="button" class="chip" data-day="' + d[0] + '" aria-pressed="false">' + d[1] + '</button>';
      }).join('') + '</div><span class="err" hidden>Escolha pelo menos um dia.</span></div>' +

      '<div class="setup-step"><span class="step-n">3</span><div class="grow"><h3>Sua conta de administrador</h3><p class="muted">Com ela você cadastra produtos, checklists e a equipe.</p></div></div>' +
      '<div class="field" id="f-s-name"><label for="s-name">Nome completo</label><input id="s-name" class="input" autocomplete="name" autocapitalize="words" maxlength="60"><span class="err" hidden>Informe nome e sobrenome.</span></div>' +
      '<div class="field" id="f-s-email"><label for="s-email">E-mail</label><div class="input-icon">' + icon('mail', 'sm') +
      '<input id="s-email" class="input" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="voce@dindom.com.br"></div><span class="err" hidden>Confira o e-mail.</span></div>' +
      L.passField('s-pass', 'Senha', 'new-password', 'Pelo menos 8 caracteres') +
      '<ul class="pass-rules"><li data-r="len">8 caracteres ou mais</li><li data-r="mix">Letras e números</li></ul>' +
      L.passField('s-pass2', 'Repita a senha', 'new-password', 'Digite de novo') +
      '<p class="login-err" id="s-err" role="alert" hidden></p>' +
      '<button type="submit" class="btn primary block login-go" data-go>Concluir e entrar</button>' +
      '<p class="card-meta">Os dados ficam salvos neste aparelho. Use o mesmo aparelho para a equipe, ou peça a ligação com o servidor para usar em vários.</p>' +
      '</form></section></main>';

    return {
      html: html, tab: '', nav: false,
      mount: function (root) {
        function $(s) { return root.querySelector(s); }
        L.bindEyes(root);
        var days = {};

        $('[data-add-unit]').addEventListener('click', function () {
          var box = $('[data-units]');
          if (box.querySelectorAll('[data-line]').length >= 10) return;
          box.insertAdjacentHTML('beforeend', unitInput(box.querySelectorAll('[data-line]').length, ''));
          box.lastElementChild.querySelector('input').focus();
        });
        $('[data-units]').addEventListener('click', function (e) { var b = e.target.closest('[data-rm-unit]'); if (b) b.closest('[data-line]').remove(); });
        $('[data-days]').addEventListener('click', function (e) {
          var b = e.target.closest('[data-day]'); if (!b) return;
          days[b.dataset.day] = !days[b.dataset.day];
          b.setAttribute('aria-pressed', !!days[b.dataset.day]);
          $('#f-days').classList.remove('error'); $('#f-days .err').hidden = true;
        });
        $('#s-pass').addEventListener('input', function () {
          var v = $('#s-pass').value;
          $('[data-r="len"]').classList.toggle('ok', v.length >= 8);
          $('[data-r="mix"]').classList.toggle('ok', /[a-zA-Z]/.test(v) && /\d/.test(v));
        });

        function setErr(id, bad) { var f = $('#' + id); f.classList.toggle('error', bad); var e = f.querySelector('.err'); if (e) e.hidden = !bad; return bad; }

        root.querySelector('form').addEventListener('submit', function (e) {
          e.preventDefault();
          var units = [].map.call(root.querySelectorAll('[data-unit-name]'), function (i) { return i.value.trim(); }).filter(Boolean);
          var dayList = Object.keys(days).filter(function (k) { return days[k]; }).map(Number);
          var name = $('#s-name').value.trim().replace(/\s+/g, ' '), email = Auth.normEmail($('#s-email').value);
          var p1 = $('#s-pass').value, p2 = $('#s-pass2').value, err = $('#s-err');
          var bad = [];
          if (setErr('f-units', !units.length)) bad.push('f-units');
          if (setErr('f-days', !dayList.length)) bad.push('f-days');
          if (setErr('f-s-name', name.split(' ').length < 2)) bad.push('f-s-name');
          if (setErr('f-s-email', !Auth.validEmail(email))) bad.push('f-s-email');
          var pp = Auth.passProblem(p1) || (p1 !== p2 ? 'As duas senhas estão diferentes.' : '');
          err.hidden = !pp; err.textContent = pp;
          if (pp) bad.push('f-s-pass');
          if (bad.length) { $('#' + bad[0]).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

          var btn = $('[data-go]');
          if (btn.classList.contains('busy')) return;
          btn.classList.add('busy');
          Auth.makePass(p1).then(function (pass) {
            DB.update(function (x) {
              x.units = units.map(function (n, i) { return { id: 'u' + (i + 1), name: n }; });
              x.deliveryDays = dayList;
              x.stock = {}; x.units.forEach(function (u) { x.stock[u.id] = {}; });
              x.employees.push({ id: 'c' + Date.now(), name: name, phone: '', email: email, func: 'Gerente', role: 'admin', unit: 'u1', shift: 'Tarde',
                admission: Cal.today(), pin: String(Math.floor(1000 + Math.random() * 9000)), pass: pass, mustChange: false, active: true, ponto: false });
              x.user.unit = 'u1';
              x.deliveries = DB.deliveries(dayList); // próximas reposições
              x.closing.delivery = x.deliveries[0].id;
              x.setupDone = true;
            });
            return Auth.login(email, p1, true);
          }).then(function (r) {
            btn.classList.remove('busy');
            if (!r || !r.ok) { err.hidden = false; err.textContent = 'Não foi possível entrar. Tente pela tela de login.'; return; }
            UI.buzz(25);
            go('inicio', { replace: true });
            UI.toast('Tudo pronto! Comece cadastrando os produtos e a equipe.', { ms: 4500 });
          });
        });

        $('[data-units] input').focus();
        return L.slides(root);
      }
    };
  };
})();
