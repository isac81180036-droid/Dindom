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
    closing: { delivery: null, counts: {}, updatedAt: null, finalizedAt: null },
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
    d.deliveries = deliveries(d.deliveryDays);
    if (!d.deliveries.some(function (x) { return x.id === d.closing.delivery; })) d.closing.delivery = d.deliveries[0] ? d.deliveries[0].id : null;

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

  window.DB = {
    get: function () { return load(); },
    update: function (fn) { fn(load()); save(); },
    // Apaga tudo deste aparelho e volta para a primeira configuração.
    reset: function () { mem = prepare(clone(defaults)); save(); },
    iso: iso,
    businessDay: businessDay,
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
    }
  };
})();
