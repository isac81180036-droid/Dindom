// Aviso de pedido cancelado (supabase/009_avisos_cancelamento.sql), para gerentes e administradores:
// • com o app aberto: janela com o motivo, que só fecha no "OK, entendi";
// • com o app em segundo plano: aviso do sistema (se a pessoa permitiu notificações);
// • com o app fechado: Web Push pela função dindom-push (supabase/functions/dindom-push), ligado em Perfil.
(function () {
  var esc = UI.esc;
  var FN_FILE = 'supabase/functions/dindom-push/index.ts';
  var SQL_FILE = 'supabase/009_avisos_cancelamento.sql';
  var shown = {}; // avisos do sistema já mostrados nesta sessão

  function manager() { return !!Auth.session() && UI.isManager() && !UI.isAccountant(); }
  function hm(ts) { var d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // "Já vi" fica neste aparelho, por pessoa: cada gerente confirma no próprio celular.
  function seenKey() { return 'dindom:cx-seen:' + (DB.get().user.empId || ''); }
  function seen() { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch (e) { return {}; } }
  function markSeen(id) {
    var s = seen();
    s[id] = Date.now();
    var keys = Object.keys(s).sort(function (a, b) { return s[a] - s[b]; });
    keys.slice(0, Math.max(0, keys.length - 200)).forEach(function (k) { delete s[k]; });
    try { localStorage.setItem(seenKey(), JSON.stringify(s)); } catch (e) {}
  }
  // Cancelamentos das últimas 24 h ainda não confirmados por quem está usando o app.
  function pending() {
    if (!manager()) return [];
    var s = seen(), since = Date.now() - 24 * 3600000;
    return DB.get().notifications.filter(function (n) { return n.kind === 'cancel' && n.cancel && (n.ts || 0) > since && !s[n.id]; })
      .sort(function (a, b) { return a.ts - b.ts; });
  }

  function show(list, onOk) {
    var n = list[0], c = n.cancel;
    var meta = [c.channel, c.total != null ? UI.money(c.total) : '', c.customer].filter(function (x) { return x; });
    var items = (c.items || []).map(function (i) { return UI.fmt(+i.q || 1) + '× ' + esc(i.name); }).join(', ');
    var wrap = document.createElement('div');
    wrap.className = 'ack-wrap';
    wrap.innerHTML = '<div class="ack" role="alertdialog" aria-modal="true" aria-labelledby="cx-title" aria-describedby="cx-reason">' +
      '<div class="tile crit ack-ico">' + icon('alert', 'lg') + '</div>' +
      '<div class="eyebrow">' + (list.length > 1 ? '1 de ' + list.length + ' cancelamentos' : 'Pedido cancelado') + '</div>' +
      '<h2 id="cx-title">Pedido #' + esc(c.number) + ' cancelado</h2>' +
      '<div class="cx-reason" id="cx-reason"><span>Motivo</span><b>' + esc(c.reason || 'Sem motivo informado pela plataforma') + '</b></div>' +
      (meta.length ? '<p class="card-meta">' + meta.map(esc).join(' · ') + '</p>' : '') +
      (items ? '<p class="card-meta">' + items + '</p>' : '') +
      '<p class="card-meta">Cancelado às ' + hm(n.ts) + (c.created_at ? ' · pedido feito às ' + hm(Date.parse(c.created_at)) : '') + '</p>' +
      '<button type="button" class="btn primary block" data-ack style="min-height:56px;font-size:var(--fs-lg)">OK, entendi</button>' +
      '<button type="button" class="btn ghost block" data-sales>Ver nas vendas</button></div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    UI.buzz([60, 40, 60, 40, 60]);
    var ok = wrap.querySelector('[data-ack]');
    setTimeout(function () { ok.focus(); }, 60);
    wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.preventDefault(); });
    function close(goSales) {
      wrap.remove();
      if (!document.querySelector('.sheet-wrap')) document.body.style.overflow = '';
      onOk(n);
      if (goSales) go('vendas');
    }
    ok.addEventListener('click', function () { close(false); });
    wrap.querySelector('[data-sales]').addEventListener('click', function () { close(true); });
  }

  // Aviso do sistema (barra de notificações) quando o app está aberto mas em segundo plano.
  function systemNotify(n) {
    if (shown[n.id] || !('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
    shown[n.id] = true;
    var c = n.cancel;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.showNotification('Pedido #' + c.number + ' cancelado' + (c.channel ? ' · ' + c.channel : ''), {
        body: 'Motivo: ' + (c.reason || 'sem motivo informado') + (c.total != null ? ' · ' + UI.money(c.total) : ''),
        tag: n.id, icon: 'icons/icon-192.png', badge: 'icons/icon-64.png', data: { url: '#vendas' }, requireInteraction: true
      });
    }).catch(function () {});
  }

  function check() {
    var list = pending();
    if (!list.length) return;
    if (document.hidden) { list.forEach(systemNotify); return; } // a janela abre quando a pessoa voltar ao app
    if (document.querySelector('.ack-wrap') || /^(login|setup)/.test(route())) return;
    show(list, function (n) {
      markSeen(n.id);
      DB.update(function (x) { x.notifications.forEach(function (y) { if (y.id === n.id) y.read = true; }); });
      setTimeout(check, 250); // o próximo, se houver
    });
  }

  window.addEventListener('dindom:changed', function (e) { if (e.detail === 'notifications') check(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(check, 300); });

  // ---------- Celular (Web Push) ----------
  function cfgUrl() { return ((window.DINDOM_CONFIG || {}).supabaseUrl || '').replace(/\/$/, ''); }
  function fnUrl() { return cfgUrl() + '/functions/v1/dindom-push'; }
  function b64(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function fail(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  var Push = {
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    // iPhone só recebe aviso com o app instalado na Tela de Início (iOS 16.4 ou mais novo).
    iosNeedsInstall: function () {
      return /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
    },
    current: function () {
      if (!Push.supported()) return Promise.resolve(null);
      return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); });
    },
    enable: function () {
      var key;
      return Notification.requestPermission().then(function (p) {
        if (p !== 'granted') throw fail('perm');
        return fetch(fnUrl()).catch(function () { throw fail('net'); });
      }).then(function (r) {
        if (r.status === 404) throw fail('fn');
        if (r.status === 401) throw fail('jwt');
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || !j.publicKey) throw fail(/009/.test(j.error || '') ? 'sql' : 'fn', j.error);
          key = j.publicKey;
          return navigator.serviceWorker.ready;
        });
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (old) { return old ? old.unsubscribe() : null; })
          .then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }); });
      }).then(function (sub) {
        var j = sub.toJSON();
        return Cloud.client.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent })
          .then(function (r) { if (r.error) throw fail(/push_subscribe|schema cache|does not exist/i.test(r.error.message) ? 'sql' : 'rpc', r.error.message); });
      });
    },
    disable: function () {
      return Push.current().then(function (sub) {
        if (!sub) return;
        var ep = sub.endpoint;
        return sub.unsubscribe().then(function () { return Cloud.client.rpc('push_unsubscribe', { p_endpoint: ep }); });
      });
    }
  };

  // Painel de Perfil › Avisos de cancelamento.
  function sheet() {
    var sample = { id: 'cx-teste', ts: Date.now(), cancel: { number: '123', channel: '99Food', total: 89.9, customer: 'Maria', reason: 'O cliente pediu o cancelamento',
      created_at: new Date(Date.now() - 25 * 60000).toISOString(), items: [{ q: 1, name: 'Calabresa Dindom (grande)' }] } };
    UI.sheet('<h2>Avisos de cancelamento</h2>' +
      '<p class="muted">Quando um pedido é cancelado na Cardápio Web, aparece uma janela com o motivo para gerentes e administradores. ' +
      'Ligando aqui, o aviso chega também neste celular com o app fechado (em até 1 minuto).</p>' +
      '<div class="list"><div class="row"><div class="tile" data-ps-tile>' + icon('bell') + '</div><div class="grow"><div class="card-title">Neste celular</div><div class="card-meta" data-ps>Conferindo…</div></div></div></div>' +
      '<div data-ps-help hidden></div>' +
      '<div class="section"><button type="button" class="btn primary block" data-ps-on hidden>' + icon('bell', 'sm') + 'Ligar neste celular</button>' +
      '<button type="button" class="btn block" data-ps-off hidden>Desligar neste celular</button>' +
      '<button type="button" class="btn block" data-ps-test>Ver como fica o aviso</button>' +
      '<button type="button" class="btn block" data-close>Fechar</button></div>',
      function (sh, close) {
        var line = sh.querySelector('[data-ps]'), on = sh.querySelector('[data-ps-on]'), off = sh.querySelector('[data-ps-off]'), help = sh.querySelector('[data-ps-help]');
        function paint() {
          if (!Push.supported()) { line.textContent = 'Este navegador não recebe avisos com o app fechado.'; return; }
          if (Push.iosNeedsInstall()) { line.textContent = 'No iPhone, primeiro adicione o app à Tela de Início (Compartilhar › Adicionar à Tela de Início) e abra por lá.'; return; }
          Push.current().then(function (s) {
            line.textContent = s ? 'Ligado: os cancelamentos chegam aqui mesmo com o app fechado.' : Notification.permission === 'denied'
              ? 'Notificações bloqueadas para este site. Libere nas configurações do navegador e volte aqui.' : 'Desligado.';
            sh.querySelector('[data-ps-tile]').className = 'tile' + (s ? ' ok' : '');
            on.hidden = !!s || Notification.permission === 'denied'; off.hidden = !s;
          });
        }
        paint();
        on.addEventListener('click', function () {
          on.disabled = true; line.textContent = 'Ligando…';
          Push.enable().then(function () { UI.toast('Pronto: os cancelamentos vão chegar neste celular'); help.hidden = true; paint(); })
            .catch(function (e) {
              on.disabled = false;
              var msg = { perm: 'Você não permitiu as notificações. Libere nas configurações do navegador e tente de novo.',
                net: 'Sem internet. Tente de novo.',
                jwt: 'A função está com "Verify JWT" ligado. No Supabase, abra a função dindom-push › Details, desligue e salve.',
                fn: UI.isAdmin() ? 'A função de envio ainda não está publicada no Supabase.' : 'Falta o administrador terminar de configurar os avisos no Supabase.',
                sql: UI.isAdmin() ? 'Falta atualizar o banco no Supabase.' : 'Falta o administrador atualizar o banco no Supabase.' }[e.code] || ('Não deu certo: ' + e.message);
              line.textContent = msg;
              if (UI.isAdmin() && e.code === 'fn') UI.fnHelp(help, { name: 'dindom-push', file: FN_FILE, jwtOff: true });
              if (UI.isAdmin() && e.code === 'sql') UI.sqlHelp(help, SQL_FILE, 'Volte aqui e toque em <b>Ligar neste celular</b> de novo.');
            });
        });
        off.addEventListener('click', function () { Push.disable().then(function () { UI.toast('Avisos desligados neste celular'); paint(); }); });
        sh.querySelector('[data-ps-test]').addEventListener('click', function () {
          close();
          show([sample], function () { UI.toast('Assim chega o aviso. É só um exemplo, nada foi gravado.'); });
        });
      });
  }

  window.CancelAlert = { check: check, sheet: sheet, Push: Push };
})();
