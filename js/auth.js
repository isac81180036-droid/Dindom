// Acesso: e-mail e senha. A senha nunca é guardada em texto: só o hash SHA-256 com um "sal" por pessoa.
// Protótipo: a conferência roda no aparelho. Com o servidor, ela passa para lá.
(function () {
  var MAX_FAILS = 5;
  var LOCK_MS = 5 * 60000;
  var ALIVE = 'dindom:alive'; // marca de "aba aberta", para sessões sem "lembrar neste aparelho"

  function alive(set) {
    try {
      if (set === true) sessionStorage.setItem(ALIVE, '1');
      else if (set === false) sessionStorage.removeItem(ALIVE);
      return sessionStorage.getItem(ALIVE) === '1';
    } catch (e) { return true; }
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }

  var Auth = {};

  Auth.normEmail = function (s) { return String(s || '').trim().toLowerCase(); };
  Auth.validEmail = function (s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(Auth.normEmail(s)); };

  Auth.hash = function (salt, password) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password)).then(hex);
  };
  // Gera sal + hash para uma senha nova.
  Auth.makePass = function (password) {
    var salt = 'dd-' + Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(8)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return Auth.hash(salt, password).then(function (h) { return { salt: salt, hash: h }; });
  };

  // Senha provisória fácil de ditar: sem letras parecidas (l/1, O/0).
  Auth.tempPassword = function () {
    var L = 'abcdefghjkmnpqrstuvwxyz', N = '23456789', r = crypto.getRandomValues(new Uint8Array(8));
    var s = '';
    for (var i = 0; i < 4; i++) s += L[r[i] % L.length];
    s = s.charAt(0).toUpperCase() + s.slice(1);
    for (var j = 4; j < 8; j++) s += N[r[j] % N.length];
    return s; // ex.: Kbtr4827
  };

  // Regras de senha: devolve a mensagem do que falta, ou '' se estiver boa.
  Auth.passProblem = function (p) {
    if (p.length < 8) return 'Use pelo menos 8 caracteres.';
    if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'Misture letras e números.';
    return '';
  };

  Auth.session = function () {
    var d = DB.get(), s = d.session;
    if (!s) return null;
    if (window.Cloud && Cloud.enabled && !Cloud.orgId) return null; // com servidor, só vale a sessão ligada à pizzaria
    var emp = d.employees.filter(function (e) { return e.id === s.empId; })[0];
    if (!emp || !emp.active || (!s.remember && !alive())) { Auth.logout(true); return null; }
    return s;
  };

  Auth.lockedFor = function () {
    var g = DB.get().loginGuard || {};
    return g.until && g.until > Date.now() ? g.until - Date.now() : 0;
  };

  function fail() {
    DB.update(function (x) {
      var g = x.loginGuard = x.loginGuard || { fails: 0 };
      g.fails = (g.fails || 0) + 1;
      if (g.fails >= MAX_FAILS) { g.until = Date.now() + LOCK_MS; g.fails = 0; }
    });
    if (Auth.lockedFor()) return { error: 'locked' };
    var left = MAX_FAILS - (DB.get().loginGuard.fails || 0);
    // Mesma mensagem para e-mail ou senha errados: não revela quem tem cadastro.
    return { error: 'E-mail ou senha incorretos.' + (left <= 2 ? ' Mais ' + left + (left === 1 ? ' tentativa' : ' tentativas') + ' antes de bloquear por 5 minutos.' : ''), field: 'pass' };
  }

  function start(emp, remember) {
    DB.update(function (x) {
      x.loginGuard = { fails: 0 };
      x.session = { empId: emp.id, remember: !!remember, at: Date.now() };
      // O app inteiro lê o usuário daqui: nome, nível de acesso e unidade vêm do cadastro.
      x.user.name = emp.name; x.user.role = emp.role; x.user.unit = emp.unit; x.user.empId = emp.id;
    });
    alive(true);
  }

  // Login pelo Supabase: a senha é conferida no servidor; depois liga o aparelho à pizzaria.
  function cloudLogin(e, password, remember) {
    var offline = { error: 'Sem conexão com o servidor. Confira a internet e tente de novo.', field: 'pass' };
    return Cloud.client.auth.signInWithPassword({ email: e, password: password }).then(function (r) {
      if (r.error) return r.error.status === 0 || /fetch|network/i.test(r.error.message) ? offline : fail();
      return Cloud.attach(r.data.user).then(function (a) {
        if (!a.ok) {
          Cloud.signOut();
          return { error: a.error === 'inactive' ? 'Seu acesso está desativado. Fale com o gerente da unidade.'
            : a.error === 'network' ? offline.error : 'Esta conta não faz parte da equipe da pizzaria.', field: 'email' };
        }
        var d = DB.get();
        var emp = d.employees.filter(function (x) { return x.id === a.member.emp_id; })[0]
          || { id: a.member.emp_id, name: e.split('@')[0], unit: (d.units[0] || {}).id, active: true };
        emp = Object.assign({}, emp, { role: a.member.role }); // o nível de acesso que vale é o do servidor
        start(emp, remember);
        return { ok: true, emp: emp, mustChange: !!emp.mustChange };
      });
    }, function () { return offline; });
  }

  // "Esqueci minha senha": com servidor, manda um link por e-mail para criar uma senha nova.
  Auth.forgot = function (email) {
    if (!(window.Cloud && Cloud.enabled)) return Promise.reject(new Error('local'));
    return Cloud.sendReset(Auth.normEmail(email));
  };

  // Promessa de { ok, emp, mustChange } ou { error, field }.
  Auth.login = function (email, password, remember) {
    if (Auth.lockedFor()) return Promise.resolve({ error: 'locked' });
    var e = Auth.normEmail(email);
    if (!Auth.validEmail(e)) return Promise.resolve({ error: 'Confira o e-mail: falta o @ ou o domínio.', field: 'email' });
    if (!password) return Promise.resolve({ error: 'Digite a sua senha.', field: 'pass' });
    if (window.Cloud && Cloud.enabled) return cloudLogin(e, password, remember);
    var emp = DB.get().employees.filter(function (x) { return Auth.normEmail(x.email) === e; })[0];
    if (emp && !emp.active) return Promise.resolve({ error: 'Seu acesso está desativado. Fale com o gerente da unidade.', field: 'email' });
    if (!emp || !emp.pass) {
      // Faz o mesmo trabalho de conferir, para o tempo de resposta não denunciar que o e-mail não existe.
      return Auth.hash('dd-x', password).then(function () { return fail(); });
    }
    return Auth.hash(emp.pass.salt, password).then(function (h) {
      if (h !== emp.pass.hash) return fail();
      start(emp, remember);
      return { ok: true, emp: emp, mustChange: !!emp.mustChange };
    });
  };

  // Entrou com senha provisória: precisa criar a própria antes de usar o app.
  Auth.mustChange = function () {
    var s = DB.get().session; if (!s) return false;
    var e = DB.get().employees.filter(function (y) { return y.id === s.empId; })[0];
    return !!(e && e.mustChange);
  };

  // Troca de senha (primeiro acesso ou pelo Perfil).
  Auth.changePassword = function (empId, password) {
    if (window.Cloud && Cloud.orgId) {
      return Cloud.client.auth.updateUser({ password: password }).then(function (r) {
        if (r.error) throw new Error(/same|different/i.test(r.error.message) ? 'A nova senha precisa ser diferente da atual.' : 'Não foi possível trocar a senha: ' + r.error.message);
        DB.update(function (x) { var e = x.employees.filter(function (y) { return y.id === empId; })[0]; if (e) e.mustChange = false; });
      });
    }
    return Auth.makePass(password).then(function (pass) {
      DB.update(function (x) { var e = x.employees.filter(function (y) { return y.id === empId; })[0]; e.pass = pass; e.mustChange = false; });
    });
  };

  Auth.logout = function (silent) {
    if (window.Cloud && Cloud.enabled) Cloud.signOut();
    DB.update(function (x) { x.session = null; });
    alive(false);
    if (!silent) go('login', { replace: true });
  };

  window.Auth = Auth;
})();
