// Contas a pagar (só o administrador): cadastro das contas, vencimentos na Agenda e aviso no Início.
// Ficam numa linha própria ("contas") da tabela "financeiro" (supabase/007_financeiro.sql), que só o
// administrador lê: a equipe não vê as contas nem os valores, nem na Agenda.
// Sem servidor, ficam só neste aparelho. A tela fica em Financeiro › Contas a pagar.
(function () {
  var esc = UI.esc;
  var LOCAL = 'dindom:contas';
  var REPEAT = [['mensal', 'Todo mês'], ['unica', 'Só uma vez'], ['semanal', 'Toda semana'], ['anual', 'Todo ano']];
  var CATS = ['Aluguel', 'Energia', 'Água', 'Gás', 'Internet e telefone', 'Fornecedor', 'Impostos', 'Folha e encargos', 'Empréstimo e parcelamento', 'Sistemas e aplicativos', 'Outros'];

  var store = { status: 'idle', at: 0, data: null, error: '' }; // data: { bills: [...], paid: { id: { 'AAAA-MM-DD': { at, by, value } } } }
  var waiting = [];

  function admin() { return UI.isAdmin(); }
  function cloud() { return !!(window.Cloud && Cloud.enabled && Cloud.orgId && Cloud.client); }
  function empty() { return { bills: [], paid: {} }; }
  function cacheGet() { try { return JSON.parse(localStorage.getItem(LOCAL + ':' + (window.Cloud && Cloud.orgId || 'local')) || 'null'); } catch (e) { return null; } }
  function cacheSet(d) { try { localStorage.setItem(LOCAL + ':' + (window.Cloud && Cloud.orgId || 'local'), JSON.stringify(d)); } catch (e) {} }
  function money(n) { return CMV.money(n); }
  function today() { return DB.iso(new Date()); }
  function br(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function brY(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  // Busca as contas no servidor (no máximo a cada minuto). "done" é chamado quando chegam.
  function ensure(done) {
    if (!admin()) return;
    // Já buscou há pouco: não chama "done" (quem chamou já está desenhando com estes dados).
    if (store.status !== 'loading' && store.data && Date.now() - store.at < 60000) return;
    if (done) waiting.push(done);
    if (store.status === 'loading') return;
    if (!store.data) store.data = cacheGet(); // mostra a última cópia enquanto busca
    if (!cloud()) { store.data = store.data || empty(); store.status = 'ok'; store.at = Date.now(); return flush(); }
    store.status = 'loading';
    Cloud.client.from('financeiro').select('data').eq('org_id', Cloud.orgId).eq('id', 'contas').then(function (r) {
      store.at = Date.now();
      if (r.error) { store.status = /financeiro|does not exist|schema cache/i.test(r.error.message || '') ? 'sql' : 'error'; store.error = r.error.message; }
      else if (!saving) { store.data = (r.data[0] && r.data[0].data) || empty(); store.status = 'ok'; cacheSet(store.data); }
      else store.status = 'ok';
      flush();
    }, function () { store.at = Date.now(); store.status = store.data ? 'ok' : 'error'; store.error = 'Sem internet.'; flush(); });
  }
  function flush() { var w = waiting; waiting = []; w.forEach(function (f) { try { f(); } catch (e) {} }); }

  var saving = 0;
  function save() {
    var d = store.data;
    if (!d.bills) d.bills = [];
    if (!d.paid) d.paid = {};
    cacheSet(d);
    if (!cloud()) return;
    saving++;
    Cloud.client.from('financeiro').upsert({ org_id: Cloud.orgId, id: 'contas', data: d, updated_at: new Date().toISOString() }).then(function (r) {
      saving--;
      if (r.error) UI.toast('As contas não foram salvas: ' + r.error.message, { tone: 'crit', ms: 6000 });
    }, function () { saving--; UI.toast('Sem internet: as contas não foram salvas. Tente de novo.', { tone: 'crit', ms: 6000 }); });
  }

  // ---------- Vencimentos ----------

  function parse(iso) { var p = iso.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }
  // Datas de vencimento da conta entre "from" e "to" (inclusive). Dia 31 em mês curto vence no último dia.
  function dues(b, from, to) {
    var out = [], s = b.start;
    if (!s || s > to) return out;
    if (b.repeat === 'unica') return s >= from ? [s] : [];
    if (b.repeat === 'semanal') {
      var d = parse(s), n = 0;
      if (s < from) { var skip = Math.floor((parse(from) - d) / (7 * 864e5)); d.setDate(d.getDate() + skip * 7); n = skip; }
      for (; DB.iso(d) <= to; d.setDate(d.getDate() + 7), n++) { if (b.times && n >= b.times) break; if (DB.iso(d) >= from) out.push(DB.iso(d)); }
      return out;
    }
    var st = parse(s), day = st.getDate(), step = b.repeat === 'anual' ? 12 : 1;
    for (var i = 0; ; i++) {
      if (b.times && i >= b.times) break;
      var m = st.getMonth() + i * step, y = st.getFullYear() + Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      var iso = DB.iso(new Date(y, m, Math.min(day, daysIn(y, m))));
      if (iso > to) break;
      if (iso >= from) out.push(iso);
    }
    return out;
  }
  function paidOf(b, date) { var p = store.data && store.data.paid && store.data.paid[b.id]; return (p && p[date]) || null; }
  function bill(id) { return ((store.data && store.data.bills) || []).filter(function (b) { return b.id === id; })[0] || null; }
  function amount(b, date) { var p = paidOf(b, date); return p && p.value != null ? +p.value : b.value != null ? +b.value : null; }
  // Parcela "3 de 10" para contas com número de vezes.
  function parcel(b, date) {
    if (!b.times || b.times < 2) return '';
    var all = dues(b, b.start, date);
    return all.length + ' de ' + b.times;
  }

  // Todos os vencimentos entre duas datas: { b, date, value, paid, late }.
  function list(from, to) {
    var out = [], t = today();
    ((store.data && store.data.bills) || []).forEach(function (b) {
      if (b.off) return;
      dues(b, from, to).forEach(function (d) { var p = paidOf(b, d); out.push({ b: b, date: d, value: amount(b, d), paid: p, late: !p && d < t }); });
    });
    return out.sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : a.b.name < c.b.name ? -1 : 1; });
  }

  // ---------- Agenda ----------
  // Cada vencimento vira um evento de dia inteiro na agenda "Financeiro", só para o administrador.
  // Cor: vermelho atrasada, cinza paga, a cor da agenda nas que estão para vencer.
  function occurrences(from, to) {
    if (!admin() || !store.data) return [];
    var hidden = DB.get().prefs.hiddenCals || {};
    if (hidden.financeiro) return [];
    var cal = DB.get().calendars.some(function (c) { return c.id === 'financeiro'; }) ? 'financeiro' : DB.get().calendars[0].id;
    return list(from, to).map(function (o) {
      return { date: o.date, ev: { id: 'bill:' + o.b.id, conta: true, cal: cal, allDay: true, repeat: 'none', date: o.date,
        color: o.paid ? 8 : o.late ? 6 : 0,
        title: (o.paid ? '✓ ' : o.late ? '⚠ ' : '💲 ') + o.b.name + (o.value != null ? ' · ' + money(o.value) : '') } };
    });
  }

  // Painel aberto ao tocar no vencimento (Agenda, Início ou a lista de contas).
  function sheet(id, date) {
    var b = bill(id);
    if (!b) return;
    var p = paidOf(b, date), v = amount(b, date), late = !p && date < today(), pc = parcel(b, date);
    UI.sheet('<h2>' + esc(b.name) + '</h2>' +
      '<div class="kv"><span>Vencimento</span><b>' + esc(Cal.dayTitle(date)) + ' de ' + date.slice(0, 4) + '</b>' +
      '<span>Valor</span><b class="num">' + (v != null ? money(v) : 'varia (informe ao pagar)') + '</b>' +
      (pc ? '<span>Parcela</span><b class="num">' + pc + '</b>' : '') +
      '<span>Repete</span><b>' + esc(repeatLabel(b)) + '</b>' +
      (b.cat ? '<span>Categoria</span><b>' + esc(b.cat) + '</b>' : '') +
      '<span>Situação</span><b>' + (p ? '<span class="pill ok">Paga em ' + br(DB.iso(new Date(p.at))) + (p.by ? ' por ' + esc(String(p.by).split(' ')[0]) : '') + '</span>'
        : late ? '<span class="pill crit">Atrasada</span>' : '<span class="pill warn">A pagar</span>') + '</b></div>' +
      (b.notes ? '<div class="card" style="box-shadow:none;background:var(--surface-2)"><div class="card-meta">Observações</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(b.notes) + '</div>' +
        (/\d{20,}|pix|chave/i.test(b.notes) ? '<button type="button" class="btn sm" data-copy-notes style="align-self:flex-start">' + icon('copy', 'sm') + 'Copiar</button>' : '') + '</div>' : '') +
      (p ? '<button type="button" class="btn block" data-unpay>Desfazer pagamento</button>' : '<button type="button" class="btn primary block" data-pay>' + icon('check', 'sm') + 'Marcar como paga</button>') +
      '<div class="seg"><button type="button" data-edit>' + icon('settings', 'sm') + 'Editar conta</button><button type="button" data-all>' + icon('receipt', 'sm') + 'Todas as contas</button></div>' +
      '<button type="button" class="btn block" data-close>Fechar</button>',
      function (sh, close) {
        var q = function (s) { return sh.querySelector(s); };
        if (q('[data-pay]')) q('[data-pay]').addEventListener('click', function () { close(); pay(b, date); });
        if (q('[data-unpay]')) q('[data-unpay]').addEventListener('click', function () { close(); unpay(b, date); });
        q('[data-edit]').addEventListener('click', function () { close(); edit(b); });
        q('[data-all]').addEventListener('click', function () { close(); go('financeiro/contas'); });
        if (q('[data-copy-notes]')) q('[data-copy-notes]').addEventListener('click', function () {
          try { navigator.clipboard.writeText(b.notes).then(function () { UI.toast('Copiado'); }); } catch (e) {}
        });
      });
  }

  function pay(b, date) {
    var v = amount(b, date);
    function done(val) {
      store.data.paid[b.id] = store.data.paid[b.id] || {};
      store.data.paid[b.id][date] = { at: Date.now(), by: DB.get().user.name, value: val };
      save(); refresh(); UI.buzz(15);
      UI.toast(b.name + ' paga' + (val != null ? ': ' + money(val) : ''), { action: 'Desfazer', ms: 4500, onAction: function () { unpay(b, date, true); } });
    }
    // Valor que varia (energia, água): pergunta quanto foi pago.
    UI.sheet('<h2>Pagar ' + esc(b.name) + '</h2><p class="muted">Vencimento em ' + brY(date) + '.</p>' +
      '<div class="field"><label for="pay-v">Valor pago (R$)</label><input id="pay-v" class="input num" inputmode="decimal" placeholder="0,00" value="' + (v != null ? CMV.num2(v) : '') + '" autofocus>' +
      '<span class="hint">Mude se o valor deste mês foi diferente (juros, desconto, conta de consumo).</span></div>' +
      '<button type="button" class="btn primary block" data-ok>' + icon('check', 'sm') + 'Confirmar pagamento</button><button type="button" class="btn block" data-close>Voltar</button>',
      function (sh, close) {
        sh.querySelector('[data-ok]').addEventListener('click', function () {
          var val = CMV.parse(sh.querySelector('#pay-v').value);
          if (val != null && val < 0) return UI.toast('O valor não pode ser negativo.', { tone: 'crit' });
          close(); done(val != null ? Math.round(val * 100) / 100 : null);
        });
      });
  }
  function unpay(b, date, quiet) {
    if (store.data.paid[b.id]) delete store.data.paid[b.id][date];
    save(); refresh();
    if (!quiet) UI.toast('Pagamento desfeito');
  }

  function repeatLabel(b) {
    if (b.repeat === 'unica') return 'Só uma vez';
    if (b.repeat === 'semanal') return 'Toda ' + Cal.WEEK[parse(b.start).getDay()] + (b.times ? ', ' + b.times + ' vezes' : '');
    if (b.repeat === 'anual') return 'Todo ano em ' + br(b.start) + (b.times ? ', ' + b.times + ' vezes' : '');
    return 'Todo mês no dia ' + parse(b.start).getDate() + (b.times ? ', ' + b.times + ' parcelas' : '');
  }

  // ---------- Cadastro ----------

  function edit(b) {
    var isNew = !b || !b.id;
    var v = b && b.id ? b : { name: '', value: null, start: (b && b.start) || today(), repeat: 'mensal', times: null, cat: '', notes: '' };
    UI.sheet('<h2>' + (isNew ? 'Nova conta' : 'Editar conta') + '</h2>' +
      '<div class="field" id="f-c-name"><label for="c-name">Nome</label><input id="c-name" class="input" maxlength="60" placeholder="Ex.: aluguel, energia, boleto do forno" value="' + esc(v.name) + '"' + (isNew ? ' autofocus' : '') + '><span class="err" hidden>Dê um nome à conta.</span></div>' +
      '<div class="field"><label for="c-value">Valor (R$) <span class="faint">(vazio se muda todo mês)</span></label><input id="c-value" class="input num" inputmode="decimal" placeholder="0,00" value="' + (v.value != null ? CMV.num2(v.value) : '') + '"></div>' +
      '<div class="field"><label for="c-start">' + (isNew ? 'Próximo vencimento' : 'Primeiro vencimento') + '</label><input id="c-start" type="date" class="input" value="' + esc(v.start) + '"></div>' +
      '<div class="field"><span class="label">Repete</span><div class="seg" data-rep>' + REPEAT.map(function (r) {
        return '<button type="button" data-v="' + r[0] + '" aria-pressed="' + (v.repeat === r[0]) + '">' + r[1] + '</button>';
      }).join('') + '</div><span class="hint" data-rep-hint></span></div>' +
      '<div class="field" data-times-f' + (v.repeat === 'unica' ? ' hidden' : '') + '><label for="c-times">Quantas vezes <span class="faint">(vazio = sem fim; use para parcelas)</span></label><input id="c-times" class="input num" inputmode="numeric" placeholder="Ex.: 10" value="' + (v.times || '') + '"></div>' +
      '<div class="field"><label for="c-cat">Categoria</label><select id="c-cat" class="select"><option value="">Sem categoria</option>' + CATS.map(function (c) { return '<option' + (c === v.cat ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="c-notes">Observações <span class="faint">(opcional: código de barras, chave Pix, fornecedor)</span></label><textarea id="c-notes" class="textarea" style="min-height:72px">' + esc(v.notes || '') + '</textarea></div>' +
      '<button type="button" class="btn primary block" data-save>' + (isNew ? 'Salvar conta' : 'Salvar alterações') + '</button>' +
      (isNew ? '' : '<button type="button" class="btn block" data-del style="color:var(--crit)">Excluir conta</button>') +
      '<button type="button" class="btn block" data-close>Cancelar</button>',
      function (sh, close) {
        var q = function (s) { return sh.querySelector(s); }, rep = v.repeat;
        function hint() {
          var s = q('#c-start').value || today(), d = parse(s);
          q('[data-rep-hint]').textContent = rep === 'mensal' ? 'Vence todo dia ' + d.getDate() + (d.getDate() > 28 ? ' (no mês que não tiver esse dia, no último dia do mês)' : '') + '.'
            : rep === 'semanal' ? 'Vence toda ' + Cal.WEEK[d.getDay()] + '.' : rep === 'anual' ? 'Vence todo ano em ' + br(s) + '.' : 'Vence só em ' + brY(s) + '.';
        }
        hint();
        q('#c-start').addEventListener('change', hint);
        sh.querySelectorAll('[data-rep] button').forEach(function (bt) {
          bt.addEventListener('click', function () {
            rep = bt.dataset.v;
            sh.querySelectorAll('[data-rep] button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === bt)); });
            q('[data-times-f]').hidden = rep === 'unica';
            hint();
          });
        });
        q('[data-save]').addEventListener('click', function () {
          var name = q('#c-name').value.trim(), val = CMV.parse(q('#c-value').value), times = CMV.parse(q('#c-times').value), start = q('#c-start').value;
          q('#f-c-name').classList.toggle('error', !name); q('#f-c-name .err').hidden = !!name;
          if (!name) return;
          if (!start) return UI.toast('Informe a data do vencimento.', { tone: 'crit' });
          if (val != null && val < 0) return UI.toast('O valor não pode ser negativo.', { tone: 'crit' });
          var out = { name: name, value: val != null ? Math.round(val * 100) / 100 : null, start: start, repeat: rep,
            times: rep !== 'unica' && times > 0 ? Math.round(times) : null, cat: q('#c-cat').value, notes: q('#c-notes').value.trim() };
          if (isNew) { out.id = 'c' + Date.now().toString(36); out.at = Date.now(); store.data.bills.push(out); }
          else Object.keys(out).forEach(function (k) { b[k] = out[k]; });
          save(); close(); refresh(); UI.buzz(15);
          UI.toast(isNew ? 'Conta salva. Os vencimentos já aparecem na sua agenda.' : 'Conta atualizada', { ms: 3500 });
        });
        var del = q('[data-del]');
        if (del) del.addEventListener('click', function () {
          close();
          UI.confirm({ title: 'Excluir "' + b.name + '"?', body: 'A conta e o histórico de pagamentos dela saem do app e da agenda.', ok: 'Excluir conta', danger: true,
            onOk: function () {
              var copy = JSON.parse(JSON.stringify(b)), paid = store.data.paid[b.id];
              store.data.bills = store.data.bills.filter(function (x) { return x.id !== b.id; });
              delete store.data.paid[b.id];
              save(); refresh();
              UI.toast('Conta excluída', { action: 'Desfazer', ms: 4500, onAction: function () { store.data.bills.push(copy); if (paid) store.data.paid[copy.id] = paid; save(); refresh(); } });
            } });
        });
      });
  }

  // ---------- Tela: Financeiro › Contas a pagar ----------

  var view = { month: null };

  function row(o) {
    var pc = parcel(o.b, o.date);
    return '<button type="button" class="row conta-row' + (o.paid ? ' paid' : o.late ? ' late' : '') + '" data-conta="' + esc(o.b.id) + '" data-date="' + o.date + '">' +
      '<span class="conta-date num"><b>' + o.date.slice(8) + '</b><span>' + Cal.WEEK_SHORT[parse(o.date).getDay()] + '</span></span>' +
      '<span class="grow"><span class="card-title">' + esc(o.b.name) + (pc ? ' <span class="faint num">(' + pc + ')</span>' : '') + '</span>' +
      '<span class="card-meta">' + (o.paid ? 'Paga em ' + br(DB.iso(new Date(o.paid.at))) : o.late ? 'Venceu em ' + brY(o.date) : o.date === today() ? 'Vence hoje' : 'Vence ' + Cal.dayTitle(o.date).toLowerCase()) + (o.b.cat ? ' · ' + esc(o.b.cat) : '') + '</span></span>' +
      '<b class="num">' + (o.value != null ? money(o.value) : '<span class="faint">a definir</span>') + '</b>' +
      (o.paid ? '<span class="pill ok no-dot">' + icon('check', 'sm') + 'Paga</span>' : o.late ? '<span class="pill crit no-dot">Atrasada</span>' : '') + '</button>';
  }

  function screen(shell) {
    ensure(function () { if (route() === 'financeiro/contas' && !document.querySelector('.sheet-wrap')) refresh(); });
    if (!store.data) {
      if (store.status === 'sql') return { html: shell('contas', '<div data-sqlhelp></div>'), tab: 'financeiro', mount: function (root) { UI.sqlHelp(root.querySelector('[data-sqlhelp]'), 'supabase/007_financeiro.sql', 'Volte aqui e abra <b>Financeiro › Contas a pagar</b> de novo.'); store.status = 'idle'; } };
      if (store.status === 'error') return { html: shell('contas', '<div class="card">' + UI.empty('alert', 'Não deu para abrir as contas', store.error || 'Confira a internet.', '<button type="button" class="btn primary" data-retry>Tentar de novo</button>') + '</div>'), tab: 'financeiro',
        mount: function (root) { root.querySelector('[data-retry]').addEventListener('click', function () { store.status = 'idle'; store.at = 0; refresh(); }); } };
      return { html: shell('contas', '<div class="skel" style="height:96px"></div><div class="skel" style="height:240px"></div>'), tab: 'financeiro' };
    }
    var t = today(), cur = view.month || t.slice(0, 7);
    var first = cur + '-01', last = cur + '-' + String(Fin.daysIn(cur)).padStart(2, '0');
    var month = list(first, last);
    var late = list(Rel_addDays(t, -120), Rel_addDays(t, -1)).filter(function (o) { return o.late && o.date < first; });
    var next7 = list(t, Rel_addDays(t, 7)).filter(function (o) { return !o.paid; });
    var sum = function (a) { return a.reduce(function (s, o) { return s + (o.value || 0); }, 0); };
    var toPay = month.filter(function (o) { return !o.paid; }), paid = month.filter(function (o) { return o.paid; });
    var unknown = toPay.filter(function (o) { return o.value == null; }).length;
    var lateAll = late.concat(month.filter(function (o) { return o.late; }));
    var bills = store.data.bills.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });

    var nav = '<div class="fin-month"><button type="button" class="icon-btn" data-cmon="-1" aria-label="Mês anterior">' + icon('chevronLeft') + '</button>' +
      '<b>' + esc(Fin.monthLabel(cur)) + '</b><button type="button" class="icon-btn" data-cmon="1" aria-label="Próximo mês">' + icon('chevronRight') + '</button></div>';
    var kpi = function (label, value, sub, tone) { return '<div class="card cmv-kpi"><span class="card-meta">' + label + '</span><span class="stat num' + (tone ? ' tone-' + tone : '') + '">' + value + '</span><span class="card-meta">' + sub + '</span></div>'; };
    var body = nav +
      '<section class="stat-grid fin-kpis">' +
      kpi('A pagar no mês', money(sum(toPay)), toPay.length + (toPay.length === 1 ? ' conta' : ' contas') + (unknown ? ' · ' + unknown + ' sem valor definido' : ''), toPay.length ? '' : 'ok') +
      kpi('Já pago', money(sum(paid)), paid.length + (paid.length === 1 ? ' conta paga' : ' contas pagas'), paid.length ? 'ok' : '') +
      kpi('Atrasadas', String(lateAll.length), lateAll.length ? money(sum(lateAll)) + ' em atraso' : 'nenhuma', lateAll.length ? 'high' : 'ok') +
      kpi('Próximos 7 dias', money(sum(next7)), next7.length + (next7.length === 1 ? ' conta vence' : ' contas vencem'), '') +
      '</section>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-new-conta>' + icon('plus', 'sm') + 'Cadastrar conta</button>' +
      '<a class="btn" href="#agenda">' + icon('calendar', 'sm') + 'Ver na agenda</a></div>' +
      (late.length ? '<section class="section"><div class="section-head"><h2>Atrasadas de meses anteriores</h2></div><div class="list">' + late.map(row).join('') + '</div></section>' : '') +
      '<section class="section"><div class="section-head"><h2>Vencimentos de ' + esc(Fin.monthLabel(cur).split(' de ')[0]) + '</h2><span class="card-meta">toque para pagar</span></div>' +
      (month.length ? '<div class="list">' + month.map(row).join('') + '</div>'
        : '<div class="card">' + UI.empty('receipt', bills.length ? 'Nada vence neste mês' : 'Nenhuma conta cadastrada', bills.length ? 'Use as setas para ver outros meses.' : 'Cadastre aluguel, energia, fornecedores, boletos e parcelas. Cada vencimento aparece na sua agenda e no Início.') + '</div>') + '</section>' +
      (bills.length ? '<section class="section"><div class="section-head"><h2>Contas cadastradas</h2><span class="card-meta">' + bills.length + '</span></div><div class="list">' + bills.map(function (b) {
        return '<button type="button" class="row" data-edit-conta="' + esc(b.id) + '"><div class="tile">' + icon('receipt') + '</div><div class="grow"><div class="card-title">' + esc(b.name) + '</div>' +
          '<div class="card-meta">' + esc(repeatLabel(b)) + (b.cat ? ' · ' + esc(b.cat) : '') + '</div></div><b class="num">' + (b.value != null ? money(b.value) : '<span class="faint">varia</span>') + '</b>' + icon('chevronRight', 'sm') + '</button>';
      }).join('') + '</div></section>' : '') +
      '<p class="faint" style="text-align:center;font-size:var(--fs-xs)">Só você (administrador) vê as contas, inclusive na agenda. A equipe não vê nomes nem valores.</p>';

    return {
      html: shell('contas', body), tab: 'financeiro',
      mount: function (root) {
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-cmon]');
          if (b) { view.month = Fin.addMonth(cur, +b.dataset.cmon); return refresh(); }
          if (e.target.closest('[data-new-conta]')) return edit(null);
          if ((b = e.target.closest('[data-edit-conta]'))) return edit(bill(b.dataset.editConta));
          if ((b = e.target.closest('[data-conta]'))) return sheet(b.dataset.conta, b.dataset.date);
        });
      }
    };
  }
  function Rel_addDays(iso, n) { var d = parse(iso); d.setDate(d.getDate() + n); return DB.iso(d); }

  // ---------- Início ----------
  // Cartão do administrador: atrasadas, vencendo hoje e nos próximos dias.
  function homeCard() {
    if (!admin() || !store.data || !store.data.bills.length) return '';
    var t = today(), late = list(Rel_addDays(t, -120), Rel_addDays(t, -1)).filter(function (o) { return o.late; });
    var now = list(t, t).filter(function (o) { return !o.paid; }), soon = list(Rel_addDays(t, 1), Rel_addDays(t, 3)).filter(function (o) { return !o.paid; });
    if (!late.length && !now.length && !soon.length) return '';
    var items = late.concat(now, soon).slice(0, 4);
    var tone = late.length ? 'crit' : now.length ? 'warn' : 'info';
    var head = late.length ? late.length + (late.length === 1 ? ' conta atrasada' : ' contas atrasadas') : now.length ? now.length + (now.length === 1 ? ' conta vence hoje' : ' contas vencem hoje') : 'Contas nos próximos 3 dias';
    return '<section class="section"><div class="section-head"><h2>Contas a pagar</h2><a class="btn ghost sm" href="#financeiro/contas">Ver todas</a></div>' +
      '<div class="list"><div class="row"><div class="tile ' + tone + '">' + icon(late.length ? 'alert' : 'receipt') + '</div><div class="grow card-title">' + head + '</div></div>' +
      items.map(function (o) {
        return '<button type="button" class="row" data-home-conta="' + esc(o.b.id) + '" data-date="' + o.date + '"><div class="grow"><div class="card-title">' + esc(o.b.name) + '</div>' +
          '<div class="card-meta">' + (o.late ? '<span style="color:var(--crit);font-weight:600">venceu em ' + br(o.date) + '</span>' : o.date === t ? 'vence hoje' : 'vence ' + Cal.dayTitle(o.date).toLowerCase()) + '</div></div>' +
          '<b class="num">' + (o.value != null ? money(o.value) : '–') + '</b></button>';
      }).join('') + '</div></section>';
  }

  window.Contas = { ensure: ensure, occurrences: occurrences, sheet: sheet, screen: screen, homeCard: homeCard, list: list, dues: dues, _store: store };
})();
