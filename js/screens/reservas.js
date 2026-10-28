// Reservas pelo link público (/reserva): lista da equipe, painel de cada reserva, avisos e link para compartilhar.
// A reserva fica na tabela "reservas" (supabase/005_reservas.sql). O banco espelha cada uma como evento da agenda,
// com todas as respostas em ev.reserva; o app lê desse espelho (chega em tempo real e funciona sem internet).
// Alterações (status, detalhes, anotações) vão direto para a tabela, e o banco atualiza o evento sozinho.
(function () {
  var esc = UI.esc;
  var SQL_FILE = 'supabase/005_reservas.sql';
  var TZ = 'America/Fortaleza';
  var STATUS = {
    pendente: { label: 'Pendente', tone: 'warn' },
    confirmada: { label: 'Confirmada', tone: 'ok' },
    recusada: { label: 'Recusada', tone: '' },
    cancelada: { label: 'Cancelada', tone: '' }
  };
  var TYPES = { aniversario: 'Aniversário', confraternizacao: 'Confraternização de empresa', reuniao: 'Reunião', outro: 'Outro' };
  var ACTIVE = { pendente: true, confirmada: true }; // ocupam o horário (contam para conflito)
  var PERIODS = [['proximas', 'Próximas'], ['hoje', 'Hoje'], ['semana', 'Próximos 7 dias'], ['mes', 'Este mês'], ['passadas', 'Passadas'], ['todas', 'Todas as datas'], ['dia', 'Escolher data']];
  var filter = { status: 'todas', period: 'proximas', day: '' };
  var sqlOk = false;

  // ---------- Dados (do espelho na agenda) ----------

  function all() { return DB.get().events.filter(function (e) { return e.reserva; }); }
  function byId(id) { return all().filter(function (e) { return e.reserva.id === id; })[0] || null; }
  function bySchedule(a, b) { var x = a.date + a.reserva.inicio, y = b.date + b.reserva.inicio; return x < y ? -1 : x > y ? 1 : 0; }
  function isNew(e) { return e.reserva.status === 'pendente' && !e.reserva.vista_em; }

  // Minutos ocupados no dia; festa que passa da meia-noite ocupa até o fim do dia.
  function span(e) { var s = Cal.mins(e.reserva.inicio), f = Cal.mins(e.reserva.termino); return [s, f > s ? f : 24 * 60]; }
  function conflicts(e) {
    if (!e.reserva || !ACTIVE[e.reserva.status]) return [];
    var a = span(e);
    return all().filter(function (o) {
      if (o.id === e.id || o.date !== e.date || !ACTIVE[o.reserva.status]) return false;
      var b = span(o);
      return a[0] < b[1] && b[0] < a[1];
    });
  }
  function pending() { var t = Cal.today(); return all().filter(function (e) { return e.reserva.status === 'pendente' && e.date >= t; }); }

  // ---------- Formatação ----------

  function br(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }
  function dayLabel(iso) { return Cal.WEEK[Cal.parse(iso).getDay()] + ', ' + br(iso); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function stamp(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.toLocaleDateString('pt-BR', { timeZone: TZ }) + ' às ' + d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }
  function phone(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function hours(r) { return r.inicio + ' às ' + r.termino + (r.termino < r.inicio ? ' (dia seguinte)' : ''); }
  function typeLabel(r) { return r.tipo === 'outro' && r.tipo_outro ? r.tipo_outro : TYPES[r.tipo] || 'Evento'; }
  function who(r) { return r.empresa || r.nome; }
  function people(n) { return n + (n === 1 ? ' pessoa' : ' pessoas'); }
  function pill(status) { var s = STATUS[status] || STATUS.pendente; return '<span class="pill rv-status ' + (s.tone || 'off') + '">' + s.label + '</span>'; }

  // Mensagem pronta para o WhatsApp do cliente, conforme o status.
  function waLink(r) {
    var org = (DB.get().org && DB.get().org.name) || 'Dindom';
    var first = String(r.nome || '').trim().split(/\s+/)[0];
    var what = typeLabel(r); what = what.charAt(0).toLowerCase() + what.slice(1);
    var when = dayLabel(r.data) + ', das ' + r.inicio + ' às ' + r.termino;
    var msg = r.status === 'recusada'
      ? 'Olá, ' + first + '! Aqui é da ' + org + '. Recebemos seu pedido de reserva (' + what + ') para ' + when + ', mas infelizmente não conseguimos atender nessa data. Se quiser, podemos ver outra data ou horário.'
      : r.status === 'cancelada'
        ? 'Olá, ' + first + '! Aqui é da ' + org + '. Sua reserva (' + what + ') para ' + when + ' foi cancelada. Se quiser remarcar, é só responder esta mensagem.'
        : 'Olá, ' + first + '! Aqui é da ' + org + '. Sua reserva (' + what + ') para ' + when + ', para ' + people(r.pessoas) + ', está confirmada! 🎉 Qualquer dúvida, é só responder esta mensagem. Até lá!';
    return 'https://wa.me/55' + String(r.whatsapp || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(msg);
  }

  // ---------- Servidor ----------

  function online() { return !!(window.Cloud && Cloud.orgId && Cloud.client); }
  function missingSql(err) { return /schema cache|does not exist|reservas/i.test((err && err.message) || '') && !/permission|violates/i.test((err && err.message) || ''); }
  function errText(err) {
    var m = (err && err.message) || '';
    if (!m || /fetch|network|Failed to/i.test(m)) return 'Sem conexão: não deu para salvar. Confira a internet e tente de novo.';
    if (missingSql(err)) return 'Falta atualizar o banco no Supabase (' + SQL_FILE + '). Abra Reservas para ver o passo a passo.';
    return 'Não foi possível salvar: ' + m;
  }

  // Grava na tabela e traz de volta o evento que o banco atualizou.
  function save(id, patch) {
    if (!online()) return Promise.reject(new Error('As reservas precisam do servidor ligado. Confira a internet e entre de novo.'));
    return Cloud.client.from('reservas').update(patch).eq('id', id).select('id').then(function (r) {
      if (r.error) throw new Error(errText(r.error));
      if (!r.data || !r.data.length) throw new Error('Você não tem permissão para alterar esta reserva.');
      return Cloud.pull('events', ['rv-' + id]).catch(function () {});
    });
  }
  function working(btn, on) { if (!btn) return; btn.disabled = on; btn.classList.toggle('busy', on); }

  // ---------- Link público ----------

  function link() { return new URL('reserva', location.href.split('#')[0]).href; }

  function copyLink() {
    var url = link();
    function manual() {
      UI.sheet('<h2>Link de reserva</h2><p class="muted">Copie o link abaixo e envie para os clientes.</p>' +
        '<input class="input" readonly value="' + esc(url) + '" data-sel><button type="button" class="btn block" data-close>Fechar</button>',
        function (sheet) { var i = sheet.querySelector('[data-sel]'); setTimeout(function () { i.focus(); i.select(); }, 80); });
    }
    try {
      navigator.clipboard.writeText(url).then(function () { UI.toast('Link copiado. Agora é só colar no WhatsApp.', { icon: 'link' }); UI.buzz(15); }, manual);
    } catch (e) { manual(); }
  }
  function shareLink() {
    var org = (DB.get().org && DB.get().org.name) || 'Dindom';
    if (!navigator.share) return copyLink();
    navigator.share({ title: 'Reservas · ' + org, text: 'Faça a reserva do seu evento na ' + org + ':', url: link() }).catch(function () {});
  }

  // Botões de copiar e compartilhar ficam em várias telas: um ouvinte só para todos.
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-rv-copy]')) copyLink();
    else if (e.target.closest('[data-rv-share]')) shareLink();
  });

  // ---------- Painel da reserva ----------

  function open(id) {
    var e = byId(id);
    if (!e) { UI.toast('Reserva não encontrada. Se acabou de chegar, tente de novo em instantes.', { tone: 'crit', ms: 4500 }); return; }
    var r = e.reserva, wasNew = isNew(e), conf = conflicts(e), changed = false;
    function row(label, value) { return value === '' || value == null ? '' : '<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>'; }
    var html = '<div class="rv-detail">' +
      '<div class="rv-head"><span class="pill rv-pill no-dot">' + icon('party', 'sm') + 'Reserva</span>' + pill(r.status) +
      (wasNew ? '<span class="pill crit no-dot">NOVA</span>' : '') + '</div>' +
      '<h2>' + esc(e.title) + '</h2>' +
      (conf.length ? '<div class="banner crit">' + icon('alert', 'sm') + '<div class="grow">Conflito de horário com ' + conf.map(function (c) {
        return esc(who(c.reserva)) + ' (' + c.reserva.inicio + ' às ' + c.reserva.termino + ', ' + STATUS[c.reserva.status].label.toLowerCase() + ')';
      }).join('; ') + '.</div></div>' : '') +
      '<dl class="rv-dl">' +
      row('Data', cap(dayLabel(r.data))) + row('Horário', hours(r)) + row('Pessoas', people(r.pessoas)) +
      row('Tipo de evento', typeLabel(r)) + row('Aniversariante ou homenageado', r.homenageado) +
      row('Responsável', r.nome) + row('Empresa', r.empresa) + row('WhatsApp', phone(r.whatsapp)) + row('E-mail', r.email) +
      row('Decoração', r.decoracao ? 'Sim, precisa' : 'Não precisa') + row('Bolo, alimentação e bebidas', r.alimentacao) +
      row('Orçamento aproximado', r.orcamento != null ? UI.money(r.orcamento) : '') + row('Observações', r.observacoes) +
      row('Recebida em', stamp(r.criado_em) + ' · link público') + row('Código', r.codigo) +
      (r.vista_em ? row('Aberta primeiro por', (r.vista_por || 'equipe') + ' em ' + stamp(r.vista_em)) : '') +
      '</dl></div>' +
      '<div class="field"><label for="rv-notes">Anotações internas <span class="faint">(só a equipe vê)</span></label>' +
      '<textarea id="rv-notes" class="textarea" maxlength="3000" style="min-height:72px" placeholder="Ex.: sinal pago, mesa do salão, bolo encomendado">' + esc(r.notas || '') + '</textarea>' +
      '<button type="button" class="btn sm" data-notes style="align-self:flex-start">Salvar anotação</button></div>' +
      '<div class="rv-actions">' +
      (r.status === 'pendente' ? '<button type="button" class="btn primary block rv-confirm" data-st="confirmada">' + icon('check', 'sm') + 'Confirmar reserva</button>' +
        '<button type="button" class="btn block" data-st="recusada">' + icon('x', 'sm') + 'Recusar reserva</button>' : '') +
      (r.status === 'confirmada' ? '<button type="button" class="btn block" data-st="cancelada">' + icon('x', 'sm') + 'Cancelar reserva</button>' : '') +
      (r.status === 'recusada' || r.status === 'cancelada' ? '<button type="button" class="btn block" data-st="pendente">' + icon('refresh', 'sm') + 'Reabrir como pendente</button>' : '') +
      '<a class="btn block rv-wa" href="' + waLink(r) + '" target="_blank" rel="noopener">' + icon('message', 'sm') + 'Abrir WhatsApp do cliente</a>' +
      '<div class="seg"><button type="button" data-edit>' + icon('settings', 'sm') + 'Editar detalhes</button><button type="button" data-goagenda>' + icon('calendar', 'sm') + 'Ver na agenda</button></div>' +
      '<button type="button" class="btn block" data-close>Fechar</button></div>';

    UI.sheet(html, function (sheet, close) {
      // Abriu pela primeira vez: deixa de ser "NOVA" para toda a equipe.
      if (wasNew && online()) save(r.id, { vista_em: new Date().toISOString(), vista_por: DB.get().user.name || null }).then(function () { changed = true; }, function () {});

      sheet.querySelector('[data-notes]').addEventListener('click', function (ev) {
        var btn = ev.currentTarget, v = sheet.querySelector('#rv-notes').value.trim();
        working(btn, true);
        save(r.id, { notas_internas: v || null }).then(function () { working(btn, false); changed = true; UI.toast('Anotação salva'); },
          function (er) { working(btn, false); UI.toast(er.message, { tone: 'crit', ms: 5000 }); });
      });

      sheet.querySelectorAll('[data-st]').forEach(function (b) {
        b.addEventListener('click', function () {
          var st = b.dataset.st;
          function run() {
            working(b, true);
            save(r.id, { status: st }).then(function () {
              close(); refresh(); open(r.id); UI.buzz(15);
              if (st === 'confirmada') UI.toast('Reserva confirmada', { action: 'Avisar no WhatsApp', ms: 6000, onAction: function () { var x = byId(r.id); if (x) window.open(waLink(x.reserva), '_blank', 'noopener'); } });
              else UI.toast(st === 'pendente' ? 'Reserva reaberta como pendente' : 'Reserva ' + STATUS[st].label.toLowerCase());
            }, function (er) { working(b, false); UI.toast(er.message, { tone: 'crit', ms: 5000 }); });
          }
          if (st === 'recusada' || st === 'cancelada') {
            close();
            UI.confirm({
              title: (st === 'recusada' ? 'Recusar' : 'Cancelar') + ' a reserva de ' + who(r) + '?',
              body: 'Ela continua na agenda, em cinza e riscada. Depois, avise o cliente pelo WhatsApp.',
              ok: st === 'recusada' ? 'Recusar reserva' : 'Cancelar reserva', danger: true,
              onOk: function () {
                save(r.id, { status: st }).then(function () {
                  refresh(); open(r.id);
                  UI.toast('Reserva ' + STATUS[st].label.toLowerCase(), { action: 'Avisar no WhatsApp', ms: 6000, onAction: function () { var x = byId(r.id); if (x) window.open(waLink(x.reserva), '_blank', 'noopener'); } });
                }, function (er) { UI.toast(er.message, { tone: 'crit', ms: 5000 }); });
              }
            });
            return;
          }
          run();
        });
      });

      sheet.querySelector('[data-edit]').addEventListener('click', function () { close(); edit(r.id); });
      sheet.querySelector('[data-goagenda]').addEventListener('click', function () {
        close();
        if (window.Agenda) Agenda.focus(e.date);
        go('agenda');
      });
    }, function () { if (changed) refresh(); });
  }

  // ---------- Editar detalhes ----------

  function edit(id) {
    var e = byId(id);
    if (!e) return;
    var r = e.reserva;
    function f(key, label, control, required) {
      return '<div class="field" id="f-rve-' + key + '"><label for="rve-' + key + '">' + label + (required ? '' : ' <span class="faint">(opcional)</span>') + '</label>' +
        control + '<span class="err" hidden></span></div>';
    }
    function inp(key, val, attrs) { return '<input id="rve-' + key + '" class="input" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }
    function area(key, val, max) { return '<textarea id="rve-' + key + '" class="textarea" style="min-height:72px" maxlength="' + max + '">' + esc(val || '') + '</textarea>'; }

    UI.sheet('<h2>Editar reserva</h2>' +
      f('tipo', 'Tipo de evento', '<select id="rve-tipo" class="select">' + Object.keys(TYPES).map(function (k) {
        return '<option value="' + k + '"' + (k === r.tipo ? ' selected' : '') + '>' + TYPES[k] + '</option>';
      }).join('') + '</select>', true) +
      '<div data-outro' + (r.tipo === 'outro' ? '' : ' hidden') + '>' + f('tipo_outro', 'Qual é o evento?', inp('tipo_outro', r.tipo_outro, 'maxlength="60"')) + '</div>' +
      f('nome', 'Nome do responsável', inp('nome', r.nome, 'maxlength="120"'), true) +
      f('empresa', 'Empresa', inp('empresa', r.empresa, 'maxlength="120"')) +
      f('whatsapp', 'WhatsApp', inp('whatsapp', phone(r.whatsapp), 'type="tel" inputmode="numeric" maxlength="16"'), true) +
      f('email', 'E-mail', inp('email', r.email, 'type="email" maxlength="160"')) +
      f('homenageado', 'Aniversariante ou homenageado', inp('homenageado', r.homenageado, 'maxlength="120"')) +
      '<div class="ev-when">' + f('data', 'Data', inp('data', r.data, 'type="date"'), true) +
      f('inicio', 'Início', inp('inicio', r.inicio, 'type="time"'), true) + f('termino', 'Término', inp('termino', r.termino, 'type="time"'), true) + '</div>' +
      f('pessoas', 'Quantidade de pessoas', inp('pessoas', r.pessoas, 'type="number" inputmode="numeric" min="1" max="2000" step="1"'), true) +
      '<label class="row" for="rve-deco" style="padding:0;min-height:var(--tap)"><span class="grow card-title">Precisa de decoração</span><input id="rve-deco" type="checkbox" class="switch"' + (r.decoracao ? ' checked' : '') + '></label>' +
      f('alimentacao', 'Bolo, alimentação e bebidas', area('alimentacao', r.alimentacao, 1500)) +
      f('orcamento', 'Orçamento aproximado (R$)', inp('orcamento', r.orcamento, 'type="number" inputmode="decimal" min="0" step="0.01"')) +
      f('observacoes', 'Observações', area('observacoes', r.observacoes, 2000)) +
      '<button type="button" class="btn primary block" data-save>Salvar alterações</button>' +
      '<button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        function $(s) { return sheet.querySelector(s); }
        function v(key) { return $('#rve-' + key).value.trim(); }
        $('#rve-tipo').addEventListener('change', function () { $('[data-outro]').hidden = v('tipo') !== 'outro'; });
        var wa = $('#rve-whatsapp');
        wa.addEventListener('input', function () { wa.value = phone(wa.value); });

        $('[data-save]').addEventListener('click', function (ev) {
          var btn = ev.currentTarget;
          var whats = v('whatsapp').replace(/\D/g, '');
          if ((whats.length === 12 || whats.length === 13) && whats.indexOf('55') === 0) whats = whats.slice(2);
          var errs = {};
          if (v('nome').length < 2) errs.nome = 'Informe o nome do responsável.';
          if (whats.length < 10 || whats.length > 11) errs.whatsapp = 'WhatsApp com DDD, ex.: (85) 99999-8888.';
          if (v('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) errs.email = 'Confira o e-mail.';
          if (!v('data')) errs.data = 'Informe a data.';
          if (!v('inicio')) errs.inicio = 'Informe o início.';
          if (!v('termino')) errs.termino = 'Informe o término.';
          else if (v('termino') === v('inicio')) errs.termino = 'Diferente do início.';
          var n = Number(v('pessoas'));
          if (!/^\d{1,4}$/.test(v('pessoas')) || n < 1 || n > 2000) errs.pessoas = 'De 1 a 2000 pessoas.';
          var orc = v('orcamento');
          if (orc && !(Number(orc) >= 0)) errs.orcamento = 'Valor inválido.';
          sheet.querySelectorAll('.field[id^="f-rve-"]').forEach(function (fl) {
            var key = fl.id.slice(6), msg = errs[key], er = fl.querySelector('.err');
            fl.classList.toggle('error', !!msg);
            if (er) { er.hidden = !msg; er.textContent = msg || ''; }
          });
          if (Object.keys(errs).length) return;

          var patch = {
            tipo: v('tipo'), tipo_outro: v('tipo') === 'outro' ? v('tipo_outro') || null : null,
            nome: v('nome'), empresa: v('empresa') || null, whatsapp: whats, email: v('email').toLowerCase() || null,
            homenageado: v('homenageado') || null, data: v('data'), inicio: v('inicio'), termino: v('termino'), pessoas: n,
            decoracao: $('#rve-deco').checked, alimentacao: v('alimentacao') || null,
            orcamento: orc ? Math.round(Number(orc) * 100) / 100 : null, observacoes: v('observacoes') || null
          };
          working(btn, true);
          save(r.id, patch).then(function () {
            close(); refresh(); open(r.id); UI.toast('Reserva atualizada');
          }, function (er) { working(btn, false); UI.toast(er.message, { tone: 'crit', ms: 5000 }); });
        });
      });
  }

  // ---------- Aviso de reserva nova (tempo real, js/cloud.js) ----------

  window.addEventListener('dindom:reserva', function (ev) {
    var e = ev.detail;
    if (!e || !e.reserva || UI.isAccountant() || e.reserva.status !== 'pendente' || e.reserva.vista_em) return;
    UI.buzz([60, 40, 60]);
    UI.toast('Nova reserva: ' + e.title.replace(/^🎉\s*/, '') + ' · ' + br(e.date), {
      icon: 'party', ms: 9000, action: 'Ver', onAction: function () { open(e.reserva.id); }
    });
  });

  // ---------- Tela: Reservas ----------

  function periodOk(e) {
    var t = Cal.today(), p = filter.period;
    if (p === 'hoje') return e.date === t;
    if (p === 'semana') return e.date >= t && e.date <= Cal.add(t, 6);
    if (p === 'mes') return e.date.slice(0, 7) === t.slice(0, 7);
    if (p === 'passadas') return e.date < t;
    if (p === 'dia') return !filter.day || e.date === filter.day;
    if (p === 'todas') return true;
    return e.date >= t; // próximas
  }

  function item(e) {
    var r = e.reserva, conf = conflicts(e).length;
    return '<button type="button" class="row rv-row st-' + r.status + (isNew(e) ? ' rv-new' : '') + '" data-open="' + esc(r.id) + '">' +
      '<span class="rv-time num">' + esc(r.inicio) + '</span><span class="ev-bar"></span>' +
      '<span class="grow"><span class="card-title rv-title">' + esc(e.title) + '</span>' +
      '<span class="card-meta">' + esc(hours(r)) + ' · ' + esc(phone(r.whatsapp)) + '</span>' +
      '<span class="rv-pills">' + pill(r.status) + (isNew(e) ? '<span class="pill crit no-dot">NOVA</span>' : '') +
      (conf ? '<span class="pill crit">' + icon('alert', 'sm') + 'Conflito</span>' : '') +
      (r.notas ? '<span class="pill no-dot">' + icon('message', 'sm') + 'Anotação</span>' : '') + '</span></span>' +
      icon('chevronRight', 'sm') + '</button>';
  }

  Screens.reservas = function (params) {
    var openId = params && params[0];
    var list = all();
    var counts = { todas: list.length };
    Object.keys(STATUS).forEach(function (k) { counts[k] = 0; });
    list.forEach(function (e) { counts[e.reserva.status] = (counts[e.reserva.status] || 0) + 1; });

    var shown = list.filter(function (e) { return (filter.status === 'todas' || e.reserva.status === filter.status) && periodOk(e); }).sort(bySchedule);
    if (filter.period === 'passadas') shown.reverse();
    var groups = [], last = null;
    shown.forEach(function (e) { if (e.date !== last) { groups.push({ date: e.date, items: [] }); last = e.date; } groups[groups.length - 1].items.push(e); });

    var url = link();
    var html = '<main class="screen">' +
      UI.topbar('Reservas', { back: isDesktop() ? null : '#inicio', sub: 'Pedidos feitos pelo link público' }) +
      (online() ? '' : '<div class="banner">' + icon('wifiOff', 'sm') + '<div class="grow">As reservas pelo link precisam do servidor ligado. Sem conexão, você vê só as que já estavam neste aparelho.</div></div>') +
      '<div data-sqlhelp hidden></div>' +
      '<section class="card rv-link"><div class="card-row"><div class="tile rv-tile">' + icon('link') + '</div><div class="grow"><div class="card-title">Link de reserva</div>' +
      '<div class="card-meta rv-url">' + esc(url) + '</div></div></div>' +
      '<div class="rv-link-actions"><button type="button" class="btn primary" data-rv-copy>' + icon('copy', 'sm') + 'Copiar link de reserva</button>' +
      (navigator.share ? '<button type="button" class="btn" data-rv-share>' + icon('share', 'sm') + 'Compartilhar</button>' : '') +
      '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Abrir</a></div>' +
      '<p class="card-meta">Envie para empresas e clientes. Cada pedido aparece na agenda, em dourado, na data e horário escolhidos.</p></section>' +

      '<div class="chips" role="toolbar" aria-label="Status">' + [['todas', 'Todas'], ['pendente', 'Pendentes'], ['confirmada', 'Confirmadas'], ['recusada', 'Recusadas'], ['cancelada', 'Canceladas']].map(function (s) {
        return '<button type="button" class="chip" data-fst="' + s[0] + '" aria-pressed="' + (filter.status === s[0]) + '">' + s[1] + ' <span class="count">' + (counts[s[0]] || 0) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="chips" role="toolbar" aria-label="Período">' + PERIODS.map(function (p) {
        return '<button type="button" class="chip" data-fper="' + p[0] + '" aria-pressed="' + (filter.period === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      (filter.period === 'dia' ? '<div class="field"><label for="rv-day">Data</label><input id="rv-day" type="date" class="input" value="' + esc(filter.day) + '"></div>' : '') +

      (groups.length ? groups.map(function (g) {
        return '<section class="section"><div class="eyebrow">' + esc(cap(dayLabel(g.date))) + '</div><div class="list">' + g.items.map(item).join('') + '</div></section>';
      }).join('') : '<div class="card">' + UI.empty('party', list.length ? 'Nenhuma reserva neste filtro' : 'Nenhuma reserva ainda',
        list.length ? 'Mude o status ou o período para ver as outras.' : 'Copie o link acima e envie para os clientes pelo WhatsApp.') + '</div>') +
      '</main>';

    return {
      html: html, tab: isDesktop() ? 'reservas' : 'inicio',
      mount: function (root) {
        root.addEventListener('click', function (ev) {
          var t = ev.target;
          var o = t.closest('[data-open]');
          if (o) return open(o.dataset.open);
          var s = t.closest('[data-fst]');
          if (s) { filter.status = s.dataset.fst; return refresh(); }
          var p = t.closest('[data-fper]');
          if (p) { filter.period = p.dataset.fper; if (p.dataset.fper === 'dia' && !filter.day) filter.day = Cal.today(); return refresh(); }
        });
        var day = root.querySelector('#rv-day');
        if (day) day.addEventListener('change', function () { filter.day = day.value; refresh(); });

        // Banco ainda sem a atualização das reservas: mostra o passo a passo.
        if (online() && !sqlOk) {
          Cloud.client.from('reservas').select('id').limit(1).then(function (r) {
            if (!r.error) { sqlOk = true; return; }
            if (missingSql(r.error) && route().split('/')[0] === 'reservas') UI.sqlHelp(root.querySelector('[data-sqlhelp]'), SQL_FILE, 'Volte aqui: o link de reserva já passa a funcionar.');
          }, function () {});
        }
        // Aberta por uma notificação (#reservas/<id>): mostra a lista e abre o painel da reserva.
        if (openId) setTimeout(function () { go('reservas', { replace: true }); open(openId); }, 0);
      }
    };
  };

  // ---------- Início, menu e agenda ----------

  function homeCard() {
    if (UI.isAccountant()) return '';
    var p = pending().sort(bySchedule), news = p.filter(isNew).length;
    var next = all().filter(function (e) { return ACTIVE[e.reserva.status] && e.date >= Cal.today(); }).sort(bySchedule)[0];
    return '<section class="section"><div class="section-head"><h2>Reservas</h2><a class="btn ghost sm" href="#reservas">Ver todas</a></div>' +
      '<a class="card tap rv-home' + (news ? ' rv-new' : '') + '" href="#reservas" style="text-decoration:none;color:inherit"><div class="card-row">' +
      '<div class="tile ' + (p.length ? 'warn' : '') + '">' + icon('party') + '</div><div class="grow">' +
      '<div class="card-title">' + (p.length ? p.length + (p.length === 1 ? ' reserva pendente' : ' reservas pendentes') : 'Nenhuma reserva pendente') + '</div>' +
      '<div class="card-meta">' + (news ? news + (news === 1 ? ' nova, ainda não aberta' : ' novas, ainda não abertas') + (next ? ' · ' : '') : '') +
      (next ? 'Próxima: ' + esc(br(next.date)) + ' às ' + esc(next.reserva.inicio) + ', ' + esc(who(next.reserva)) : (news ? '' : 'Os pedidos do link público aparecem aqui')) + '</div></div>' +
      (p.length ? '<span class="rv-count num">' + p.length + '</span>' : icon('chevronRight', 'sm')) + '</div></a>' +
      '<button type="button" class="btn block" data-rv-copy>' + icon('link', 'sm') + 'Copiar link de reserva</button></section>';
  }

  // Aviso no topo da agenda: reservas futuras que disputam o mesmo horário.
  function conflictBanner() {
    var t = Cal.today();
    var list = all().filter(function (e) { return e.date >= t && conflicts(e).length; }).sort(bySchedule);
    if (!list.length) return '';
    var first = list[0];
    return '<button type="button" class="banner crit rv-conflict-banner" data-rv="' + esc(first.reserva.id) + '">' + icon('alert', 'sm') +
      '<span class="grow">' + list.length + ' reservas com conflito de horário · a primeira em ' + esc(br(first.date)) + ' às ' + esc(first.reserva.inicio) + '</span>' +
      icon('chevronRight', 'sm') + '</button>';
  }

  window.Reservas = {
    STATUS: STATUS,
    isNew: isNew,
    conflicts: conflicts,
    pendingCount: function () { return pending().length; },
    open: open,
    link: link,
    copyLink: copyLink,
    homeCard: homeCard,
    conflictBanner: conflictBanner
  };
})();
