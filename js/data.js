// Dados de exemplo e armazenamento local.
// Na fase 2 este módulo é substituído por chamadas ao banco de dados, mantendo a mesma interface (DB.get / DB.set / DB.update).
(function () {
  var KEY = 'dindom:v1';

  var seed = {
    user: { name: 'Marina', role: 'colaborador', unit: 'u1' },
    units: [
      { id: 'u1', name: 'Unidade Centro' },
      { id: 'u2', name: 'Unidade Jardins' }
    ],
    // Datas de reposição: cada uma tem seu próprio estoque ideal por produto.
    deliveries: [
      { id: 'd1', label: 'Terça', date: '27/10' },
      { id: 'd2', label: 'Sexta', date: '30/10' }
    ],
    categories: ['Queijos', 'Carnes e frios', 'Massas e farinhas', 'Molhos e conservas', 'Hortifrúti', 'Bebidas', 'Embalagens'],
    products: [
      { id: 'p1', name: 'Queijo muçarela', cat: 'Queijos', unit: 'kg', ideal: { d1: 20, d2: 28 }, crit: 6 },
      { id: 'p2', name: 'Provolone', cat: 'Queijos', unit: 'kg', ideal: { d1: 4, d2: 6 }, crit: 1 },
      { id: 'p3', name: 'Gorgonzola', cat: 'Queijos', unit: 'kg', ideal: { d1: 2, d2: 3 }, crit: 0.5 },
      { id: 'p4', name: 'Catupiry', cat: 'Queijos', unit: 'bisn.', ideal: { d1: 6, d2: 9 }, crit: 2 },
      { id: 'p5', name: 'Calabresa fatiada', cat: 'Carnes e frios', unit: 'kg', ideal: { d1: 8, d2: 12 }, crit: 2 },
      { id: 'p6', name: 'Presunto', cat: 'Carnes e frios', unit: 'kg', ideal: { d1: 5, d2: 7 }, crit: 1 },
      { id: 'p7', name: 'Frango desfiado', cat: 'Carnes e frios', unit: 'kg', ideal: { d1: 6, d2: 9 }, crit: 2 },
      { id: 'p8', name: 'Bacon em cubos', cat: 'Carnes e frios', unit: 'kg', ideal: { d1: 3, d2: 4 }, crit: 1 },
      { id: 'p9', name: 'Farinha tipo 00 (25 kg)', cat: 'Massas e farinhas', unit: 'saco', ideal: { d1: 3, d2: 4 }, crit: 1 },
      { id: 'p10', name: 'Fermento biológico (500 g)', cat: 'Massas e farinhas', unit: 'pct', ideal: { d1: 4, d2: 6 }, crit: 1 },
      { id: 'p11', name: 'Tomate pelado (lata 2,5 kg)', cat: 'Molhos e conservas', unit: 'lata', ideal: { d1: 10, d2: 14 }, crit: 3 },
      { id: 'p12', name: 'Azeitona preta', cat: 'Molhos e conservas', unit: 'balde', ideal: { d1: 2, d2: 3 }, crit: 1 },
      { id: 'p13', name: 'Palmito', cat: 'Molhos e conservas', unit: 'pote', ideal: { d1: 4, d2: 6 }, crit: 1 },
      { id: 'p14', name: 'Tomate', cat: 'Hortifrúti', unit: 'kg', ideal: { d1: 8, d2: 12 }, crit: 2 },
      { id: 'p15', name: 'Cebola', cat: 'Hortifrúti', unit: 'kg', ideal: { d1: 6, d2: 8 }, crit: 2 },
      { id: 'p16', name: 'Manjericão', cat: 'Hortifrúti', unit: 'maço', ideal: { d1: 6, d2: 8 }, crit: 2 },
      { id: 'p17', name: 'Refrigerante 2 L', cat: 'Bebidas', unit: 'fardo', ideal: { d1: 8, d2: 12 }, crit: 2 },
      { id: 'p18', name: 'Água mineral', cat: 'Bebidas', unit: 'fardo', ideal: { d1: 4, d2: 6 }, crit: 1 },
      { id: 'p19', name: 'Caixa pizza 35 cm', cat: 'Embalagens', unit: 'un', ideal: { d1: 300, d2: 450 }, crit: 80 },
      { id: 'p20', name: 'Caixa pizza broto', cat: 'Embalagens', unit: 'un', ideal: { d1: 100, d2: 150 }, crit: 30 }
    ],
    // Rascunho da contagem em andamento (salvo automaticamente a cada digitação).
    closing: {
      delivery: 'd1',
      counts: { p1: 7, p2: 3, p3: 2, p4: 4, p5: 5, p6: 5, p7: 2 },
      updatedAt: null,
      finalizedAt: null
    },
    // Lista de compras gerada no último fechamento finalizado.
    shopping: {
      fromClosing: 'Sexta, 23/10',
      items: [
        { pid: 'p1', need: 13, received: null },
        { pid: 'p5', need: 3, received: null },
        { pid: 'p7', need: 4, received: null },
        { pid: 'p11', need: 6, received: null },
        { pid: 'p14', need: 5, received: 5 },
        { pid: 'p19', need: 120, received: null },
        { pid: 'p16', need: 4, received: null }
      ]
    },
    checklists: [
      {
        id: 'c1', name: 'Abertura da cozinha', period: 'Abertura', due: '17:30', icon: 'sun',
        tasks: [
          { id: 't1', text: 'Ligar forno e conferir temperatura (300 °C)', required: true },
          { id: 't2', text: 'Conferir temperatura das câmaras frias', required: true, photo: true },
          { id: 't3', text: 'Higienizar bancadas e tábuas', required: true },
          { id: 't4', text: 'Abrir massas do dia (40 bolinhas)', required: true },
          { id: 't5', text: 'Repor molho e coberturas na linha', required: true },
          { id: 't6', text: 'Conferir validade dos insumos abertos', required: false },
          { id: 't7', text: 'Foto da linha montada', required: true, photo: true }
        ],
        done: { t1: true, t3: true, t4: true }, photos: {}, reason: '', finishedAt: null
      },
      {
        id: 'c2', name: 'Abertura do salão', period: 'Abertura', due: '18:00', icon: 'store',
        tasks: [
          { id: 't1', text: 'Limpar mesas e cadeiras', required: true },
          { id: 't2', text: 'Repor guardanapos e sachês', required: true },
          { id: 't3', text: 'Ligar máquinas de cartão e conferir bateria', required: true },
          { id: 't4', text: 'Conferir banheiros', required: true, photo: true }
        ],
        done: {}, photos: {}, reason: '', finishedAt: null
      },
      {
        id: 'c3', name: 'Fechamento da cozinha', period: 'Fechamento', due: '23:45', icon: 'moon',
        tasks: [
          { id: 't1', text: 'Desligar forno e exaustor', required: true },
          { id: 't2', text: 'Guardar coberturas em potes identificados', required: true },
          { id: 't3', text: 'Lavar e secar utensílios', required: true },
          { id: 't4', text: 'Limpar piso da cozinha', required: true },
          { id: 't5', text: 'Retirar lixo orgânico e reciclável', required: true },
          { id: 't6', text: 'Foto da cozinha limpa', required: true, photo: true }
        ],
        done: {}, photos: {}, reason: '', finishedAt: null
      }
    ],
    maintenance: [
      {
        id: 1042, title: 'Forno com chama irregular no lado esquerdo', place: 'Cozinha', equipment: 'Forno a lenha',
        priority: 'alta', status: 'andamento', date: '24/10 · 19:12', notes: 'Chama apaga quando a porta abre.', media: 1,
        timeline: [
          { at: '24/10 · 19:12', text: 'Chamado aberto por Marina' },
          { at: '24/10 · 21:40', text: 'Gerente encaminhou para técnico' },
          { at: '25/10 · 10:05', text: 'Visita técnica agendada para hoje às 15h' }
        ]
      },
      {
        id: 1039, title: 'Câmara fria marcando 9 °C', place: 'Estoque', equipment: 'Câmara fria 1',
        priority: 'urgente', status: 'aberta', date: '25/10 · 09:30', notes: '', media: 2,
        timeline: [{ at: '25/10 · 09:30', text: 'Chamado aberto por Rafael' }]
      },
      {
        id: 1031, title: 'Lâmpada queimada no banheiro feminino', place: 'Salão', equipment: '',
        priority: 'baixa', status: 'resolvida', date: '20/10 · 18:02', notes: '', media: 0,
        timeline: [
          { at: '20/10 · 18:02', text: 'Chamado aberto por Marina' },
          { at: '21/10 · 14:20', text: 'Lâmpada trocada. Chamado resolvido.' }
        ]
      }
    ],
    notifications: [
      { id: 'n1', icon: 'wrench', tone: 'info', text: 'Chamado #1042 atualizado: visita técnica às 15h', at: 'há 2 h', read: false },
      { id: 'n2', icon: 'cart', tone: 'warn', text: 'Lista de compras tem 6 itens aguardando recebimento', at: 'há 5 h', read: false },
      { id: 'n3', icon: 'checklist', tone: 'ok', text: 'Fechamento da cozinha de ontem concluído por Rafael', at: 'ontem', read: true }
    ],
    prefs: { theme: 'system' },
    // Permissões configuradas pelo gerente.
    settings: { staffCanJustify: true },
    nextMaintenanceId: 1043
  };

  // Agendas, no estilo Google Agenda: cada uma tem uma cor e pode ser ocultada.
  var calendars = [
    { id: 'entregas', name: 'Entregas e fornecedores', color: 1 },
    { id: 'equipe', name: 'Equipe e escala', color: 2 },
    { id: 'manutencao', name: 'Manutenção', color: 3 },
    { id: 'reservas', name: 'Reservas e eventos', color: 4 },
    { id: 'financeiro', name: 'Financeiro', color: 5 }
  ];

  function iso(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  // Eventos de exemplo posicionados em relação a hoje, para a agenda nunca abrir vazia.
  function seedEvents() {
    var today = new Date();
    var dow = today.getDay();
    function day(offset) { var x = new Date(today); x.setDate(x.getDate() + offset); return iso(x); }
    function next(weekday) { return day(((weekday - dow) + 7) % 7); }
    var n = 0;
    function ev(o) { o.id = 'e' + (++n); o.repeat = o.repeat || 'none'; o.place = o.place || ''; o.notes = o.notes || ''; return o; }
    return [
      ev({ title: 'Visita técnica: forno a lenha', cal: 'manutencao', date: day(0), start: '15:00', end: '16:00', place: 'Cozinha', notes: 'Referente ao chamado #1042. Acompanhar o técnico.' }),
      ev({ title: 'Ligação com o contador', cal: 'financeiro', date: day(0), start: '15:30', end: '16:15' }),
      ev({ title: 'Conferir câmara fria 1', cal: 'manutencao', date: day(0), start: '10:00', end: '10:30', place: 'Estoque' }),
      ev({ title: 'Abertura da cozinha', cal: 'equipe', date: day(-7), start: '17:30', end: '18:00', repeat: 'daily', place: 'Cozinha' }),
      ev({ title: 'Entrega Laticínios Serra', cal: 'entregas', date: next(2), start: '08:00', end: '09:00', repeat: 'weekly', place: 'Doca', notes: 'Muçarela, provolone, catupiry. Conferir temperatura no recebimento.' }),
      ev({ title: 'Entrega hortifrúti', cal: 'entregas', date: next(5), start: '07:30', end: '08:30', repeat: 'weekly', place: 'Doca' }),
      ev({ title: 'Reunião de equipe', cal: 'equipe', date: next(1), start: '15:00', end: '15:45', repeat: 'weekly', place: 'Salão' }),
      ev({ title: 'Treinamento de forno: novos pizzaiolos', cal: 'equipe', date: next(3), start: '14:00', end: '16:00', place: 'Cozinha' }),
      ev({ title: 'Entrevista: atendente de salão', cal: 'equipe', date: next(4), start: '11:00', end: '11:30' }),
      ev({ title: 'Pagamento fornecedor de carnes', cal: 'financeiro', date: next(3), start: '12:00', end: '12:30' }),
      ev({ title: 'Aniversário: reserva 40 pessoas', cal: 'reservas', date: next(6), start: '19:00', end: '22:30', place: 'Salão inteiro', notes: 'Bolo trazido pelo cliente. Rodízio completo.' }),
      ev({ title: 'Escala reforçada', cal: 'equipe', date: next(6), allDay: true }),
      ev({ title: 'Noite de Halloween', cal: 'reservas', date: day(6), allDay: true, notes: 'Cardápio temático e decoração.' }),
      ev({ title: 'Dedetização', cal: 'manutencao', date: day(10), start: '08:00', end: '11:00', place: 'Toda a loja' }),
      ev({ title: 'Fechamento do mês', cal: 'financeiro', date: day(-1), start: '10:00', end: '12:00' })
    ];
  }

  // Funções da equipe usadas no cadastro de colaboradores.
  var functions = ['Pizzaiolo', 'Auxiliar de cozinha', 'Atendente', 'Caixa', 'Entregador', 'Gerente', 'Serviços gerais'];

  function seedEmployees() {
    var n = 0;
    function emp(o) {
      o.id = 'c' + (++n); o.active = o.active !== false; o.email = o.email || ''; o.shift = o.shift || 'Noite';
      return o;
    }
    return [
      emp({ name: 'Marina Alves', phone: '11987654321', func: 'Atendente', role: 'colaborador', unit: 'u1', admission: '2024-03-11', pin: '4821' }),
      emp({ name: 'Rafael Souza', phone: '11991234567', func: 'Pizzaiolo', role: 'colaborador', unit: 'u1', admission: '2021-08-02', pin: '7350' }),
      emp({ name: 'Juliana Costa', phone: '11983332211', email: 'juliana@dindom.com.br', func: 'Gerente', role: 'gerente', unit: 'u1', admission: '2019-05-20', pin: '1946', shift: 'Tarde' }),
      emp({ name: 'Carlos Mendes', phone: '11976540987', func: 'Entregador', role: 'colaborador', unit: 'u1', admission: '2025-01-15', pin: '3082' }),
      emp({ name: 'Ana Lima', phone: '11965432100', func: 'Caixa', role: 'colaborador', unit: 'u2', admission: '2023-10-01', pin: '5517' }),
      emp({ name: 'Bruno Ferreira', phone: '11954321876', func: 'Pizzaiolo', role: 'colaborador', unit: 'u2', admission: '2022-06-13', pin: '6203' }),
      emp({ name: 'Pedro Henrique', phone: '11943218765', func: 'Auxiliar de cozinha', role: 'colaborador', unit: 'u1', admission: '2023-02-06', pin: '9174', active: false })
    ];
  }

  // Lojas onde a pizzaria compra. Nomes fictícios para o exemplo; as reais entram sozinhas pelas notas escaneadas.
  var stores = [
    { id: 's1', name: 'Atacado Bom Preço', kind: 'Atacado', cnpj: '12345678000190', dist: '3,2 km' },
    { id: 's2', name: 'Mega Atacadista', kind: 'Atacado', cnpj: '23456789000101', dist: '6,8 km' },
    { id: 's3', name: 'Supermercado Vila Nova', kind: 'Supermercado', cnpj: '34567890000112', dist: '1,1 km' },
    { id: 's4', name: 'Laticínios Serra', kind: 'Fornecedor', cnpj: '45678901000123', dist: 'Entrega' }
  ];

  // Preço de referência por produto (R$ por unidade do cadastro).
  var basePrice = { p1: 34.9, p2: 52.9, p3: 69.9, p4: 42.9, p5: 27.9, p6: 29.9, p7: 32.9, p8: 39.9, p9: 119.9, p10: 18.9,
    p11: 32.9, p12: 89.9, p13: 39.9, p14: 7.49, p15: 5.29, p16: 3.99, p17: 47.9, p18: 19.9, p19: 2.1, p20: 1.4 };

  // Histórico de preços de exemplo, como se tivesse vindo de notas anteriores.
  function seedPrices() {
    var cats = { p1: 'q', p2: 'q', p3: 'q', p4: 'q', p5: 'c', p6: 'c', p7: 'c', p8: 'c', p14: 'h', p15: 'h', p16: 'h' };
    var factor = {
      s1: { q: .93, c: .92, h: 1.08, x: 1.0 },
      s2: { q: 1.04, c: .99, h: 1.02, x: .95 },
      s3: { q: 1.12, c: 1.1, h: .9, x: 1.12 },
      s4: { q: .88 }
    };
    var out = [], today = new Date(), i = 0;
    Object.keys(basePrice).forEach(function (pid) {
      i++;
      ['s1', 's2', 's3', 's4'].forEach(function (sid, k) {
        var f = factor[sid][cats[pid] || 'x'];
        if (!f) return; // o fornecedor de laticínios só vende queijos
        if (sid === 's3' && (pid === 'p9' || pid === 'p19' || pid === 'p20')) return; // supermercado não tem itens de atacado
        var noise = 1 + (((i * 7 + k * 13) % 9) - 4) / 100; // ±4%, fixo por produto e loja
        var d = new Date(today); d.setDate(d.getDate() - (1 + (i + k * 3) % 12));
        out.push({ pid: pid, store: sid, price: Math.round(basePrice[pid] * f * noise * 100) / 100, date: iso(d), source: 'exemplo' });
      });
    });
    return out;
  }

  // Estoque atual por unidade (quantidade na unidade do cadastro).
  function seedStock(products, counts) {
    var s = { u1: {}, u2: {} };
    products.forEach(function (p, i) {
      s.u1[p.id] = counts[p.id] != null ? counts[p.id] : Math.round(p.ideal.d1 * (.4 + (i % 5) / 10));
      s.u2[p.id] = Math.round(p.ideal.d1 * (.5 + (i % 4) / 10));
    });
    return s;
  }

  // Turnos: horário de entrada e horas previstas por dia (descontado o intervalo).
  var shifts = {
    'Manhã': { start: '08:00', hours: 8 },
    'Tarde': { start: '14:00', hours: 8 },
    'Noite': { start: '17:30', hours: 6 }
  };
  // Horários típicos de cada turno: entrada, saída para intervalo, volta, saída (minutos desde 0h; >1440 = madrugada).
  var shiftPattern = {
    'Manhã': [480, 720, 780, 1020],
    'Tarde': [840, 1080, 1110, 1350],
    'Noite': [1050, 1200, 1230, 1455]
  };

  // Registros de ponto de exemplo dos últimos dias, gerados a partir do turno de cada colaborador.
  function seedPunches(employees) {
    var out = [], now = Date.now(), base = new Date(); base.setHours(0, 0, 0, 0);
    var types = ['entrada', 'intervalo', 'retorno', 'saida'];
    employees.forEach(function (e, ei) {
      if (!e.active) return;
      for (var off = -13; off <= 0; off++) {
        var day = new Date(base); day.setDate(day.getDate() + off);
        var dow = day.getDay();
        if (dow === 1 || (e.id === 'c5' && dow === 2)) continue; // segunda é folga; Ana também folga na terça
        if (e.id === 'c1' && off === 0) continue;                  // a usuária do exemplo ainda vai bater o ponto hoje
        var pat = shiftPattern[e.shift] || shiftPattern.Noite;
        var h = (ei * 31 + off * 17 + 100) % 13;                   // variação fixa por pessoa e dia
        var late = (e.id === 'c4' && (off === -2 || off === -6)) ? 19 : 0; // Carlos chegou atrasado duas vezes
        var marks = [pat[0] - 6 + h + late, pat[1] + (h % 5), pat[2] + (h % 7), pat[3] - 4 + h];
        if (e.id === 'c6' && off === -4) marks = [marks[0], null, null, marks[3]];   // Bruno não fez intervalo
        if (e.id === 'c1' && off === -1) marks[3] = null;                            // Marina esqueceu a saída ontem
        marks.forEach(function (m, i) {
          if (m == null) return;
          var ts = day.getTime() + m * 60000;
          if (ts > now) return;
          out.push({ id: 'pt' + e.id + off + i, emp: e.id, ts: ts, type: types[i], unit: e.unit, method: 'app' });
        });
      }
    });
    out.sort(function (a, b) { return a.ts - b.ts; });
    out.forEach(function (p, i) { p.nsr = i + 1; });
    return out;
  }

  function seedAdjusts() {
    var y = new Date(); y.setDate(y.getDate() - 3);
    return [{ id: 'aj1', emp: 'c2', date: iso(y), type: 'retorno', time: '20:35', reason: 'O celular descarregou na volta do intervalo.', status: 'pendente', at: Date.now() - 86400000 }];
  }

  var mem = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Acrescenta o que versões anteriores dos dados salvos não tinham.
  function migrate(d) {
    if (!d.calendars) d.calendars = clone(calendars);
    if (!d.events) d.events = seedEvents();
    if (!d.prefs.hiddenCals) d.prefs.hiddenCals = {};
    if (!d.settings) d.settings = { staffCanJustify: true };
    if (!d.employees) d.employees = seedEmployees();
    if (!d.functions) d.functions = functions.slice();
    if (!d.stores) d.stores = clone(stores);
    if (!d.prices) d.prices = seedPrices();
    if (!d.stock) d.stock = seedStock(d.products, d.closing.counts);
    if (!d.notas) d.notas = [];
    if (!d.shifts) d.shifts = clone(shifts);
    if (!d.user.empId) d.user.empId = 'c1';
    if (!d.punches) d.punches = seedPunches(d.employees);
    if (d.punchSeq == null) d.punchSeq = d.punches.length;
    if (!d.adjusts) d.adjusts = seedAdjusts();
    return d;
  }

  function load() {
    if (mem) return mem;
    try {
      var raw = localStorage.getItem(KEY);
      mem = raw ? JSON.parse(raw) : clone(seed);
    } catch (e) {
      mem = clone(seed);
    }
    return migrate(mem);
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* sem armazenamento: segue em memória */ }
  }

  window.DB = {
    get: function () { return load(); },
    update: function (fn) { fn(load()); save(); },
    reset: function () { mem = migrate(clone(seed)); save(); },
    iso: iso,
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
