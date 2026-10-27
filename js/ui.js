// Utilitários de interface compartilhados pelas telas.
(function () {
  var UI = {};

  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  UI.fmt = function (n) {
    if (n == null || isNaN(n)) return '–';
    return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  };

  UI.money = function (n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  UI.greeting = function () {
    var h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  UI.buzz = function (ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) {}
  };

  UI.toast = function (msg, opts) {
    opts = opts || {};
    var host = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast ' + (opts.tone || 'ok');
    el.setAttribute('role', 'status');
    el.innerHTML = icon(opts.icon || (opts.tone === 'crit' ? 'alert' : 'check')) +
      '<span>' + UI.esc(msg) + '</span>' +
      (opts.action ? '<button type="button">' + UI.esc(opts.action) + '</button>' : '');
    if (opts.action) {
      el.querySelector('button').addEventListener('click', function () { el.remove(); opts.onAction && opts.onAction(); });
    }
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, opts.ms || 2600);
  };

  // Painel inferior. Retorna a função que fecha o painel.
  UI.sheet = function (html, mount, onClose) {
    var wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>' + html + '</div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove();
      document.body.style.overflow = '';
      if (onClose) onClose();
    }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
    if (mount) mount(wrap.querySelector('.sheet'), close);
    var f = wrap.querySelector('[autofocus]');
    if (f) setTimeout(function () { f.focus(); }, 60);
    return close;
  };

  // Confirmação antes de ações irreversíveis (o navegador do app não usa confirm()).
  UI.confirm = function (o) {
    UI.sheet(
      '<h2>' + UI.esc(o.title) + '</h2>' +
      (o.body ? '<p class="muted">' + o.body + '</p>' : '') +
      '<div class="section">' +
      '<button type="button" class="btn ' + (o.danger ? 'dark' : 'primary') + ' block" data-ok>' + UI.esc(o.ok || 'Confirmar') + '</button>' +
      '<button type="button" class="btn block" data-close>Voltar</button>' +
      '</div>',
      function (sheet, close) {
        sheet.querySelector('[data-ok]').addEventListener('click', function () { close(); o.onOk(); });
      }
    );
  };

  // Evita toque duplo durante envios: mostra carregamento e libera ao terminar.
  UI.busy = function (btn, work) {
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    btn.disabled = true;
    var label = btn.textContent;
    setTimeout(function () {
      btn.classList.remove('busy');
      btn.disabled = false;
      btn.textContent = label;
      work();
    }, 650);
  };

  UI.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  };

  UI.bar = function (pct, cls) {
    return '<div class="bar ' + (cls || '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><i style="width:' + pct + '%"></i></div>';
  };

  UI.empty = function (ic, title, text, action) {
    return '<div class="empty"><div class="tile">' + icon(ic, 'lg') + '</div><h3>' + UI.esc(title) + '</h3><p>' + UI.esc(text) + '</p>' + (action || '') + '</div>';
  };

  UI.topbar = function (title, opts) {
    opts = opts || {};
    return '<header class="topbar">' +
      (opts.back ? '<a class="icon-btn plain" href="' + opts.back + '" aria-label="Voltar">' + icon('chevronLeft') + '</a>' : '') +
      '<div style="flex:1;min-width:0"><h1>' + UI.esc(title) + '</h1>' + (opts.sub ? '<div class="sub">' + UI.esc(opts.sub) + '</div>' : '') + '</div>' +
      (opts.right || '') + '</header>';
  };

  // Níveis de acesso: colaborador < gerente < admin. O admin tem tudo do gerente e mais a área de cadastro.
  // contador = contabilidade externa: só consulta e exporta o ponto.
  UI.ROLES = { colaborador: 'Colaborador', gerente: 'Gerente', admin: 'Administrador', contador: 'Contabilidade' };
  UI.isManager = function () { var r = DB.get().user.role; return r === 'gerente' || r === 'admin'; };
  UI.isAdmin = function () { return DB.get().user.role === 'admin'; };
  UI.isAccountant = function () { return DB.get().user.role === 'contador'; };

  // Banco sem uma atualização: passo a passo com o SQL pronto para copiar e colar no Supabase.
  // "last" é o último passo (HTML), dizendo o que fazer ao voltar para o app.
  UI.sqlHelp = function (box, file, last) {
    var ref = ((window.DINDOM_CONFIG || {}).supabaseUrl || '').replace(/^https:\/\/([^.]+)\..*$/, '$1');
    var sql = '';
    var fail = 'Não foi possível copiar. Abra o arquivo ' + file + ' no GitHub.';
    box.hidden = false;
    box.innerHTML = '<div class="card" style="border:1.5px solid var(--warn)"><div class="card-row"><div class="tile warn">' + icon('alert') + '</div><div class="grow"><div class="card-title">Falta atualizar o banco no Supabase</div>' +
      '<div class="card-meta">É uma vez só. Nenhum dado é apagado.</div></div></div>' +
      '<ol class="card-meta" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;color:var(--ink-2)">' +
      '<li>Toque em <b>Copiar SQL</b>.</li><li>Toque em <b>Abrir Supabase</b>, cole (Ctrl+V) e clique em <b>Run</b>. Se aparecer um aviso, confirme.</li><li>' + last + '</li></ol>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-copysql disabled>' + icon('copy', 'sm') + 'Copiar SQL</button>' +
      '<a class="btn" href="https://supabase.com/dashboard/project/' + UI.esc(ref) + '/sql/new" target="_blank" rel="noopener">Abrir Supabase</a></div></div>';
    var copy = box.querySelector('[data-copysql]');
    // O texto é baixado antes, para a cópia acontecer na hora do toque (exigência do iPhone).
    fetch(file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.text(); })
      .then(function (t) { sql = t; copy.disabled = false; }, function () { copy.disabled = false; });
    copy.addEventListener('click', function () {
      if (!sql) return UI.toast('Não foi possível baixar o SQL. Confira a internet e tente de novo.', { tone: 'crit', ms: 5000 });
      try {
        navigator.clipboard.writeText(sql).then(function () { UI.toast('SQL copiado. Agora cole no Supabase e clique em Run.', { ms: 5000 }); },
          function () { UI.toast(fail, { tone: 'crit', ms: 6000 }); });
      } catch (er) { UI.toast(fail, { tone: 'crit', ms: 6000 }); }
    });
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  UI.fmtCnpj = function (s) { var c = String(s || '').replace(/\D/g, '').slice(0, 14); return c.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); };
  // CNPJ válido pelos dígitos verificadores.
  UI.validCnpj = function (s) {
    var c = String(s || '').replace(/\D/g, '');
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    function dv(n) { var w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], sum = 0; for (var i = 0; i < n; i++) sum += Number(c[i]) * w[i]; var r = sum % 11; return r < 2 ? 0 : 11 - r; }
    return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
  };

  window.UI = UI;
  // Registro das telas; cada arquivo em js/screens/ adiciona a sua.
  window.Screens = window.Screens || {};
})();
