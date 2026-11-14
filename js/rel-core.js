// Relatórios: transforma os números da empresa em gráficos e leituras com uma sugestão do que fazer.
// Junta três fontes: a Cardápio Web (cw_relatorio, supabase/010_relatorios.sql), o Google (nota e avaliações)
// e o que o próprio app guarda (ponto, checklists, manutenção, estoque, notas, fichas técnicas, reservas, financeiro).
// As leituras de vendas que já existiam em Vendas › Insights (js/screens/vendas-insights.js) entram aqui também.
// A tela fica em js/screens/relatorios.js; aqui só as contas e os textos.
(function () {
  var money = UI.money, fmt = UI.fmt;
  var WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var TYPES = { delivery: 'Entrega', takeout: 'Retirada', onsite: 'No local', closed_table: 'Mesa ou comanda' };
  var CHANNELS = { catalog: 'Cardápio digital', store_front_catalog: 'Cardápio da loja', portal: 'Balcão', whatsapp_extension: 'WhatsApp', ifood: 'iFood',
    food99: '99Food', '99food': '99Food', keeta: 'Keeta', rappi: 'Rappi', aiqfome: 'aiqfome' };
  var PAY = { money: 'Dinheiro', credit_card: 'Crédito', debit_card: 'Débito', pix: 'Pix', pix_auto: 'Pix', meal_voucher: 'Vale-refeição',
    food_voucher: 'Vale-alimentação', bank_transfer: 'Transferência', bank_slip: 'Boleto', picpay: 'PicPay', debt_book: 'Fiado',
    online_credit_card: 'Cartão online', ifood: 'iFood', ifood_voucher: 'Vale iFood', food99: '99Food', food99_voucher: 'Vale 99Food' };
  var DISC = { coupon: 'Cupons', loyalty: 'Fidelidade', promotion: 'Promoções', manual: 'Desconto no balcão', outros: 'Outros' };

  // Áreas do relatório e os grupos de leituras de cada uma.
  var SECTIONS = [
    { id: 'vendas', label: 'Vendas', icon: 'receipt', groups: ['Vendas', 'Ritmo e ticket', 'Horários e dias', 'Canais e pagamento'] },
    { id: 'entrega', label: 'Entrega e bairros', icon: 'truck', groups: ['Entrega', 'Bairros'] },
    { id: 'clientes', label: 'Clientes', icon: 'users', groups: ['Clientes', 'Base de clientes', 'Cadastros e cardápio'] },
    { id: 'produtos', label: 'Produtos', icon: 'pizza', groups: ['Sabores', 'Produtos'] },
    { id: 'avaliacoes', label: 'Avaliações', icon: 'message', groups: ['Satisfação', 'Avaliações em detalhe'] },
    { id: 'google', label: 'Google', icon: 'star', groups: ['Google'] },
    { id: 'financeiro', label: 'Financeiro', icon: 'tag', groups: ['Financeiro'], admin: true },
    { id: 'equipe', label: 'Equipe', icon: 'clock', groups: ['Equipe'] },
    { id: 'operacao', label: 'Operação', icon: 'checklist', groups: ['Checklists', 'Manutenção', 'Estoque e compras', 'Ficha técnica', 'Reservas'] }
  ];
  var SECTION_OF = {};
  SECTIONS.forEach(function (s) { s.groups.forEach(function (g) { SECTION_OF[g] = s.id; }); });

  // ---------- Utilitários ----------
  function pct(a, b) { return b ? (a - b) / b * 100 : null; }
  function share(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function sp(p) { return (p > 0 ? '+' : '') + fmt(Math.round(p)) + '%'; }
  function sum(list, f) { return (list || []).reduce(function (s, x) { return s + (+(typeof f === 'string' ? x[f] : f(x)) || 0); }, 0); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many); }
  function maxBy(list, f) { return (list || []).reduce(function (m, x) { return m == null || f(x) > f(m) ? x : m; }, null); }
  function minBy(list, f) { return (list || []).reduce(function (m, x) { return m == null || f(x) < f(m) ? x : m; }, null); }
  function one(n) { return fmt(Math.round(n * 10) / 10); }
  function nota(v) { return v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
  function nota2(v) { return v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
  function hours(min) { return fmt(Math.round(min / 60)) + ' h'; }
  function day(iso) { var p = String(iso).slice(0, 10).split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function addDays(iso, n) { var d = day(iso); d.setDate(d.getDate() + n); return DB.iso(d); }
  function dm(iso) { var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1]; }
  function wdm(iso) { return WD[day(iso).getDay()] + ', ' + dm(iso); }
  function monthShort(key) { var p = key.split('-'); return MON[+p[1] - 1] + '/' + p[0].slice(2); }
  function monthName(key) { return Fin.MONTHS[+key.split('-')[1] - 1]; }
  function daysAgo(iso) { return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000)); }
  function chName(k) { k = k == null ? '' : String(k); return CHANNELS[k] || (/99/.test(k) ? '99Food' : k ? k.replace(/_/g, ' ') : 'Outros'); }
  function first(name) { return String(name || '').trim().split(/\s+/)[0] || '—'; }

  // Vendas por dia do período (e do período anterior, do mesmo tamanho), com os dias sem pedido como zero.
  function dailySeries(r, days) {
    var map = {}, cur = [], prev = [];
    (r.daily || []).forEach(function (x) { map[String(x.d).slice(0, 10)] = x; });
    for (var i = 0; i < days; i++) {
      var a = addDays(r.day_from, i), b = addDays(r.day_from, i - days);
      cur.push({ d: a, n: map[a] ? +map[a].n : 0, v: map[a] ? +map[a].v : 0 });
      prev.push({ d: b, n: map[b] ? +map[b].n : 0, v: map[b] ? +map[b].v : 0 });
    }
    return { cur: cur, prev: prev, map: map };
  }

  // ---------- Leituras ----------
  // Cada uma: grupo (g), ícone, tom, título, valor, explicação, o que fazer, prioridade (0 a 100) e, se houver, uma lista.

  function salesInsights(add, x) {
    var r = x.r, ins = r.ins, cur = ins.cur || {}, ds = x.daily, today = x.to;
    var full = x.live ? ds.cur.slice(0, -1) : ds.cur; // sem hoje, que ainda está em andamento
    var open = full.filter(function (d) { return d.n > 0; });
    var ticket = cur.orders ? cur.revenue / cur.orders : 0;

    // Projeção do mês pelo ritmo dos dias fechados.
    var mk = today.slice(0, 7), months = r.months || [], m = months.filter(function (q) { return q.m === mk; })[0];
    var dom = +today.slice(8, 10), dim = Fin.daysIn(mk);
    if (m && dom > 3) {
      var todayV = ds.map[today] ? +ds.map[today].v : 0, proj = (+m.v - todayV) / (dom - 1) * dim;
      var pm = months.filter(function (q) { return q.m === Fin.addMonth(mk, -1); })[0];
      var pmFull = pm && months[0].m !== pm.m; // o primeiro mês do histórico pode estar pela metade
      var g = pmFull ? pct(proj, +pm.v) : null;
      add({ g: 'Ritmo e ticket', ic: 'calendar', tone: g == null ? 'info' : g >= 0 ? 'ok' : g <= -10 ? 'crit' : 'warn', title: 'Projeção de ' + monthName(mk), value: money(proj),
        text: 'No ritmo dos ' + (dom - 1) + ' dias já fechados, o mês termina perto desse valor (até ontem: ' + money(+m.v - todayV) + ').' +
          (g != null ? ' ' + monthName(pm.m).replace(/^./, function (c) { return c.toUpperCase(); }) + ' fechou em ' + money(pm.v) + ' (' + sp(g) + ').' : ''),
        action: g != null && g < 0 ? 'Para não fechar abaixo do mês passado, concentre promoções nos dias fracos que ainda restam e reative clientes em risco esta semana.'
          : 'Use a projeção para planejar compras e escala das próximas semanas. Fins de semana pesam mais: confira quantos ainda faltam no mês.',
        prio: g != null && g <= -10 ? 72 : g != null && g < 0 ? 48 : 18 });
    }

    // Tendência: últimas 4 semanas completas contra as 4 anteriores.
    var wk = (r.weeks || []).filter(function (w) { return addDays(w.w, 6) < today; });
    if (wk.length >= 8) {
      var a = sum(wk.slice(-4), 'v'), b = sum(wk.slice(-8, -4), 'v'), t = pct(a, b);
      if (t != null) add({ g: 'Ritmo e ticket', ic: 'flame', tone: t >= 3 ? 'ok' : t <= -8 ? 'crit' : t < 0 ? 'warn' : '', title: 'Tendência das últimas 4 semanas', value: sp(t),
        text: 'As 4 últimas semanas completas somaram ' + money(a) + '; as 4 anteriores, ' + money(b) + '.',
        action: t <= -8 ? 'A queda já dura um mês: não é um dia ruim, é tendência. Veja em Clientes quem parou de pedir e em Avaliações se a nota caiu junto.'
          : t >= 3 ? 'Crescimento consistente. Garanta que a equipe e o estoque acompanhem para a nota não cair.' : 'Vendas de lado. Um lançamento de sabor ou combo costuma destravar.',
        prio: t <= -8 ? 70 : t < 0 ? 40 : 12 });
      var bestW = maxBy(wk, function (w) { return +w.v; });
      if (bestW) add({ g: 'Ritmo e ticket', ic: 'flame', tone: 'ok', title: 'Melhor semana do histórico', value: 'Semana de ' + dm(bestW.w),
        text: money(bestW.v) + ' em ' + plural(+bestW.n, 'pedido', 'pedidos') + '. ' + (bestW === wk[wk.length - 1] ? 'É a última semana completa: recorde novo.' : 'A última semana completa fez ' + money(wk[wk.length - 1].v) + ' (' + share(+wk[wk.length - 1].v, +bestW.v) + '% do recorde).'),
        action: 'Lembre o que aconteceu naquela semana (promoção, feriado, pagamento, clima) e repita o que estiver ao seu alcance.', prio: 10 });
    }

    if (open.length >= 5) {
      var best = maxBy(open, function (d) { return d.v; }), worst = minBy(open, function (d) { return d.v; });
      var avg = sum(open, 'v') / open.length, above = open.filter(function (d) { return d.v > avg; }).length;
      add({ g: 'Ritmo e ticket', ic: 'receipt', tone: '', title: 'Média por dia aberto', value: money(avg),
        text: 'Média dos ' + open.length + ' dias com venda (' + fmt(Math.round(sum(open, 'n') / open.length)) + ' pedidos por dia). ' + above + ' dias ficaram acima da média.',
        action: 'Use esse número como régua do dia: abaixo dele às 21h, vale soltar uma oferta relâmpago no WhatsApp e nos stories.', prio: 12 });
      add({ g: 'Ritmo e ticket', ic: 'flame', tone: 'ok', title: 'Melhor dia do período', value: wdm(best.d),
        text: money(best.v) + ' em ' + plural(best.n, 'pedido', 'pedidos') + ', ' + one(best.v / avg) + ' vezes a média.',
        action: 'É o teto que a cozinha já aguentou. Se a nota daquele dia foi boa, dá para buscar esse volume mais vezes.', prio: 8 });
      if (worst.d !== best.d) add({ g: 'Ritmo e ticket', ic: 'alert', tone: worst.v < avg * 0.5 ? 'warn' : '', title: 'Dia mais fraco do período', value: wdm(worst.d),
        text: money(worst.v) + ' em ' + plural(worst.n, 'pedido', 'pedidos') + ' (' + share(worst.v, avg) + '% da média).',
        action: 'Confira o que houve (chuva, falta de entregador, sistema fora do ar). Se foi dia comum, é candidato a promoção fixa.', prio: worst.v < avg * 0.4 ? 30 : 10 });
      var closed = full.length - open.length;
      if (closed > 0) add({ g: 'Ritmo e ticket', ic: 'calendar', tone: closed > full.length * 0.2 ? 'warn' : '', title: 'Dias sem nenhum pedido', value: fmt(closed),
        text: 'Em ' + full.length + ' dias do período, ' + closed + ' não tiveram venda registrada na Cardápio Web.',
        action: 'Se a loja estava fechada nesses dias, está certo. Se estava aberta, confira se os pedidos foram lançados no sistema: venda fora do sistema some dos relatórios.',
        prio: closed > full.length * 0.2 ? 35 : 8 });
    }

    // Fim de semana.
    var wds = ins.weekdays || [], wtot = sum(wds, 'v');
    if (wtot && wds.length >= 4) {
      var we = sum(wds.filter(function (w) { return w.d === 5 || w.d === 6 || w.d === 0; }), 'v'), ws = share(we, wtot);
      add({ g: 'Horários e dias', ic: 'calendar', tone: ws > 65 ? 'warn' : '', title: 'Peso do fim de semana', value: ws + '%',
        text: 'Sexta, sábado e domingo trazem ' + ws + '% do faturamento do período.',
        action: ws > 65 ? 'A semana depende de três dias. Uma chuva no sábado derruba o mês: crie motivos para pedir de segunda a quinta (combo da semana, sabor do dia).'
          : 'Movimento bem dividido entre semana e fim de semana. Mantenha a escala de acordo.', prio: ws > 70 ? 38 : 10 });
    }
    // Melhor hora da semana (dia x hora).
    var cell = maxBy(r.heat || [], function (h) { return +h.n; });
    if (cell && +cell.n >= 5) {
      var weeks = Math.max(1, x.days / 7);
      add({ g: 'Horários e dias', ic: 'clock', tone: 'info', title: x.days >= 14 ? 'Hora mais cheia da semana' : 'Hora mais cheia do período', value: DB.WEEK[cell.d] + ', ' + cell.h + 'h',
        text: plural(+cell.n, 'pedido', 'pedidos') + ' nessa hora no período' + (x.days >= 14 ? ': cerca de ' + one(+cell.n / weeks) + ' por semana, ' + money(+cell.v / weeks) + ' em uma hora.' : ', somando ' + money(+cell.v) + '.'),
        action: 'É a hora que não pode dar errado: ninguém de folga ou no intervalo, forno já quente e pelo menos um entregador a mais disponível.', prio: 22 });
    }

    // Ticket.
    var ts = r.ticket_stats || {}, tk = r.tickets || [], tkN = sum(tk, 'n');
    if (ts.median != null && ticket) {
      add({ g: 'Ritmo e ticket', ic: 'tag', tone: '', title: 'Pedido típico', value: money(ts.median),
        text: 'Metade dos pedidos fica abaixo desse valor. A média (' + money(ticket) + ') é puxada pelos pedidos grandes: 1 em cada 10 passa de ' + money(ts.p90) + '.',
        action: 'Coloque o preço do combo mais vendido um pouco acima do pedido típico: é o degrau que o cliente aceita subir.', prio: 14 });
    }
    if (tkN) {
      var mode = maxBy(tk, function (b) { return +b.n; });
      add({ g: 'Ritmo e ticket', ic: 'tag', tone: '', title: 'Faixa de valor mais comum', value: +mode.b >= 200 ? 'Acima de R$ 200' : 'R$ ' + mode.b + ' a R$ ' + (+mode.b + 20),
        text: share(+mode.n, tkN) + '% dos pedidos caem nessa faixa.',
        action: 'Um frete grátis ou brinde a partir de um valor logo acima dessa faixa empurra muita gente para o degrau seguinte.', prio: 12 });
      var big = tk.filter(function (b) { return +b.b >= 120; }), bn = sum(big, 'n'), bv = sum(big, 'v');
      if (bn) add({ g: 'Ritmo e ticket', ic: 'receipt', tone: 'ok', title: 'Pedidos acima de R$ 120', value: share(bn, tkN) + '% dos pedidos',
        text: 'São só ' + plural(bn, 'pedido', 'pedidos') + ', mas trazem ' + share(bv, cur.revenue) + '% do faturamento.',
        action: 'Pedido grande é família e festa. Tenha um combo família bem visível no topo do cardápio e ofereça agendamento.', prio: 16 });
      var small = tk.filter(function (b) { return +b.b < 40; }), sn = sum(small, 'n');
      if (sn && share(sn, tkN) >= 15) add({ g: 'Ritmo e ticket', ic: 'alert', tone: 'warn', title: 'Pedidos abaixo de R$ 40', value: share(sn, tkN) + '% dos pedidos',
        text: plural(sn, 'pedido', 'pedidos') + ' de valor baixo. Na entrega, eles mal pagam o entregador e a embalagem.',
        action: 'Defina um pedido mínimo para entrega ou ofereça bebida com desconto para quem está logo abaixo dele.', prio: 34 });
    }

    // Descontos.
    var dsc = r.discounts || [], dv = sum(dsc, 'v');
    if (dv > 0 && cur.revenue) {
      var topD = maxBy(dsc, function (q) { return +q.v; }), dp = dv / (cur.revenue + dv) * 100;
      add({ g: 'Canais e pagamento', ic: 'tag', tone: dp > 8 ? 'warn' : '', title: 'Descontos concedidos', value: money(dv),
        text: one(dp) + '% do que seria vendido sem desconto, em ' + plural(sum(dsc, 'n'), 'pedido', 'pedidos') + '. Maior parte: ' + (DISC[topD.k] || topD.k) + ' (' + money(topD.v) + ').',
        action: dp > 8 ? 'Desconto alto come o lucro direto. Troque parte dos descontos em dinheiro por brinde de custo baixo (refri, borda) e limite cupom a clientes novos ou em risco.'
          : 'Descontos sob controle. Acompanhe se cada cupom traz cliente novo ou só dá desconto a quem já ia pedir.', prio: dp > 8 ? 46 : 12 });
    }
  }

  function deliveryInsights(add, x) {
    var r = x.r, ins = r.ins, f = r.fees || {}, cur = ins.cur || {};
    var dl = +f.deliveries || 0;
    if (dl && +f.driver_fee > 0) {
      var diff = +f.delivery_fee - +f.driver_fee;
      add({ g: 'Entrega', ic: 'truck', tone: diff >= 0 ? 'ok' : diff < -0.15 * +f.driver_fee ? 'crit' : 'warn', title: 'A entrega se paga?', value: (diff >= 0 ? 'Sobram ' : 'Faltam ') + money(Math.abs(diff)),
        text: 'Os clientes pagaram ' + money(f.delivery_fee) + ' de taxa em ' + plural(dl, 'entrega', 'entregas') + '; os entregadores receberam ' + money(f.driver_fee) + '.',
        action: diff >= 0 ? 'A taxa cobre o entregador. Mantenha e revise só os bairros mais distantes.'
          : 'A pizzaria está bancando ' + money(-diff / dl) + ' por entrega. Revise a taxa por bairro e reduza as entregas grátis.', prio: diff < 0 ? 58 : 10 });
    } else if (dl) {
      add({ g: 'Entrega', ic: 'truck', tone: '', title: 'Taxa de entrega cobrada', value: money(f.delivery_fee),
        text: 'Em ' + plural(dl, 'entrega', 'entregas') + ', média de ' + money(+f.delivery_fee / dl) + ' por entrega.',
        action: 'Lance no Portal da Cardápio Web quanto cada entregador recebe por corrida: o relatório passa a mostrar se a taxa cobre o custo.', prio: 12 });
    }
    if (dl && +f.free > 0) {
      var fp = share(+f.free, dl);
      add({ g: 'Entrega', ic: 'tag', tone: fp > 25 ? 'warn' : '', title: 'Entregas sem taxa', value: fp + '%',
        text: plural(+f.free, 'entrega saiu', 'entregas saíram') + ' sem cobrar taxa do cliente.',
        action: fp > 25 ? 'Muita entrega grátis. Deixe o frete grátis só acima de um valor de pedido que pague o entregador.' : 'Frete grátis usado com moderação. Bom como isca para pedidos maiores.',
        prio: fp > 25 ? 44 : 10 });
    }
    if (+f.driver_days > 0 && +f.with_driver > 0) {
      var per = +f.with_driver / +f.driver_days;
      add({ g: 'Entrega', ic: 'users', tone: per > 22 ? 'warn' : '', title: 'Entregas por entregador por dia', value: one(per),
        text: plural(+f.drivers, 'entregador diferente', 'entregadores diferentes') + ' no período, em ' + plural(+f.with_driver, 'entrega atribuída', 'entregas atribuídas') + '.',
        action: per > 22 ? 'Carga alta por entregador: é daí que nasce o atraso no pico. Tenha um entregador extra de sobreaviso na sexta e no sábado.'
          : per < 8 ? 'Poucas entregas por entregador: em dias fracos, dá para trabalhar com um a menos.' : 'Carga equilibrada por entregador.', prio: per > 22 ? 42 : 10 });
    }
    // Ticket por tipo de pedido.
    var types = (ins.types || []).filter(function (t) { return +t.n >= 5; }).map(function (t) { return { k: t.k, n: +t.n, v: +t.v, tk: +t.v / +t.n }; });
    if (types.length >= 2) {
      var hi = maxBy(types, function (t) { return t.tk; }), lo = minBy(types, function (t) { return t.tk; });
      add({ g: 'Entrega', ic: 'store', tone: 'info', title: 'Onde o cliente gasta mais', value: TYPES[hi.k] || hi.k,
        text: 'Ticket médio: ' + types.sort(function (a, b) { return b.tk - a.tk; }).map(function (t) { return (TYPES[t.k] || t.k) + ' ' + money(t.tk); }).join(' · ') + '.',
        action: 'Leve para ' + (TYPES[lo.k] || lo.k).toLowerCase() + ' o que funciona em ' + (TYPES[hi.k] || hi.k).toLowerCase() + ': sugestão de bebida, sobremesa e borda antes de fechar o pedido.', prio: 14 });
    }
    var salon = (ins.types || []).filter(function (t) { return t.k === 'closed_table' || t.k === 'onsite'; }), sv = sum(salon, 'v');
    if (sv && cur.revenue) add({ g: 'Entrega', ic: 'store', tone: '', title: 'Salão (mesas e comandas)', value: share(sv, cur.revenue) + '% do faturamento',
      text: money(sv) + ' em ' + plural(sum(salon, 'n'), 'mesa ou comanda fechada', 'mesas ou comandas fechadas') + '.',
      action: 'Mesa não paga comissão nem entregador. Divulgue o salão para aniversários e confraternizações pelo link de reservas do app.', prio: 10 });
    // Concentração nos bairros.
    var nbs = ins.neighborhoods || [], nbTot = sum(nbs, 'v');
    if (nbs.length >= 4 && nbTot) {
      var top3 = sum(nbs.slice(0, 3), 'v');
      add({ g: 'Bairros', ic: 'mapPin', tone: '', title: 'Três bairros principais', value: share(top3, nbTot) + '% das entregas',
        text: nbs.slice(0, 3).map(function (b) { return b.name; }).join(', ') + ' concentram ' + money(top3) + '.',
        action: 'Panfleto e anúncio rendem mais onde você ainda é pouco conhecido: escolha um bairro vizinho a esses e teste por um mês.', prio: 12 });
    }
  }

  function customerInsights(add, x) {
    var r = x.r, ins = r.ins, cur = ins.cur || {};
    var fq = r.freq || [], total = sum(fq, 'c'), totV = sum(fq, 'v');
    if (total >= 20) {
      var once = fq.filter(function (q) { return q.k === '1'; })[0], oc = once ? +once.c : 0;
      add({ g: 'Base de clientes', ic: 'user', tone: share(oc, total) > 55 ? 'warn' : '', title: 'Compraram uma única vez', value: share(oc, total) + '%',
        text: 'De ' + fmt(total) + ' clientes identificados no histórico guardado, ' + fmt(oc) + ' pediram só uma vez.',
        action: 'O segundo pedido é o mais difícil. Cupom com validade curta dentro da caixa do primeiro pedido é a ação mais barata para aumentar esse retorno.',
        prio: share(oc, total) > 55 ? 44 : 14 });
      var heavy = fq.filter(function (q) { return +q.o >= 5; }), hc = sum(heavy, 'c'), hv = sum(heavy, 'v');
      if (hc) add({ g: 'Base de clientes', ic: 'flame', tone: 'ok', title: 'Clientes de 5 pedidos ou mais', value: fmt(hc),
        text: 'São ' + share(hc, total) + '% dos clientes e respondem por ' + share(hv, totV) + '% do que já foi vendido a clientes identificados.',
        action: 'Esse grupo paga as contas. Saiba quem são (lista de fiéis, acima) e trate como VIP: prioridade no pico e um mimo de vez em quando.', prio: 20 });
    }
    // Safras: tira a primeira (mistura clientes antigos) e os dois últimos meses (ainda sem tempo de voltar).
    var co = (r.cohorts || []), mk = x.to.slice(0, 7);
    var fair = co.slice(1).filter(function (c) { return c.m < Fin.addMonth(mk, -1) && +c.n >= 10; });
    if (fair.length >= 2) {
      var bc = maxBy(fair, function (c) { return +c.back / +c.n; }), wc = minBy(fair, function (c) { return +c.back / +c.n; });
      add({ g: 'Base de clientes', ic: 'refresh', tone: share(+wc.back, +wc.n) < 25 ? 'warn' : '', title: 'Safra que menos voltou', value: monthName(wc.m),
        text: 'De ' + fmt(+wc.n) + ' clientes que fizeram o 1º pedido em ' + monthName(wc.m) + ', ' + share(+wc.back, +wc.n) + '% voltaram. A melhor safra foi ' + monthName(bc.m) + ' (' + share(+bc.back, +bc.n) + '%).',
        action: 'Veja o que mudou entre esses dois meses (promoção que trouxe caçador de desconto, atraso, mudança de receita). Cliente que chega por cupom forte costuma voltar menos.',
        prio: share(+wc.back, +wc.n) < 25 ? 40 : 12,
        list: { title: 'Safras: quem voltou depois do 1º pedido', rows: co.map(function (c) { return { name: monthName(c.m) + ' de ' + c.m.slice(0, 4), meta: plural(+c.n, 'cliente novo', 'clientes novos') + ' · gasto médio ' + money(c.spent), value: share(+c.back, +c.n) + '% voltaram' }; }) } });
    }
    // Quanto do faturamento vem de quem já era cliente.
    var wk = (r.weeks || []).filter(function (w) { return addDays(w.w, 6) >= r.day_from && w.w < r.day_to; });
    var nv = sum(wk, 'nv'), rv = sum(wk, 'rv');
    if (nv + rv > 0 && ins.history_from && daysAgo(ins.history_from) > x.days + 30) {
      var rs = share(rv, nv + rv);
      add({ g: 'Base de clientes', ic: 'users', tone: rs >= 60 ? 'ok' : 'warn', title: 'Faturamento de quem já era cliente', value: rs + '%',
        text: 'Nas semanas do período, ' + money(rv) + ' vieram de clientes antigos e ' + money(nv) + ' de clientes na primeira semana de casa.',
        action: rs >= 60 ? 'A base sustenta a casa. Cada cliente novo que fica aumenta esse piso: capriche no primeiro pedido.'
          : 'Você depende de cliente novo toda semana, o que custa caro em anúncio e desconto. Invista em fazer quem já provou voltar.', prio: rs < 50 ? 42 : 12 });
    }
    if (+r.no_customer > 0 && cur.orders) {
      var np = share(+r.no_customer, cur.orders);
      if (np >= 10) add({ g: 'Base de clientes', ic: 'eye', tone: np > 30 ? 'warn' : '', title: 'Pedidos sem cliente identificado', value: np + '%',
        text: plural(+r.no_customer, 'pedido', 'pedidos') + ' do período não têm cliente cadastrado (balcão, mesa ou apps).',
        action: 'Sem cadastro, o cliente não entra em campanha nem em fidelidade. No balcão e na mesa, peça o WhatsApp para lançar o pedido no nome dele.', prio: np > 30 ? 36 : 12 });
    }
  }

  function productInsights(add, x) {
    var r = x.r, ins = r.ins, cur = ins.cur || {};
    var fl = (r.flavors || []).map(function (f) { return { name: f.name, q: +f.q, pq: +f.pq }; }), flTot = sum(fl, 'q');
    var hasPrev = sum(fl, 'pq') > 0;
    if (flTot >= 10) {
      var champ = fl[0];
      add({ g: 'Sabores', ic: 'pizza', tone: 'ok', title: 'Sabor campeão', value: champ.name,
        text: one(champ.q) + ' pizzas no período (meia pizza conta meia): ' + share(champ.q, flTot) + '% de tudo o que saiu.',
        action: 'O ingrediente desse sabor é o último que pode faltar. Negocie preço por volume com o fornecedor e use o sabor como destaque nos anúncios.', prio: 18,
        list: { title: 'Sabores do período', rows: fl.filter(function (f) { return f.q > 0; }).map(function (f) { var g = pct(f.q, f.pq); return { name: f.name, meta: share(f.q, flTot) + '% das pizzas' + (hasPrev && g != null ? ' · ' + sp(g) : ''), value: one(f.q) }; }) } });
      var top3 = sum(fl.slice(0, 3), 'q');
      if (fl.length >= 6) add({ g: 'Sabores', ic: 'pizza', tone: share(top3, flTot) > 60 ? 'warn' : '', title: 'Três sabores principais', value: share(top3, flTot) + '% das pizzas',
        text: fl.slice(0, 3).map(function (f) { return f.name; }).join(', ') + ' respondem por quase tudo isso. O cardápio tem ' + fl.filter(function (f) { return f.q > 0; }).length + ' sabores com saída.',
        action: share(top3, flTot) > 60 ? 'Cardápio muito concentrado: se um ingrediente desses subir de preço ou faltar, o impacto é grande. Tenha fornecedor reserva.'
          : 'Vendas bem espalhadas entre os sabores. Bom para o cliente, mas exige estoque variado: acompanhe as perdas.', prio: 14 });
      if (hasPrev) {
        var up = maxBy(fl.filter(function (f) { return f.q >= 5 && f.pq >= 2 && f.q > f.pq * 1.2; }), function (f) { return f.q / f.pq; });
        if (up) add({ g: 'Sabores', ic: 'flame', tone: 'ok', title: 'Sabor em alta', value: up.name,
          text: 'Foi de ' + one(up.pq) + ' para ' + one(up.q) + ' pizzas (' + sp(pct(up.q, up.pq)) + ').',
          action: 'Aproveite: foto nova no cardápio, destaque nos stories e reforço do ingrediente no estoque ideal.', prio: 24 });
        var down = maxBy(fl.filter(function (f) { return f.pq >= 5 && f.q < f.pq * 0.8; }), function (f) { return (f.pq - f.q) / f.pq; });
        if (down) add({ g: 'Sabores', ic: 'alert', tone: 'warn', title: 'Sabor em queda', value: down.name,
          text: 'Foi de ' + one(down.pq) + ' para ' + one(down.q) + ' pizzas (' + sp(pct(down.q, down.pq)) + ').',
          action: 'Prove você mesmo: mudou a receita, o fornecedor ou quem monta? Veja em Avaliações a nota desse sabor.', prio: 38 });
      }
      var tail = fl.filter(function (f) { return f.q > 0 && f.q / flTot < 0.015; }), stopped = fl.filter(function (f) { return f.q === 0 && f.pq > 0; });
      if (tail.length + stopped.length >= 2) add({ g: 'Sabores', ic: 'box', tone: 'warn', title: 'Sabores que quase não saem', value: fmt(tail.length + stopped.length),
        text: tail.length + ' sabores ficaram com menos de 1,5% das pizzas' + (stopped.length ? ' e ' + stopped.length + ' não saíram nenhuma vez' : '') + '.',
        action: 'Cada sabor parado é ingrediente vencendo na geladeira. Tire do cardápio os que usam ingrediente exclusivo ou transforme em "sabor do mês".', prio: 36,
        list: { title: 'Sabores com pouca saída', rows: stopped.concat(tail.slice().reverse()).map(function (f) { return { name: f.name, meta: f.q ? one(f.q / flTot * 100) + '% das pizzas' : 'não saiu no período (antes: ' + one(f.pq) + ')', value: one(f.q) }; }) } });
    }
    var fp = (r.flavor_pairs || [])[0];
    if (fp) add({ g: 'Sabores', ic: 'sparkle', tone: 'info', title: 'Meio a meio mais pedido', value: fp.a + ' + ' + fp.b,
      text: 'Essa dupla saiu na mesma pizza ' + plural(+fp.n, 'vez', 'vezes') + '.' + ((r.flavor_pairs || [])[1] ? ' Depois: ' + r.flavor_pairs[1].a + ' + ' + r.flavor_pairs[1].b + ' (' + r.flavor_pairs[1].n + ').' : ''),
      action: 'Dê um nome a essa dupla e ponha no cardápio como pizza da casa: facilita o pedido e vira assinatura da pizzaria.', prio: 20 });

    // Curva ABC dos itens e itens parados.
    var items = (ins.items || []).map(function (i) { return { name: i.name, q: +i.q, v: +i.v, pq: +i.pq }; });
    var sold = items.filter(function (i) { return i.v > 0; }).sort(function (a, b) { return b.v - a.v; }), itTot = sum(sold, 'v');
    if (sold.length >= 5) {
      var acc = 0, k = 0;
      while (k < sold.length && acc < itTot * 0.8) { acc += sold[k].v; k++; }
      add({ g: 'Produtos', ic: 'box', tone: '', title: 'Itens que fazem 80% do faturamento', value: k + ' de ' + sold.length,
        text: 'Os outros ' + (sold.length - k) + ' itens dividem os 20% restantes.',
        action: 'Os ' + k + ' primeiros merecem a melhor foto, a melhor posição no cardápio e nunca faltar. Os últimos da lista só valem a pena se não exigem estoque próprio.', prio: 16,
        list: { title: 'Itens por faturamento', rows: sold.map(function (i) { return { name: i.name, meta: plural(i.q, 'unidade', 'unidades') + ' · ' + one(i.v / itTot * 100) + '% do faturamento', value: money(i.v) }; }) } });
    }
    var idle = items.filter(function (i) { return i.q === 0 && i.pq >= 2; });
    if (idle.length) add({ g: 'Produtos', ic: 'alert', tone: 'warn', title: 'Itens que pararam de vender', value: fmt(idle.length),
      text: 'Venderam no período anterior e nenhuma vez neste: ' + idle.slice(0, 3).map(function (i) { return i.name; }).join(', ') + (idle.length > 3 ? '…' : '') + '.',
      action: 'Confira se o item foi pausado por engano no cardápio ou se faltou ingrediente. Item pausado não aparece para o cliente.', prio: 42,
      list: { title: 'Itens que pararam de vender', rows: idle.map(function (i) { return { name: i.name, meta: 'período anterior', value: fmt(i.pq) + ' un' }; }) } });

    var ad = r.addons || {};
    if (cur.orders && +ad.orders > 0) {
      var ap = share(+ad.orders, cur.orders), t = (ad.top || [])[0];
      add({ g: 'Produtos', ic: 'plus', tone: ap < 15 ? 'warn' : 'ok', title: 'Pedidos com adicional pago', value: ap + '%',
        text: 'Bordas e extras renderam ' + money(ad.revenue) + ' no período.' + (t ? ' O mais pedido: ' + t.name + ' (' + fmt(+t.q) + ').' : ''),
        action: ap < 15 ? 'Poucos clientes levam adicional. Ofereça a borda recheada no fechamento do pedido e treine o balcão a perguntar sempre.'
          : 'Boa venda de adicionais: é o faturamento com a melhor margem da casa. Teste um adicional novo por mês.', prio: ap < 15 ? 40 : 12 });
    } else if (cur.orders >= 30) {
      add({ g: 'Produtos', ic: 'plus', tone: 'warn', title: 'Adicionais pagos', value: 'Nenhum no período',
        text: 'Nenhum pedido levou borda recheada ou extra com preço.',
        action: 'Cadastre no cardápio bordas e extras como complementos pagos: costuma ser o dinheiro mais fácil de ganhar por pedido.', prio: 38 });
    }
  }

  function reviewInsights(add, x) {
    var r = x.r, ins = r.ins, rv = r.reviews || {}, cur = ins.cur || {};
    if (!+rv.n) {
      if (+rv.all_n) add({ g: 'Avaliações em detalhe', ic: 'message', tone: 'warn', title: 'Avaliações no período', value: 'Nenhuma',
        text: 'O histórico tem ' + fmt(+rv.all_n) + ' avaliações (nota ' + nota(rv.all_avg) + '), mas nenhuma chegou neste período.',
        action: 'Peça a avaliação: um bilhete na caixa com "Avalie seu pedido e ganhe um mimo no próximo" resolve.', prio: 40 });
      return;
    }
    var n = +rv.n, stars = rv.stars || [];
    var five = sum(stars.filter(function (s) { return s.s === 5; }), 'n'), low = sum(stars.filter(function (s) { return s.s <= 3; }), 'n');
    var pn = sum(stars, 'pn'), pfive = sum(stars.filter(function (s) { return s.s === 5; }), 'pn');
    var idx = Math.round((five - low) / n * 100);
    add({ g: 'Avaliações em detalhe', ic: 'sparkle', tone: idx >= 70 ? 'ok' : idx >= 50 ? 'warn' : 'crit', title: 'Índice de satisfação', value: (idx > 0 ? '+' : '') + idx,
      text: share(five, n) + '% de notas 5 menos ' + share(low, n) + '% de notas 3 ou menos. Vai de −100 a +100; acima de +70 é excelente.',
      action: idx >= 70 ? 'Clientes muito satisfeitos. Transforme isso em propaganda: convide quem deu nota 5 a avaliar também no Google.'
        : 'Cada nota baixa a menos sobe o índice duas vezes (sai dos detratores, entra nos satisfeitos). Ataque o motivo nº 1 das notas baixas, logo abaixo.',
      prio: idx < 50 ? 68 : idx < 70 ? 40 : 10 });
    if (cur.orders) {
      var rate = n / cur.orders * 100;
      add({ g: 'Avaliações em detalhe', ic: 'message', tone: rate < 5 ? 'warn' : '', title: 'Pedidos avaliados', value: one(rate) + '%',
        text: plural(n, 'avaliação', 'avaliações') + ' em ' + fmt(cur.orders) + ' pedidos.' + (+rv.pn ? ' No período anterior foram ' + fmt(+rv.pn) + '.' : ''),
        action: rate < 5 ? 'Pouca gente avalia, então poucas notas ruins pesam muito. Peça a avaliação na mensagem de "pedido entregue" e num bilhete na caixa.'
          : 'Boa participação. Quanto mais avaliações, mais confiável fica cada número deste relatório.', prio: rate < 5 ? 34 : 8 });
    }
    if (pn >= 5) {
      var d5 = share(five, n) - share(pfive, pn);
      add({ g: 'Avaliações em detalhe', ic: 'flame', tone: d5 >= 0 ? 'ok' : d5 <= -5 ? 'crit' : 'warn', title: 'Notas 5', value: share(five, n) + '%',
        text: (d5 === 0 ? 'Igual ao' : (d5 > 0 ? 'Subiu ' : 'Caiu ') + plural(Math.abs(d5), 'ponto', 'pontos') + ' em relação ao') + ' período anterior (' + share(pfive, pn) + '%).',
        action: d5 < 0 ? 'Menos clientes encantados. Veja no gráfico de quesitos qual nota caiu e nos comentários o que eles dizem.' : d5 > 0 ? 'Mais clientes dando nota máxima. Descubra o que melhorou e vire padrão.' : 'Mesma fatia de notas máximas. Para subir, mire no quesito mais fraco.',
        prio: d5 <= -5 ? 55 : d5 < 0 ? 30 : 8 });
    }
    // Tendência mensal (meses fechados).
    var mk = x.to.slice(0, 7), mon = (rv.monthly || []).filter(function (m) { return m.m < mk && +m.n >= 5; });
    if (mon.length >= 2) {
      var a = mon[mon.length - 1], b = mon[mon.length - 2], dd = +a.avg - +b.avg;
      add({ g: 'Avaliações em detalhe', ic: 'calendar', tone: dd <= -0.1 ? 'warn' : dd >= 0.1 ? 'ok' : '', title: 'Nota de ' + monthName(a.m), value: nota2(a.avg),
        text: monthName(b.m).replace(/^./, function (c) { return c.toUpperCase(); }) + ' teve ' + nota2(b.avg) + ' (' + fmt(+b.n) + ' avaliações); ' + monthName(a.m) + ', ' + nota2(a.avg) + ' (' + fmt(+a.n) + ').',
        action: dd <= -0.1 ? 'A nota caiu de um mês para o outro. Confira se coincidiu com troca de equipe, de fornecedor ou aumento de movimento.'
          : 'Nota estável ou subindo mês a mês. Acompanhe aqui todo começo de mês.', prio: dd <= -0.15 ? 50 : dd <= -0.1 ? 32 : 8 });
    }
    // Quesitos: o que mais caiu e o que mais subiu.
    var asp = (rv.aspects || []).filter(function (q) { return q.avg != null && q.pavg != null; }).map(function (q) { return { q: q.q, avg: +q.avg, d: +q.avg - +q.pavg, pavg: +q.pavg }; });
    var fell = minBy(asp, function (q) { return q.d; }), rose = maxBy(asp, function (q) { return q.d; });
    if (fell && fell.d <= -0.1) add({ g: 'Avaliações em detalhe', ic: 'alert', tone: 'warn', title: 'Quesito que mais caiu', value: fell.q,
      text: 'Foi de ' + nota2(fell.pavg) + ' para ' + nota2(fell.avg) + '.',
      action: /entrega|tempo/i.test(fell.q) ? 'O tempo de entrega piorou: confira se a previsão informada ao cliente está realista e se falta entregador no pico.'
        : /embala/i.test(fell.q) ? 'Embalagem: confira se mudou o fornecedor da caixa ou se a pizza está saindo sem o suporte no centro.'
        : /custo|benef|pre[cç]o/i.test(fell.q) ? 'O cliente está achando caro pelo que recebe. Antes de baixar preço, aumente a percepção: recheio visível, brinde, bilhete escrito à mão.'
        : /atend/i.test(fell.q) ? 'Atendimento: ouça algumas ligações e conversas de WhatsApp e alinhe com a equipe o tom e o tempo de resposta.'
        : 'Converse com a equipe sobre "' + fell.q + '" e acompanhe a nota nas próximas semanas.', prio: fell.d <= -0.2 ? 60 : 42 });
    if (rose && rose.d >= 0.1 && (!fell || rose.q !== fell.q)) add({ g: 'Avaliações em detalhe', ic: 'check', tone: 'ok', title: 'Quesito que mais melhorou', value: rose.q,
      text: 'Foi de ' + nota2(rose.pavg) + ' para ' + nota2(rose.avg) + '.',
      action: 'O que foi feito deu resultado. Conte para a equipe: reconhecimento mantém o padrão.', prio: 8 });
    var bestA = maxBy((rv.aspects || []).filter(function (q) { return q.avg != null; }), function (q) { return +q.avg; });
    if (bestA && (rv.aspects || []).length > 1) add({ g: 'Avaliações em detalhe', ic: 'check', tone: 'ok', title: 'Ponto mais forte', value: bestA.q,
      text: 'Nota ' + nota2(bestA.avg) + ' de 5 em ' + fmt(+bestA.n) + ' respostas.',
      action: 'Use isso na propaganda: é o que o seu cliente mais elogia, com número para provar.', prio: 6 });

    // Entrega x retirada.
    var bt = (rv.by_type || []).filter(function (t) { return +t.n >= 3; });
    if (bt.length >= 2) {
      var hi = maxBy(bt, function (t) { return +t.avg; }), lo = minBy(bt, function (t) { return +t.avg; }), gap = +hi.avg - +lo.avg;
      add({ g: 'Avaliações em detalhe', ic: 'truck', tone: gap >= 0.2 ? 'warn' : '', title: 'Nota por tipo de pedido', value: (TYPES[lo.k] || lo.k) + ': ' + nota2(lo.avg),
        text: bt.map(function (t) { return (TYPES[t.k] || t.k) + ' ' + nota2(t.avg) + ' (' + t.n + ')'; }).join(' · ') + '.',
        action: gap >= 0.2 ? (lo.k === 'delivery' ? 'A pizza sai boa da loja e perde nota no caminho: bag térmica, rota mais curta e menos pedidos por viagem.' : 'A nota mais baixa está em ' + (TYPES[lo.k] || lo.k).toLowerCase() + ': acompanhe um pedido desses do começo ao fim para achar o problema.')
          : 'A experiência é parecida em todos os tipos de pedido.', prio: gap >= 0.3 ? 46 : gap >= 0.2 ? 30 : 6 });
    }
    // Pico x fora do pico.
    var hrs = (ins.hours || []).slice().sort(function (a, b) { return +b.n - +a.n; }).slice(0, 2).map(function (h) { return h.h; });
    var bh = rv.by_hour || [], pk = bh.filter(function (h) { return hrs.indexOf(h.h) >= 0; }), off = bh.filter(function (h) { return hrs.indexOf(h.h) < 0; });
    var pkN = sum(pk, 'n'), offN = sum(off, 'n');
    if (pkN >= 5 && offN >= 5) {
      var pa = sum(pk, function (h) { return +h.avg * +h.n; }) / pkN, oa = sum(off, function (h) { return +h.avg * +h.n; }) / offN, g2 = pa - oa;
      add({ g: 'Avaliações em detalhe', ic: 'clock', tone: g2 <= -0.15 ? 'warn' : 'ok', title: 'Nota no horário de pico', value: nota2(pa),
        text: 'Pedidos feitos às ' + hrs.sort(function (a, b) { return a - b; }).map(function (h) { return h + 'h'; }).join(' e ') + ' têm nota ' + nota2(pa) + '; nos outros horários, ' + nota2(oa) + '.',
        action: g2 <= -0.15 ? 'O pico derruba a nota: a cozinha não está dando conta. Pré-preparo antes das ' + Math.min.apply(null, hrs) + 'h, uma pessoa a mais na montagem ou previsão de entrega maior nessas horas.'
          : 'A qualidade se mantém mesmo com a casa cheia. Sinal de que dá para vender mais no pico.', prio: g2 <= -0.25 ? 56 : g2 <= -0.15 ? 40 : 8 });
    }
    // Dia da semana com a pior nota.
    var bd = (rv.by_dow || []).filter(function (d) { return +d.n >= 3; });
    if (bd.length >= 3) {
      var wd = minBy(bd, function (d) { return +d.avg; }), bdx = maxBy(bd, function (d) { return +d.avg; });
      if (+bdx.avg - +wd.avg >= 0.15) add({ g: 'Avaliações em detalhe', ic: 'calendar', tone: 'warn', title: 'Dia com a pior nota', value: DB.WEEK[wd.d],
        text: 'Nota ' + nota2(wd.avg) + ' em ' + wd.n + ' avaliações; o melhor dia é ' + DB.WEEK[bdx.d].toLowerCase() + ' (' + nota2(bdx.avg) + ').',
        action: 'Veja quem trabalha nesse dia e como fica a escala. Muitas vezes é o dia da folga de quem mais sabe.', prio: 34 });
    }
    var nb = (rv.by_nb || [])[0];
    if (nb && +nb.avg <= +rv.avg - 0.15) add({ g: 'Avaliações em detalhe', ic: 'mapPin', tone: 'warn', title: 'Bairro com a pior nota', value: nb.name,
      text: 'Nota ' + nota2(nb.avg) + ' em ' + nb.n + ' avaliações, contra ' + nota2(rv.avg) + ' no geral.',
      action: 'Bairro distante costuma receber pizza morna. Teste sair com ele primeiro na rota ou aumente a previsão de entrega para lá.', prio: 36,
      list: { title: 'Bairros com as notas mais baixas', rows: (rv.by_nb || []).map(function (b) { return { name: b.name, meta: plural(+b.n, 'avaliação', 'avaliações'), value: nota2(b.avg) }; }) } });
    // Sabores: o pior e o melhor avaliados (histórico).
    var rf = rv.flavors || [];
    if (rf.length >= 3 && +rf[rf.length - 1].avg - +rf[0].avg >= 0.15) {
      var wf = rf[0], bf = rf[rf.length - 1];
      add({ g: 'Avaliações em detalhe', ic: 'pizza', tone: 'warn', title: 'Sabor com a pior nota', value: wf.name,
        text: 'Pedidos com esse sabor têm nota ' + nota2(wf.avg) + ' (' + wf.n + ' avaliações no histórico). O mais bem avaliado é ' + bf.name + ' (' + nota2(bf.avg) + ').',
        action: 'Prove esse sabor como o cliente recebe: depois de 20 minutos na caixa. Ajuste a receita ou o ponto e veja a nota em 30 dias.', prio: 38,
        list: { title: 'Nota dos pedidos por sabor (histórico)', rows: rf.map(function (f) { return { name: f.name, meta: plural(+f.n, 'avaliação', 'avaliações'), value: nota2(f.avg) }; }) } });
    }
    var lb = rv.low_back || {};
    if (+lb.n >= 3) {
      var bp = share(+lb.back, +lb.n);
      add({ g: 'Avaliações em detalhe', ic: 'refresh', tone: bp < 40 ? 'crit' : bp < 60 ? 'warn' : 'ok', title: 'Voltaram depois de uma nota baixa', value: bp + '%',
        text: 'De ' + plural(+lb.n, 'cliente que deu', 'clientes que deram') + ' nota 3 ou menos, ' + fmt(+lb.back) + ' pediram de novo depois.',
        action: bp < 60 ? 'Nota baixa sem resposta vira cliente perdido. Responda em até um dia, peça desculpas e mande um cupom: quem é bem tratado depois do erro costuma ficar.'
          : 'A maioria dá uma segunda chance. Continue respondendo cada nota baixa.', prio: bp < 40 ? 58 : bp < 60 ? 38 : 8 });
    }
    // Motivo nº 1 das notas baixas.
    var ll = rv.low_list || [];
    if (ll.length >= 2) {
      var tally = {};
      ll.forEach(function (l) { if (l.worst) tally[l.worst] = (tally[l.worst] || 0) + 1; });
      var top = maxBy(Object.keys(tally), function (k) { return tally[k]; });
      if (top) add({ g: 'Avaliações em detalhe', ic: 'alert', tone: 'crit', title: 'Motivo nº 1 das notas baixas', value: top,
        text: 'Foi o pior quesito em ' + tally[top] + ' das ' + ll.length + ' últimas avaliações com nota 3 ou menos.',
        action: 'Resolver esse único ponto tira boa parte das notas baixas. Leia os comentários na lista e defina uma ação com a equipe ainda esta semana.', prio: 62,
        list: { title: 'Últimas notas baixas', rows: ll.map(function (l) { return { name: l.comment ? '"' + l.comment + '"' : 'Sem comentário', meta: (l.name || 'Cliente') + ' · ' + (TYPES[l.otype] || 'Pedido') + ' · há ' + plural(daysAgo(l.created_at), 'dia', 'dias') + (l.worst ? ' · pior: ' + l.worst : ''), value: nota(l.rating) }; }) } });
    }
    var rc = rv.recent || [];
    if (+rv.commented || rc.length) add({ g: 'Avaliações em detalhe', ic: 'message', tone: '', title: 'Avaliações com comentário', value: share(+rv.commented, n) + '%',
      text: plural(+rv.commented, 'cliente escreveu', 'clientes escreveram') + ' alguma coisa além da nota.',
      action: 'Comentário é pesquisa de graça. Leia todos uma vez por semana e use os elogios (com autorização) nas redes.', prio: 10,
      list: { title: 'Comentários recentes', rows: rc.map(function (c) { return { name: '"' + c.comment + '"', meta: (c.name || 'Cliente') + ' · há ' + plural(daysAgo(c.created_at), 'dia', 'dias'), value: nota(c.rating) }; }) } });
  }

  // Google: usa a nota buscada agora (se a chave estiver ligada) ou o último registro feito à mão.
  function googleNow(g) {
    var live = g && g.live, log = (g && g.log) || [];
    if (live && live.rating != null) return { rating: +live.rating, count: +live.count || 0, src: 'live' };
    var last = log[log.length - 1];
    return last ? { rating: +last.rating, count: +last.count || 0, src: 'log', d: last.d } : null;
  }

  function googleInsights(add, x) {
    var g = x.google || {}, now = googleNow(g), rv = (x.r && x.r.reviews) || {}, cur = (x.r && x.r.ins && x.r.ins.cur) || {};
    if (!now) return;
    var R = now.rating, N = now.count, src = now.src === 'live' ? 'Consultado agora no Google.' : 'Seu registro de ' + dm(now.d) + '.';
    add({ g: 'Google', ic: 'star', tone: R >= 4.6 ? 'ok' : R >= 4.2 ? 'warn' : 'crit', title: 'Nota no Google', value: nota(R) + ' de 5',
      text: 'Com ' + plural(N, 'avaliação', 'avaliações') + '. ' + src,
      action: R >= 4.6 ? 'Nota de quem lidera na região. Ponha a nota e o número de avaliações nos anúncios e no perfil do Instagram.'
        : R >= 4.2 ? 'Nota boa, mas abaixo de 4,6 o cliente novo ainda compara com o vizinho. O caminho é volume de notas 5: peça a quem já elogiou.'
        : 'Abaixo de 4,2 muita gente nem abre o cardápio. Responda todas as avaliações ruins e faça uma campanha para os clientes fiéis avaliarem.',
      prio: R < 4.2 ? 74 : R < 4.6 ? 44 : 10 });
    add({ g: 'Google', ic: 'users', tone: N < 100 ? 'warn' : '', title: 'Avaliações no Google', value: fmt(N),
      text: (+rv.all_n ? 'Na Cardápio Web são ' + fmt(+rv.all_n) + ' avaliações guardadas. ' : '') + (cur.customers ? fmt(cur.customers) + ' clientes pediram só neste período: cada um é uma avaliação em potencial.' : 'Quanto mais avaliações, mais a nota resiste a uma crítica isolada e melhor a pizzaria aparece nas buscas.'),
      action: 'Imprima um QR Code do link "Avaliar no Google" (botão acima) e cole na tampa da caixa. Quem ganha a pizza quente e bonita avalia na hora.',
      prio: N < 50 ? 46 : N < 100 ? 30 : 12 });
    if (R < 4.95 && N > 0) {
      // Quantas notas 5 seguidas para o número mostrado subir um décimo (o Google arredonda para uma casa).
      var target = Math.round(R * 10) / 10 + 0.1, need = target - 0.05, k = Math.ceil(N * (need - R) / (5 - need));
      if (target <= 5 && k > 0) add({ g: 'Google', ic: 'flame', tone: 'info', title: 'Para chegar a ' + nota(target), value: plural(k, 'nota 5', 'notas 5'),
        text: 'É quantas avaliações 5 estrelas seguidas faltam, mais ou menos, para a nota mostrada subir de ' + nota(R) + ' para ' + nota(target) + '.',
        action: 'Meta para a equipe: ' + Math.ceil(k / 4) + ' avaliações 5 estrelas por semana fecham isso em um mês. Combine um prêmio quando a nota virar.', prio: 28 });
      var cost = Math.round((R - 1) / (5 - R));
      if (cost >= 2) add({ g: 'Google', ic: 'alert', tone: 'warn', title: 'O peso de uma nota 1', value: cost + ' notas 5',
        text: 'Com a média em ' + nota(R) + ', cada avaliação de 1 estrela precisa de cerca de ' + cost + ' avaliações de 5 estrelas para a média voltar ao lugar.',
        action: 'Por isso vale resolver o problema antes de virar avaliação: ligue para o cliente que reclamou no mesmo dia e compense.', prio: 26 });
    }
    if (+rv.avg || +rv.all_avg) {
      var cw = +rv.avg || +rv.all_avg, df = R - cw;
      add({ g: 'Google', ic: 'message', tone: Math.abs(df) < 0.2 ? '' : 'warn', title: 'Google x Cardápio Web', value: (df >= 0 ? '+' : '−') + nota2(Math.abs(df)),
        text: 'Google: ' + nota(R) + '. Cardápio Web: ' + nota2(cw) + ' (' + (+rv.avg ? 'no período' : 'no histórico') + ').',
        action: df <= -0.2 ? 'Quem pede e avalia no cardápio gosta mais do que o Google mostra. No Google pesa quem teve problema: leve os clientes satisfeitos para lá.'
          : df >= 0.2 ? 'O Google está melhor que a avaliação de quem pede. Cuidado: a nota do cardápio antecipa o que o Google vai mostrar daqui a alguns meses.'
          : 'As duas notas contam a mesma história. Bom sinal de que são confiáveis.', prio: df <= -0.3 ? 40 : 12 });
    }
    var fr = (g.live && g.live.reviews) || [];
    if (fr.length) {
      var bad = fr.filter(function (v) { return +v.rating <= 3; });
      add({ g: 'Google', ic: 'eye', tone: bad.length ? 'crit' : 'ok', title: 'Avaliações em destaque', value: bad.length ? bad.length + ' de ' + fr.length + ' com nota baixa' : 'Todas positivas',
        text: 'São as avaliações que o Google mostra primeiro para quem procura a pizzaria.',
        action: bad.length ? 'Avaliação ruim em destaque espanta cliente novo todo dia. Responda com educação, explique o que foi corrigido e peça avaliações novas: as recentes empurram as antigas para baixo.'
          : 'Vitrine limpa. Responda agradecendo: resposta do dono também conta para o Google.', prio: bad.length ? 64 : 8 });
      var newest = minBy(fr.filter(function (v) { return v.time; }), function (v) { return daysAgo(v.time); });
      if (newest && daysAgo(newest.time) > 60) add({ g: 'Google', ic: 'calendar', tone: 'warn', title: 'Avaliação em destaque mais recente', value: 'há ' + plural(Math.round(daysAgo(newest.time) / 30), 'mês', 'meses'),
        text: 'Nenhuma das avaliações em destaque é dos últimos dois meses.',
        action: 'Avaliação antiga passa a impressão de casa parada. Peça avaliações com foto: o Google costuma destacá-las.', prio: 32 });
    }
    var log = g.log || [];
    if (log.length >= 2) {
      var a = log[0], b = log[log.length - 1], span = Math.max(1, Math.round((day(b.d) - day(a.d)) / 86400000));
      var gain = (+b.count - +a.count) / span * 30, dr = +b.rating - +a.rating;
      add({ g: 'Google', ic: 'calendar', tone: gain < 4 ? 'warn' : 'ok', title: 'Ritmo de avaliações novas', value: one(gain) + ' por mês',
        text: 'De ' + dm(a.d) + ' a ' + dm(b.d) + ', foram de ' + fmt(+a.count) + ' para ' + fmt(+b.count) + ' avaliações e a nota ' + (dr > 0.04 ? 'subiu de ' + nota(a.rating) + ' para ' + nota(b.rating) : dr < -0.04 ? 'caiu de ' + nota(a.rating) + ' para ' + nota(b.rating) : 'ficou em ' + nota(b.rating)) + '.' +
          (x.r && cur.orders && gain > 0 ? ' Dá 1 avaliação a cada ' + fmt(Math.round(cur.orders / x.days * 30 / gain)) + ' pedidos.' : ''),
        action: gain < 4 ? 'Menos de uma avaliação por semana. O QR Code na caixa e um pedido direto no WhatsApp ("gostou? avalia a gente no Google") mudam esse ritmo.'
          : 'Bom ritmo. Continue registrando aqui uma vez por mês para acompanhar.', prio: gain < 4 ? 36 : 8 });
    }
  }

  function financeInsights(add, x) {
    var f = x.fin;
    if (!f || !f.ready) return;
    var mName = monthName(f.key);
    if (f.empty) {
      add({ g: 'Financeiro', ic: 'tag', tone: 'warn', title: 'Custos ainda não cadastrados', value: 'Sem meta nem lucro',
        text: 'Sem os custos fixos, a folha e as metas, o app não consegue dizer quanto precisa vender nem quanto sobra.',
        action: 'Abra Financeiro › Custos e metas e preencha uma vez. Leva dez minutos e destrava todas as leituras desta área.', prio: 66, href: '#financeiro/custos' });
      return;
    }
    var r = f.r, p = f.proj || r, pct1 = CMV.fmtPct;
    if (r.goal) {
      var pr = r.progress || 0, pace = f.di.current ? f.di.day / f.di.days : 1;
      add({ g: 'Financeiro', ic: 'flame', tone: pr >= pace ? 'ok' : pr >= pace * 0.85 ? 'warn' : 'crit', title: 'Meta de ' + mName, value: pct1(pr),
        text: money(r.revenue) + ' de ' + money(r.goal) + '.' + (f.di.current ? ' O mês está em ' + Math.round(pace * 100) + '% dos dias.' : ''),
        action: pr >= pace ? 'Vendas à frente do calendário. Não alivie: os últimos dias do mês costumam ser mais fracos.'
          : 'Vendas atrás do calendário. Faltam ' + money(Math.max(0, r.goal - r.revenue)) + (r.perDay ? ': ' + money(r.perDay) + ' por dia até o fim do mês.' : '.'),
        prio: pr < pace * 0.85 ? 70 : pr < pace ? 46 : 12 });
    }
    if (f.di.current && r.projection != null && r.goal) {
      var gap = r.projection - r.goal;
      add({ g: 'Financeiro', ic: 'calendar', tone: gap >= 0 ? 'ok' : 'warn', title: 'Projeção x meta', value: (gap >= 0 ? 'Sobram ' : 'Faltam ') + money(Math.abs(gap)),
        text: 'No ritmo de hoje o mês fecha em ' + money(r.projection) + '; a meta é ' + money(r.goal) + '.',
        action: gap >= 0 ? 'A meta está no caminho. Decida desde já o que fazer com a sobra: reserva, equipamento ou marketing.'
          : 'Para fechar a conta: ' + (r.ticket ? 'cerca de ' + fmt(Math.ceil(-gap / r.ticket)) + ' pedidos a mais no mês, ou ' : '') + 'um aumento de ' + one(-gap / r.projection * 100) + '% no ticket médio.', prio: gap < 0 ? 52 : 10 });
    }
    if (r.breakEven) {
      var be = r.revenue >= r.breakEven;
      add({ g: 'Financeiro', ic: 'shield', tone: be ? 'ok' : p.revenue >= r.breakEven ? 'warn' : 'crit', title: 'Ponto de equilíbrio', value: be ? 'Já passou' : 'Faltam ' + money(r.breakEven - r.revenue),
        text: 'O mês só deixa de dar prejuízo a partir de ' + money(r.breakEven) + ' de faturamento.' + (be ? ' O que entrar agora já é margem.' : f.di.current && r.projection != null ? ' Pela projeção (' + money(r.projection) + '), ' + (r.projection >= r.breakEven ? 'passa.' : 'não passa.') : ''),
        action: be ? 'Custos do mês pagos. Daqui para frente, cada R$ 100 vendidos deixam ' + money(100 * r.margin) + ' de margem.'
          : 'Até lá, segure gastos que podem esperar e foque em volume nos dias fortes.', prio: !be && p.revenue < r.breakEven ? 78 : !be ? 40 : 8 });
    }
    if (p.revenue > 0) {
      add({ g: 'Financeiro', ic: 'receipt', tone: p.profit >= p.profitGoal ? 'ok' : p.profit > 0 ? 'warn' : 'crit', title: f.proj ? 'Lucro projetado do mês' : 'Lucro do mês', value: money(p.profit),
        text: 'Depois de CMV, custos variáveis, folha, custos fixos, marketing e reserva. A meta de lucro é ' + money(p.profitGoal) + ' (' + pct1(f.cfg.metas.lucro) + ' do faturamento).',
        action: p.profit >= p.profitGoal ? 'Lucro na meta. Retire o planejado e deixe a reserva crescer.'
          : p.profit > 0 ? 'Dá lucro, mas abaixo da meta. As duas alavancas mais rápidas: CMV (porcionamento e desperdício) e ticket médio (adicionais e combos).'
          : 'No ritmo atual o mês não deixa lucro. Não faça retirada e veja em Financeiro qual linha mais pesa.', prio: p.profit <= 0 ? 76 : p.profit < p.profitGoal ? 48 : 10 });
      var fp = p.folha.total / p.revenue;
      if (p.folha.total > 0) add({ g: 'Financeiro', ic: 'users', tone: fp > 0.3 ? 'warn' : '', title: 'Folha sobre o faturamento', value: pct1(fp),
        text: money(p.folha.total) + ' de folha (' + p.folha.n + ' pessoas, com encargos e benefícios) sobre ' + money(p.revenue) + (f.proj ? ' projetados.' : '.'),
        action: fp > 0.3 ? 'Acima de 30% a folha aperta o lucro. Antes de cortar, veja em Equipe quanto cada hora trabalhada fatura e ajuste a escala aos dias fracos.'
          : 'Folha dentro do saudável para pizzaria (até 30%).', prio: fp > 0.35 ? 50 : fp > 0.3 ? 34 : 8 });
      add({ g: 'Financeiro', ic: 'pizza', tone: p.cmvPct > 0.36 ? 'warn' : '', title: 'CMV usado na conta', value: pct1(p.cmvPct),
        text: 'Ingredientes e embalagens: ' + money(p.cmv) + '. Origem: ' + f.cmvLabel + '.',
        action: p.cmvPct > 0.36 ? 'CMV alto para pizzaria (o comum é 28% a 35%). Veja na Ficha técnica quais itens passam do máximo e pese as porções por uma semana.'
          : 'CMV dentro da faixa comum de pizzaria (28% a 35%). Confira com as compras reais em Operação.', prio: p.cmvPct > 0.4 ? 54 : p.cmvPct > 0.36 ? 36 : 8 });
      add({ g: 'Financeiro', ic: 'tag', tone: 'info', title: 'O que sobra de cada R$ 100 vendidos', value: money(100 * p.margin),
        text: 'É a margem de contribuição: o que fica depois de ingredientes, impostos, taxas e comissões, para pagar os custos fixos e o lucro.',
        action: 'Use esse número para avaliar promoção: um desconto de 10% tira R$ 10 desses ' + money(100 * p.margin) + ', não dos R$ 100.', prio: 14 });
    }
    if (r.fixed) add({ g: 'Financeiro', ic: 'store', tone: '', title: 'Custo de abrir as portas', value: money(r.fixed / f.di.days) + ' por dia',
      text: 'Custos fixos e folha somam ' + money(r.fixed) + ' no mês, vendendo ou não.' + (r.margin > 0 ? ' Cada dia precisa de ' + money(r.fixed / f.di.days / r.margin) + ' em vendas só para empatar.' : ''),
      action: 'Compare com a média por dia aberto, em Vendas. Dia que não alcança esse valor está sendo pago pelos outros.', prio: 16 });
    if (f.di.current && r.perDay != null && r.goal && r.revenue < r.goal) {
      var avg = f.di.day > 1 ? r.revenue / f.di.day : null;
      add({ g: 'Financeiro', ic: 'clock', tone: avg != null && r.perDay > avg * 1.15 ? 'warn' : '', title: 'Vender por dia até o fim do mês', value: money(r.perDay),
        text: 'Nos ' + r.daysLeft + ' dias que faltam (contando hoje).' + (avg != null ? ' Até agora a média foi ' + money(avg) + ' por dia.' : '') + (r.ordersPerDay && r.ticket ? ' São cerca de ' + Math.ceil(r.perDay / r.ticket) + ' pedidos por dia.' : ''),
        action: avg != null && r.perDay > avg * 1.15 ? 'Precisa vender ' + one((r.perDay / avg - 1) * 100) + '% acima do ritmo atual. Programe duas ações fortes: uma nesta semana e outra na última sexta do mês.'
          : 'No ritmo atual a meta sai. Mantenha.', prio: avg != null && r.perDay > avg * 1.3 ? 50 : 14 });
    }
    if (p.marketing > 0) add({ g: 'Financeiro', ic: 'sparkle', tone: '', title: 'Verba de marketing do mês', value: money(p.marketing),
      text: pct1(f.cfg.metas.marketing) + ' do faturamento' + (f.proj ? ' projetado' : '') + '. A reserva do mês fica em ' + money(p.reserva) + '.',
      action: 'Divida a verba: metade para trazer cliente novo (anúncio por bairro) e metade para fazer voltar (cupons e brindes para clientes em risco).', prio: 10 });
  }

  // Ponto da equipe no período (e no anterior, para comparar).
  function teamData(x) {
    var d = x.d, emps = d.employees.filter(function (e) { return e.active !== false && e.role !== 'contador' && e.ponto !== false; });
    var pf = addDays(x.from, -x.days), pt = addDays(x.from, -1), rows = [], prevWorked = 0;
    var firstPunch = (d.punches || []).reduce(function (m, p) { return m == null || p.ts < m ? p.ts : m; }, null);
    var covered = firstPunch != null && DB.iso(new Date(firstPunch)) <= pf; // o ponto já era batido no app no período anterior inteiro
    emps.forEach(function (e) {
      var s = Ponto.summary(e.id, x.from, x.to), bank = Ponto.bankTotal(e.id);
      if (covered) prevWorked += Ponto.summary(e.id, pf, pt).worked;
      rows.push({ e: e, name: e.name, worked: s.worked, days: s.days, late: s.late, lateCount: s.lateCount, missing: s.missing, bank: bank });
    });
    return { emps: emps, rows: rows, worked: sum(rows, 'worked'), prevWorked: prevWorked };
  }

  function teamInsights(add, x) {
    var d = x.d, t = x.team, cur = (x.r && x.r.ins && x.r.ins.cur) || {}, prev = (x.r && x.r.ins && x.r.ins.prev) || {};
    var all = d.employees.filter(function (e) { return e.active !== false && e.role !== 'contador'; });
    if (all.length) {
      var funcs = {};
      all.forEach(function (e) { var f = e.func || 'Sem função'; funcs[f] = (funcs[f] || 0) + 1; });
      add({ g: 'Equipe', ic: 'users', tone: '', title: 'Equipe ativa', value: plural(all.length, 'pessoa', 'pessoas'),
        text: Object.keys(funcs).sort(function (a, b) { return funcs[b] - funcs[a]; }).map(function (f) { return funcs[f] + ' ' + f.toLowerCase(); }).join(', ') + '.',
        action: 'Confira se há substituto treinado para cada função com uma pessoa só: é onde uma falta para a casa.', prio: 8 });
    }
    if (t.worked > 0) {
      var withHours = t.rows.filter(function (r) { return r.worked > 0; });
      add({ g: 'Equipe', ic: 'clock', tone: '', title: 'Horas trabalhadas', value: hours(t.worked),
        text: plural(withHours.length, 'pessoa bateu', 'pessoas bateram') + ' ponto no período, em ' + fmt(sum(withHours, 'days')) + ' jornadas.' + (t.prevWorked ? ' No período anterior: ' + hours(t.prevWorked) + ' (' + sp(pct(t.worked, t.prevWorked)) + ').' : ''),
        action: 'Compare com as vendas: horas subindo mais que o faturamento é sinal de escala folgada nos dias fracos.', prio: 10 });
      if (cur.revenue) {
        var rph = cur.revenue / (t.worked / 60), prph = t.prevWorked && prev.revenue ? prev.revenue / (t.prevWorked / 60) : null, g = prph ? pct(rph, prph) : null;
        add({ g: 'Equipe', ic: 'receipt', tone: g != null && g <= -8 ? 'warn' : g != null && g >= 5 ? 'ok' : 'info', title: 'Faturamento por hora trabalhada', value: money(rph),
          text: 'Cada hora de equipe trouxe ' + money(rph) + ' em vendas' + (g != null ? ' (' + sp(g) + ' em relação ao período anterior, ' + money(prph) + ').' : '.'),
          action: g != null && g <= -8 ? 'A equipe está rendendo menos por hora: ou caiu a venda, ou sobrou gente na escala. Veja no mapa de dia x hora (Vendas) onde dá para enxugar.'
            : 'É o melhor termômetro de produtividade da casa. Acompanhe mês a mês antes de contratar ou cortar.', prio: g != null && g <= -8 ? 44 : 14 });
        add({ g: 'Equipe', ic: 'cart', tone: '', title: 'Pedidos por hora trabalhada', value: one(cur.orders / (t.worked / 60)),
          text: fmt(cur.orders) + ' pedidos em ' + hours(t.worked) + ' de equipe.',
          action: 'No pico esse número dobra ou triplica: é a referência para saber quantas pessoas a noite de sexta realmente pede.', prio: 8 });
      }
      var jor = sum(withHours, 'days'), lates = sum(t.rows, 'lateCount');
      if (jor) {
        var onTime = share(jor - lates, jor), worst = maxBy(t.rows.filter(function (r) { return r.lateCount > 0; }), function (r) { return r.lateCount; });
        add({ g: 'Equipe', ic: 'clock', tone: onTime < 85 ? 'warn' : 'ok', title: 'Pontualidade', value: onTime + '%',
          text: lates ? plural(lates, 'atraso', 'atrasos') + ' (mais de ' + Ponto.TOLERANCE + ' min) somando ' + Ponto.dur(sum(t.rows, 'late')) + '.' + (worst ? ' Quem mais atrasou: ' + first(worst.name) + ' (' + worst.lateCount + ').' : '') : 'Nenhum atraso acima da tolerância no período.',
          action: onTime < 85 ? 'Atraso na abertura vira atraso no primeiro pedido. Converse em particular com quem repete e ajuste o horário se o problema for transporte.'
            : 'Equipe pontual. Vale um elogio na reunião.', prio: onTime < 75 ? 46 : onTime < 85 ? 32 : 6,
          list: lates ? { title: 'Atrasos no período', rows: t.rows.filter(function (r) { return r.lateCount > 0; }).sort(function (a, b) { return b.lateCount - a.lateCount; }).map(function (r) { return { name: r.name, meta: 'somando ' + Ponto.dur(r.late) + ' · ' + r.days + ' jornadas', value: plural(r.lateCount, 'atraso', 'atrasos') }; }) } : null });
      }
    }
    var owed = sum(t.rows.filter(function (r) { return r.bank > 0; }), 'bank'), debt = sum(t.rows.filter(function (r) { return r.bank < 0; }), 'bank');
    if (owed > 60 || debt < -60) add({ g: 'Equipe', ic: 'clock', tone: owed > 40 * 60 ? 'warn' : '', title: 'Banco de horas', value: owed > 0 ? Ponto.dur(owed) + ' a favor da equipe' : Ponto.dur(debt) + ' devidos',
      text: 'A empresa deve ' + Ponto.dur(owed) + ' de horas extras acumuladas' + (debt < 0 ? '; a equipe deve ' + Ponto.dur(debt) : '') + '.',
      action: owed > 40 * 60 ? 'Banco alto vira custo ou passivo trabalhista. Programe folgas compensatórias nos dias fracos antes de o saldo crescer mais.' : 'Banco de horas sob controle. Compense em folga nos dias de menor movimento.',
      prio: owed > 80 * 60 ? 48 : owed > 40 * 60 ? 34 : 10,
      list: { title: 'Banco de horas por pessoa', rows: t.rows.filter(function (r) { return Math.abs(r.bank) >= 1; }).sort(function (a, b) { return b.bank - a.bank; }).map(function (r) { return { name: r.name, meta: r.bank > 0 ? 'a empresa deve' : 'a pessoa deve', value: Ponto.signed(r.bank) }; }) } });
    var miss = sum(t.rows, 'missing');
    if (miss) add({ g: 'Equipe', ic: 'alert', tone: 'warn', title: 'Jornadas sem saída', value: fmt(miss),
      text: 'Dias em que a pessoa bateu a entrada e não registrou a saída: as horas desses dias ficam erradas.',
      action: 'Corrija em Ponto › Equipe antes de fechar o mês com a contabilidade.', prio: 40, href: '#ponto/equipe',
      list: { title: 'Jornadas sem saída', rows: t.rows.filter(function (r) { return r.missing; }).map(function (r) { return { name: r.name, meta: 'no período', value: fmt(r.missing) }; }) } });
    var pend = (d.adjusts || []).filter(function (a) { return a.status === 'pendente'; }).length;
    if (pend) add({ g: 'Equipe', ic: 'checklist', tone: 'warn', title: 'Ajustes de ponto esperando resposta', value: fmt(pend),
      text: 'Pedidos de correção feitos pela equipe e ainda não aprovados nem recusados.',
      action: 'Responda em Ponto › Equipe. Pedido parado gera desconfiança e atrasa o fechamento da folha.', prio: 36, href: '#ponto/equipe' });
    var today = DB.iso(new Date()), soon = addDays(today, 30), vac = [];
    all.forEach(function (e) { Ponto.vacations(e.id).forEach(function (v) { if (v.to >= today && v.from <= soon) vac.push({ e: e, v: v }); }); });
    if (vac.length) add({ g: 'Equipe', ic: 'sun', tone: 'info', title: 'Férias nos próximos 30 dias', value: plural(vac.length, 'pessoa', 'pessoas'),
      text: vac.map(function (q) { return first(q.e.name) + ' (' + dm(q.v.from) + ' a ' + dm(q.v.to) + ')'; }).join(', ') + '.',
      action: 'Confira quem cobre cada função nesses dias, principalmente nos fins de semana.', prio: 24 });
    var at = (x.r && x.r.attendants) || [];
    if (at.length) {
      var top = at[0], rest = at.slice(1), rn = sum(rest, 'n');
      add({ g: 'Equipe', ic: 'user', tone: 'info', title: 'Quem mais lançou pedidos', value: top.name,
        text: plural(+top.n, 'pedido', 'pedidos') + ' no balcão, telefone e WhatsApp, ticket médio de ' + money(+top.v / +top.n) + '.' + (rn ? ' Os demais: ' + fmt(rn) + ' pedidos, ticket de ' + money(sum(rest, 'v') / rn) + '.' : ''),
        action: 'Compare o ticket médio entre atendentes: quem vende mais por pedido sabe oferecer. Peça para ensinar a técnica aos outros.', prio: 12,
        list: { title: 'Pedidos lançados por atendente', rows: at.map(function (a) { return { name: a.name, meta: plural(+a.n, 'pedido', 'pedidos') + ' · ticket ' + money(+a.v / +a.n), value: money(a.v) }; }) } });
    }
  }

  // Checklists do período: quantas tarefas previstas foram feitas, por rotina.
  function checkData(x) {
    var by = {}, runs = 0, done = 0, total = 0, open = 0;
    (x.d.checkHistory || []).forEach(function (h) {
      if (!h.date || h.date < x.from || h.date > x.to || !h.total) return;
      var n = Math.min(h.total, Object.keys(h.done || {}).filter(function (k) { return h.done[k]; }).length);
      var b = by[h.name] = by[h.name] || { name: h.name, runs: 0, done: 0, total: 0, open: 0 };
      b.runs++; b.done += n; b.total += h.total; if (!h.finishedAt) { b.open++; open++; }
      runs++; done += n; total += h.total;
    });
    return { rows: Object.keys(by).map(function (k) { return by[k]; }), runs: runs, done: done, total: total, open: open };
  }

  function opsInsights(add, x) {
    var d = x.d, ck = x.checks, cur = (x.r && x.r.ins && x.r.ins.cur) || {};
    if (ck.total) {
      var rate = share(ck.done, ck.total);
      add({ g: 'Checklists', ic: 'checklist', tone: rate >= 90 ? 'ok' : rate >= 75 ? 'warn' : 'crit', title: 'Tarefas de checklist feitas', value: rate + '%',
        text: fmt(ck.done) + ' de ' + fmt(ck.total) + ' tarefas em ' + plural(ck.runs, 'checklist iniciado', 'checklists iniciados') + ' no período. Dias em que ninguém abriu o checklist não entram na conta.',
        action: rate >= 90 ? 'Rotina em dia. Revise de vez em quando se as tarefas ainda fazem sentido: checklist longo demais vira "marcar tudo".'
          : 'Tarefa não feita hoje é problema amanhã (geladeira fora da temperatura, falta de massa). Veja abaixo qual rotina mais falha.', prio: rate < 75 ? 52 : rate < 90 ? 34 : 6 });
      var weak = minBy(ck.rows.filter(function (r) { return r.runs >= 3; }), function (r) { return r.done / r.total; });
      if (weak && weak.done / weak.total < 0.9 && ck.rows.length > 1) add({ g: 'Checklists', ic: 'alert', tone: 'warn', title: 'Checklist mais esquecido', value: weak.name,
        text: share(weak.done, weak.total) + '% das tarefas feitas em ' + weak.runs + ' dias.',
        action: 'Veja com a equipe o que atrapalha: horário ruim, tarefa demorada ou falta de material. Se precisar, divida a rotina em duas.', prio: 38 });
      if (ck.open) add({ g: 'Checklists', ic: 'clock', tone: ck.open > ck.runs * 0.2 ? 'warn' : '', title: 'Checklists não finalizados', value: fmt(ck.open),
        text: 'Foram começados e ficaram sem o "finalizar" em ' + ck.open + ' de ' + ck.runs + ' vezes.',
        action: 'Finalizar é o que avisa o gerente das pendências. Combine que o último a sair confere e finaliza.', prio: ck.open > ck.runs * 0.2 ? 32 : 8 });
    }
    var mt = d.maintenance || [], openM = mt.filter(function (m) { return m.status !== 'resolvida'; }), urg = openM.filter(function (m) { return m.priority === 'urgente'; });
    if (mt.length) {
      add({ g: 'Manutenção', ic: 'wrench', tone: urg.length ? 'crit' : openM.length > 5 ? 'warn' : 'ok', title: 'Chamados em aberto', value: fmt(openM.length),
        text: (urg.length ? plural(urg.length, 'urgente', 'urgentes') + ': ' + urg.slice(0, 2).map(function (m) { return m.title; }).join(', ') + '. ' : '') + fmt(mt.length - openM.length) + ' já resolvidos no histórico.',
        action: urg.length ? 'Chamado urgente parado é risco de fechar a cozinha no meio da noite. Resolva ou defina um plano B hoje.'
          : openM.length ? 'Defina um responsável e uma data para cada chamado aberto.' : 'Tudo resolvido. Aproveite para programar a manutenção preventiva do forno e da refrigeração.',
        prio: urg.length ? 72 : openM.length > 5 ? 36 : 6, href: '#manutencao' });
      var eq = {};
      mt.forEach(function (m) { var k = m.equipment || m.place; if (k) eq[k] = (eq[k] || 0) + 1; });
      var te = maxBy(Object.keys(eq), function (k) { return eq[k]; });
      if (te && eq[te] >= 2) add({ g: 'Manutenção', ic: 'alert', tone: eq[te] >= 4 ? 'warn' : '', title: 'O que mais dá problema', value: te,
        text: plural(eq[te], 'chamado', 'chamados') + ' no histórico, de ' + mt.length + ' no total.',
        action: eq[te] >= 4 ? 'Conserto repetido costuma sair mais caro que a troca. Some o que já gastou com esse equipamento e peça orçamento de um novo.'
          : 'Fique de olho: se repetir, vale uma revisão completa em vez de mais um remendo.', prio: eq[te] >= 4 ? 40 : 12 });
    }
    if (d.products.length && window.Stats) {
      var crit = Stats.critical(d), pendS = Stats.shoppingPending(d);
      add({ g: 'Estoque e compras', ic: 'box', tone: crit.length ? 'crit' : 'ok', title: 'Itens abaixo do mínimo', value: fmt(crit.length),
        text: crit.length ? crit.slice(0, 4).map(function (p) { return p.name; }).join(', ') + (crit.length > 4 ? ' e mais ' + (crit.length - 4) : '') + '.' : 'Nenhum produto em nível crítico na unidade selecionada.',
        action: crit.length ? 'Compre hoje o que entra em sabor campeão. Faltar ingrediente no pico é cancelamento e nota baixa.' : 'Estoque saudável. Mantenha o fechamento em dia para o número continuar confiável.',
        prio: crit.length >= 3 ? 60 : crit.length ? 44 : 6, href: '#estoque' });
      if (pendS.length) add({ g: 'Estoque e compras', ic: 'cart', tone: 'warn', title: 'Lista de compras pendente', value: plural(pendS.length, 'item', 'itens'),
        text: 'Itens pedidos no último fechamento que ainda não foram recebidos.',
        action: 'Confira com quem compra o que já está a caminho e dê entrada pela nota fiscal quando chegar.', prio: 30, href: '#estoque/compras' });
    }
    var notas = (d.notas || []).filter(function (n) { return n.date >= x.from && n.date <= x.to; }), buy = sum(notas, 'total');
    if (notas.length) {
      var st = {};
      notas.forEach(function (n) { var k = n.storeName || 'Sem loja'; st[k] = (st[k] || 0) + (+n.total || 0); });
      var ts = maxBy(Object.keys(st), function (k) { return st[k]; });
      add({ g: 'Estoque e compras', ic: 'receipt', tone: '', title: 'Compras lançadas por nota', value: money(buy),
        text: plural(notas.length, 'nota', 'notas') + ' no período. Onde mais comprou: ' + ts + ' (' + share(st[ts], buy) + '%).',
        action: share(st[ts], buy) > 70 ? 'Quase tudo em uma loja só. Compare os preços em Estoque › Onde comprar: dividir a compra costuma economizar.'
          : 'Compras divididas entre lojas. Continue escaneando as notas: é o que alimenta o comparativo de preços.', prio: 10 });
      if (cur.revenue) {
        var bp = buy / cur.revenue * 100;
        add({ g: 'Estoque e compras', ic: 'pizza', tone: bp > 38 || bp < 15 ? 'warn' : '', title: 'Compras sobre o faturamento', value: one(bp) + '%',
          text: 'É o CMV "de verdade" do período, pelas notas lançadas, contra ' + money(cur.revenue) + ' vendidos. Só vale se todas as compras passaram pelo app.',
          action: bp > 38 ? 'Compras altas para o que foi vendido: ou formou estoque, ou há desperdício e porção acima da ficha. Compare com o CMV das fichas técnicas.'
            : bp < 15 ? 'Muito abaixo do normal de uma pizzaria (28% a 35%): quase certamente nem todas as compras foram lançadas por nota. Escaneie as notas que faltam para o número valer.'
            : 'Compatível com um CMV saudável. Se ficar muito abaixo das fichas, provavelmente faltou lançar nota.', prio: bp > 45 ? 48 : bp > 38 ? 32 : bp < 15 ? 28 : 8 });
      }
    }
    var hist = (d.precoHist || []).filter(function (h) { var t = DB.iso(new Date(h.ts)); return t >= x.from && t <= x.to; }), byIns = {};
    hist.sort(function (a, b) { return a.ts - b.ts; }).forEach(function (h) { var b = byIns[h.ins] = byIns[h.ins] || { from: +h.from, to: +h.to }; b.to = +h.to; });
    var moves = Object.keys(byIns).map(function (id) {
      var i = (d.insumos || []).filter(function (q) { return q.id === id; })[0];
      return { name: i ? i.name : id, from: byIns[id].from, to: byIns[id].to, p: pct(byIns[id].to, byIns[id].from) };
    }).filter(function (m) { return m.p != null && Math.abs(m.p) >= 1; }).sort(function (a, b) { return b.p - a.p; });
    if (moves.length && moves[0].p > 0) add({ g: 'Estoque e compras', ic: 'flame', tone: moves[0].p >= 15 ? 'warn' : '', title: 'Insumo que mais subiu', value: moves[0].name,
      text: 'Foi de ' + money(moves[0].from) + ' para ' + money(moves[0].to) + ' (' + sp(moves[0].p) + ') no período. ' + plural(moves.filter(function (m) { return m.p > 0; }).length, 'insumo subiu', 'insumos subiram') + ' e ' + plural(moves.filter(function (m) { return m.p < 0; }).length, 'caiu', 'caíram') + '.',
      action: moves[0].p >= 15 ? 'Alta forte: veja na Ficha técnica quais pizzas usam esse insumo e se o preço delas ainda fecha a conta. Cote com outro fornecedor.'
        : 'Variação normal. Acompanhe para reajustar o cardápio antes que a margem suma.', prio: moves[0].p >= 25 ? 46 : moves[0].p >= 15 ? 34 : 10,
      list: { title: 'Mudanças de preço dos insumos', rows: moves.map(function (m) { return { name: m.name, meta: money(m.from) + ' → ' + money(m.to), value: sp(m.p) }; }) } });

    if (d.cmv && window.CMV && (d.cardapio || []).length) {
      var E = CMV.env(d), rows = CMV.rows(E).filter(function (r) { return r.pct != null; });
      if (rows.length) {
        var high = rows.filter(function (r) { return r.status === 'high'; }).sort(function (a, b) { return b.pct - a.pct; });
        var avg = sum(rows, 'pct') / rows.length;
        add({ g: 'Ficha técnica', ic: 'pizza', tone: high.length ? 'warn' : 'ok', title: 'Itens acima do CMV máximo', value: high.length + ' de ' + rows.length,
          text: 'CMV médio das fichas: ' + CMV.fmtPct(avg) + ' (meta ' + CMV.fmtPct(E.p.target) + ', máximo ' + CMV.fmtPct(E.p.max) + ').' + (high[0] ? ' O pior: ' + high[0].item.name + (high[0].size ? ' ' + CMV.sizeName(E, high[0].size) : '') + ' (' + CMV.fmtPct(high[0].pct) + ').' : ''),
          action: high.length ? 'Cada item acima do máximo vende com margem apertada. Na Ficha técnica, veja o preço sugerido ou reduza o custo da receita.' : 'Todas as fichas dentro da faixa. Revise quando um insumo importante subir.',
          prio: high.length > rows.length * 0.3 ? 50 : high.length ? 34 : 6, href: '#cmv',
          list: high.length ? { title: 'Itens acima do CMV máximo', rows: high.map(function (r) { return { name: r.item.name + (r.size ? ' · ' + CMV.sizeName(E, r.size) : ''), meta: 'custo ' + money(r.cost) + ' · preço ' + money(r.price) + ' · sugerido ' + money(r.sugg), value: CMV.fmtPct(r.pct) }; }) } : null });
      }
    }
    var rvs = (d.events || []).filter(function (e) { return e.reserva; }), today = DB.iso(new Date());
    var inP = rvs.filter(function (e) { return e.date >= x.from && e.date <= x.to; });
    if (rvs.length) {
      var conf = inP.filter(function (e) { return e.reserva.status === 'confirmada'; }), ppl = sum(conf, function (e) { return e.reserva.pessoas; });
      if (inP.length) add({ g: 'Reservas', ic: 'party', tone: '', title: 'Reservas no período', value: fmt(inP.length),
        text: plural(conf.length, 'confirmada', 'confirmadas') + ', somando ' + plural(ppl, 'pessoa', 'pessoas') + (conf.length ? ' (média de ' + fmt(Math.round(ppl / conf.length)) + ' por evento).' : '.'),
        action: 'Evento é faturamento garantido em dia marcado. Envie o link de reservas para empresas da região antes das datas de confraternização.', prio: 10 });
      var decided = inP.filter(function (e) { return e.reserva.status !== 'pendente'; });
      if (decided.length >= 3) {
        var cr = share(conf.length, decided.length);
        add({ g: 'Reservas', ic: 'check', tone: cr < 50 ? 'warn' : 'ok', title: 'Reservas que viraram evento', value: cr + '%',
          text: plural(conf.length, 'confirmada', 'confirmadas') + ' de ' + decided.length + ' respondidas (o resto foi recusado ou cancelado).',
          action: cr < 50 ? 'Mais da metade dos pedidos se perde. Veja os motivos: data cheia (dá para oferecer outra?), demora para responder ou orçamento.' : 'Boa conversão de pedidos em eventos.', prio: cr < 50 ? 34 : 6 });
      }
      var pendR = rvs.filter(function (e) { return e.reserva.status === 'pendente' && e.date >= today; });
      if (pendR.length) add({ g: 'Reservas', ic: 'bell', tone: 'warn', title: 'Reservas esperando resposta', value: fmt(pendR.length),
        text: 'Pedidos do link público ainda sem confirmação nem recusa. A mais próxima é para ' + dm(pendR.sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0].date) + '.',
        action: 'Responda hoje: quem organiza festa pede orçamento em mais de um lugar e fecha com quem responde primeiro.', prio: 56, href: '#reservas' });
      var next = rvs.filter(function (e) { return e.reserva.status === 'confirmada' && e.date >= today && e.date <= addDays(today, 14); });
      if (next.length) add({ g: 'Reservas', ic: 'calendar', tone: 'info', title: 'Eventos nos próximos 14 dias', value: fmt(next.length),
        text: 'Somam ' + plural(sum(next, function (e) { return e.reserva.pessoas; }), 'pessoa', 'pessoas') + ': ' + next.slice(0, 3).map(function (e) { return dm(e.date); }).join(', ') + '.',
        action: 'Reforce a escala e o estoque nesses dias e confirme os detalhes com o cliente dois dias antes.', prio: 22 });
    }
  }

  // ---------- Gráficos de cada área ----------

  function salesCharts(x) {
    var r = x.r, ins = r.ins, ds = x.daily, out = [], C = Charts;
    var cur = x.live ? ds.cur.slice(0, -1) : ds.cur, prev = x.live ? ds.prev.slice(0, -1) : ds.prev, hasPrev = sum(prev, 'v') > 0;
    // Pedidos por hora: o gráfico principal quando o período tem só um ou dois dias.
    var hrs = (ins.hours || []).filter(function (h) { return +h.n > 0; });
    var hourChart = null;
    if (hrs.length) {
      var hs = hrs.map(function (h) { return +h.h; }).sort(function (a, b) { return (a + 19) % 24 - (b + 19) % 24; }), lo = (hs[0] + 19) % 24, hi = (hs[hs.length - 1] + 19) % 24, cols = [];
      for (var k = lo; k <= hi; k++) { var hh = (k + 5) % 24, q = hrs.filter(function (h) { return +h.h === hh; })[0]; cols.push({ h: hh, n: q ? +q.n : 0, v: q ? +q.v : 0 }); }
      hourChart = { wide: x.days <= 2, html: C.card('Pedidos por hora', x.days === 1 ? 'Quantos pedidos entraram em cada hora do dia.' : 'Pedidos de todo o período, somados por hora do dia.',
        C.cols({ labels: cols.map(function (c) { return c.h + 'h'; }), tipLabels: cols.map(function (c) { return c.h + 'h às ' + ((c.h + 1) % 24) + 'h'; }), values: cols.map(function (c) { return c.n; }),
          tips: cols.map(function (c) { return money(c.v); }), fmt: function (v) { return plural(v, 'pedido', 'pedidos'); }, axisFmt: fmt, name: 'Pedidos', xName: 'Hora' })) };
    }
    if (x.days <= 2 && hourChart) { out.push(hourChart); hourChart = null; }
    if (cur.length >= 2) out.push({ wide: true, html: C.card('Faturamento por dia', (x.live ? 'Até ontem' : 'Dia a dia do período') + (hasPrev ? ', com o período anterior em cinza para comparar' : '') + '.',
      C.line({ labels: cur.map(function (d) { return wdm(d.d); }), xLabels: cur.map(function (d) { return dm(d.d); }), area: true, fmt: money, axisFmt: C.moneyK,
        series: (hasPrev ? [{ name: 'Período anterior', slot: 0, values: prev.map(function (d) { return d.v; }) }] : []).concat([{ name: 'Este período', slot: 1, values: cur.map(function (d) { return d.v; }) }]) })) });
    if (hourChart) out.push(hourChart);
    var wk = (r.weeks || []).filter(function (w) { return addDays(w.w, 6) < DB.businessDay(); });
    if (wk.length >= 3) out.push({ html: C.card('Faturamento por semana', 'Semanas completas de todo o histórico guardado (segunda a domingo).',
      C.cols({ labels: wk.map(function (w) { return dm(w.w); }), tipLabels: wk.map(function (w) { return 'Semana de ' + dm(w.w); }), values: wk.map(function (w) { return +w.v; }),
        tips: wk.map(function (w) { return w.n + ' pedidos'; }), fmt: money, axisFmt: C.moneyK, name: 'Faturamento', xName: 'Semana', xMax: 5 })) });
    var mo = r.months || [];
    if (mo.length >= 2) out.push({ html: C.card('Faturamento por mês', 'O primeiro mês do histórico e o mês atual podem estar incompletos.',
      C.cols({ labels: mo.map(function (m) { return monthShort(m.m); }), values: mo.map(function (m) { return +m.v; }), tips: mo.map(function (m) { return m.n + ' pedidos em ' + m.days + ' dias'; }),
        fmt: money, axisFmt: C.moneyK, name: 'Faturamento', xName: 'Mês' })) });
    // Mapa de dia x hora: semana começa na segunda; horas na ordem do dia de trabalho (que vira às 5h).
    var heat = r.heat || [];
    if (heat.length) {
      var order = [], hs = {};
      heat.forEach(function (h) { hs[h.h] = true; });
      for (var i = 0; i < 24; i++) { var hh = (i + 5) % 24; if (hs[hh]) order.push(hh); }
      var lo = order.length ? (order[0] + 19) % 24 : 0, hi2 = order.length ? (order[order.length - 1] + 19) % 24 : 0, colsH = [];
      for (var k = lo; k <= hi2; k++) colsH.push((k + 5) % 24);
      var dows = [1, 2, 3, 4, 5, 6, 0], grid = dows.map(function () { return colsH.map(function () { return 0; }); }), gv = dows.map(function () { return colsH.map(function () { return 0; }); });
      heat.forEach(function (h) { var ri = dows.indexOf(h.d), ci = colsH.indexOf(h.h); if (ri >= 0 && ci >= 0) { grid[ri][ci] = +h.n; gv[ri][ci] = +h.v; } });
      out.push({ html: C.card('Quando os pedidos chegam', 'Pedidos por dia da semana e hora, no período.',
        C.heat({ rows: dows.map(function (d) { return WD[d]; }), cols: colsH.map(function (h) { return h + 'h'; }), values: grid, xName: 'Dia',
          tip: function (ri, ci, v) { return plural(v, 'pedido', 'pedidos') + ' · ' + money(gv[ri][ci]); } })) });
    }
    var wds = ins.weekdays || [];
    if (wds.length >= 3) {
      var ord = [1, 2, 3, 4, 5, 6, 0].map(function (d) { return wds.filter(function (w) { return w.d === d; })[0] || { d: d, v: 0, days: 0, n: 0 }; });
      out.push({ html: C.card('Média por dia da semana', 'Faturamento médio de cada dia, no período.',
        C.cols({ labels: ord.map(function (w) { return WD[w.d]; }), values: ord.map(function (w) { return w.days ? +w.v / +w.days : 0; }),
          tips: ord.map(function (w) { return w.days ? fmt(Math.round(+w.n / +w.days)) + ' pedidos por dia' : ''; }), fmt: money, axisFmt: C.moneyK, name: 'Média por dia', xName: 'Dia' })) });
    }
    var tk = r.tickets || [];
    if (tk.length) {
      var all = [];
      for (var b = 0; b <= 200; b += 20) { var q = tk.filter(function (t) { return +t.b === b; })[0]; all.push({ b: b, n: q ? +q.n : 0 }); }
      out.push({ html: C.card('Pedidos por faixa de valor', 'Quantos pedidos caem em cada faixa de R$ 20.',
        C.cols({ labels: all.map(function (t) { return t.b >= 200 ? '200+' : String(t.b); }), tipLabels: all.map(function (t) { return t.b >= 200 ? 'R$ 200 ou mais' : 'R$ ' + t.b + ' a R$ ' + (t.b + 20); }),
          values: all.map(function (t) { return t.n; }), fmt: function (v) { return plural(v, 'pedido', 'pedidos'); }, axisFmt: fmt, name: 'Pedidos', xName: 'Faixa', xMax: 6 })) });
    }
    var ch = (ins.channels || []).slice().sort(function (a, b) { return +b.v - +a.v; });
    if (ch.length) out.push({ html: C.card('Canais de venda', 'Faturamento por canal, no período.',
      C.bars({ rows: ch.map(function (c) { return { name: chName(c.k), value: +c.v, meta: plural(+c.n, 'pedido', 'pedidos') + ' · ticket ' + money(+c.v / +c.n) }; }), fmt: money, xName: 'Canal', valueName: 'Faturamento' })) });
    var pay = (ins.payments || []).slice().sort(function (a, b) { return +b.v - +a.v; });
    if (pay.length) out.push({ html: C.card('Formas de pagamento', 'Quanto entrou por cada forma.',
      C.bars({ rows: pay.map(function (p) { return { name: PAY[p.k] || p.k || 'Outros', value: +p.v, meta: plural(+p.n, 'pagamento', 'pagamentos') + (+p.fee ? ' · ' + money(p.fee) + ' em taxas' : '') }; }), fmt: money, xName: 'Forma', valueName: 'Valor' })) });
    return out;
  }

  function deliveryCharts(x) {
    var r = x.r, ins = r.ins, out = [], C = Charts, f = r.fees || {};
    var nbs = ins.neighborhoods || [], hasPrev = sum(nbs, 'pv') > 0;
    if (nbs.length) out.push({ html: C.card('Bairros que mais vendem', 'Faturamento das entregas por bairro' + (hasPrev ? ', com o período anterior em cinza' : '') + '.',
      C.bars({ rows: nbs.slice(0, 10).map(function (b) { return { name: b.name, value: +b.v, cmp: hasPrev ? +b.pv : null, meta: hasPrev ? null : plural(+b.n, 'pedido', 'pedidos') }; }), fmt: money, xName: 'Bairro', valueName: 'Faturamento' })) });
    var ty = (ins.types || []).slice().sort(function (a, b) { return +b.v - +a.v; });
    if (ty.length) out.push({ html: C.card('Tipo de pedido', 'Faturamento por tipo, com o ticket médio de cada um.',
      C.bars({ rows: ty.map(function (t) { return { name: TYPES[t.k] || t.k || 'Outros', value: +t.v, meta: plural(+t.n, 'pedido', 'pedidos') + ' · ticket ' + money(+t.v / +t.n) }; }), fmt: money, xName: 'Tipo', valueName: 'Faturamento' })) });
    if (+f.deliveries && (+f.delivery_fee || +f.driver_fee)) out.push({ html: C.card('Taxa de entrega: cobrado x pago', 'O que os clientes pagaram de taxa e o que foi para os entregadores.',
      C.bars({ rows: [{ name: 'Cobrado dos clientes', value: +f.delivery_fee, meta: plural(+f.deliveries, 'entrega', 'entregas') + ' · ' + plural(+f.free, 'sem taxa', 'sem taxa') },
        { name: 'Pago aos entregadores', value: +f.driver_fee, meta: +f.with_driver ? plural(+f.with_driver, 'entrega com entregador', 'entregas com entregador') : 'nenhum valor lançado' }], fmt: money, xName: '', valueName: 'Valor' })) });
    return out;
  }

  function customerCharts(x) {
    var r = x.r, ins = r.ins, c = ins.customers || {}, out = [], C = Charts;
    var wk = (r.weeks || []).filter(function (w) { return addDays(w.w, 6) >= r.day_from && w.w < r.day_to; });
    if (wk.length >= 2) out.push({ wide: true, html: C.card('Faturamento por semana: clientes antigos x novos', 'Novo = primeira semana de casa. Nas primeiras semanas do histórico guardado, quase todos aparecem como novos.',
      C.cols({ labels: wk.map(function (w) { return dm(w.w); }), tipLabels: wk.map(function (w) { return 'Semana de ' + dm(w.w); }), fmt: money, axisFmt: C.moneyK, xName: 'Semana', xMax: 6,
        series: [{ name: 'Já eram clientes', slot: 1, values: wk.map(function (w) { return +w.rv; }) }, { name: 'Clientes novos', slot: 2, values: wk.map(function (w) { return +w.nv; }) },
          { name: 'Sem cadastro', slot: 0, values: wk.map(function (w) { return Math.max(0, +w.v - +w.rv - +w.nv); }) }] })) });
    var fq = r.freq || [];
    if (fq.length) out.push({ html: C.card('Quantas vezes cada cliente já pediu', 'Clientes identificados em todo o histórico guardado.',
      C.cols({ labels: fq.map(function (q) { return q.k; }), tipLabels: fq.map(function (q) { return q.k + (q.k === '1' ? ' pedido' : ' pedidos'); }), values: fq.map(function (q) { return +q.c; }),
        tips: fq.map(function (q) { return money(q.v) + ' gastos no total'; }), fmt: function (v) { return plural(v, 'cliente', 'clientes'); }, axisFmt: fmt, name: 'Clientes', xName: 'Pedidos' })) });
    if (c.loyal_count != null) out.push({ html: C.card('Saúde da base', 'Onde estão os clientes que já pediram.',
      C.bars({ rows: [{ name: 'Fiéis (3 ou mais pedidos em 90 dias)', value: +c.loyal_count }, { name: 'Em risco (30 a 60 dias sem pedir)', value: +c.risk_count || 0 },
        { name: 'Perdidos (mais de 60 dias sem pedir)', value: +c.lost_count || 0 }, { name: 'Pediram uma vez e não voltaram', value: +c.one_time || 0 }],
        fmt: function (v) { return plural(v, 'cliente', 'clientes'); }, xName: 'Grupo', valueName: 'Clientes' })) });
    var co = r.cohorts || [];
    if (co.length >= 2) out.push({ html: C.card('Safras: quem voltou', 'De quem fez o 1º pedido em cada mês, quantos pediram de novo. A primeira safra mistura clientes antigos; as duas últimas ainda estão em tempo de voltar.',
      C.bars({ rows: co.map(function (q) { return { name: monthName(q.m) + ' de ' + q.m.slice(0, 4), value: +q.n ? +q.back / +q.n * 100 : 0, meta: plural(+q.n, 'cliente novo', 'clientes novos') }; }),
        max: 100, fmt: function (v) { return Math.round(v) + '%'; }, xName: 'Mês do 1º pedido', valueName: 'Voltaram' })) });
    return out;
  }

  function productCharts(x) {
    var r = x.r, ins = r.ins, out = [], C = Charts;
    var fl = (r.flavors || []).filter(function (f) { return +f.q > 0; }), hasPrev = sum(r.flavors || [], 'pq') > 0;
    if (fl.length) out.push({ html: C.card('Sabores mais pedidos', 'Em pizzas (meia pizza conta meia)' + (hasPrev ? ', com o período anterior em cinza' : '') + '.',
      C.bars({ rows: fl.slice(0, 10).map(function (f) { return { name: f.name, value: +f.q, cmp: hasPrev ? +f.pq : null }; }), fmt: one, xName: 'Sabor', valueName: 'Pizzas' })) });
    var it = (ins.items || []).filter(function (i) { return +i.v > 0; }).sort(function (a, b) { return +b.v - +a.v; });
    if (it.length) out.push({ html: C.card('Itens que mais faturam', 'Os 10 primeiros do período.',
      C.bars({ rows: it.slice(0, 10).map(function (i) { return { name: i.name, value: +i.v, meta: plural(+i.q, 'unidade', 'unidades') }; }), fmt: money, xName: 'Item', valueName: 'Faturamento' })) });
    var fp = r.flavor_pairs || [];
    if (fp.length) out.push({ html: C.card('Duplas de meio a meio', 'Sabores que mais saem juntos na mesma pizza.',
      C.bars({ rows: fp.map(function (p) { return { name: p.a + ' + ' + p.b, value: +p.n }; }), fmt: function (v) { return plural(v, 'vez', 'vezes'); }, xName: 'Dupla', valueName: 'Vezes' })) });
    var ad = (r.addons || {}).top || [];
    if (ad.length) out.push({ html: C.card('Adicionais pagos', 'Bordas e extras que mais renderam.',
      C.bars({ rows: ad.map(function (a) { return { name: a.name, value: +a.v, meta: fmt(+a.q) + ' vezes' + (a.grp ? ' · ' + a.grp : '') }; }), fmt: money, xName: 'Adicional', valueName: 'Valor' })) });
    return out;
  }

  function reviewCharts(x) {
    var rv = x.r.reviews || {}, out = [], C = Charts;
    var st = rv.stars || [], n = sum(st, 'n');
    if (n) {
      var all = [5, 4, 3, 2, 1].map(function (s) { var q = st.filter(function (t) { return t.s === s; })[0]; return { s: s, n: q ? +q.n : 0 }; });
      out.push({ html: C.card('Distribuição das notas', 'A nota de cada avaliação (média dos quesitos), arredondada.',
        C.bars({ rows: all.map(function (s) { return { name: s.s + (s.s === 1 ? ' estrela' : ' estrelas'), value: s.n, meta: share(s.n, n) + '% das avaliações' }; }),
          fmt: function (v) { return plural(v, 'avaliação', 'avaliações'); }, xName: 'Nota', valueName: 'Avaliações' })) });
    }
    var asp = (rv.aspects || []).filter(function (q) { return q.avg != null; });
    if (asp.length) out.push({ html: C.card('Nota por quesito', 'O que o cliente avalia em cada pedido' + (asp.some(function (q) { return q.pavg != null; }) ? ', com o período anterior em cinza' : '') + '.',
      C.dots({ rows: asp.map(function (q) { return { name: q.q, value: +q.avg, cmp: q.pavg != null ? +q.pavg : null }; }), min: 3, max: 5, fmt: nota2, xName: 'Quesito' })) });
    var mon = rv.monthly || [];
    if (mon.length >= 2) {
      out.push({ html: C.card('Nota média por mês', 'Todo o histórico de avaliações guardado.',
        C.dots({ rows: mon.map(function (m) { return { name: monthName(m.m) + ' de ' + m.m.slice(0, 4), value: +m.avg, meta: plural(+m.n, 'avaliação', 'avaliações') + (+m.low ? ' · ' + m.low + ' com nota 3 ou menos' : '') }; }), min: 3, max: 5, fmt: nota2, xName: 'Mês' })) });
      out.push({ html: C.card('Avaliações recebidas por mês', 'Quantos clientes avaliaram.',
        C.cols({ labels: mon.map(function (m) { return monthShort(m.m); }), values: mon.map(function (m) { return +m.n; }), fmt: function (v) { return plural(v, 'avaliação', 'avaliações'); }, axisFmt: fmt, name: 'Avaliações', xName: 'Mês' })) });
    }
    var bh = (rv.by_hour || []).filter(function (h) { return +h.n >= 2; });
    if (bh.length >= 2) {
      var sorted = bh.slice().sort(function (a, b) { return (a.h + 19) % 24 - (b.h + 19) % 24; });
      out.push({ html: C.card('Nota por horário do pedido', 'Mostra se a qualidade cai quando a casa enche.',
        C.dots({ rows: sorted.map(function (h) { return { name: h.h + 'h', value: +h.avg, meta: plural(+h.n, 'avaliação', 'avaliações') }; }), min: 3, max: 5, fmt: nota2, xName: 'Hora' })) });
    }
    var bd = (rv.by_dow || []).filter(function (d) { return +d.n >= 2; });
    if (bd.length >= 3) out.push({ html: C.card('Nota por dia da semana', 'Pelo dia em que o pedido foi feito.',
      C.dots({ rows: [1, 2, 3, 4, 5, 6, 0].map(function (d) { return bd.filter(function (q) { return q.d === d; })[0]; }).filter(Boolean).map(function (d) { return { name: DB.WEEK[d.d], value: +d.avg, meta: plural(+d.n, 'avaliação', 'avaliações') }; }), min: 3, max: 5, fmt: nota2, xName: 'Dia' })) });
    var rf = rv.flavors || [];
    if (rf.length >= 3) out.push({ html: C.card('Nota dos pedidos por sabor', 'Os 8 sabores com as notas mais baixas, em todo o histórico (5 avaliações ou mais).',
      C.dots({ rows: rf.slice(0, 8).map(function (f) { return { name: f.name, value: +f.avg, meta: plural(+f.n, 'avaliação', 'avaliações') }; }), min: 3, max: 5, fmt: nota2, xName: 'Sabor' })) });
    return out;
  }

  function googleCharts(x) {
    var log = (x.google && x.google.log) || [], out = [], C = Charts;
    if (log.length >= 2) {
      out.push({ html: C.card('Avaliações no Google', 'Pelos registros que você lançou.',
        C.line({ labels: log.map(function (l) { return dm(l.d) + '/' + l.d.slice(2, 4); }), area: true, fmt: function (v) { return plural(v, 'avaliação', 'avaliações'); }, axisFmt: fmt,
          series: [{ name: 'Avaliações', slot: 1, values: log.map(function (l) { return +l.count; }) }] })) });
      out.push({ html: C.card('Nota no Google', 'Pelos registros que você lançou.',
        C.dots({ rows: log.slice(-8).map(function (l) { return { name: dm(l.d) + '/' + l.d.slice(0, 4), value: +l.rating, meta: plural(+l.count, 'avaliação', 'avaliações') }; }), min: 3, max: 5, fmt: nota, xName: 'Data' })) });
    }
    return out;
  }

  function financeCharts(x) {
    var f = x.fin, out = [], C = Charts;
    if (!f || !f.ready || f.empty) return out;
    var r = f.r, p = f.proj || r;
    // Acumulado do mês (vendas da Cardápio Web, dia a dia) contra o ritmo que leva à meta.
    if (x.r && r.goal && f.di.current) {
      var ds = x.daily, acc = 0, cum = [], goal = [], labels = [], dom = f.di.day, covered = true;
      for (var d = 1; d <= f.di.days; d++) {
        var iso = f.key + '-' + String(d).padStart(2, '0');
        labels.push(String(d).padStart(2, '0') + '/' + f.key.slice(5));
        goal.push(r.goal * d / f.di.days);
        if (d <= dom) { if (iso < addDays(x.r.day_from, -x.days)) covered = false; acc += ds.map[iso] ? +ds.map[iso].v : 0; cum.push(acc); } else cum.push(null);
      }
      if (covered && acc > 0) out.push({ wide: true, html: C.card('Faturamento acumulado em ' + monthName(f.key) + ' x ritmo da meta', 'A linha cinza é o caminho reto até a meta de ' + money(r.goal) + '. Acumulado pelas vendas da Cardápio Web.',
        C.line({ labels: labels, fmt: money, axisFmt: C.moneyK, xName: 'Dia', series: [{ name: 'Ritmo da meta', slot: 0, values: goal }, { name: 'Acumulado', slot: 1, values: cum }] })) });
    }
    if (p.revenue > 0 && p.profit >= 0) {
      out.push({ wide: true, html: C.card('Para onde vai o faturamento' + (f.proj ? ' (projeção do mês)' : ''), 'Cada parte do que entra, do ingrediente ao lucro.',
        C.seg({ fmt: money, parts: [{ name: 'Ingredientes e embalagens (CMV)', value: p.cmv, slot: 1 }, { name: 'Impostos, taxas e comissões', value: sum(p.vars, 'value'), slot: 2 },
          { name: 'Folha de pagamento', value: p.folha.total, slot: 3 }, { name: 'Custos fixos e extras', value: p.fixosBase + p.extras, slot: 4 },
          { name: 'Marketing e reserva', value: p.marketing + p.reserva, slot: 5 }, { name: 'Lucro', value: p.profit, slot: 6 }] })) });
    } else if (p.revenue > 0) {
      out.push({ wide: true, html: C.card('Custos x faturamento' + (f.proj ? ' (projeção do mês)' : ''), 'O mês ainda não paga todos os custos: as barras mostram quanto cada um pesa.',
        C.bars({ fmt: money, xName: 'Linha', valueName: 'Valor', rows: [{ name: 'Faturamento', value: p.revenue }, { name: 'Ingredientes e embalagens (CMV)', value: p.cmv }, { name: 'Impostos, taxas e comissões', value: sum(p.vars, 'value') },
          { name: 'Folha de pagamento', value: p.folha.total }, { name: 'Custos fixos e extras', value: p.fixosBase + p.extras }, { name: 'Marketing e reserva', value: p.marketing + p.reserva }] })) });
    }
    return out;
  }

  function teamCharts(x) {
    var t = x.team, out = [], C = Charts;
    var w = t.rows.filter(function (r) { return r.worked > 0; }).sort(function (a, b) { return b.worked - a.worked; });
    if (w.length) out.push({ html: C.card('Horas trabalhadas por pessoa', 'Pelo ponto registrado no período.',
      C.bars({ rows: w.map(function (r) { return { name: r.name, value: r.worked / 60, meta: plural(r.days, 'jornada', 'jornadas') }; }), fmt: function (v) { return fmt(Math.round(v)) + ' h'; }, xName: 'Pessoa', valueName: 'Horas' })) });
    var l = t.rows.filter(function (r) { return r.lateCount > 0; }).sort(function (a, b) { return b.lateCount - a.lateCount; });
    if (l.length) out.push({ html: C.card('Atrasos por pessoa', 'Entradas com mais de ' + Ponto.TOLERANCE + ' minutos de atraso.',
      C.bars({ rows: l.map(function (r) { return { name: r.name, value: r.lateCount, meta: 'somando ' + Ponto.dur(r.late) }; }), fmt: function (v) { return plural(v, 'atraso', 'atrasos'); }, xName: 'Pessoa', valueName: 'Atrasos' })) });
    return out;
  }

  function opsCharts(x) {
    var d = x.d, ck = x.checks, out = [], C = Charts;
    if (ck.rows.length) out.push({ html: C.card('Checklists: tarefas feitas', 'De cada 100 tarefas previstas, quantas foram marcadas.',
      C.bars({ rows: ck.rows.slice().sort(function (a, b) { return a.done / a.total - b.done / b.total; }).map(function (r) { return { name: r.name, value: r.done / r.total * 100, meta: plural(r.runs, 'dia', 'dias') + (r.open ? ' · ' + r.open + ' sem finalizar' : '') }; }),
        max: 100, fmt: function (v) { return Math.round(v) + '%'; }, xName: 'Checklist', valueName: 'Feitas' })) });
    var notas = (d.notas || []).filter(function (n) { return n.date >= x.from && n.date <= x.to; }), st = {};
    notas.forEach(function (n) { var k = n.storeName || 'Sem loja'; st[k] = st[k] || { v: 0, n: 0 }; st[k].v += +n.total || 0; st[k].n++; });
    var stores = Object.keys(st).sort(function (a, b) { return st[b].v - st[a].v; });
    if (stores.length) out.push({ html: C.card('Compras por loja', 'Pelas notas fiscais lançadas no período.',
      C.bars({ rows: stores.slice(0, 8).map(function (k) { return { name: k, value: st[k].v, meta: plural(st[k].n, 'nota', 'notas') }; }), fmt: money, xName: 'Loja', valueName: 'Valor' })) });
    var eq = {};
    (d.maintenance || []).forEach(function (m) { var k = m.equipment || m.place; if (k) eq[k] = (eq[k] || 0) + 1; });
    var eqs = Object.keys(eq).sort(function (a, b) { return eq[b] - eq[a]; });
    if (eqs.length >= 2) out.push({ html: C.card('Chamados de manutenção', 'Por equipamento ou local, em todo o histórico.',
      C.bars({ rows: eqs.slice(0, 8).map(function (k) { return { name: k, value: eq[k] }; }), fmt: function (v) { return plural(v, 'chamado', 'chamados'); }, xName: 'Equipamento', valueName: 'Chamados' })) });
    return out;
  }

  // ---------- Montagem ----------
  // x: { r (cw_relatorio ou null), d (DB.get()), fin, google: { live, log }, from, to (AAAA-MM-DD), days, label, admin }
  function build(x) {
    var list = [], charts = {};
    function add(o) { if (o) { o.s = SECTION_OF[o.g]; list.push(o); } }
    function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn('Relatórios:', e); } }
    x.team = { emps: [], rows: [], worked: 0, prevWorked: 0 };
    x.checks = { rows: [], runs: 0, done: 0, total: 0, open: 0 };
    safe(function () { x.team = teamData(x); });
    safe(function () { x.checks = checkData(x); });
    if (x.r && x.r.ins) {
      x.daily = dailySeries(x.r, x.days);
      safe(function () { CWInsights.build(x.r.ins, x.label).forEach(add); });
      safe(function () { salesInsights(add, x); });
      safe(function () { deliveryInsights(add, x); });
      safe(function () { customerInsights(add, x); });
      safe(function () { productInsights(add, x); });
      safe(function () { reviewInsights(add, x); });
      safe(function () { charts.vendas = salesCharts(x); });
      safe(function () { charts.entrega = deliveryCharts(x); });
      safe(function () { charts.clientes = customerCharts(x); });
      safe(function () { charts.produtos = productCharts(x); });
      safe(function () { charts.avaliacoes = reviewCharts(x); });
    }
    safe(function () { googleInsights(add, x); });
    safe(function () { charts.google = googleCharts(x); });
    if (x.admin) {
      safe(function () { financeInsights(add, x); });
      safe(function () { charts.financeiro = financeCharts(x); });
    }
    safe(function () { teamInsights(add, x); });
    safe(function () { charts.equipe = teamCharts(x); });
    safe(function () { opsInsights(add, x); });
    safe(function () { charts.operacao = opsCharts(x); });
    list.forEach(function (o, i) { o.i = i; });
    return { list: list, charts: charts, daily: x.daily, team: x.team, google: googleNow(x.google) };
  }

  window.Rel = { SECTIONS: SECTIONS, TYPES: TYPES, build: build, googleNow: googleNow, nota: nota, nota2: nota2, dm: dm, wdm: wdm, addDays: addDays, pct: pct, share: share, sum: sum, plural: plural, monthName: monthName };
})();
