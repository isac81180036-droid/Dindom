// Sincronização com o Supabase: login, carga dos dados da pizzaria, envio das alterações e tempo real.
// Cada item (um produto, um ponto, um chamado…) vira uma linha na tabela "records"; configurações
// e documentos únicos (estoque, lista de compras…) ficam na coleção "meta".
// Sem configuração (js/config.js vazio), o app funciona só neste aparelho, como antes.
(function () {
  var cfg = window.DINDOM_CONFIG || {};
  // Listas sincronizadas item a item e o campo que identifica cada item.
  var ITEMS = { employees: 'id', products: 'id', checklists: 'id', events: 'id', maintenance: 'id', notifications: 'id',
    stores: 'id', punches: 'id', adjusts: 'id', notas: 'key', units: 'id', calendars: 'id', stations: 'id', counts: 'id' };
  // Documentos únicos, sincronizados inteiros.
  var META = ['org', 'deliveryDays', 'categories', 'closing', 'shopping', 'checkHistory', 'nextMaintenanceId', 'settings',
    'functions', 'prices', 'stock', 'matchMemory', 'shifts'];
  var PAGE = 1000;
  var LAST = 'dindom:member'; // último vínculo usado, para abrir sem internet

  var Cloud = {
    enabled: !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient),
    ITEMS: ITEMS, META: META,
    orgId: null, user: null, member: null,
    status: 'off',          // off | ok | saving | offline
    pendingRefresh: false,
    recovery: false
  };
  var client = null, snapshot = {}, timer = 0, retryTimer = 0, channel = null, pushing = false, again = false;

  if (Cloud.enabled) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'dindom-auth' }
    });
  }
  Cloud.client = client;

  function k(col, id) { return col + '|' + id; }
  function readLast() { try { return JSON.parse(localStorage.getItem(LAST) || 'null'); } catch (e) { return null; } }
  function writeLast(m) { try { if (m) localStorage.setItem(LAST, JSON.stringify(m)); else localStorage.removeItem(LAST); } catch (e) {} }
  function netError(err) { return !err || err.status === 0 || /fetch|network|Failed to/i.test(String(err.message || err)); }

  // Estado do app → linhas { collection, id, data }.
  function flatten(d) {
    var out = {};
    Object.keys(ITEMS).forEach(function (col) {
      var idf = ITEMS[col];
      (d[col] || []).forEach(function (it) {
        if (it && it[idf] != null) out[k(col, it[idf])] = { collection: col, id: String(it[idf]), data: it };
      });
    });
    META.forEach(function (m) { if (d[m] !== undefined) out[k('meta', m)] = { collection: 'meta', id: m, data: { v: d[m] } }; });
    return out;
  }

  // Linhas do banco → partes do estado do app.
  function build(rows) {
    var shared = {};
    Object.keys(ITEMS).forEach(function (col) { shared[col] = []; });
    rows.forEach(function (r) {
      if (r.deleted) return;
      if (r.collection === 'meta') shared[r.id] = r.data ? r.data.v : null;
      else if (shared[r.collection]) shared[r.collection].push(r.data);
    });
    // Ordem estável: pontos por horário; os demais, na ordem de criação aproximada pelo id.
    shared.punches.sort(function (a, b) { return a.ts - b.ts; });
    return shared;
  }

  function loadAll() {
    var rows = [];
    function page(from) {
      return client.from('records').select('collection,id,data,deleted').eq('org_id', Cloud.orgId)
        .order('collection').order('id').range(from, from + PAGE - 1)
        .then(function (r) {
          if (r.error) throw r.error;
          rows = rows.concat(r.data);
          return r.data.length === PAGE ? page(from + PAGE) : rows;
        });
    }
    return page(0).then(function (all) {
      snapshot = {};
      all.forEach(function (r) { if (!r.deleted) snapshot[k(r.collection, r.id)] = JSON.stringify(r.collection === 'meta' ? r.data : r.data); });
      DB.setShared(build(all));
    });
  }

  // Aplica um item que veio do servidor. Retorna false se não mudou nada.
  function receive(row) {
    var key = k(row.collection, row.id), json = JSON.stringify(row.data);
    if (!row.deleted && snapshot[key] === json) return false; // eco do que este aparelho mesmo enviou
    var isNew = !snapshot[key];
    DB.applyRemote(row);
    if (row.deleted) delete snapshot[key]; else snapshot[key] = json;
    if (row.collection === 'punches' && row.data) showNsr(row.data);
    // Reserva nova pelo link público (supabase/005_reservas.sql): avisa quem está com o app aberto.
    if (isNew && !row.deleted && row.collection === 'events' && row.data && row.data.reserva) {
      try { window.dispatchEvent(new CustomEvent('dindom:reserva', { detail: row.data })); } catch (e) {}
    }
    return true;
  }

  function subscribe() {
    if (channel) { client.removeChannel(channel); channel = null; }
    channel = client.channel('dindom-' + Cloud.orgId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'org_id=eq.' + Cloud.orgId }, function (p) {
        var row = p.new; if (!row || !row.collection) return;
        if (receive(row)) refreshSoon();
      })
      .subscribe();
  }

  // Busca agora itens que o próprio servidor montou (ex.: o evento de uma reserva), sem esperar o tempo real.
  Cloud.pull = function (col, ids) {
    return client.from('records').select('collection,id,data,deleted').eq('org_id', Cloud.orgId).eq('collection', col).in('id', ids)
      .then(function (r) { if (r.error) throw r.error; r.data.forEach(receive); });
  };

  // Redesenha a tela com o que chegou de outro aparelho, sem atrapalhar quem está digitando.
  var refreshTimer = 0;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      var a = document.activeElement;
      var typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (typing || document.querySelector('.sheet-wrap')) { Cloud.pendingRefresh = true; return; }
      if (window.refresh) window.refresh();
    }, 350);
  }

  function showNsr(p) {
    if (!p.nsr) return;
    document.querySelectorAll('[data-nsr-for="' + p.id + '"]').forEach(function (el) { el.textContent = 'NSR ' + String(p.nsr).padStart(9, '0'); });
  }

  // Envia só o que mudou desde a última sincronização.
  function push() {
    if (!Cloud.orgId || !client) return;
    if (pushing) { again = true; return; }
    var cur = flatten(DB.get()), rows = [], marks = [];
    // Contabilidade só consulta: o único dado que envia é o próprio cadastro (ex.: após trocar a senha provisória).
    if (Cloud.readOnly) {
      var mine = k('employees', Cloud.member.emp_id), only = {};
      if (cur[mine]) only[mine] = cur[mine];
      cur = only;
    }
    Object.keys(cur).forEach(function (key) {
      var c = cur[key], j = JSON.stringify(c.data);
      if (snapshot[key] !== j) { rows.push({ org_id: Cloud.orgId, collection: c.collection, id: c.id, data: c.data, deleted: false }); marks.push([key, j]); }
    });
    Object.keys(snapshot).forEach(function (key) {
      if (cur[key] || Cloud.readOnly) return;
      var i = key.indexOf('|');
      rows.push({ org_id: Cloud.orgId, collection: key.slice(0, i), id: key.slice(i + 1), data: {}, deleted: true });
      marks.push([key, null]);
    });
    if (!rows.length) { Cloud.status = 'ok'; return; }
    pushing = true; Cloud.status = 'saving';
    var batches = [];
    for (var i = 0; i < rows.length; i += 400) batches.push(rows.slice(i, i + 400));
    Promise.all(batches.map(function (b) {
      return client.from('records').upsert(b, { onConflict: 'org_id,collection,id' }).select('collection,id,data');
    })).then(function (res) {
      pushing = false;
      var failed = res.filter(function (r) { return r.error; })[0];
      if (failed) { Cloud.status = netError(failed.error) ? 'offline' : 'error'; console.warn('Dindom: falha ao salvar', failed.error); retryLater(); return; }
      marks.forEach(function (m) { if (m[1] === null) delete snapshot[m[0]]; else snapshot[m[0]] = m[1]; });
      // O servidor completa alguns dados (ex.: NSR do ponto): traz de volta para este aparelho.
      res.forEach(function (r) {
        (r.data || []).forEach(function (row) {
          var key = k(row.collection, row.id), j = JSON.stringify(row.data);
          if (snapshot[key] !== j && row.collection === 'punches') { DB.applyRemote(row); snapshot[key] = j; showNsr(row.data); }
        });
      });
      Cloud.status = 'ok';
      if (again) { again = false; push(); }
    }, function (err) { pushing = false; Cloud.status = 'offline'; console.warn('Dindom: sem conexão para salvar', err); retryLater(); });
  }

  function retryLater() { clearTimeout(retryTimer); retryTimer = setTimeout(push, 15000); }

  Cloud.schedule = function (now) {
    if (!Cloud.orgId) return;
    clearTimeout(timer);
    timer = setTimeout(push, now ? 0 : 400);
  };
  window.addEventListener('online', function () { if (Cloud.orgId) push(); });

  // Liga o aparelho à pizzaria da conta logada. Retorna { ok } ou { error: 'nomember' | 'inactive' | 'network' }.
  Cloud.attach = function (user) {
    return client.from('members').select('org_id,emp_id,role,active').eq('user_id', user.id).limit(1).then(function (r) {
      if (r.error) throw r.error;
      var m = r.data && r.data[0];
      if (!m) return { error: 'nomember' };
      if (!m.active) return { error: 'inactive' };
      Cloud.user = user; Cloud.member = m; Cloud.orgId = m.org_id;
      Cloud.readOnly = m.role === 'contador';
      writeLast({ org_id: m.org_id, emp_id: m.emp_id, role: m.role, user_id: user.id });
      DB.useOrg(m.org_id);
      return loadAll().then(function () { subscribe(); push(); Cloud.status = 'ok'; return { ok: true, member: m }; });
    }).catch(function (err) {
      // Sem internet: abre com a última cópia deste aparelho e sincroniza quando voltar.
      var last = readLast();
      if (netError(err) && last && last.user_id === user.id) {
        Cloud.user = user; Cloud.member = last; Cloud.orgId = last.org_id; Cloud.status = 'offline';
        Cloud.readOnly = last.role === 'contador';
        DB.useOrg(last.org_id);
        retryLater();
        return { ok: true, member: last, offline: true };
      }
      return { error: netError(err) ? 'network' : 'nomember', detail: err };
    });
  };

  // Na abertura do app: sessão salva? Liga à pizzaria. Senão, descobre se já existe pizzaria configurada.
  Cloud.start = function () {
    if (!Cloud.enabled) return Promise.resolve();
    Cloud.recovery = /type=recovery/.test(location.hash);
    var hadTokens = /access_token=/.test(location.hash);
    return client.auth.getSession().then(function (r) {
      if (hadTokens) { try { history.replaceState(null, '', location.pathname + location.search + (Cloud.recovery ? '#login/senha' : '#inicio')); } catch (e) {} }
      var s = r.data && r.data.session;
      if (!s) return Cloud.checkOrg();
      return Cloud.attach(s.user).then(function (a) {
        if (!a.ok) { client.auth.signOut(); return Cloud.checkOrg(); }
        // Continua logado: refaz a sessão do app a partir do vínculo e do cadastro do colaborador.
        DB.update(function (x) {
          x.setupDone = true;
          var e = x.employees.filter(function (y) { return y.id === a.member.emp_id; })[0];
          if (!x.session || x.session.empId !== a.member.emp_id) x.session = { empId: a.member.emp_id, remember: true, at: Date.now() };
          if (e) { x.user.name = e.name; x.user.unit = x.user.unit || e.unit; }
          x.user.empId = a.member.emp_id; x.user.role = a.member.role;
        });
        return a;
      });
    }).catch(function () { return Cloud.checkOrg(); });
  };

  Cloud.checkOrg = function () {
    return client.rpc('org_exists').then(function (r) {
      var exists = !r.error && r.data === true;
      DB.update(function (x) { x.setupDone = exists || (!!readLast() && !!r.error); });
      Cloud.schemaMissing = !!(r.error && /org_exists|schema cache/i.test(r.error.message || ''));
    }, function () {});
  };

  Cloud.signOut = function () {
    if (channel) { client.removeChannel(channel); channel = null; }
    Cloud.user = null; Cloud.member = null; Cloud.orgId = null; snapshot = {};
    return client.auth.signOut().catch(function () {});
  };

  // Cria a conta de login de um colaborador sem derrubar a sessão de quem está cadastrando.
  Cloud.createUser = function (email, password) {
    var temp = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'dindom-tmp' }
    });
    return temp.auth.signUp({ email: email, password: password }).then(function (r) {
      if (r.error) {
        var msg = /registered|already/i.test(r.error.message) ? 'Este e-mail já tem uma conta no sistema.' : 'Não foi possível criar o acesso: ' + r.error.message;
        throw new Error(msg);
      }
      if (!r.data.user) throw new Error('Não foi possível criar o acesso.');
      if (r.data.user.identities && r.data.user.identities.length === 0) throw new Error('Este e-mail já tem uma conta no sistema.');
      return r.data.user.id;
    });
  };

  var NEEDS_SQL = Cloud.NEEDS_SQL = 'O servidor ainda não aceita o acesso da contabilidade: rode o arquivo supabase/002_contabilidade.sql no Supabase e tente de novo.';

  Cloud.addMember = function (userId, empId, role) {
    return client.from('members').insert({ org_id: Cloud.orgId, user_id: userId, emp_id: empId, role: role }).then(function (r) {
      if (r.error && role === 'contador' && /role|check/i.test(r.error.message)) throw new Error(NEEDS_SQL);
      if (r.error) throw new Error('Não foi possível ligar o acesso à equipe: ' + r.error.message);
    });
  };

  // Cria o login e liga à equipe. Se o e-mail ficou com conta sem vínculo (cadastro que falhou no meio),
  // o servidor reaproveita essa conta com a senha nova.
  Cloud.createAccess = function (email, password, empId, role) {
    var ready = role === 'contador'
      // Confere antes de criar a conta, para não sobrar login sem vínculo.
      ? client.rpc('parceiros_ok').then(function (r) { if (r.error) throw new Error(NEEDS_SQL); })
      : Promise.resolve();
    return ready.then(function () {
      return Cloud.createUser(email, password).then(function (uid) { return Cloud.addMember(uid, empId, role); }, function (er) {
        if (!/já tem uma conta/.test(er.message)) throw er;
        return client.rpc('claim_user', { p_email: email, p_emp_id: empId, p_role: role, p_password: password }).then(function (r) {
          if (r.error || !r.data) throw er;
        });
      });
    });
  };

  // O admin troca a senha de um parceiro (contabilidade) direto no servidor.
  Cloud.setPartnerPassword = function (empId, password) {
    return client.rpc('set_partner_password', { p_emp_id: empId, p_password: password }).then(function (r) {
      if (r.error) throw new Error(/function|schema cache/i.test(r.error.message) ? NEEDS_SQL : r.error.message);
    });
  };

  var NEEDS_PASS_SQL = Cloud.NEEDS_PASS_SQL = 'O servidor ainda não aceita definir senhas: rode o arquivo supabase/006_senha_colaborador.sql no Supabase e tente de novo.';

  // O admin define a senha de alguém da equipe (supabase/006_senha_colaborador.sql). O servidor também conserta
  // acesso pela metade (e-mail sem confirmação, login sem vínculo). Sem login para o e-mail, cria a conta e grava de novo.
  Cloud.setPassword = function (empId, email, password, role) {
    function call() {
      return client.rpc('definir_senha', { p_emp_id: empId, p_email: email, p_password: password, p_role: role }).then(function (r) {
        if (r.error) throw new Error(/definir_senha|schema cache|does not exist/i.test(r.error.message) ? NEEDS_PASS_SQL : netError(r.error) ? 'Sem conexão com o servidor. Confira a internet e tente de novo.' : r.error.message);
        return r.data;
      });
    }
    return call().then(function (res) {
      if (res !== 'sem_conta') return;
      return Cloud.createUser(email, password).then(function (uid) { return Cloud.addMember(uid, empId, role); }).then(call);
    });
  };

  // Testa um acesso de verdade (como a pessoa faria no login), sem mexer na sessão de quem está usando o app.
  // Devolve { ok, error, member: { emp_id, role, active } }.
  Cloud.testLogin = function (email, password) {
    var temp = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'dindom-test' }
    });
    return temp.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
      if (r.error) return { ok: false, error: r.error.message || 'erro desconhecido' };
      return temp.from('members').select('emp_id,role,active').eq('user_id', r.data.user.id).limit(1).then(function (m) {
        temp.auth.signOut({ scope: 'local' }).catch(function () {});
        return { ok: true, member: (m.data && m.data[0]) || null };
      });
    }, function (er) { return { ok: false, error: (er && er.message) || 'sem conexão' }; });
  };

  Cloud.updateMember = function (empId, patch) {
    if (!Cloud.orgId) return Promise.resolve();
    return client.from('members').update(patch).eq('org_id', Cloud.orgId).eq('emp_id', empId).then(function (r) {
      if (r.error) console.warn('Dindom: falha ao atualizar acesso', r.error);
    });
  };

  Cloud.sendReset = function (email) {
    var back = location.origin + location.pathname;
    return client.auth.resetPasswordForEmail(email, { redirectTo: back }).then(function (r) {
      if (r.error) throw new Error(/rate|limit/i.test(r.error.message) ? 'Muitos e-mails enviados agora. Tente de novo em alguns minutos.' : r.error.message);
    });
  };

  window.Cloud = Cloud;
})();
