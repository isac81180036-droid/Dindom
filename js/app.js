// Roteador e casca do aplicativo: barra inferior, tema, conexão.
(function () {
  window.Screens = window.Screens || {};

  // A Agenda só entra no menu do computador; no celular a barra fica com 5 destinos e a Agenda abre pelo Início.
  var TABS = [
    { id: 'inicio', label: 'Início', icon: 'home' },
    { id: 'ponto', label: 'Ponto', icon: 'clock', desk: true },
    { id: 'agenda', label: 'Agenda', icon: 'calendar', desk: true },
    { id: 'estoque', label: 'Estoque', icon: 'box' },
    { id: 'checklists', label: 'Checklists', icon: 'checklist' },
    { id: 'manutencao', label: 'Manutenção', icon: 'wrench' },
    { id: 'perfil', label: 'Perfil', icon: 'user' }
  ];
  // Área do administrador: no computador aparece no menu lateral; no celular, pelo Perfil.
  var ADMIN_TABS = [
    { id: 'vendas', label: 'Vendas', icon: 'receipt' },
    { id: 'produtos', label: 'Produtos', icon: 'box' },
    { id: 'checklists/editar', label: 'Modelos de checklist', icon: 'checklist' },
    { id: 'equipe', label: 'Colaboradores', icon: 'users', admin: true },
    { id: 'parceiros', label: 'Parceiros', icon: 'file', admin: true }
  ];

  var current = 'inicio';
  var root, nav;

  function applyTheme() {
    var t = DB.get().prefs.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function badges() {
    var d = DB.get();
    var pendingTasks = d.checklists.reduce(function (n, c) { return n + (c.finishedAt ? 0 : 1); }, 0);
    var openMaint = d.maintenance.filter(function (m) { return m.status !== 'resolvida'; }).length;
    return { checklists: pendingTasks, manutencao: openMaint };
  }

  function renderNav(tab, show) {
    nav.hidden = !show;
    if (!show) return;
    var b = badges();
    var d = DB.get();
    var unit = d.units.filter(function (u) { return u.id === d.user.unit; })[0] || { name: '' };
    function item(t, cls) {
      return '<li' + (cls ? ' class="' + cls + '"' : '') + '><a href="#' + t.id + '"' + (t.id === tab ? ' aria-current="page"' : '') + '>' +
        icon(t.icon) + '<span>' + t.label + '</span>' +
        (b[t.id] ? '<span class="badge num">' + b[t.id] + '</span>' : '') + '</a></li>';
    }
    nav.innerHTML = '<div class="brand"><img class="logo-ink" src="icons/wordmark-black.png" alt="Dindom"><span class="since">DESDE 2009</span></div>' +
      (UI.isAccountant()
        // Contabilidade: só o ponto da equipe e o perfil.
        ? '<ul style="grid-template-columns:repeat(2,1fr)">' + item({ id: 'ponto', label: 'Ponto da equipe', icon: 'clock' }) + item({ id: 'perfil', label: 'Perfil', icon: 'user' })
        : '<ul>' + TABS.map(function (t) { return item(t, t.desk ? 'desk-only' : ''); }).join('')) +
      (UI.isManager() ? '<li class="desk-only nav-label">Gestão</li>' + ADMIN_TABS.filter(function (t) { return !t.admin || UI.isAdmin(); }).map(function (t) { return item(t, 'desk-only'); }).join('') : '') +
      '</ul>' +
      '<a class="nav-foot" href="#perfil"><span class="avatar">' + UI.esc(d.user.name.charAt(0)) + '</span>' +
      '<span class="grow"><b>' + UI.esc(d.user.name) + '</b><span class="muted">' + UI.esc(unit.name) + '</span></span></a>';
  }

  var unmount = null; // limpeza da tela anterior (ex.: desligar a câmera)

  function render() {
    if (unmount) { try { unmount(); } catch (e) {} unmount = null; }
    if (window.Cloud) Cloud.pendingRefresh = false; // esta tela já sai com o que veio de outros aparelhos
    // Aparelho ainda sem configuração: tudo leva à primeira configuração.
    if (!DB.get().setupDone) current = 'setup';
    else if (current === 'setup') current = 'inicio';
    // Sem sessão, qualquer tela leva ao login (e volta para ela depois de entrar).
    var logged = !!Auth.session();
    if (current === 'setup') {
      // segue para a tela de configuração
    } else if (!logged && current.split('/')[0] !== 'login') {
      Auth.after = current;
      current = 'login';
      try { history.replaceState(null, '', '#login'); } catch (e) {}
    } else if (logged && Auth.mustChange()) {
      current = 'login/senha'; // senha provisória: primeiro cria a própria
    } else if (logged && current.split('/')[0] === 'login' && current !== 'login/senha') {
      current = 'inicio';
      try { history.replaceState(null, '', '#inicio'); } catch (e) {}
    }
    // Contabilidade só chega ao ponto da equipe e ao perfil.
    if (logged && UI.isAccountant() && ['ponto', 'perfil', 'login', 'notificacoes'].indexOf(current.split('/')[0]) < 0) current = 'ponto/equipe';
    var parts = current.split('/');
    var screen = Screens[parts[0]] || Screens.inicio;
    var view = screen(parts.slice(1));
    // Cada tela ganha um contêiner novo, para que ouvintes de eventos não se acumulem entre renderizações.
    var host = document.createElement('div');
    host.className = 'view';
    host.innerHTML = view.html;
    root.replaceChildren(host);
    renderNav(view.tab || parts[0], view.nav !== false);
    window.scrollTo(0, 0);
    if (view.mount) unmount = view.mount(host) || null;
  }

  window.go = function (path, opts) {
    current = path.replace(/^#/, '') || 'inicio';
    try {
      if (opts && opts.replace) history.replaceState(null, '', '#' + current);
      else history.pushState(null, '', '#' + current);
    } catch (e) {}
    render();
  };
  window.route = function () { return current; };

  // Redesenha a tela atual sem perder a posição de rolagem.
  window.refresh = function () {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  };
  window.applyTheme = applyTheme;

  // Mesmo limite usado no CSS (css/desktop.css).
  var desk = window.matchMedia('(min-width: 900px)');
  window.isDesktop = function () { return desk.matches; };

  function boot() {
    root = document.getElementById('app');
    nav = document.getElementById('nav');
    applyTheme();

    // Links internos navegam pelo roteador, sem depender da barra de endereço.
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      go(a.getAttribute('href'));
    });
    window.addEventListener('popstate', function () {
      current = (location.hash || '#inicio').slice(1);
      render();
    });


    // Com o servidor ligado, confere a sessão e carrega os dados antes da primeira tela (a abertura cobre a espera).
    var first = function () {
      current = (location.hash || '#inicio').slice(1);
      if (/access_token=|type=recovery/.test(current)) current = 'inicio';
      render();
    };
    (window.Cloud && Cloud.enabled ? Cloud.start() : Promise.resolve()).then(first, first);

    // Abertura: a animação é só CSS; aqui só permite pular com um toque e tira o elemento ao terminar.
    var splash = document.getElementById('splash');
    if (splash) {
      var gone = function () { if (splash.parentNode) splash.remove(); };
      splash.addEventListener('click', function () { splash.classList.add('skip'); setTimeout(gone, 220); });
      splash.addEventListener('animationend', function (e) { if (e.target === splash && e.animationName === 'splash-out') gone(); });
      setTimeout(gone, 2600);
    }

    // Algumas telas mudam de estrutura entre celular e computador (ex.: Agenda): redesenha ao cruzar o limite.
    var onChange = function () { document.querySelectorAll('.sheet-wrap').forEach(function (s) { s.remove(); }); document.body.style.overflow = ''; render(); };
    if (desk.addEventListener) desk.addEventListener('change', onChange); else desk.addListener(onChange);

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {}
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
