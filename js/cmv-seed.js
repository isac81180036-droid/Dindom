// Dados iniciais da Ficha técnica & CMV da Dindom (planilha de 2026). Carregados uma vez pelo gerente.
// Os ids são fixos (tirados do nome): carregar em dois aparelhos ao mesmo tempo não duplica nada.
(function () {
  function slug(s) {
    return String(s).toLowerCase()
      .replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/í/g, 'i').replace(/[óôõ]/g, 'o').replace(/ú/g, 'u').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  var PARAMS = {
    min: 0.30, max: 0.33, target: 0.315,
    sizes: [
      { id: 'P', name: 'Pequena', diam: 25, slices: 4, factor: 0.510, box: 1.10, napkin: 0.40, gas: 0.45, loss: 0.20 },
      { id: 'M', name: 'Média', diam: 30, slices: 8, factor: 0.735, box: 1.35, napkin: 0.40, gas: 0.55, loss: 0.25 },
      { id: 'G', name: 'Grande', diam: 35, slices: 10, factor: 1.000, box: 1.60, napkin: 0.40, gas: 0.70, loss: 0.30 }
    ],
    cats: [
      { id: 'tradicional', name: 'Tradicional', prices: { P: 29, M: 40, G: 50 } },
      { id: 'especial', name: 'Especial', prices: { P: 33, M: 45, G: 55 } },
      { id: 'gourmet', name: 'Gourmet', prices: { P: 45, M: 60, G: 70 } }
    ]
  };

  // Nome | unidade | preço | n = nota fiscal, e = estimativa
  var INSUMOS = [
    'Farinha de trigo|kg|5|n', 'Fermento, sal, açúcar e óleo|kg|12|n', 'Molho de tomate|kg|10|n', 'Mussarela|kg|36|n',
    'Calabresa fatiada|kg|26|n', 'Cebola|kg|5|n', 'Azeitona|kg|22|n', 'Orégano|kg|50|n',
    'Frango desfiado (pronto)|kg|28|e', 'Catupiry|kg|42|e', 'Tomate|kg|8|e', 'Manjericão|kg|60|e', 'Peito de peru|kg|48|e',
    'Lombinho|kg|45|e', 'Patê de frango autoral|kg|22|e', 'Bacon|kg|38|e', 'Ovo cozido|kg|16|e', 'Palmito|kg|48|e',
    'Presunto|kg|32|e', 'Pimentão|kg|9|e', 'Cheddar|kg|38|e', 'Parmesão|kg|85|e', 'Carne seca desfiada (pronta)|kg|65|e',
    'Cream cheese|kg|40|e', 'Queijo coalho|kg|48|e', 'Pimenta biquinho|kg|55|e', 'Cebolinha|kg|35|e',
    'Carne assada desfiada (pronta)|kg|48|e', 'Cebola caramelizada|kg|9|e', 'Filé mignon|kg|80|e', 'Cebola crispy|kg|55|e',
    'Batata frita congelada|kg|18|e', 'Óleo de fritura|kg|10|e', 'Alho frito|kg|60|e', 'Queijo cuia|kg|75|e',
    'Camarão regional|kg|50|e', 'Molho de camarão|kg|30|e', 'Camarão rosa|kg|95|e', 'Chocolate (cobertura)|kg|38|e',
    'KitKat|un|4.5|e', 'Cheddar artesanal|kg|40|e', 'Molho de alho|kg|20|e', 'Embalagem de fritas|un|1.2|e',
    'Pote de molho com tampa|un|0.25|e', 'Água com ou sem gás|un|1.8|e', 'Suco 500ml|un|4.5|e', 'Refrigerante 1L|un|6|e',
    'Refrigerante 2L|un|9|e'
  ];

  var BASE = 'Farinha de trigo:250|Fermento, sal, açúcar e óleo:40|Molho de tomate:100|Orégano:2';
  // Categoria | sabor | acréscimo | recheio (gramas da GRANDE)
  var PIZZAS = [
    'tradicional|Calabresa Dindom|0|Mussarela:230|Calabresa fatiada:100|Cebola:40',
    'tradicional|Frango com Catupiry|0|Mussarela:200|Frango desfiado (pronto):150|Catupiry:100|Azeitona:20',
    'tradicional|Marguerita|0|Mussarela:250|Tomate:100|Manjericão:5',
    'tradicional|Mussarela|0|Mussarela:330|Tomate:60',
    'tradicional|Peito de Peru|0|Peito de peru:150|Catupiry:120',
    'tradicional|Lombinho|0|Mussarela:230|Lombinho:120',
    'especial|À Moda da Casa|10|Patê de frango autoral:100|Mussarela:230|Calabresa fatiada:80|Tomate:50|Cebola:30',
    'especial|Bacon|0|Mussarela:230|Bacon:100',
    'especial|Mafiosa|0|Mussarela:220|Calabresa fatiada:70|Bacon:60|Ovo cozido:100|Cebola:30|Azeitona:20',
    'especial|Palmito|0|Mussarela:230|Palmito:120|Azeitona:20',
    'especial|Portuguesa|0|Mussarela:220|Presunto:100|Ovo cozido:100|Pimentão:30|Tomate:50|Cebola:30',
    'especial|Quatro Queijos|0|Mussarela:180|Catupiry:80|Cheddar:80|Parmesão:30',
    'gourmet|Carne Seca|0|Mussarela:200|Carne seca desfiada (pronta):120|Cream cheese:60|Queijo coalho:80|Pimenta biquinho:20|Cebolinha:5',
    'gourmet|Carne Assada|0|Mussarela:220|Carne assada desfiada (pronta):150|Cebola caramelizada:60',
    'gourmet|Filé|0|Mussarela:220|Filé mignon:150',
    'gourmet|Filé Crispy|0|Mussarela:220|Filé mignon:130|Bacon:50|Cebola crispy:20',
    'gourmet|Filé com Fritas|0|Mussarela:200|Filé mignon:130|Batata frita congelada:100',
    'gourmet|Filé di Dindom|0|Mussarela:200|Filé mignon:130|Catupiry:80|Alho frito:10',
    'gourmet|Filé do Reino|0|Mussarela:180|Filé mignon:130|Queijo cuia:80',
    'gourmet|Camarão Regional|0|Mussarela:220|Camarão regional:120|Cebola:30',
    'gourmet|Ribeirinha|20|Mussarela:200|Molho de camarão:80|Camarão rosa:150|Manjericão:5',
    'gourmet|Verona|20|Mussarela:200|Camarão rosa:150|Catupiry:100'
  ];

  var GAS = [{ name: 'Guardanapo e sachês', value: 0.40 }, { name: 'Gás', value: 0.30 }];
  var UNICOS = [
    ['Chocolate com KitKat (pequena)', 40, 'Farinha de trigo:128|Fermento, sal, açúcar e óleo:20|Chocolate (cobertura):120|KitKat:2', [{ name: 'Caixa, guardanapo, gás e perdas da pizza pequena', size: 'P' }]],
    ['Fritas', 20, 'Batata frita congelada:400|Óleo de fritura:60|Embalagem de fritas:1', GAS],
    ['Fritas Suprema', 35, 'Batata frita congelada:400|Óleo de fritura:60|Carne seca desfiada (pronta):100|Cheddar artesanal:80|Embalagem de fritas:1', GAS],
    ['Molho salva-bordas de alho', 7, 'Molho de alho:40|Pote de molho com tampa:1', []],
    ['Molho salva-bordas de cheddar', 7, 'Cheddar artesanal:40|Pote de molho com tampa:1', []]
  ];
  var BEBIDAS = [['Água com ou sem gás', 5], ['Suco 500ml', 14], ['Refrigerante 1L', 12], ['Refrigerante 2L', 17]];
  var REFRI = 'it-' + slug('Refrigerante 1L');
  var COMBOS = [
    ['Individual', 35, [{ kind: 'pizza', cat: 'tradicional', size: 'P', qty: 1 }, { kind: 'item', id: REFRI, qty: 1 }]],
    ['Família', 80, [{ kind: 'pizza', cat: 'tradicional', size: 'G', qty: 1 }, { kind: 'pizza', cat: 'tradicional', size: 'M', qty: 1 }]],
    ['Dose Dupla', 90, [{ kind: 'pizza', cat: 'tradicional', size: 'G', qty: 2 }, { kind: 'item', id: REFRI, qty: 1 }]]
  ];

  function lines(spec) {
    return spec.split('|').map(function (p) {
      var i = p.lastIndexOf(':');
      return { ins: 'in-' + slug(p.slice(0, i)), q: +p.slice(i + 1) };
    });
  }

  // Monta tudo; quem chama grava com DB.update. Não apaga nada do que já existe.
  function build(now, by) {
    var ins = INSUMOS.map(function (s) {
      var f = s.split('|');
      return { id: 'in-' + slug(f[0]), name: f[0], unit: f[1], price: +f[2], origin: f[3] === 'n' ? 'nota' : 'estimativa', updatedAt: now, by: by };
    });
    var items = [], order = 0;
    function add(o) { o.order = order++; o.active = true; items.push(o); }
    PIZZAS.forEach(function (s) {
      var f = s.split('|');
      add({ id: 'it-' + slug(f[1]), name: f[1], type: 'pizza', cat: f[0], extra: +f[2], lines: lines(BASE + '|' + f.slice(3).join('|')) });
    });
    UNICOS.forEach(function (u) { add({ id: 'it-' + slug(u[0]), name: u[0], type: 'unico', price: u[1], lines: lines(u[2]), extras: JSON.parse(JSON.stringify(u[3])) }); });
    BEBIDAS.forEach(function (b) { add({ id: 'it-' + slug(b[0]), name: b[0], type: 'bebida', price: b[1], lines: lines(b[0] + ':1') }); });
    COMBOS.forEach(function (c) { add({ id: 'it-combo-' + slug(c[0]), name: c[0], type: 'combo', price: c[1], parts: JSON.parse(JSON.stringify(c[2])) }); });
    return { params: JSON.parse(JSON.stringify(PARAMS)), insumos: ins, items: items };
  }

  // Carrega no estado: parâmetros se ainda não houver; insumos e itens que ainda não existem.
  CMV.seed = function (d, by) {
    var s = build(Date.now(), by || null);
    if (!d.cmv) d.cmv = s.params;
    var hasIns = {}, hasIt = {};
    d.insumos.forEach(function (x) { hasIns[x.id] = 1; });
    d.cardapio.forEach(function (x) { hasIt[x.id] = 1; });
    s.insumos.forEach(function (x) { if (!hasIns[x.id]) d.insumos.push(x); });
    s.items.forEach(function (x) { if (!hasIt[x.id]) d.cardapio.push(x); });
  };
  CMV.slug = slug;
  // Massa e molho de toda pizza salgada: sabor novo já começa com eles.
  CMV.baseLines = function () { return lines(BASE); };
})();
