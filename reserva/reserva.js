// Página pública de reservas (/reserva): questionário sem login, feito para abrir pelo WhatsApp.
// Envia para criar_reserva() (supabase/005_reservas.sql), que confere tudo de novo no servidor,
// grava a reserva e cria o evento na agenda da equipe. Esta página não lê nenhum dado do app.
(function () {
  var cfg = window.DINDOM_CONFIG || {};
  var NAME = 'Dindom';
  var TZ = 'America/Fortaleza';
  var TYPES = [['aniversario', 'Aniversário'], ['confraternizacao', 'Confraternização de empresa'], ['reuniao', 'Reunião'], ['outro', 'Outro']];
  var WEEK = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var MIN_FILL_MS = 4000; // ninguém preenche o questionário em menos que isso: envio assim é robô
  var openedAt = Date.now();
  var body = document.getElementById('rp-body');
  var client = null;

  if (cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'dindom-reserva' }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ic(name, cls) { return window.icon ? window.icon(name, cls) : ''; }

  // Hoje e agora no fuso da loja (não no do aparelho de quem preenche).
  function now() {
    var p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
  }
  function addDays(iso, n) {
    var p = iso.split('-'), d = new Date(+p[0], p[1] - 1, +p[2] + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function br(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function weekday(iso) { var p = iso.split('-'); return WEEK[new Date(+p[0], p[1] - 1, +p[2]).getDay()]; }

  function fmtPhone(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function fmtMoney(v) {
    var d = String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
    return d ? 'R$ ' + Number(d).toLocaleString('pt-BR') : '';
  }

  // ---------- Questionário ----------

  function label(id, text, required) {
    return '<label for="r-' + id + '">' + text + (required ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="faint">(opcional)</span>') + '</label>';
  }
  function field(id, text, required, input, hint) {
    return '<div class="field" id="f-' + id + '">' + label(id, text, required) + input +
      (hint ? '<span class="hint" id="h-' + id + '">' + hint + '</span>' : '') + '<span class="err" role="alert" hidden></span></div>';
  }
  function input(id, attrs) { return '<input id="r-' + id + '" name="' + id + '" class="input" ' + (attrs || '') + '>'; }
  function opts(name, list) {
    return '<div class="rp-opts">' + list.map(function (o) {
      return '<label class="rp-opt"><input type="radio" name="' + name + '" value="' + o[0] + '"><span>' + esc(o[1]) + '</span></label>';
    }).join('') + '</div>';
  }
  function group(id, text, required, inner) {
    return '<fieldset class="field rp-group" id="f-' + id + '"><legend>' + text + (required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</legend>' +
      inner + '<span class="err" role="alert" hidden></span></fieldset>';
  }

  function formHtml() {
    var t = now().date;
    return '<section class="rp-intro"><h1>Reserve seu evento</h1>' +
      '<p class="muted">Aniversários, confraternizações de empresa e reuniões. Preencha o pedido e a nossa equipe confirma pelo WhatsApp.</p>' +
      '<p class="faint rp-legend"><span class="req">*</span> obrigatório</p></section>' +
      '<div class="banner crit" id="rp-error" role="alert" hidden></div>' +
      '<form id="rp-form" novalidate autocomplete="on">' +

      '<section class="card"><h2>Seus dados</h2>' +
      field('nome', 'Nome do responsável', true, input('nome', 'autocomplete="name" maxlength="120" autocapitalize="words"')) +
      field('empresa', 'Nome da empresa', false, input('empresa', 'autocomplete="organization" maxlength="120"')) +
      field('whatsapp', 'WhatsApp', true, input('whatsapp', 'type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="(85) 99999-8888" maxlength="16"'), 'Com DDD. É por aqui que vamos confirmar a reserva.') +
      field('email', 'E-mail', false, input('email', 'type="email" inputmode="email" autocomplete="email" maxlength="160" placeholder="nome@empresa.com.br"')) +
      '</section>' +

      '<section class="card"><h2>O evento</h2>' +
      group('tipo', 'Tipo de evento', true, opts('tipo', TYPES)) +
      '<div id="f-outro-wrap" hidden>' + field('tipo_outro', 'Qual é o evento?', false, input('tipo_outro', 'maxlength="60" placeholder="Ex.: chá de bebê, formatura"')) + '</div>' +
      field('homenageado', 'Nome do aniversariante ou homenageado', false, input('homenageado', 'maxlength="120"')) +
      field('data', 'Data do evento', true, input('data', 'type="date" min="' + t + '" max="' + addDays(t, 730) + '"')) +
      '<div class="rp-two">' +
      field('inicio', 'Início', true, input('inicio', 'type="time"')) +
      field('termino', 'Término previsto', true, input('termino', 'type="time"')) +
      '</div>' +
      '<p class="hint rp-midnight" id="rp-midnight" hidden>' + ic('clock', 'sm') + ' Termina depois da meia-noite (no dia seguinte).</p>' +
      field('pessoas', 'Quantidade de pessoas', true, input('pessoas', 'type="number" inputmode="numeric" min="1" max="2000" step="1" placeholder="Ex.: 25"')) +
      group('decoracao', 'Precisa de decoração?', true, opts('decoracao', [['sim', 'Sim'], ['nao', 'Não']])) +
      '</section>' +

      '<section class="card"><h2>Detalhes</h2>' +
      field('alimentacao', 'Bolo, alimentação e bebidas: o que deseja?', false,
        '<textarea id="r-alimentacao" name="alimentacao" class="textarea" maxlength="1500" placeholder="Ex.: rodízio de pizza, bolo da casa, refrigerante e suco"></textarea>') +
      field('orcamento', 'Orçamento aproximado', false, input('orcamento', 'inputmode="numeric" placeholder="R$ 0" maxlength="14"')) +
      field('observacoes', 'Observações ou pedidos especiais', false,
        '<textarea id="r-observacoes" name="observacoes" class="textarea" maxlength="2000" placeholder="Ex.: mesa perto da janela, cadeirão para criança, alguém com restrição alimentar"></textarea>') +
      '</section>' +

      // Campo escondido: pessoas não veem nem preenchem; robôs costumam preencher.
      '<div class="rp-hp" aria-hidden="true"><label for="r-site">Site</label><input id="r-site" name="site" tabindex="-1" autocomplete="off"></div>' +

      '<div class="field" id="f-aceite"><label class="rp-check" for="r-aceite"><input id="r-aceite" name="aceite" type="checkbox">' +
      '<span>Entendo que a reserva só é garantida após confirmação da equipe. <span class="req" aria-hidden="true">*</span></span></label>' +
      '<span class="err" role="alert" hidden></span></div>' +

      '<button type="submit" class="btn primary block rp-send">Enviar solicitação</button>' +
      '</form>' +
      '<p class="faint rp-foot">' + esc(NAME) + ' · seus dados são usados só para combinar o seu evento.</p>';
  }

  function radio(form, name) { var r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }

  function values(form) {
    function v(id) { return form.querySelector('#r-' + id).value.trim(); }
    var tipo = radio(form, 'tipo'), deco = radio(form, 'decoracao');
    return {
      nome: v('nome'), empresa: v('empresa'), whatsapp: v('whatsapp').replace(/\D/g, ''), email: v('email'),
      tipo: tipo, tipo_outro: tipo === 'outro' ? v('tipo_outro') : '', homenageado: v('homenageado'),
      data: v('data'), inicio: v('inicio'), termino: v('termino'), pessoas: v('pessoas'),
      decoracao: deco === '' ? null : deco === 'sim',
      alimentacao: v('alimentacao'), orcamento: v('orcamento').replace(/\D/g, ''), observacoes: v('observacoes'),
      aceite: form.querySelector('#r-aceite').checked, site: v('site')
    };
  }

  // Mesmas regras do servidor, com mensagens que dizem o que corrigir.
  function validate(x) {
    var e = {}, n = now();
    if (x.nome.length < 2) e.nome = 'Informe o nome do responsável.';
    if (x.whatsapp.length < 10 || x.whatsapp.length > 11) e.whatsapp = 'Informe o WhatsApp com DDD, por exemplo (85) 99999-8888.';
    if (x.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)) e.email = 'Confira o e-mail (exemplo: nome@empresa.com.br) ou deixe em branco.';
    if (!x.tipo) e.tipo = 'Escolha o tipo de evento.';
    if (!x.data) e.data = 'Escolha a data do evento.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(x.data)) e.data = 'Data inválida.';
    else if (x.data < n.date) e.data = 'Essa data já passou. Escolha uma data a partir de hoje.';
    else if (x.data > addDays(n.date, 730)) e.data = 'Escolha uma data nos próximos dois anos.';
    if (!x.inicio) e.inicio = 'Informe o horário de início.';
    else if (x.data === n.date && x.inicio < n.time) e.inicio = 'Esse horário de hoje já passou.';
    if (!x.termino) e.termino = 'Informe o horário previsto de término.';
    else if (x.inicio && x.termino === x.inicio) e.termino = 'O término precisa ser diferente do início.';
    if (!/^\d{1,4}$/.test(x.pessoas) || +x.pessoas < 1 || +x.pessoas > 2000) e.pessoas = 'Informe quantas pessoas, só com números (de 1 a 2000).';
    if (x.decoracao === null) e.decoracao = 'Responda se precisa de decoração.';
    if (!x.aceite) e.aceite = 'Marque esta caixa para enviar a solicitação.';
    return e;
  }

  function showErrors(form, errs) {
    form.querySelectorAll('.field').forEach(function (f) {
      var id = f.id.slice(2), msg = errs[id], err = f.querySelector(':scope > .err');
      f.classList.toggle('error', !!msg);
      if (err) { err.hidden = !msg; err.textContent = msg || ''; }
      var inp = f.querySelector('#r-' + id);
      if (inp) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
    });
  }
  function clearError(form, id) {
    var f = form.querySelector('#f-' + id);
    if (!f || !f.classList.contains('error')) return;
    f.classList.remove('error');
    var err = f.querySelector(':scope > .err'); if (err) err.hidden = true;
    var inp = f.querySelector('#r-' + id); if (inp) inp.removeAttribute('aria-invalid');
  }
  function topError(msg) {
    var b = document.getElementById('rp-error');
    if (!msg) { b.hidden = true; return; }
    b.innerHTML = ic('alert', 'sm') + '<div class="grow">' + esc(msg) + '</div>';
    b.hidden = false;
  }

  function mountForm() {
    body.innerHTML = formHtml();
    var form = document.getElementById('rp-form');
    var $ = function (s) { return form.querySelector(s); };

    var wa = $('#r-whatsapp');
    wa.addEventListener('input', function () { wa.value = fmtPhone(wa.value); });
    var orc = $('#r-orcamento');
    orc.addEventListener('input', function () { orc.value = fmtMoney(orc.value); });

    form.addEventListener('change', function (e) {
      if (e.target.name === 'tipo') $('#f-outro-wrap').hidden = e.target.value !== 'outro';
      if (e.target.name) clearError(form, e.target.name);
    });
    form.addEventListener('input', function (e) { if (e.target.name) clearError(form, e.target.name); });

    // Término antes do início: a festa passa da meia-noite.
    function midnight() {
      var a = $('#r-inicio').value, b = $('#r-termino').value;
      document.getElementById('rp-midnight').hidden = !(a && b && b < a);
    }
    $('#r-inicio').addEventListener('change', midnight);
    $('#r-termino').addEventListener('change', midnight);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var x = values(form);
      // Robô: responde como se tivesse dado certo, sem enviar nada.
      if (x.site || Date.now() - openedAt < MIN_FILL_MS) return done(x, '');
      var errs = validate(x);
      showErrors(form, errs);
      var bad = Object.keys(errs);
      if (bad.length) {
        topError(bad.length === 1 ? 'Falta corrigir 1 campo. Ele está destacado em vermelho.' : 'Faltam corrigir ' + bad.length + ' campos. Eles estão destacados em vermelho.');
        var first = form.querySelector('.field.error');
        if (first) {
          first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var focus = first.querySelector('input, textarea');
          if (focus) setTimeout(function () { try { focus.focus({ preventScroll: true }); } catch (er) {} }, 350);
        }
        return;
      }
      topError('');
      send(form, x);
    });
  }

  function send(form, x) {
    var btn = form.querySelector('.rp-send');
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Enviando…';
    function fail(msg) {
      btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Enviar solicitação';
      topError(msg);
      document.getElementById('rp-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    client.rpc('criar_reserva', { p: x }).then(function (r) {
      if (r.error) {
        var m = r.error.message || '';
        if (/fetch|network|Failed to/i.test(m)) return fail('Sem conexão com a internet. Confira e toque em Enviar de novo.');
        if (/schema cache|does not exist|criar_reserva/i.test(m)) return fail('As reservas pelo link ainda não estão ativas. Fale com a gente pelo WhatsApp.');
        return fail(m);
      }
      done(x, (r.data && r.data.codigo) || '');
    }, function () { fail('Sem conexão com a internet. Confira e toque em Enviar de novo.'); });
  }

  // ---------- Tela de sucesso ----------

  function done(x, codigo) {
    var tipo = (TYPES.filter(function (t) { return t[0] === x.tipo; })[0] || ['', ''])[1];
    if (x.tipo === 'outro' && x.tipo_outro) tipo = 'Outro: ' + x.tipo_outro;
    var rows = [
      ['Responsável', x.nome], ['Empresa', x.empresa], ['WhatsApp', fmtPhone(x.whatsapp)], ['E-mail', x.email],
      ['Tipo de evento', tipo], ['Aniversariante ou homenageado', x.homenageado],
      ['Data', x.data ? weekday(x.data) + ', ' + br(x.data) : ''],
      ['Horário', x.inicio && x.termino ? x.inicio + ' às ' + x.termino + (x.termino < x.inicio ? ' (termina no dia seguinte)' : '') : ''],
      ['Pessoas', x.pessoas], ['Decoração', x.decoracao ? 'Sim' : 'Não'],
      ['Bolo, alimentação e bebidas', x.alimentacao], ['Orçamento aproximado', fmtMoney(x.orcamento)], ['Observações', x.observacoes]
    ].filter(function (r) { return r[1]; });
    body.innerHTML = '<section class="card rp-done">' +
      '<div class="rp-ok">' + ic('check', 'lg') + '</div>' +
      '<h1>Recebemos sua solicitação!</h1>' +
      '<p>Entraremos em contato pelo WhatsApp para confirmar.</p>' +
      (codigo ? '<p class="muted">Código da solicitação: <b class="num">' + esc(codigo) + '</b></p>' : '') +
      '</section>' +
      '<section class="card"><h2>Resumo</h2><dl class="rp-sum">' + rows.map(function (r) {
        return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl></section>' +
      '<div class="banner">' + ic('alert', 'sm') + '<div class="grow">A reserva só é garantida depois da confirmação da equipe.</div></div>' +
      '<button type="button" class="btn block" data-again>Fazer outra solicitação</button>';
    body.querySelector('[data-again]').addEventListener('click', function () { openedAt = Date.now(); mountForm(); window.scrollTo(0, 0); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!client) {
    body.innerHTML = '<section class="card rp-done"><h1>Reservas indisponíveis</h1><p class="muted">No momento não conseguimos receber reservas por aqui. Fale com a gente pelo WhatsApp.</p></section>';
  } else {
    mountForm();
  }
})();
