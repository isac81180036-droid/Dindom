// Login: marca em verde-escuro com a logo branca e formulário de e-mail e senha.
// Também a etapa "Crie sua senha" de quem entrou com senha provisória (rota login/senha).
(function () {
  var esc = UI.esc;
  var DEMO = [
    { label: 'Administrador', email: 'admin@dindom.com.br', pass: 'Dindom2009' },
    { label: 'Gerente', email: 'juliana@dindom.com.br', pass: 'Gerente123' },
    { label: 'Colaborador', email: 'marina@dindom.com.br', pass: 'Equipe123' }
  ];

  function mmss(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function brand() {
    // Logo no canto superior direito; saudação embaixo, à esquerda, para o verde não ficar vazio.
    // No computador, um notebook flutuando mostra telas reais do sistema (só decoração).
    return '<section class="login-brand">' +
      '<img class="login-logo" src="icons/logo-white.png" alt="Dindom, desde 2009">' +
      '<div class="login-hello"><p class="login-tag">Gestão da pizzaria</p>' +
      '<h2>' + UI.greeting() + '!</h2>' +
      '<p>Ponto, estoque, agenda e equipe da Dindom num lugar só.</p></div>' +
      '<div class="login-device" aria-hidden="true"><div class="ld-float">' +
      '<div class="ld-lid"><div class="ld-cam"></div><div class="ld-screen">' +
      SHOTS.map(function (s, i) { return '<img src="' + s + '" alt=""' + (i ? '' : ' class="on"') + ' loading="lazy">'; }).join('') +
      '</div></div><div class="ld-base"><i></i></div></div><div class="ld-shadow"></div></div>' +
      '</section>';
  }

  var SHOTS = ['img/tela-inicio.png', 'img/tela-agenda.png', 'img/tela-ponto.png'];

  // Troca a tela do notebook a cada 4 s. Devolve a função que para.
  function slides(root) {
    var imgs = root.querySelectorAll('.ld-screen img'), i = 0;
    if (!window.isDesktop() || imgs.length < 2) return function () {};
    var t = setInterval(function () {
      imgs[i].classList.remove('on'); i = (i + 1) % imgs.length; imgs[i].classList.add('on');
    }, 4000);
    return function () { clearInterval(t); };
  }

  function passField(id, label, autocomplete, placeholder) {
    return '<div class="field" id="f-' + id + '"><label for="' + id + '">' + label + '</label>' +
      '<div class="input-icon pass-wrap">' + icon('key', 'sm') +
      '<input id="' + id + '" class="input" type="password" autocomplete="' + autocomplete + '" placeholder="' + placeholder + '">' +
      '<button type="button" class="icon-btn plain pass-eye" data-eye="' + id + '" aria-label="Mostrar senha">' + icon('eye', 'sm') + '</button></div></div>';
  }

  function bindEyes(root) {
    root.querySelectorAll('[data-eye]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = root.querySelector('#' + b.dataset.eye), show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
        b.innerHTML = icon(show ? 'eyeOff' : 'eye', 'sm');
        inp.focus();
      });
    });
  }

  function leave(root, emp) {
    UI.buzz(20);
    root.querySelector('.login').classList.add('leaving');
    setTimeout(function () {
      go(Auth.after || 'inicio', { replace: true }); Auth.after = null;
      UI.toast(UI.greeting() + ', ' + emp.name.split(' ')[0]);
    }, 260);
  }

  // ---------- Entrar ----------
  function signIn() {
    var html = '<main class="login">' + brand() +
      '<section class="login-card"><form class="login-form" novalidate>' +
      '<div class="eyebrow">Acesso da equipe</div><h1>Entrar</h1>' +
      '<p class="muted">Use o e-mail e a senha do seu cadastro.</p>' +
      '<div class="field" id="f-l-email"><label for="l-email">E-mail</label>' +
      '<div class="input-icon">' + icon('mail', 'sm') + '<input id="l-email" class="input" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="nome@dindom.com.br"></div></div>' +
      passField('l-pass', 'Senha', 'current-password', 'Sua senha') +
      '<p class="login-err" id="l-err" role="alert" hidden></p>' +
      '<label class="login-remember" for="l-remember"><input id="l-remember" type="checkbox" class="switch" checked><span>Lembrar neste aparelho</span></label>' +
      '<button type="submit" class="btn primary block login-go" data-go>Entrar</button>' +
      '<button type="button" class="btn ghost login-forgot" data-forgot>Esqueci minha senha</button>' +
      '<details class="login-demo"><summary>' + icon('sparkle', 'sm') + 'Contas de demonstração</summary>' +
      '<div class="login-demo-list">' + DEMO.map(function (d, i) { return '<button type="button" class="chip" data-demo="' + i + '">' + esc(d.label) + '</button>'; }).join('') + '</div>' +
      '<p class="card-meta">Preenche e-mail e senha de exemplo. Some quando o app for para produção.</p></details>' +
      '</form></section></main>';

    return {
      html: html, tab: '', nav: false,
      mount: function (root) {
        var form = root.querySelector('form'), email = root.querySelector('#l-email'), pass = root.querySelector('#l-pass');
        var err = root.querySelector('#l-err'), btn = root.querySelector('[data-go]'), lockTimer = 0;
        bindEyes(root);

        function setErr(msg, field) {
          err.hidden = !msg; err.textContent = msg || '';
          root.querySelector('#f-l-email').classList.toggle('error', field === 'email');
          root.querySelector('#f-l-pass').classList.toggle('error', field === 'pass');
        }
        function lockState() {
          var ms = Auth.lockedFor();
          clearTimeout(lockTimer);
          btn.disabled = !!ms;
          if (ms) { setErr('Muitas tentativas erradas. Tente de novo em ' + mmss(ms) + '.'); lockTimer = setTimeout(lockState, 1000); }
          else if (err.textContent.indexOf('Muitas tentativas') === 0) setErr('');
        }
        [email, pass].forEach(function (i) { i.addEventListener('input', function () { if (!Auth.lockedFor()) setErr(''); }); });

        function submit() {
          if (btn.classList.contains('busy') || Auth.lockedFor()) return;
          btn.classList.add('busy');
          var started = Date.now();
          Auth.login(email.value, pass.value, root.querySelector('#l-remember').checked).then(function (r) {
            // Pequena espera mínima: dá retorno visual e dificulta tentativas em sequência.
            setTimeout(function () {
              btn.classList.remove('busy');
              if (r.ok) {
                if (r.mustChange) { go('login/senha', { replace: true }); return; }
                return leave(root, r.emp);
              }
              UI.buzz(50);
              if (r.error === 'locked') return lockState();
              setErr(r.error, r.field);
              if (r.field === 'pass') { pass.value = ''; pass.focus(); } else email.focus();
            }, Math.max(0, 450 - (Date.now() - started)));
          });
        }
        form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

        root.querySelector('[data-forgot]').addEventListener('click', function () {
          UI.sheet('<h2>Esqueceu a senha?</h2><p class="muted">Peça ao gerente ou ao administrador uma <b>senha provisória</b> em <b>Admin › Colaboradores</b>. No primeiro acesso com ela, você cria uma senha nova.</p>' +
            '<button type="button" class="btn primary block" data-close>Entendi</button>');
        });
        root.querySelectorAll('[data-demo]').forEach(function (b) {
          b.addEventListener('click', function () {
            var d = DEMO[Number(b.dataset.demo)];
            email.value = d.email; pass.value = d.pass; setErr(''); submit();
          });
        });

        lockState();
        if (window.isDesktop()) email.focus();
        var stopSlides = slides(root);
        return function () { clearTimeout(lockTimer); stopSlides(); };
      }
    };
  }

  // ---------- Primeiro acesso: criar a própria senha ----------
  function newPassword() {
    var s = DB.get().session;
    var emp = s && DB.get().employees.filter(function (e) { return e.id === s.empId; })[0];
    if (!emp) return signIn();
    var html = '<main class="login">' + brand() +
      '<section class="login-card"><form class="login-form" novalidate>' +
      (emp.mustChange ? '<div class="eyebrow">Primeiro acesso</div><h1>Crie sua senha</h1>' +
        '<p class="muted">Olá, ' + esc(emp.name.split(' ')[0]) + '! Você entrou com uma senha provisória. Escolha uma senha só sua para continuar.</p>'
        : '<div class="eyebrow">Perfil</div><h1>Alterar senha</h1><p class="muted">Escolha a nova senha. Ela vale a partir do próximo acesso.</p>') +
      passField('n-pass', 'Nova senha', 'new-password', 'Pelo menos 8 caracteres') +
      '<ul class="pass-rules" data-rules><li data-r="len">8 caracteres ou mais</li><li data-r="mix">Letras e números</li></ul>' +
      passField('n-pass2', 'Repita a nova senha', 'new-password', 'Digite de novo') +
      '<p class="login-err" id="n-err" role="alert" hidden></p>' +
      '<button type="submit" class="btn primary block login-go" data-go>Salvar e entrar</button>' +
      '<button type="button" class="btn ghost login-forgot" data-out>' + (emp.mustChange ? 'Sair' : 'Cancelar') + '</button>' +
      '</form></section></main>';

    return {
      html: html, tab: '', nav: false,
      mount: function (root) {
        var p1 = root.querySelector('#n-pass'), p2 = root.querySelector('#n-pass2'), err = root.querySelector('#n-err'), btn = root.querySelector('[data-go]');
        bindEyes(root);
        p1.addEventListener('input', function () {
          root.querySelector('[data-r="len"]').classList.toggle('ok', p1.value.length >= 8);
          root.querySelector('[data-r="mix"]').classList.toggle('ok', /[a-zA-Z]/.test(p1.value) && /\d/.test(p1.value));
          err.hidden = true;
        });
        p2.addEventListener('input', function () { err.hidden = true; });
        root.querySelector('form').addEventListener('submit', function (e) {
          e.preventDefault();
          var problem = Auth.passProblem(p1.value) || (p1.value !== p2.value ? 'As duas senhas estão diferentes.' : '');
          if (problem) { err.hidden = false; err.textContent = problem; (p1.value !== p2.value && !Auth.passProblem(p1.value) ? p2 : p1).focus(); return; }
          if (btn.classList.contains('busy')) return;
          btn.classList.add('busy');
          var first = emp.mustChange;
          Auth.changePassword(emp.id, p1.value).then(function () {
            btn.classList.remove('busy');
            if (first) return leave(root, emp);
            go('perfil', { replace: true }); UI.toast('Senha alterada');
          });
        });
        root.querySelector('[data-out]').addEventListener('click', function () { if (emp.mustChange) Auth.logout(); else go('perfil', { replace: true }); });
        p1.focus();
        return slides(root);
      }
    };
  }

  Screens.login = function (params) { return params && params[0] === 'senha' ? newPassword() : signIn(); };
})();
