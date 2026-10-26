// Manutenção: registrar problema rápido e acompanhar até resolver.
(function () {
  var esc = UI.esc;
  var P = window.MAINT.PRIORITY, S = window.MAINT.STATUS;

  var PLACES = {
    'Cozinha': ['Forno a lenha', 'Forno elétrico', 'Masseira', 'Exaustor', 'Fogão', 'Pia'],
    'Estoque': ['Câmara fria 1', 'Câmara fria 2', 'Freezer', 'Prateleiras'],
    'Salão': ['Ar-condicionado', 'Iluminação', 'Mesas e cadeiras', 'Máquina de cartão'],
    'Banheiros': ['Descarga', 'Torneira', 'Iluminação'],
    'Área externa': ['Fachada', 'Portão', 'Letreiro']
  };
  var FILTERS = [['abertos', 'Abertos'], ['resolvida', 'Resolvidos'], ['todos', 'Todos']];
  var filter = 'abertos';
  var media = []; // anexos do formulário em andamento

  function emptyDraft() { return { title: '', place: '', equipment: '', other: '', priority: '', notes: '' }; }
  function find(id) { return DB.get().maintenance.filter(function (m) { return String(m.id) === String(id); })[0]; }

  function card(m) {
    var p = P[m.priority], s = S[m.status];
    return '<a class="card tap" href="#manutencao/' + m.id + '" style="text-decoration:none;color:inherit">' +
      '<div class="card-row"><span class="faint num" style="font-size:var(--fs-sm);font-weight:600">#' + m.id + '</span><span class="grow"></span>' +
      '<span class="pill ' + s[0] + '">' + s[1] + '</span></div>' +
      '<div class="card-title">' + esc(m.title) + '</div>' +
      '<div class="card-row card-meta"><span class="pill no-dot ' + p[0] + '">' + icon('flame', 'sm') + p[1] + '</span>' +
      '<span>' + esc(m.place) + (m.equipment ? ' · ' + esc(m.equipment) : '') + '</span></div>' +
      '<div class="card-meta">' + icon('clock', 'sm') + ' ' + esc(m.date) + '</div></a>';
  }

  function list() {
    var d = DB.get();
    var items = d.maintenance.filter(function (m) {
      if (filter === 'abertos') return m.status !== 'resolvida';
      if (filter === 'resolvida') return m.status === 'resolvida';
      return true;
    });
    var count = function (f) {
      return d.maintenance.filter(function (m) { return f === 'todos' || (f === 'abertos' ? m.status !== 'resolvida' : m.status === f); }).length;
    };
    var html = '<main class="screen wide">' + UI.topbar('Manutenção') +
      '<a class="btn primary block cta" href="#manutencao/nova" style="min-height:56px;font-size:var(--fs-lg)">' + icon('plus') + 'Nova manutenção</a>' +
      '<div class="chips" role="toolbar" aria-label="Filtrar chamados">' + FILTERS.map(function (f) {
        return '<button type="button" class="chip" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + ' <span class="count">' + count(f[0]) + '</span></button>';
      }).join('') + '</div>' +
      (items.length ? '<section class="card-grid">' + items.map(card).join('') + '</section>'
        : '<div class="card">' + UI.empty('wrench', 'Nenhum chamado aqui', filter === 'abertos' ? 'Nada quebrado no momento. Se algo der problema, registre em poucos toques.' : 'Os chamados aparecem aqui conforme são registrados.') + '</div>') +
      '</main>';
    return {
      html: html, tab: 'manutencao',
      mount: function (root) {
        root.querySelectorAll('[data-f]').forEach(function (b) { b.addEventListener('click', function () { filter = b.dataset.f; refresh(); }); });
      }
    };
  }

  function chipGroup(name, opts, val) {
    return '<div class="chips wrap" data-group="' + name + '">' + opts.map(function (o) {
      return '<button type="button" class="chip" data-v="' + esc(o) + '" aria-pressed="' + (o === val) + '">' + esc(o) + '</button>';
    }).join('') + '</div>';
  }

  function form() {
    var d = DB.get();
    var dr = d.maintDraft || emptyDraft();
    var equipments = dr.place ? (PLACES[dr.place] || []).concat(['Outro']) : [];
    var html = '<main class="screen no-nav">' + UI.topbar('Nova manutenção', { back: '#manutencao', sub: 'Rascunho salvo automaticamente' }) +
      '<div class="field" id="f-title"><label for="m-title">O que aconteceu?</label>' +
      '<input id="m-title" class="input" maxlength="90" placeholder="Ex.: forno não está esquentando" value="' + esc(dr.title) + '">' +
      '<span class="err" hidden>Descreva o problema em poucas palavras.</span></div>' +

      '<div class="field" id="f-place"><span class="label">Onde está o problema?</span>' + chipGroup('place', Object.keys(PLACES), dr.place) +
      '<span class="err" hidden>Escolha o local.</span></div>' +

      (dr.place ? '<div class="field"><span class="label">Qual equipamento? <span class="faint">(opcional)</span></span>' + chipGroup('equipment', equipments, dr.equipment) +
        (dr.equipment === 'Outro' ? '<input id="m-other" class="input" placeholder="Nome do equipamento" value="' + esc(dr.other) + '">' : '') + '</div>' : '') +

      '<div class="field" id="f-prio"><span class="label">Qual é a prioridade?</span><div class="seg">' +
      [['baixa', 'Baixa', ''], ['media', 'Média', ''], ['alta', 'Alta', 'warn'], ['urgente', 'Urgente', 'crit']].map(function (o) {
        return '<button type="button" data-prio="' + o[0] + '" data-tone="' + o[2] + '" aria-pressed="' + (dr.priority === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      (dr.priority === 'urgente' ? '<span class="hint" style="color:var(--crit)">O gerente recebe um aviso imediato.</span>' : '') +
      '<span class="err" hidden>Escolha a prioridade.</span></div>' +

      '<div class="field"><span class="label">Fotos ou vídeo</span><div class="thumbs" data-thumbs>' + thumbs() + '</div></div>' +

      (dr.notes || d.maintNotesOpen ? '<div class="field"><label for="m-notes">Observações</label><textarea id="m-notes" class="textarea" placeholder="Desde quando, o que já foi tentado...">' + esc(dr.notes) + '</textarea></div>'
        : '<button type="button" class="btn ghost" data-notes style="align-self:flex-start;padding:0">' + icon('plus', 'sm') + 'Adicionar observação</button>') +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner"><button type="button" class="btn primary block" data-send style="min-height:56px">Enviar chamado</button></div></div>';

    return {
      html: html, tab: 'manutencao', nav: false,
      mount: function (root) {
        // Sempre grava os textos digitados junto, para nada se perder quando a tela redesenha.
        function save(fn) {
          DB.update(function (x) {
            x.maintDraft = x.maintDraft || emptyDraft();
            ['title', 'other', 'notes'].forEach(function (k) {
              var el = root.querySelector('#m-' + k);
              if (el) x.maintDraft[k] = el.value;
            });
            fn(x.maintDraft);
          });
        }
        var saveText = UI.debounce(function (k, v) { save(function (dr) { dr[k] = v; }); }, 300);
        ['title', 'other', 'notes'].forEach(function (k) {
          var el = root.querySelector('#m-' + k);
          if (el) el.addEventListener('input', function () { saveText(k, el.value); root.querySelector('#f-title').classList.remove('error'); });
        });
        root.querySelectorAll('[data-group] .chip').forEach(function (b) {
          b.addEventListener('click', function () {
            var g = b.parentNode.dataset.group;
            save(function (dr) {
              var v = dr[g] === b.dataset.v ? '' : b.dataset.v;
              dr[g] = v;
              if (g === 'place') dr.equipment = '';
            });
            refresh();
          });
        });
        root.querySelectorAll('[data-prio]').forEach(function (b) {
          b.addEventListener('click', function () { save(function (dr) { dr.priority = b.dataset.prio; }); refresh(); });
        });
        var notes = root.querySelector('[data-notes]');
        if (notes) notes.addEventListener('click', function () {
          DB.update(function (x) { x.maintNotesOpen = true; }); refresh();
          setTimeout(function () { var t = document.getElementById('m-notes'); if (t) t.focus(); }, 50);
        });

        var box = root.querySelector('[data-thumbs]');
        box.addEventListener('click', function (e) {
          var rm = e.target.closest('[data-rm]');
          if (rm) { media.splice(Number(rm.dataset.rm), 1); box.innerHTML = thumbs(); return; }
          var add = e.target.closest('[data-add]');
          if (add) pickMedia({ camera: add.dataset.add === 'cam', video: true, multiple: add.dataset.add !== 'cam' }, function (m) {
            if (media.length >= 4) return UI.toast('Limite de 4 anexos por chamado', { tone: 'crit' });
            media.push(m); box.innerHTML = thumbs(); UI.buzz();
          });
        });

        root.querySelector('[data-send]').addEventListener('click', function (e) {
          var dr = DB.get().maintDraft || emptyDraft();
          var titleEl = root.querySelector('#m-title');
          dr.title = titleEl.value.trim();
          var bad = [];
          if (dr.title.length < 4) bad.push('f-title');
          if (!dr.place) bad.push('f-place');
          if (!dr.priority) bad.push('f-prio');
          root.querySelectorAll('.field').forEach(function (f) { f.classList.remove('error'); var er = f.querySelector('.err'); if (er) er.hidden = true; });
          if (bad.length) {
            bad.forEach(function (id) { var f = root.querySelector('#' + id); f.classList.add('error'); f.querySelector('.err').hidden = false; });
            root.querySelector('#' + bad[0]).scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
          }
          UI.busy(e.currentTarget, function () {
            var id;
            DB.update(function (x) {
              id = x.nextMaintenanceId++;
              var now = new Date();
              var at = String(now.getDate()).padStart(2, '0') + '/' + String(now.getMonth() + 1).padStart(2, '0') + ' · ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
              x.maintenance.unshift({
                id: id, title: dr.title, place: dr.place, equipment: dr.equipment === 'Outro' ? dr.other : dr.equipment,
                priority: dr.priority, status: 'aberta', date: at, notes: dr.notes || '',
                media: media.length, photos: media.filter(function (m) { return !m.temp; }),
                timeline: [{ at: at, text: 'Chamado aberto por ' + x.user.name }]
              });
              x.maintDraft = null;
              x.maintNotesOpen = false;
            });
            media = [];
            UI.buzz(25);
            go('manutencao/enviado/' + id, { replace: true });
          });
        });
      }
    };
  }

  function thumbs() {
    return media.map(thumbHtml).join('') +
      (media.length < 4 ? '<button type="button" class="add-media" data-add="cam">' + icon('camera') + 'Câmera</button>' +
        '<button type="button" class="add-media" data-add="gal">' + icon('image') + 'Galeria</button>' : '');
  }

  function sent(id) {
    var m = find(id);
    var html = '<main class="screen no-nav" style="justify-content:center;text-align:center;align-items:center">' +
      '<div class="success-mark">' + icon('check', 'lg') + '</div>' +
      '<div class="section" style="align-items:center"><div class="eyebrow">Chamado enviado</div>' +
      '<h1 class="num" style="font-size:2.5rem">#' + m.id + '</h1>' +
      '<p class="muted" style="max-width:30ch">' + esc(m.title) + '</p>' +
      '<span class="pill ' + S[m.status][0] + '">' + S[m.status][1] + '</span></div>' +
      '<p class="card-meta" style="max-width:34ch">Você recebe uma notificação a cada atualização do chamado.</p>' +
      '</main>' +
      '<div class="dock no-nav"><div class="dock-inner" style="flex-direction:column;gap:8px">' +
      '<a class="btn primary block" href="#manutencao/' + m.id + '">Acompanhar chamado</a>' +
      '<a class="btn block" href="#inicio">Voltar ao início</a></div></div>';
    return { html: html, tab: 'manutencao', nav: false };
  }

  function detail(id) {
    var m = find(id);
    if (!m) return list();
    var manager = UI.isManager();
    var steps = ['aberta', 'andamento', 'aguardando', 'resolvida'];
    var html = '<main class="screen">' + UI.topbar('Chamado #' + m.id, { back: '#manutencao' }) +
      '<section class="card"><div class="card-row"><span class="pill ' + S[m.status][0] + '">' + S[m.status][1] + '</span>' +
      '<span class="pill no-dot ' + P[m.priority][0] + '">' + icon('flame', 'sm') + P[m.priority][1] + '</span></div>' +
      '<h2 style="font-size:var(--fs-xl)">' + esc(m.title) + '</h2>' +
      '<div class="kv"><span>Local</span><b>' + esc(m.place) + '</b><span>Equipamento</span><b>' + esc(m.equipment || 'Não informado') + '</b>' +
      '<span>Aberto em</span><b class="num">' + esc(m.date) + '</b><span>Anexos</span><b class="num">' + m.media + '</b></div>' +
      (m.notes ? '<p class="muted">' + esc(m.notes) + '</p>' : '') +
      (m.photos && m.photos.length ? '<div class="thumbs">' + m.photos.map(function (p) { return '<div class="thumb"><img src="' + p.src + '" alt=""></div>'; }).join('') + '</div>' : '') +
      '</section>' +
      (manager ? '<section class="section"><div class="eyebrow">Atualizar status</div><div class="seg">' + steps.map(function (s) {
        return '<button type="button" data-st="' + s + '" aria-pressed="' + (m.status === s) + '"><span style="font-size:var(--fs-xs)">' + S[s][1] + '</span></button>';
      }).join('') + '</div></section>' : '') +
      '<section class="section"><div class="eyebrow">Andamento</div><ol class="timeline">' +
      m.timeline.slice().reverse().map(function (t, i) {
        return '<li' + (i === 0 ? ' class="now"' : '') + '><span class="num faint">' + esc(t.at) + '</span><span>' + esc(t.text) + '</span></li>';
      }).join('') + '</ol></section></main>';

    return {
      html: html, tab: 'manutencao',
      mount: function (root) {
        root.querySelectorAll('[data-st]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (b.dataset.st === m.status) return;
            var apply = function () {
              DB.update(function () {
                var x = find(id);
                var now = new Date();
                x.status = b.dataset.st;
                x.timeline.push({ at: String(now.getDate()).padStart(2, '0') + '/' + String(now.getMonth() + 1).padStart(2, '0') + ' · ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'), text: 'Status alterado para ' + S[b.dataset.st][1].toLowerCase() });
              });
              refresh(); UI.toast('Status atualizado');
            };
            if (b.dataset.st === 'resolvida') UI.confirm({ title: 'Marcar como resolvido?', body: 'Quem abriu o chamado será avisado.', ok: 'Marcar como resolvido', onOk: apply });
            else apply();
          });
        });
      }
    };
  }

  Screens.manutencao = function (params) {
    if (params[0] === 'nova') return form();
    if (params[0] === 'enviado') return sent(params[1]);
    if (params[0]) return detail(params[0]);
    return list();
  };
})();
