// Financeiro: contas do mês a partir dos custos e das metas (as telas ficam em js/screens/financeiro.js).
// Custo fixo = não muda com as vendas (aluguel, folha…); custo variável = % do faturamento (impostos, CMV, taxas).
//   Ponto de equilíbrio = fixos ÷ (1 − variáveis)
//   Meta do mês        = fixos ÷ (1 − variáveis − lucro − marketing − reserva)
// Tudo em reais por mês; percentuais guardados como fração (6% = 0,06).
(function () {
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Ponto de partida: nomes comuns numa pizzaria, valores zerados para o dono preencher.
  var DEFAULT = {
    fixos: [
      { id: 'aluguel', name: 'Aluguel', value: 0 }, { id: 'energia', name: 'Energia elétrica', value: 0 }, { id: 'agua', name: 'Água', value: 0 },
      { id: 'gas', name: 'Gás', value: 0 }, { id: 'internet', name: 'Internet e telefone', value: 0 }, { id: 'contador', name: 'Contador', value: 0 },
      { id: 'sistemas', name: 'Sistemas e aplicativos', value: 0 }, { id: 'manutencao', name: 'Manutenção e limpeza', value: 0 },
      { id: 'prolabore', name: 'Pró-labore (salário fixo dos sócios)', value: 0 }
    ],
    folha: { count: null, salary: 0, encargos: 0.30, beneficios: 0 },
    variaveis: [
      { id: 'impostos', name: 'Impostos (Simples Nacional)', pct: 0.06 }, { id: 'cartao', name: 'Taxas de cartão e Pix', pct: 0.025 },
      { id: 'apps', name: 'Comissão do iFood e outros apps', pct: 0 }, { id: 'entrega', name: 'Entregadores', pct: 0 },
      { id: 'embalagens', name: 'Embalagens fora da ficha técnica', pct: 0 }
    ],
    cmv: { source: 'fichas', pct: 0.32 },
    metas: { lucro: 0.10, marketing: 0.03, reserva: 0.05 },
    ticket: null,
    cwExclude: [] // canais da Cardápio Web fora da conta (ex.: o 99Food, que não informa o valor certo)
  };

  function sum(a, f) { var s = 0; (a || []).forEach(function (x) { s += f ? f(x) : x; }); return s; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Completa a configuração salva com campos que vieram depois (nunca apaga o que já foi preenchido).
  function config(saved) {
    var c = saved ? clone(saved) : clone(DEFAULT);
    Object.keys(DEFAULT).forEach(function (k) { if (c[k] === undefined) c[k] = clone(DEFAULT[k]); });
    ['folha', 'cmv', 'metas'].forEach(function (k) { Object.keys(DEFAULT[k]).forEach(function (f) { if (c[k][f] === undefined) c[k][f] = DEFAULT[k][f]; }); });
    return c;
  }

  // Folha do mês: pessoas × (salário + encargos) + benefícios.
  function folha(c, team) {
    var f = c.folha, n = f.count != null ? +f.count : (team || 0);
    return { n: n, total: n * ((+f.salary || 0) * (1 + (+f.encargos || 0)) + (+f.beneficios || 0)) };
  }

  // x: { revenue, cmvPct, team, extras: [{ value }], orders, ticket, day, days }
  // day = dias já passados do mês (contando hoje); days = dias do mês. Mês fechado: day = days.
  function calc(c, x) {
    var R = +x.revenue || 0, m = c.metas;
    var fol = folha(c, x.team);
    var fixosBase = sum(c.fixos, function (f) { return +f.value || 0; });
    var extras = sum(x.extras, function (e) { return +e.value || 0; });
    var fixed = fixosBase + fol.total + extras;
    var cmvPct = x.cmvPct != null ? x.cmvPct : (+c.cmv.pct || 0);
    var vars = (c.variaveis || []).map(function (v) { return { name: v.name, pct: +v.pct || 0, value: R * (+v.pct || 0) }; });
    var varPct = sum(vars, function (v) { return v.pct; }) + cmvPct;
    var margin = 1 - varPct;
    var goalDen = margin - (+m.lucro || 0) - (+m.marketing || 0) - (+m.reserva || 0);
    var breakEven = margin > 0 ? fixed / margin : null;
    var goal = goalDen > 0 ? fixed / goalDen : null;
    var contrib = R * margin, operating = contrib - fixed;
    var marketing = R * (+m.marketing || 0), reserva = R * (+m.reserva || 0);
    var profit = operating - marketing - reserva;
    var ticket = x.ticket || (x.orders ? R / x.orders : null);
    var left = Math.max(0, (x.days || 0) - (x.day || 0) + 1); // dias que ainda dá para vender, contando hoje
    return {
      revenue: R, fixed: fixed, fixosBase: fixosBase, folha: fol, extras: extras,
      cmvPct: cmvPct, cmv: R * cmvPct, vars: vars, varPct: varPct, margin: margin, contrib: contrib,
      breakEven: breakEven, goal: goal, operating: operating,
      marketing: marketing, reserva: reserva, profit: profit, profitGoal: R * (+m.lucro || 0),
      progress: goal ? R / goal : null,
      projection: x.day && x.days && x.day < x.days ? R / x.day * x.days : null,
      perDay: goal && x.day < x.days ? Math.max(0, goal - R) / Math.max(1, left) : null,
      daysLeft: left,
      ticket: ticket,
      ordersPerDay: goal && ticket ? goal / (x.days || 30) / ticket : null
    };
  }

  // ---------- Meses ----------
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthLabel(key) { var p = key.split('-'); return MONTHS[+p[1] - 1] + ' de ' + p[0]; }
  function addMonth(key, n) { var p = key.split('-'), d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function daysIn(key) { var p = key.split('-'); return new Date(+p[0], +p[1], 0).getDate(); }

  window.Fin = { DEFAULT: DEFAULT, MONTHS: MONTHS, config: config, folha: folha, calc: calc, monthKey: monthKey, monthLabel: monthLabel, addMonth: addMonth, daysIn: daysIn };
})();
