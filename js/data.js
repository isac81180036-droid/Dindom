// Dados do sistema e armazenamento local (neste aparelho).
// Começa vazio: a primeira configuração cria as unidades e a conta do administrador.
// Na fase do servidor este módulo é trocado por chamadas ao banco, mantendo a mesma interface (DB.get / DB.update ...).
(function () {
  var KEY = 'dindom:v2'; // v1 era o protótipo com dados de exemplo; não é reaproveitado
  var WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  var DAY_START_HOUR = 5; // o "dia de trabalho" vira às 5h: o fechamento da noite não zera à meia-noite

  // Configurações padrão (podem ser ajustadas depois). Nenhum registro de exemplo.
  var defaults = {
    setupDone: false,
    org: { name: 'Dindom' },
    user: { name: '', role: 'colaborador', unit: null, empId: null },
    units: [],
    deliveryDays: [],
    categories: ['Queijos', 'Carnes e frios', 'Massas e farinhas', 'Molhos e conservas', 'Hortifrúti', 'Bebidas', 'Embalagens', 'Limpeza', 'Outros'],
    products: [],
    // Estações do fechamento: cada uma reúne produtos e os colaboradores que contam esses produtos.
    stations: [],
    closing: { delivery: null, finalizedAt: null },
    // Contagem do fechamento em andamento, um item por produto ({ id: produto, q, by, at }): várias
    // pessoas contam ao mesmo tempo sem uma sobrescrever a outra.
    counts: [],
    shopping: { fromClosing: '', items: [] },
    checklists: [],
    checkHistory: [],
    maintenance: [],
    nextMaintenanceId: 1,
    notifications: [],
    prefs: { theme: 'system', hiddenCals: {} },
    settings: { staffCanJustify: true },
    // Agendas, no estilo Google Agenda: cada uma tem uma cor e pode ser ocultada.
    calendars: [
      { id: 'entregas', name: 'Entregas e fornecedores', color: 1 },
      { id: 'equipe', name: 'Equipe e escala', color: 2 },
      { id: 'manutencao', name: 'Manutenção', color: 3 },
      { id: 'reservas', name: 'Reservas e eventos', color: 4 },
      { id: 'financeiro', name: 'Financeiro', color: 5 }
    ],
    events: [],
    employees: [],
    functions: ['Pizzaiolo', 'Auxiliar de cozinha', 'Atendente', 'Caixa', 'Entregador', 'Gerente', 'Serviços gerais'],
    stores: [],
    prices: [],
    stock: {},
    notas: [],
    matchMemory: {},
    // Turnos: horário de entrada e horas previstas por dia (descontado o intervalo).
    shifts: {
      'Manhã': { start: '08:00', hours: 8 },
      'Tarde': { start: '14:00', hours: 8 },
      'Noite': { start: '17:30', hours: 6 }
    },
    punches: [],
    punchSeq: 0,
    adjusts: [],
    session: null,
    loginGuard: { fails: 0 }
  };

  var mem = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function iso(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function businessDay() { var d = new Date(Date.now() - DAY_START_HOUR * 3600000); return iso(d); }

  // Próximas datas de reposição a partir dos dias da semana configurados (ex.: terça e sexta).
  function deliveries(days) {
    var out = [], base = new Date(); base.setHours(0, 0, 0, 0);
    (days || []).slice().sort(function (a, b) {
      return ((a - base.getDay() + 7) % 7) - ((b - base.getDay() + 7) % 7);
    }).forEach(function (wd) {
      var d = new Date(base); d.setDate(d.getDate() + ((wd - base.getDay() + 7) % 7));
      out.push({ id: 'w' + wd, label: WEEK[wd], date: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') });
    });
    return out;
  }

  // Ajustes feitos a cada abertura: completa campos novos, calcula reposições e vira o dia dos checklists.
  function prepare(d) {
    Object.keys(defaults).forEach(function (k) { if (d[k] === undefined) d[k] = clone(defaults[k]); });
    if (!d.prefs.hiddenCals) d.prefs.hiddenCals = {};
    // Sem agendas (ex.: banco novo no servidor): volta às padrão, senão não dá para criar evento.
    if (!d.calendars || !d.calendars.length) d.calendars = clone(defaults.calendars);
    d.deliveries = deliveries(d.deliveryDays);
    if (!d.deliveries.some(function (x) { return x.id === d.closing.delivery; })) d.closing.delivery = d.deliveries[0] ? d.deliveries[0].id : null;
    // Versão anterior guardava a contagem dentro do fechamento: passa para a lista por produto.
    if (d.closing.counts) {
      Object.keys(d.closing.counts).forEach(function (pid) {
        if (!d.counts.some(function (c) { return c.id === pid; })) d.counts.push({ id: pid, q: d.closing.counts[pid], by: null, at: d.closing.updatedAt || Date.now() });
      });
      delete d.closing.counts; delete d.closing.updatedAt;
    }

    var today = businessDay();
    d.checklists.forEach(function (c) {
      if (c.runDate === today) return;
      // Guarda como ficou o dia anterior e começa o checklist de hoje do zero.
      if (c.runDate && (Object.keys(c.done || {}).length || c.finishedAt)) {
        d.checkHistory.push({ id: c.id, name: c.name, date: c.runDate, done: c.done, reason: c.reason, finishedAt: c.finishedAt, total: c.tasks.length });
        if (d.checkHistory.length > 400) d.checkHistory = d.checkHistory.slice(-400);
      }
      c.runDate = today; c.done = {}; c.photos = {}; c.reason = ''; c.finishedAt = null;
    });
    return d;
  }

  function load() {
    if (mem) return mem;
    try {
      var raw = localStorage.getItem(KEY);
      mem = raw ? JSON.parse(raw) : clone(defaults);
    } catch (e) {
      mem = clone(defaults);
    }
    return prepare(mem);
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* sem armazenamento: segue em memória */ }
  }

  function syncing() { return window.Cloud && Cloud.orgId; }

  window.DB = {
    get: function () { return load(); },
    // Toda alteração passa por aqui: salva no aparelho e, com o servidor ligado, sincroniza.
    update: function (fn) { fn(load()); save(); if (syncing()) Cloud.schedule(); },
    // Apaga tudo deste aparelho e volta para a primeira configuração.
    reset: function () { mem = prepare(clone(defaults)); save(); },

    // ---------- Servidor (js/cloud.js) ----------
    // Passa a usar a cópia local da pizzaria logada (mantém as preferências deste aparelho).
    useOrg: function (orgId) {
      var prefs = mem ? mem.prefs : null;
      KEY = 'dindom:org:' + orgId;
      mem = null; load();
      if (prefs) mem.prefs = prefs;
      mem.setupDone = true;
      save();
    },
    // Recebe os dados completos vindos do servidor.
    setShared: function (shared) {
      var d = load();
      Object.keys(shared).forEach(function (k) { d[k] = shared[k] == null ? clone(defaults[k]) : shared[k]; });
      d.setupDone = true;
      prepare(d); save();
    },
    // Aplica um item alterado por outro aparelho.
    applyRemote: function (row) {
      var d = load();
      if (row.collection === 'meta') {
        if (row.deleted) d[row.id] = clone(defaults[row.id]); else d[row.id] = row.data ? row.data.v : null;
      } else {
        var idf = Cloud.ITEMS[row.collection]; if (!idf) return;
        var list = d[row.collection] = d[row.collection] || [];
        var i = -1;
        for (var j = 0; j < list.length; j++) if (String(list[j][idf]) === String(row.id)) { i = j; break; }
        if (row.deleted) { if (i >= 0) list.splice(i, 1); }
        else if (i >= 0) list[i] = row.data;
        else list.push(row.data);
        if (row.collection === 'punches') list.sort(function (a, b) { return a.ts - b.ts; });
      }
      prepare(d); save();
    },
    iso: iso,
    businessDay: businessDay,
    DAY_START_HOUR: DAY_START_HOUR,
    deliveries: deliveries,
    WEEK: WEEK,
    // Estoque atual de um produto na unidade selecionada.
    stockOf: function (pid, unit) {
      var d = load(); var s = d.stock[unit || d.user.unit] || {};
      return s[pid] != null ? s[pid] : null;
    },
    product: function (id) {
      var ps = load().products;
      for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
      return null;
    },

    // ---------- Fechamento por estação ----------
    // Tipo do produto, acima da categoria: separa o que vai no preparo do que vai na montagem.
    KINDS: [
      { id: 'preparo', label: 'Preparo e produção', hint: 'Massas, molhos e o que é produzido na casa: farinha, óleo, fermento, colorau, cheiro-verde…' },
      { id: 'montagem', label: 'Montagem das pizzas', hint: 'Vai direto na pizza: queijos, calabresa, catupiry e outros recheios.' },
      { id: 'apoio', label: 'Apoio e outros', hint: 'Bebidas, sachês, descartáveis, embalagens e limpeza.' }
    ],
    kindOf: function (p) { return p.kind === 'preparo' || p.kind === 'montagem' ? p.kind : 'apoio'; },
    // Quantidade contada no fechamento em andamento (null = ainda não contado).
    countOf: function (pid) {
      var cs = load().counts;
      for (var i = 0; i < cs.length; i++) if (cs[i].id === pid) return cs[i].q;
      return null;
    },
    // Grava (ou apaga, com null) a contagem de um produto, sem salvar ainda: quem chama salva com DB.update.
    setCount: function (pid, q) {
      var d = load();
      d.counts = d.counts.filter(function (c) { return c.id !== pid; });
      if (q != null) d.counts.push({ id: pid, q: q, by: d.user.empId, at: Date.now() });
    },
    station: function (id) { return load().stations.filter(function (s) { return s.id === id; })[0] || null; },
    // Estações de quem está usando o app.
    myStations: function () {
      var d = load();
      return d.stations.filter(function (s) { return (s.emps || []).indexOf(d.user.empId) >= 0; });
    }
  };
})();
