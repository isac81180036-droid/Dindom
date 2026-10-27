// Vendas › Insights: transforma os números de cw_insights (supabase/004_insights.sql) em leituras
// com uma sugestão do que fazer. As regras ficam aqui; o banco só soma.
(function () {
  var esc = UI.esc, money = UI.money;
  var GROUPS = ['Vendas', 'Clientes', 'Cadastros e cardápio', 'Bairros', 'Horários e dias', 'Produtos', 'Canais e pagamento', 'Satisfação'];
  var CHANNELS = { catalog: 'Cardápio digital', store_front_catalog: 'Cardápio da loja', portal: 'Balcão', whatsapp_extension: 'WhatsApp', ifood: 'iFood' };
  var PAY = { money: 'Dinheiro', credit_card: 'Crédito', debit_card: 'Débito', pix: 'Pix', pix_auto: 'Pix', online_credit_card: 'Cartão online' };

  function pct(a, b) { return b ? (a - b) / b * 100 : null; }
  function fmtPct(p, signed) { return (signed && p > 0 ? '+' : '') + UI.fmt(Math.round(p)) + '%'; }
  function share(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function sum(list, k) { return (list || []).reduce(function (s, x) { return s + (Number(x[k]) || 0); }, 0); }
  function plural(n, one, many) { return UI.fmt(n) + ' ' + (n === 1 ? one : many); }
  function daysAgo(iso) { return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000)); }
  function maxBy(list, f) { return (list || []).reduce(function (m, x) { return m == null || f(x) > f(m) ? x : m; }, null); }
  function minBy(list, f) { return (list || []).reduce(function (m, x) { return m == null || f(x) < f(m) ? x : m; }, null); }
  function hourLabel(h) { return String(h).padStart(2, '0') + 'h'; }

  // Lista de clientes (fiéis, em risco, perdidos) para abrir num painel.
  function people(rows, verb) {
    return (rows || []).map(function (c) {
      return { name: c.name || 'Cliente #' + c.id, meta: plural(c.n, 'pedido', 'pedidos') + ' ' + verb + ' · último há ' + plural(daysAgo(c.last_at), 'dia', 'dias'), value: money(c.spent) };
    });
  }

  // Monta a lista de insights. Cada um: grupo, ícone, tom, título, valor, explicação, o que fazer e prioridade (0 a 100).
  function build(d, label) {
    var out = [];
    function add(o) { out.push(o); }
    var cur = d.cur || {}, prev = d.prev || {}, c = d.customers || {}, s = d.signups || {};
    var ticket = cur.orders ? cur.revenue / cur.orders : 0, pticket = prev.orders ? prev.revenue / prev.orders : 0;

    // ---------- Vendas ----------
    var rv = pct(cur.revenue, prev.revenue);
    if (rv != null) add({ g: 'Vendas', ic: 'receipt', tone: rv >= 0 ? 'ok' : rv <= -10 ? 'crit' : 'warn', title: 'Faturamento', value: money(cur.revenue),
      text: fmtPct(rv, true) + ' em relação ao período anterior, do mesmo tamanho (' + money(prev.revenue) + ').',
      action: rv <= -10 ? 'Veja abaixo os bairros e itens que mais caíram e reative os clientes em risco primeiro: é o caminho mais rápido para recuperar.'
        : rv >= 10 ? 'Bom momento: garanta estoque e equipe nos dias e horários de pico para não perder pedidos.' : 'Estável. Use as sugestões abaixo para crescer.',
      prio: rv <= -10 ? 80 : rv < 0 ? 45 : 20 });
    var ro = pct(cur.orders, prev.orders);
    if (ro != null) add({ g: 'Vendas', ic: 'cart', tone: ro >= 0 ? 'ok' : 'warn', title: 'Pedidos', value: UI.fmt(cur.orders),
      text: fmtPct(ro, true) + ' em pedidos em relação ao período anterior (' + UI.fmt(prev.orders) + ').',
      action: ro < 0 ? 'Menos pedidos: aposte em campanhas para clientes em risco e no dia mais fraco da semana.' : 'Mais gente pedindo: mantenha o tempo de entrega sob controle para não perder nota.',
      prio: ro < -10 ? 60 : 15 });
    if (cur.orders && prev.orders) {
      var rt = pct(ticket, pticket);
      add({ g: 'Vendas', ic: 'tag', tone: rt >= 0 ? 'ok' : 'warn', title: 'Ticket médio', value: money(ticket),
        text: fmtPct(rt, true) + ' em relação ao período anterior (' + money(pticket) + ').',
        action: rt < -3 ? 'O cliente está gastando menos por pedido: ofereça borda, bebida e sobremesa no fechamento do pedido e combos com preço fechado.'
          : 'Para subir mais o ticket, crie um combo com os itens que já saem juntos (veja em Produtos).',
        prio: rt < -5 ? 55 : 15 });
    }

    // ---------- Clientes ----------
    if (cur.customers) add({ g: 'Clientes', ic: 'users', tone: '', title: 'Clientes que pediram', value: UI.fmt(cur.customers),
      text: (prev.customers ? fmtPct(pct(cur.customers, prev.customers), true) + ' em relação ao período anterior. ' : '') + 'Cada um pediu em média ' + UI.fmt(Math.round(cur.orders / cur.customers * 10) / 10) + ' vez(es).',
      action: 'Quanto mais clientes diferentes, menos você depende de poucos. Combine as ações de clientes novos e de reativação abaixo.', prio: 10 });
    if (c['new'] != null && cur.customers) add({ g: 'Clientes', ic: 'userPlus', tone: 'info', title: 'Clientes novos', value: UI.fmt(c['new']),
      text: share(c['new'], cur.customers) + '% dos clientes do período pediram pela primeira vez e trouxeram ' + money(c.new_revenue) + ' (' + share(c.new_revenue, cur.revenue) + '% do faturamento).',
      action: 'Dê um motivo para voltar: mande junto do primeiro pedido um cupom para o segundo, válido por 15 dias.', prio: 40 });
    if (c.returning != null && cur.customers) add({ g: 'Clientes', ic: 'refresh', tone: share(c.returning, cur.customers) >= 50 ? 'ok' : 'warn', title: 'Clientes que voltaram', value: UI.fmt(c.returning),
      text: share(c.returning, cur.customers) + '% de quem pediu no período já tinha pedido antes.',
      action: share(c.returning, cur.customers) < 50 ? 'Menos da metade é cliente de volta: invista em fidelidade (cartão de pontos, brinde no 5º pedido).' : 'Boa base de clientes que voltam. Agradeça e mantenha a qualidade.',
      prio: share(c.returning, cur.customers) < 40 ? 50 : 15 });
    if (c.repurchase_base >= 5) {
      var rr = share(c.repurchase_back, c.repurchase_base);
      add({ g: 'Clientes', ic: 'refresh', tone: rr < 25 ? 'crit' : rr < 40 ? 'warn' : 'ok', title: 'Taxa de recompra', value: rr + '%',
        text: 'De ' + plural(c.repurchase_base, 'cliente que fez', 'clientes que fizeram') + ' o 1º pedido entre 30 e 90 dias atrás, ' + UI.fmt(c.repurchase_back) + ' já voltaram.',
        action: rr < 40 ? 'Muita gente prova e não volta. Envie mensagem no dia seguinte perguntando como foi e ofereça cupom de segundo pedido.' : 'Recompra saudável. Mantenha o padrão da pizza e do tempo de entrega.',
        prio: rr < 25 ? 75 : rr < 40 ? 50 : 10 });
    }
    if (c.avg_gap_days) add({ g: 'Clientes', ic: 'calendar', tone: '', title: 'Intervalo entre pedidos', value: plural(Math.round(c.avg_gap_days), 'dia', 'dias'),
      text: 'Quem volta costuma pedir de novo a cada ' + plural(Math.round(c.avg_gap_days), 'dia', 'dias') + ', em média.',
      action: 'Programe campanhas perto desse prazo: quem passar de ' + Math.round(c.avg_gap_days * 1.5) + ' dias sem pedir merece um lembrete com oferta.', prio: 20 });
    if (c.loyal_count != null) add({ g: 'Clientes', ic: 'flame', tone: 'ok', title: 'Clientes fiéis', value: UI.fmt(c.loyal_count),
      text: 'Pediram 3 vezes ou mais nos últimos 90 dias.',
      action: 'Reconheça quem sustenta a pizzaria: brinde surpresa, sobremesa por conta da casa ou programa de pontos.',
      prio: 30, list: { title: 'Clientes fiéis (últimos 90 dias)', rows: people(c.loyal, 'em 90 dias') } });
    if (c.risk_count) add({ g: 'Clientes', ic: 'alert', tone: 'warn', title: 'Clientes em risco', value: UI.fmt(c.risk_count),
      text: 'Pediram 2 vezes ou mais, mas estão há 30 a 60 dias sem pedir.',
      action: 'Ainda dá tempo: mande agora um cupom de "saudade" (ex.: 10%) pelo Portal da Cardápio Web para esses clientes.',
      prio: Math.min(90, 60 + c.risk_count), list: { title: 'Clientes em risco (30 a 60 dias sem pedir)', rows: people(c.risk, 'no total') } });
    if (c.lost_count) add({ g: 'Clientes', ic: 'logout', tone: 'crit', title: 'Clientes perdidos', value: UI.fmt(c.lost_count),
      text: 'Clientes que já pediram 2 vezes ou mais e sumiram há mais de 60 dias. Juntos, já gastaram ' + money(c.lost_value) + '.',
      action: 'Campanha de reconquista com oferta forte (ex.: pizza média grátis na grande) e pergunte o que aconteceu: a resposta mostra o que corrigir.',
      prio: Math.min(85, 50 + c.lost_count), list: { title: 'Clientes perdidos (mais de 60 dias sem pedir)', rows: people(c.lost, 'no total') } });
    if (c.one_time) add({ g: 'Clientes', ic: 'user', tone: 'warn', title: 'Pediram uma vez e não voltaram', value: UI.fmt(c.one_time),
      text: 'Fizeram só um pedido, há mais de 30 dias.',
      action: 'A primeira experiência não convenceu ou foi esquecida. Revise as avaliações ruins e mande uma oferta de "segunda chance".', prio: 45 });
    if (c.top20_share) add({ g: 'Clientes', ic: 'users', tone: c.top20_share > 65 ? 'warn' : '', title: 'Dependência dos melhores clientes', value: c.top20_share + '%',
      text: 'É quanto do faturamento vem dos 20% de clientes que mais gastam.',
      action: c.top20_share > 65 ? 'Você depende muito de poucos clientes. Proteja esse grupo (fidelidade) e traga clientes novos para diluir o risco.' : 'Faturamento bem distribuído entre os clientes.',
      prio: c.top20_share > 70 ? 35 : 10 });
    if (c.avg_spent) add({ g: 'Clientes', ic: 'receipt', tone: '', title: 'Quanto vale um cliente', value: money(c.avg_spent),
      text: 'Gasto médio de cada cliente no histórico guardado.',
      action: 'Use esse valor para decidir quanto vale gastar para conquistar ou reconquistar um cliente (cupom, brinde, anúncio).', prio: 8 });

    // ---------- Cadastros e cardápio ----------
    if (s.period) add({ g: 'Cadastros e cardápio', ic: 'userPlus', tone: share(s.period_ordered, s.period) < 60 ? 'warn' : 'ok', title: 'Cadastros que viraram pedido', value: share(s.period_ordered, s.period) + '%',
      text: plural(s.period, 'pessoa se cadastrou', 'pessoas se cadastraram') + ' no cardápio no período e ' + UI.fmt(s.period_ordered) + ' já fizeram pedido.',
      action: 'Quem se cadastra e não pede costuma travar no frete, no pedido mínimo ou no pagamento. Teste frete grátis no primeiro pedido.',
      prio: share(s.period_ordered, s.period) < 50 ? 55 : 15 });
    if (s.never_ordered) add({ g: 'Cadastros e cardápio', ic: 'eye', tone: 'warn', title: 'Cadastrados que nunca pediram', value: UI.fmt(s.never_ordered),
      text: 'Entraram no cardápio, criaram cadastro e ainda não fizeram nenhum pedido.',
      action: 'Crie um cupom "PRIMEIRA" (só para clientes novos) e divulgue para essa base pelo Portal da Cardápio Web.', prio: Math.min(70, 40 + s.never_ordered / 2) });
    if (d.abandoned && d.abandoned.n) add({ g: 'Cadastros e cardápio', ic: 'cart', tone: d.abandoned.n >= 5 ? 'crit' : 'warn', title: 'Desistiram no pagamento online', value: UI.fmt(d.abandoned.n),
      text: 'Pedidos começados que não foram pagos (' + money(d.abandoned.v) + ' que não entraram).',
      action: 'Teste você mesmo o pagamento por Pix e cartão no cardápio. Se estiver tudo certo, deixe também a opção de pagar na entrega.', prio: d.abandoned.n >= 5 ? 65 : 35 });
    if (s.total) add({ g: 'Cadastros e cardápio', ic: 'bell', tone: '', title: 'Clientes que aceitam avisos', value: share(s.notifications, s.total) + '%',
      text: UI.fmt(s.notifications) + ' de ' + UI.fmt(s.total) + ' clientes cadastrados aceitam receber avisos da loja.',
      action: 'Essa é sua base de campanha sem pagar anúncio: avise lançamentos e promoções do dia fraco.', prio: 12 });

    // ---------- Bairros ----------
    var nbs = d.neighborhoods || [];
    if (nbs.length) {
      var topNb = nbs[0], nbTotal = sum(nbs, 'v');
      add({ g: 'Bairros', ic: 'mapPin', tone: 'ok', title: 'Bairro que mais vende', value: topNb.name,
        text: money(topNb.v) + ' em ' + plural(topNb.n, 'pedido', 'pedidos') + ' (' + share(topNb.v, nbTotal) + '% das entregas).',
        action: 'Proteja esse bairro: priorize o tempo de entrega nele e use-o para testar lançamentos.', prio: 20,
        list: { title: 'Bairros que mais vendem', rows: nbs.map(function (b) { var g = pct(b.n, b.pn); return { name: b.name, meta: plural(b.n, 'pedido', 'pedidos') + (g != null && b.pn ? ' · ' + fmtPct(g, true) : ' · novo'), value: money(b.v) }; }) } });
      var up = maxBy(nbs.filter(function (b) { return b.n >= 4 && b.pn >= 2 && b.n > b.pn; }), function (b) { return b.n / b.pn; });
      if (up) add({ g: 'Bairros', ic: 'flame', tone: 'ok', title: 'Bairro em alta', value: up.name,
        text: 'Pedidos foram de ' + up.pn + ' para ' + up.n + ' (' + fmtPct(pct(up.n, up.pn), true) + ').',
        action: 'Aproveite o embalo: panfleto na região ou anúncio no Instagram com raio nesse bairro.', prio: 30 });
      var down = maxBy(nbs.filter(function (b) { return b.pn >= 4 && b.n < b.pn; }), function (b) { return (b.pn - b.n) / b.pn; });
      if (down && pct(down.n, down.pn) <= -20) add({ g: 'Bairros', ic: 'alert', tone: 'warn', title: 'Bairro em queda', value: down.name,
        text: 'Pedidos foram de ' + down.pn + ' para ' + down.n + ' (' + fmtPct(pct(down.n, down.pn), true) + ').',
        action: 'Confira tempo de entrega e taxa de entrega nesse bairro e veja se surgiu concorrente por perto.', prio: 50 });
      var rich = maxBy(nbs.filter(function (b) { return b.n >= 4; }), function (b) { return b.v / b.n; });
      if (rich && nbs.length > 1) add({ g: 'Bairros', ic: 'tag', tone: '', title: 'Bairro com maior ticket', value: rich.name,
        text: 'Ticket médio de ' + money(rich.v / rich.n) + ' por pedido.',
        action: 'Clientes que gastam mais: bom lugar para divulgar pizzas premium e combos família.', prio: 15 });
    }
    var types = d.types || [], tk = types.filter(function (t) { return t.k === 'takeout'; })[0], dl = types.filter(function (t) { return t.k === 'delivery'; })[0];
    if (dl && cur.orders) add({ g: 'Bairros', ic: 'truck', tone: '', title: 'Entrega x retirada', value: share(dl.n, cur.orders) + '% entrega',
      text: (tk ? share(tk.n, cur.orders) + '% dos pedidos são retirada. ' : 'Quase ninguém retira. ') + 'Taxa de entrega média: ' + money(dl.fee) + '.',
      action: 'Desconto para quem retira diminui o custo com entregador e acelera a saída nos horários de pico.', prio: 15 });

    // ---------- Horários e dias ----------
    var hours = (d.hours || []).filter(function (h) { return h.n > 0; });
    if (hours.length) {
      var peak = maxBy(hours, function (h) { return h.n; });
      add({ g: 'Horários e dias', ic: 'clock', tone: 'info', title: 'Horário de pico', value: hourLabel(peak.h) + ' às ' + hourLabel(peak.h + 1),
        text: plural(peak.n, 'pedido', 'pedidos') + ' nesse horário no período (' + share(peak.n, cur.orders) + '% do total).',
        action: 'Reforce a equipe e deixe massas abertas e ingredientes porcionados antes das ' + hourLabel(peak.h) + '.', prio: 25 });
      // Horário fraco: dentro do expediente (horas com movimento relevante), o de menos pedidos.
      var busy = hours.filter(function (h) { return h.n >= peak.n * 0.1; });
      var weak = minBy(busy, function (h) { return h.n; });
      if (weak && weak.h !== peak.h) add({ g: 'Horários e dias', ic: 'clock', tone: 'warn', title: 'Horário mais fraco', value: hourLabel(weak.h) + ' às ' + hourLabel(weak.h + 1),
        text: 'Só ' + plural(weak.n, 'pedido', 'pedidos') + ' nesse horário, contra ' + peak.n + ' no pico.',
        action: 'Promoção relâmpago nesse horário (ex.: borda grátis até as ' + hourLabel(weak.h + 1) + ') ajuda a puxar pedidos e aliviar o pico.', prio: 30 });
    }
    var wd = (d.weekdays || []).map(function (w) { return { d: w.d, n: w.n, avg: w.days ? w.v / w.days : 0 }; });
    if (wd.length >= 3) {
      var best = maxBy(wd, function (w) { return w.avg; }), worst = minBy(wd, function (w) { return w.avg; });
      add({ g: 'Horários e dias', ic: 'calendar', tone: 'ok', title: 'Dia mais forte', value: DB.WEEK[best.d],
        text: 'Média de ' + money(best.avg) + ' por ' + DB.WEEK[best.d].toLowerCase() + '.',
        action: 'Escala completa e estoque reforçado nesse dia. Evite folgas e manutenção.', prio: 20 });
      if (worst.d !== best.d) add({ g: 'Horários e dias', ic: 'calendar', tone: 'warn', title: 'Dia mais fraco', value: DB.WEEK[worst.d],
        text: 'Média de ' + money(worst.avg) + ' por dia, ' + share(worst.avg, best.avg) + '% do dia mais forte.',
        action: 'Crie uma promoção fixa nesse dia (ex.: "' + DB.WEEK[worst.d] + ' em dobro" ou rodízio de sabor do dia) e divulgue sempre no mesmo dia.', prio: 50 });
    }
    if (d.scheduled && cur.orders) add({ g: 'Horários e dias', ic: 'calendar', tone: '', title: 'Pedidos agendados', value: share(d.scheduled, cur.orders) + '%',
      text: plural(d.scheduled, 'pedido foi agendado', 'pedidos foram agendados') + ' com antecedência.',
      action: 'Agendamento ajuda a planejar a produção: divulgue a opção para festas e fins de semana.', prio: 8 });

    // ---------- Produtos ----------
    var items = (d.items || []).filter(function (i) { return i.q > 0 || i.pq > 0; });
    var cur_items = items.filter(function (i) { return i.q > 0; });
    if (cur_items.length) {
      var champ = maxBy(cur_items, function (i) { return i.v; });
      add({ g: 'Produtos', ic: 'pizza', tone: 'ok', title: 'Campeão de faturamento', value: champ.name,
        text: money(champ.v) + ' (' + share(champ.v, sum(cur_items, 'v')) + '% do que foi vendido em itens), ' + plural(champ.q, 'unidade', 'unidades') + '.',
        action: 'Nunca deixe faltar os ingredientes dele e use-o como chamariz nas promoções (ele vende sozinho).', prio: 20 });
      var rising = maxBy(items.filter(function (i) { return i.q >= 5 && i.pq >= 2 && i.q > i.pq * 1.2; }), function (i) { return i.q / i.pq; });
      if (rising) add({ g: 'Produtos', ic: 'flame', tone: 'ok', title: 'Item em alta', value: rising.name,
        text: 'Vendas foram de ' + UI.fmt(rising.pq) + ' para ' + UI.fmt(rising.q) + ' (' + fmtPct(pct(rising.q, rising.pq), true) + ').',
        action: 'Destaque no topo do cardápio e garanta estoque dos ingredientes.', prio: 25 });
      var falling = maxBy(items.filter(function (i) { return i.pq >= 5 && i.q < i.pq * 0.8; }), function (i) { return (i.pq - i.q) / i.pq; });
      if (falling) add({ g: 'Produtos', ic: 'alert', tone: 'warn', title: 'Item em queda', value: falling.name,
        text: 'Vendas foram de ' + UI.fmt(falling.pq) + ' para ' + UI.fmt(falling.q) + ' (' + fmtPct(pct(falling.q, falling.pq), true) + ').',
        action: 'Confira se mudou algo (receita, preço, foto, falta de ingrediente). Se não recuperar, troque por um sabor novo.', prio: 40 });
    }
    var pair = (d.pairs || [])[0];
    if (pair) add({ g: 'Produtos', ic: 'sparkle', tone: 'info', title: 'Saem juntos', value: pair.a + ' + ' + pair.b,
      text: 'Pedidos juntos ' + plural(pair.n, 'vez', 'vezes') + ' no período.' + ((d.pairs || [])[1] ? ' Depois vem ' + d.pairs[1].a + ' + ' + d.pairs[1].b + ' (' + d.pairs[1].n + ').' : ''),
      action: 'Monte um combo "' + pair.a + ' + ' + pair.b + '" com um pequeno desconto: aumenta o ticket de quem pediria só um.', prio: 45 });
    if (cur.items_per_order) add({ g: 'Produtos', ic: 'box', tone: cur.items_per_order < 1.6 ? 'warn' : 'ok', title: 'Itens por pedido', value: UI.fmt(cur.items_per_order),
      text: 'Média de itens em cada pedido no período.',
      action: cur.items_per_order < 1.6 ? 'A maioria pede um item só. Ofereça bebida e sobremesa como adicional na própria pizza ("leve um refri 2L por R$ X").' : 'Bom volume por pedido. Continue sugerindo adicionais.',
      prio: cur.items_per_order < 1.4 ? 45 : 15 });

    // ---------- Canais e pagamento ----------
    var ch = d.channels || [], chTotal = sum(ch, 'v'), ifood = ch.filter(function (x) { return x.k === 'ifood'; })[0];
    if (chTotal) {
      var mainCh = maxBy(ch, function (x) { return x.v; });
      add({ g: 'Canais e pagamento', ic: 'store', tone: ifood && share(ifood.v, chTotal) > 30 ? 'warn' : 'ok', title: 'iFood x cardápio próprio',
        value: (ifood ? share(ifood.v, chTotal) : 0) + '% iFood',
        text: 'Canal principal: ' + (CHANNELS[mainCh.k] || mainCh.k) + ' (' + share(mainCh.v, chTotal) + '% do faturamento).',
        action: ifood && share(ifood.v, chTotal) > 25 ? 'O iFood cobra comissão alta. Coloque na caixa da pizza um cupom para o próximo pedido pelo cardápio próprio.' : 'A maior parte vem pelo canal próprio, sem comissão. Continue divulgando o link do cardápio.',
        prio: ifood && share(ifood.v, chTotal) > 30 ? 55 : 10 });
    }
    var pays = d.payments || [], fees = sum(pays, 'fee'), payTotal = sum(pays, 'v'), pix = sum(pays.filter(function (p) { return p.k === 'pix' || p.k === 'pix_auto'; }), 'v');
    if (payTotal) add({ g: 'Canais e pagamento', ic: 'receipt', tone: fees > 100 ? 'warn' : '', title: 'Taxas de pagamento', value: money(fees),
      text: 'Pago em taxas de cartão e pagamento online no período. Pix é ' + share(pix, payTotal) + '% do que entrou.' + (maxBy(pays, function (p) { return p.fee; }) && fees ? ' Maior custo: ' + (PAY[maxBy(pays, function (p) { return p.fee; }).k] || maxBy(pays, function (p) { return p.fee; }).k) + '.' : ''),
      action: 'Incentive o Pix (ex.: R$ 2 de desconto no Pix): o desconto costuma sair mais barato que a taxa do cartão.', prio: fees > 100 ? 40 : 12 });
    var cp = d.coupons || {};
    if (cur.orders && cp.orders) add({ g: 'Canais e pagamento', ic: 'tag', tone: cp.ticket_with < cp.ticket_without ? 'warn' : 'ok', title: 'Cupons', value: share(cp.orders, cur.orders) + '% dos pedidos',
      text: plural(cp.orders, 'pedido usou', 'pedidos usaram') + ' cupom, somando ' + money(cp.discount) + ' de desconto. Ticket com cupom: ' + money(cp.ticket_with) + '; sem: ' + money(cp.ticket_without) + '.' +
        ((d.top_coupons || [])[0] ? ' Mais usado: ' + d.top_coupons[0].code + '.' : ''),
      action: cp.ticket_with < cp.ticket_without ? 'Os cupons estão trazendo pedidos menores: defina um pedido mínimo para usar o cupom.' : 'Os cupons não estão derrubando o ticket. Mantenha os que trazem clientes novos.',
      prio: cp.ticket_with < cp.ticket_without ? 40 : 12 });
    var cn = d.cancel || {};
    if (cn.total) {
      var cr = share(cn.n, cn.total), reason = (cn.reasons || [])[0];
      var why = reason ? reason.reason.toLowerCase() : '';
      add({ g: 'Canais e pagamento', ic: 'x', tone: cr >= 5 ? 'crit' : cr >= 2 ? 'warn' : 'ok', title: 'Cancelamentos', value: cr + '%',
        text: plural(cn.n, 'pedido cancelado', 'pedidos cancelados') + ' (' + money(cn.v) + ').' + (reason ? ' Motivo mais comum: "' + reason.reason + '" (' + reason.n + ').' : ''),
        action: /demor|atras|tempo/.test(why) ? 'O motivo principal é demora: revise o tempo de preparo no pico e o número de entregadores.'
          : /endere|área|area|raio/.test(why) ? 'Muitos cancelamentos por endereço: revise a área de entrega no Portal da Cardápio Web.'
          : /falt|acab|estoque/.test(why) ? 'Cancelamento por falta de produto: pause no cardápio o que acabar, na hora.'
          : cn.n ? 'Ligue para alguns desses clientes para entender o motivo e evitar que se repita.' : 'Quase nenhum cancelamento. Ótimo.',
        prio: cr >= 5 ? 70 : cr >= 2 ? 35 : 5 });
    }

    // ---------- Satisfação ----------
    var rv2 = d.reviews || {};
    if (rv2.n) {
      add({ g: 'Satisfação', ic: 'message', tone: rv2.avg >= 4.5 ? 'ok' : rv2.avg >= 4 ? 'warn' : 'crit', title: 'Nota média', value: UI.fmt(rv2.avg) + ' / 5',
        text: plural(rv2.n, 'avaliação', 'avaliações') + ' no período' + (rv2.prev_avg ? ' (antes: ' + UI.fmt(rv2.prev_avg) + ')' : '') + '.',
        action: rv2.avg >= 4.5 ? 'Clientes satisfeitos: peça para os fiéis avaliarem e divulgue as notas no Instagram.' : 'A nota está puxando para baixo. Veja abaixo o quesito pior avaliado e os comentários.',
        prio: rv2.avg < 4 ? 75 : rv2.avg < 4.5 ? 45 : 10 });
      var worstA = (rv2.aspects || [])[0];
      if (worstA) add({ g: 'Satisfação', ic: 'alert', tone: worstA.avg >= 4.5 ? 'ok' : 'warn', title: 'Pior quesito', value: worstA.q,
        text: 'Nota ' + UI.fmt(worstA.avg) + ' de 5. ' + (rv2.aspects.length > 1 ? 'Melhor: ' + rv2.aspects[rv2.aspects.length - 1].q + ' (' + UI.fmt(rv2.aspects[rv2.aspects.length - 1].avg) + ').' : ''),
        action: worstA.avg >= 4.5 ? 'Todos os quesitos vão bem.' : /entrega|tempo/i.test(worstA.q) ? 'Tempo de entrega é o ponto fraco: revise rotas, entregadores no pico e a previsão informada ao cliente.'
          : /embala/i.test(worstA.q) ? 'Embalagem: teste caixas que seguram melhor o calor e lacre de segurança.'
          : /qualidade|produto/i.test(worstA.q) ? 'Qualidade do produto: confira padrão de recheio, ponto da massa e temperatura de saída.'
          : 'Foque em melhorar "' + worstA.q + '" e acompanhe a nota nas próximas semanas.',
        prio: worstA.avg < 4 ? 65 : worstA.avg < 4.5 ? 35 : 5 });
      if (rv2.low) add({ g: 'Satisfação', ic: 'message', tone: 'crit', title: 'Avaliações ruins', value: UI.fmt(rv2.low),
        text: 'Avaliações com nota 3 ou menos no período.',
        action: 'Responda cada uma no Portal, peça desculpas e ofereça compensação: cliente bem atendido depois de um problema costuma voltar.',
        prio: 40, list: { title: 'Comentários das notas baixas', rows: (rv2.comments || []).map(function (r) { return { name: '"' + r.comment + '"', meta: (r.name || 'Cliente') + ' · há ' + plural(daysAgo(r.created_at), 'dia', 'dias'), value: UI.fmt(r.rating) + ' / 5' }; }) } });
    }
    return out;
  }

  // ---------- Desenho ----------

  function card(x, i) {
    return '<div class="card cw-ins"><div class="card-row"><div class="tile ' + (x.tone || '') + '">' + icon(x.ic) + '</div>' +
      '<div class="grow"><div class="card-meta">' + esc(x.title) + '</div><div class="cw-ins-value">' + esc(x.value) + '</div></div></div>' +
      '<p class="cw-ins-text">' + esc(x.text) + '</p>' +
      '<div class="cw-ins-do">' + icon('sparkle', 'sm') + '<span><b>O que fazer:</b> ' + esc(x.action) + '</span></div>' +
      (x.list && x.list.rows.length ? '<button type="button" class="btn sm" data-ins-list="' + i + '">Ver lista (' + x.list.rows.length + ')</button>' : '') + '</div>';
  }

  function html(d, label) {
    var list = build(d, label);
    var top = list.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return o.x.prio >= 40; })
      .sort(function (a, b) { return b.x.prio - a.x.prio; }).slice(0, 5);
    var days = d.history_from ? daysAgo(d.history_from) : 0;
    var note = (d.pending > 50 || d.without_customer_id > 0)
      ? '<div class="banner info">' + icon('refresh', 'sm') + '<div class="grow">Ainda trazendo o histórico da Cardápio Web (faltam ' + UI.fmt(d.pending) + ' pedidos). Os números de clientes vão se completando nas próximas horas.</div></div>' : '';
    return note +
      '<p class="card-meta" style="margin:0">' + plural(list.length, 'insight', 'insights') + ' sobre os ' + esc(label) + ', comparando com o mesmo período anterior.' +
      (days ? ' Clientes fiéis, em risco e perdidos usam todo o histórico guardado (' + plural(days, 'dia', 'dias') + ').' : '') + '</p>' +
      (top.length ? '<section class="section"><div class="section-head"><h2>Decisões prioritárias</h2></div><div class="list">' + top.map(function (o, n) {
        return '<div class="row cw-decision"><span class="cw-decision-n num">' + (n + 1) + '</span><div class="grow"><div class="card-title">' + esc(o.x.action) + '</div>' +
          '<div class="card-meta">' + esc(o.x.title) + ': ' + esc(o.x.value) + '</div></div>' +
          (o.x.list && o.x.list.rows.length ? '<button type="button" class="btn sm ghost" data-ins-list="' + o.i + '">Ver</button>' : '') + '</div>';
      }).join('') + '</div></section>' : '') +
      GROUPS.map(function (g) {
        var items = list.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return o.x.g === g; });
        if (!items.length) return '';
        return '<section class="section"><div class="section-head"><h2>' + g + '</h2></div><div class="card-grid">' +
          items.map(function (o) { return card(o.x, o.i); }).join('') + '</div></section>';
      }).join('') +
      (!list.length ? '<div class="card">' + UI.empty('sparkle', 'Poucos dados ainda', 'Os insights aparecem conforme os pedidos chegam da Cardápio Web. Tente um período maior.') + '</div>' : '') +
      '<p class="faint" style="text-align:center;font-size:var(--fs-xs)">Telefone e e-mail dos clientes não são guardados no app: para falar com eles, procure pelo nome no Portal da Cardápio Web.</p>';
  }

  function openList(d, label, i) {
    var x = build(d, label)[i];
    if (!x || !x.list) return;
    UI.sheet('<h2>' + esc(x.list.title) + '</h2><div class="list">' + x.list.rows.map(function (r) {
      return '<div class="row"><div class="grow"><div class="card-title">' + esc(r.name) + '</div><div class="card-meta">' + esc(r.meta) + '</div></div><span class="num">' + esc(r.value) + '</span></div>';
    }).join('') + '</div>' + (x.list.rows.length >= 15 ? '<p class="card-meta">Mostrando os 15 primeiros.</p>' : '') +
      '<p class="card-meta">' + esc(x.action) + '</p><button type="button" class="btn block" data-close>Fechar</button>');
  }

  window.CWInsights = { build: build, html: html, openList: openList };
})();
