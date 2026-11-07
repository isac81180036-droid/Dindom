// Ficha técnica & CMV: cálculo do custo de cada item do cardápio, do CMV e dos preços sugeridos.
// As contas seguem a planilha da Dindom; as telas ficam em js/screens/cmv.js.
// Tudo é calculado na hora a partir dos insumos, das fichas e dos parâmetros (nada de custo guardado).
(function () {
  var TYPES = { pizza: 'Pizza', unico: 'Item único', bebida: 'Bebida', combo: 'Combo' };
  var FIXED = [['box', 'Caixa'], ['napkin', 'Guardanapo, sachês e etiqueta'], ['gas', 'Gás e energia'], ['loss', 'Perdas e sobras']];

  // Arredonda para cima em reais inteiros, sem cair no erro de ponto flutuante (31,5 ÷ 0,315 = 100,0000001).
  function ceilR(x) { return Math.ceil(x - 1e-7); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  // Ambiente de cálculo: insumos, itens e parâmetros. O simulador monta um ambiente com cópias alteradas.
  function env(d) {
    var ins = {};
    (d.insumos || []).forEach(function (x) { ins[x.id] = x; });
    return { ins: ins, items: d.cardapio || [], p: d.cmv };
  }

  function size(E, id) { return E.p.sizes.filter(function (s) { return s.id === id; })[0]; }
  function cat(E, id) { return E.p.cats.filter(function (c) { return c.id === id; })[0]; }
  function item(E, id) { return E.items.filter(function (x) { return x.id === id; })[0]; }
  function fixed(s) { return s ? sum(FIXED.map(function (f) { return +s[f[0]] || 0; })) : 0; }
  // Tamanhos em que o item é vendido: pizza nos três, o resto em um só.
  function sizesOf(E, it) { return it.type === 'pizza' ? E.p.sizes.map(function (s) { return s.id; }) : ['']; }

  // Custo de uma linha da ficha: gramas viram kg; unidade é a própria quantidade.
  function lineCost(E, l) {
    var x = E.ins[l.ins];
    if (!x) return 0;
    return (x.unit === 'kg' ? (+l.q || 0) / 1000 : (+l.q || 0)) * (+x.price || 0);
  }
  function base(E, it) { return sum((it.lines || []).map(function (l) { return lineCost(E, l); })); }
  function extra(E, e) { return e.size ? fixed(size(E, e.size)) : (+e.value || 0); }

  function cost(E, it, sz) {
    if (it.type === 'pizza') {
      var s = size(E, sz);
      return s ? base(E, it) * (+s.factor || 0) + fixed(s) : 0;
    }
    if (it.type === 'combo') {
      return sum((it.parts || []).map(function (p) {
        var q = +p.qty || 1;
        if (p.kind === 'pizza') return q * catAvg(E, p.cat, p.size, false);
        var x = item(E, p.id);
        return x ? q * cost(E, x, x.type === 'pizza' ? p.size : '') : 0;
      }));
    }
    return base(E, it) + sum((it.extras || []).map(function (e) { return extra(E, e); }));
  }

  function price(E, it, sz) {
    if (it.type === 'pizza') {
      var c = cat(E, it.cat);
      return c ? (+c.prices[sz] || 0) + (+it.extra || 0) : 0;
    }
    return +it.price || 0;
  }

  function pct(c, p) { return p > 0 ? c / p : null; }

  // Verde dentro da faixa, vermelho acima do máximo, azul abaixo do mínimo (sobra margem).
  function status(E, v) {
    if (v == null) return 'none';
    if (v > E.p.max + 1e-9) return 'high';
    if (v < E.p.min - 1e-9) return 'low';
    return 'ok';
  }

  function pizzas(E, catId) {
    return E.items.filter(function (x) { return x.type === 'pizza' && x.active !== false && x.cat === catId; });
  }
  // Custo médio dos sabores da categoria no tamanho; noExtra = só os sabores sem acréscimo.
  function catAvg(E, catId, sz, noExtra) {
    var ps = pizzas(E, catId).filter(function (x) { return !noExtra || !(+x.extra); });
    return ps.length ? sum(ps.map(function (x) { return cost(E, x, sz); })) / ps.length : 0;
  }

  // Preço sugerido da categoria: o de hoje ou, se não alcançar a meta, custo médio ÷ CMV alvo.
  function suggestCat(E, catId, sz) {
    var c = cat(E, catId);
    var now = c ? +c.prices[sz] || 0 : 0;
    var avg = catAvg(E, catId, sz, true);
    return Math.max(now, avg ? ceilR(avg / E.p.target) : 0);
  }

  function suggest(E, it, sz) {
    var c = cost(E, it, sz);
    if (it.type === 'pizza') {
      var sc = suggestCat(E, it.cat, sz);
      return sc + Math.max(0, ceilR(c / E.p.max - sc));
    }
    return Math.max(+it.price || 0, ceilR(c / E.p.target));
  }

  // Uma linha por item e tamanho, com hoje x proposta. Base do painel, do resumo e da exportação.
  function rows(E) {
    var out = [];
    E.items.forEach(function (it) {
      if (it.active === false) return;
      sizesOf(E, it).forEach(function (sz) {
        var c = cost(E, it, sz), p = price(E, it, sz), sg = suggest(E, it, sz);
        var v = pct(c, p), sv = pct(c, sg);
        out.push({ item: it, size: sz, cost: c, price: p, pct: v, status: status(E, v), sugg: sg, suggPct: sv, suggStatus: status(E, sv) });
      });
    });
    return out;
  }

  // Grupo do item na lista: a categoria da pizza ou o tipo.
  function group(E, it) {
    if (it.type === 'pizza') { var c = cat(E, it.cat); return c ? c.name : 'Pizzas'; }
    return { unico: 'Itens únicos', bebida: 'Bebidas', combo: 'Combos' }[it.type] || 'Outros';
  }
  function groupKey(it) { return it.type === 'pizza' ? 'cat:' + it.cat : it.type; }

  function sizeName(E, sz) { var s = size(E, sz); return s ? s.name : ''; }

  // Itens que usam o insumo (direto na ficha ou, nos combos, por uma pizza ou item que usa).
  function usesIns(E, it, insId) {
    if ((it.lines || []).some(function (l) { return l.ins === insId; })) return true;
    if (it.type !== 'combo') return false;
    return (it.parts || []).some(function (p) {
      if (p.kind === 'pizza') return pizzas(E, p.cat).some(function (x) { return usesIns(E, x, insId); });
      var x = item(E, p.id); return x && x.type !== 'combo' && usesIns(E, x, insId);
    });
  }

  // ---------- Formatos ----------
  // Feitos à mão (sem toLocaleString) para sair igual em qualquer celular: 1.234,56 · R$ 16,91 · 31,5%.
  function num2(n) {
    var v = Math.round((+n || 0) * 100) / 100, s = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '-' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
  }
  function money(n) { return 'R$ ' + num2(n); }
  function fmtPct(v) { return v == null ? '–' : (Math.round(v * 1000) / 10).toFixed(1).replace('.', ',') + '%'; }
  // "R$ 1.234,56", "36,5" ou "36.5" → número; vazio ou inválido → null.
  function parse(s) {
    s = String(s == null ? '' : s).replace(/[^\d,.\-]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  window.CMV = {
    TYPES: TYPES, FIXED: FIXED,
    env: env, size: size, cat: cat, item: item, fixed: fixed, sizesOf: sizesOf,
    lineCost: lineCost, base: base, extra: extra, cost: cost, price: price, pct: pct, status: status,
    catAvg: catAvg, suggestCat: suggestCat, suggest: suggest, rows: rows, group: group, groupKey: groupKey,
    sizeName: sizeName, usesIns: usesIns, ceilR: ceilR,
    money: money, num2: num2, fmtPct: fmtPct, parse: parse
  };
})();
