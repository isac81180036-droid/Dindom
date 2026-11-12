// Gráficos do app, sem biblioteca: HTML e CSS (css/relatorios.css) e um pouco de SVG só para as linhas.
// Cada função devolve o HTML pronto; Charts.mount(root) liga o balão de valores ao passar o dedo ou o mouse.
// Regras: uma cor por série (azul, laranja, verde), nunca dois eixos, barras finas, e todo gráfico
// tem a tabela "Ver números" logo abaixo, para ninguém depender do balão.
(function () {
  var esc = UI.esc;

  // ---------- Formatos ----------
  function num(n) { return UI.fmt(n); }
  function money(n) { return UI.money(n); }
  // R$ 1.234 → "R$ 1,2 mil" (rótulos de eixo e números grandes).
  function moneyK(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return 'R$ ' + UI.fmt(Math.round(n / 1e5) / 10) + ' mi';
    if (a >= 1e4) return 'R$ ' + UI.fmt(Math.round(n / 1e3)) + ' mil';
    if (a >= 1e3) return 'R$ ' + UI.fmt(Math.round(n / 100) / 10) + ' mil';
    return 'R$ ' + UI.fmt(Math.round(n));
  }

  // Teto "redondo" do eixo e os degraus (0, 500, 1.000…).
  function scale(max, ticks) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    var raw = max / (ticks || 3), pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
    var top = Math.ceil(max / step - 1e-9) * step, out = [];
    for (var v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return { max: top, ticks: out };
  }

  function yAxis(sc, fmt) {
    return '<div class="ch-y" aria-hidden="true">' + sc.ticks.slice().reverse().map(function (t) { return '<span>' + esc(fmt(t)) + '</span>'; }).join('') + '</div>';
  }
  function grid(sc) {
    return '<div class="ch-grid" aria-hidden="true">' + sc.ticks.map(function (t) { return '<i style="bottom:' + (t / sc.max * 100) + '%"></i>'; }).join('') + '</div>';
  }
  // Rótulos do eixo X: no máximo "max", espalhados por igual (sempre o primeiro e o último).
  function pick(n, max) {
    if (n <= max) { var all = []; for (var i = 0; i < n; i++) all.push(i); return all; }
    var out = [], last = -1;
    for (var k = 0; k < max; k++) { var j = Math.round(k * (n - 1) / (max - 1)); if (j !== last) out.push(j); last = j; }
    return out;
  }

  function legend(items) {
    return '<div class="ch-legend">' + items.map(function (s) {
      return '<span><i class="ch-key s' + s.slot + (s.line ? ' line' : '') + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>';
  }

  // Tabela com os mesmos números do gráfico.
  function table(head, rows) {
    if (!rows || !rows.length) return '';
    return '<details class="ch-data"><summary>Ver números</summary><div class="ch-table"><table><thead><tr>' +
      head.map(function (h, i) { return '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="n"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div></details>';
  }

  // Moldura: título, subtítulo, o gráfico e a tabela.
  function card(title, sub, body, extra) {
    return '<section class="card ch"><div class="ch-head"><h3>' + esc(title) + '</h3>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' + body + (extra || '') + '</section>';
  }
  function nothing(text) { return '<p class="ch-none">' + esc(text || 'Ainda sem dados para este gráfico.') + '</p>'; }

  // ---------- Linha (tendência no tempo) ----------
  // o: { labels: [..], xLabels: [rótulos curtos do eixo], series: [{ name, values: [n|null], slot: 1|2|3|0 (0 = cinza, de comparação) }], fmt, axisFmt, area }
  function line(o) {
    var n = o.labels.length, fmt = o.fmt || num, max = 0;
    o.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && v > max) max = v; }); });
    if (!n || !max) return nothing(o.empty);
    var sc = scale(max, 3);
    function x(i) { return n === 1 ? 50 : i / (n - 1) * 100; }
    function y(v) { return 100 - v / sc.max * 100; }
    var svg = o.series.map(function (s, si) {
      var d = '', open = false, first = null, last = null;
      s.values.forEach(function (v, i) {
        if (v == null) { open = false; return; }
        d += (open ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(v).toFixed(2);
        open = true; if (first == null) first = i; last = i;
      });
      if (!d) return '';
      var area = o.area && si === o.series.length - 1 && s.slot ? '<path class="ch-fill s' + s.slot + '" d="' + d + 'L' + x(last).toFixed(2) + ' 100L' + x(first).toFixed(2) + ' 100Z"/>' : '';
      return area + '<path class="ch-line s' + s.slot + '" d="' + d + '" vector-effect="non-scaling-stroke"/>';
    }).join('');
    // Ponto no fim da série principal (a última da lista), com o valor escrito.
    var main = o.series[o.series.length - 1], li = -1;
    main.values.forEach(function (v, i) { if (v != null) li = i; });
    var dot = li >= 0 ? '<span class="ch-dot s' + main.slot + '" style="left:' + x(li) + '%;bottom:' + (main.values[li] / sc.max * 100) + '%"></span>' +
      '<span class="ch-endlabel" style="' + (x(li) > 70 ? 'right:' + (100 - x(li)) + '%' : 'left:' + x(li) + '%') + ';bottom:' + (main.values[li] / sc.max * 100) + '%">' + esc(fmt(main.values[li])) + '</span>' : '';
    var data = { labels: o.labels, series: o.series.map(function (s) { return { name: s.name, slot: s.slot, v: s.values.map(function (v) { return v == null ? null : fmt(v); }) }; }) };
    var xs = pick(n, o.xMax || 5);
    return (o.series.length > 1 ? legend(o.series.slice().reverse().map(function (s) { return { name: s.name, slot: s.slot, line: true }; })) : '') +
      '<div class="ch-plot">' + yAxis(sc, o.axisFmt || fmt) +
      '<div class="ch-area" data-ch-line="' + esc(JSON.stringify(data)) + '">' + grid(sc) +
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + svg + '</svg>' + dot +
      '<i class="ch-cross" hidden></i></div>' +
      '<div class="ch-x" aria-hidden="true">' + xs.map(function (i, k) {
        return '<span style="left:' + x(i) + '%" class="' + (k === 0 ? 'first' : k === xs.length - 1 ? 'last' : '') + '">' + esc((o.xLabels || o.labels)[i]) + '</span>';
      }).join('') + '</div></div>' +
      table([o.xName || 'Data'].concat(o.series.slice().reverse().map(function (s) { return s.name; })),
        o.labels.map(function (l, i) { return [l].concat(o.series.slice().reverse().map(function (s) { return s.values[i] == null ? '–' : fmt(s.values[i]); })); }));
  }

  // ---------- Colunas (comparar tamanhos; com várias séries, empilha) ----------
  // o: { labels, series: [{ name, values, slot }] ou values: [..], fmt, axisFmt, tips: [texto extra por coluna], xMax }
  function cols(o) {
    var series = o.series || [{ name: o.name || '', values: o.values, slot: o.slot || 1 }];
    var n = o.labels.length, fmt = o.fmt || num, totals = [];
    for (var i = 0; i < n; i++) totals.push(series.reduce(function (s, x) { return s + (+x.values[i] || 0); }, 0));
    var max = Math.max.apply(null, totals.concat([0]));
    if (!n || !max) return nothing(o.empty);
    var sc = scale(max, 3), top = totals.indexOf(max);
    var xs = pick(n, o.xMax || (n <= 12 ? n : 6)), show = {};
    xs.forEach(function (i) { show[i] = true; });
    var bars = o.labels.map(function (l, i) {
      var tip = series.length > 1
        ? series.map(function (s) { return s.name + ': ' + fmt(+s.values[i] || 0); }).join(' · ')
        : fmt(totals[i]);
      return '<div class="ch-col" data-tip-l="' + esc(o.tipLabels ? o.tipLabels[i] : l) + '" data-tip-v="' + esc(tip) + '"' + (o.tips && o.tips[i] ? ' data-tip-x="' + esc(o.tips[i]) + '"' : '') + '>' +
        (i === top && !o.noCap ? '<b class="ch-cap' + (n > 6 && i >= n - 2 ? ' end' : n > 6 && i < 2 ? ' start' : '') + '" style="bottom:' + (totals[i] / sc.max * 100) + '%">' + esc((o.axisFmt || fmt)(totals[i])) + '</b>' : '') +
        '<div class="ch-stack" style="height:' + (totals[i] / sc.max * 100) + '%">' +
        series.slice().reverse().map(function (s) { var v = +s.values[i] || 0; return v > 0 ? '<i class="s' + s.slot + '" style="flex:' + v + '"></i>' : ''; }).join('') +
        '</div></div>';
    }).join('');
    return (series.length > 1 ? legend(series) : '') +
      '<div class="ch-plot">' + yAxis(sc, o.axisFmt || fmt) + '<div class="ch-area ch-cols">' + grid(sc) + bars + '</div>' +
      '<div class="ch-x cols" aria-hidden="true">' + o.labels.map(function (l, i) { return '<span>' + (show[i] ? esc(l) : '') + '</span>'; }).join('') + '</div></div>' +
      table([o.xName || ''].concat(series.map(function (s) { return s.name || 'Valor'; })),
        o.labels.map(function (l, i) { return [o.tipLabels ? o.tipLabels[i] : l].concat(series.map(function (s) { return fmt(+s.values[i] || 0); })); }));
  }

  // ---------- Barras deitadas (ranking) ----------
  // o: { rows: [{ name, value, meta, cmp }], fmt, max, cmpName, name }  cmp = valor de comparação (cinza)
  function bars(o) {
    var rows = (o.rows || []).filter(function (r) { return r.value != null; }), fmt = o.fmt || num;
    if (!rows.length) return nothing(o.empty);
    var hasCmp = rows.some(function (r) { return r.cmp != null; });
    var max = o.max || Math.max.apply(null, rows.map(function (r) { return Math.max(+r.value || 0, +r.cmp || 0); })) || 1;
    return (hasCmp ? legend([{ name: o.name || 'Agora', slot: 1 }, { name: o.cmpName || 'Período anterior', slot: 0 }]) : '') +
      '<div class="ch-bars">' + rows.map(function (r) {
        return '<div class="ch-bar" data-tip-l="' + esc(r.name) + '" data-tip-v="' + esc(fmt(r.value)) + '"' +
          (r.cmp != null ? ' data-tip-x="' + esc((o.cmpName || 'Período anterior') + ': ' + fmt(r.cmp)) + '"' : r.meta ? ' data-tip-x="' + esc(r.meta) + '"' : '') + '>' +
          '<div class="ch-bar-head"><span>' + esc(r.name) + '</span><b>' + esc(fmt(r.value)) + '</b></div>' +
          (r.meta ? '<div class="ch-bar-meta">' + esc(r.meta) + '</div>' : '') +
          '<div class="ch-track">' + (+r.value > 0 ? '<i class="s1" style="width:' + Math.min(100, +r.value / max * 100) + '%"></i>' : '') + '</div>' +
          (r.cmp != null ? '<div class="ch-track thin"><i class="s0" style="width:' + Math.max(0, Math.min(100, (+r.cmp || 0) / max * 100)) + '%"></i></div>' : '') +
          '</div>';
      }).join('') + '</div>' +
      table([o.xName || ''].concat(hasCmp ? [o.name || 'Agora', o.cmpName || 'Período anterior'] : [o.valueName || 'Valor']),
        rows.map(function (r) { return [r.name, fmt(r.value)].concat(hasCmp ? [r.cmp == null ? '–' : fmt(r.cmp)] : []); }));
  }

  // ---------- Pontos numa régua (notas de 1 a 5: a régua não começa no zero, então não é barra) ----------
  // o: { rows: [{ name, value, cmp }], min, max, fmt, cmpName }
  function dots(o) {
    var rows = (o.rows || []).filter(function (r) { return r.value != null; }), fmt = o.fmt || num;
    if (!rows.length) return nothing(o.empty);
    var lo = o.min, hi = o.max;
    rows.forEach(function (r) { [r.value, r.cmp].forEach(function (v) { if (v != null && v < lo) lo = Math.floor(v); }); });
    function pos(v) { return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); }
    var hasCmp = rows.some(function (r) { return r.cmp != null; });
    return (hasCmp ? legend([{ name: o.name || 'Agora', slot: 1 }, { name: o.cmpName || 'Período anterior', slot: 0 }]) : '') +
      '<div class="ch-bars">' + rows.map(function (r) {
        return '<div class="ch-bar" data-tip-l="' + esc(r.name) + '" data-tip-v="' + esc(fmt(r.value)) + '"' +
          (r.cmp != null ? ' data-tip-x="' + esc((o.cmpName || 'Período anterior') + ': ' + fmt(r.cmp)) + '"' : r.meta ? ' data-tip-x="' + esc(r.meta) + '"' : '') + '>' +
          '<div class="ch-bar-head"><span>' + esc(r.name) + '</span><b>' + esc(fmt(r.value)) + '</b></div>' +
          (r.meta ? '<div class="ch-bar-meta">' + esc(r.meta) + '</div>' : '') +
          '<div class="ch-rule">' + (r.cmp != null ? '<i class="ch-dot s0" style="left:' + pos(r.cmp) + '%"></i>' : '') +
          '<i class="ch-dot s1" style="left:' + pos(r.value) + '%"></i></div></div>';
      }).join('') + '<div class="ch-rule-axis" aria-hidden="true"><span>' + esc(fmt(lo)) + '</span><span>' + esc(fmt((lo + hi) / 2)) + '</span><span>' + esc(fmt(hi)) + '</span></div></div>' +
      table([o.xName || ''].concat(hasCmp ? [o.name || 'Agora', o.cmpName || 'Período anterior'] : [o.valueName || 'Nota']),
        rows.map(function (r) { return [r.name, fmt(r.value)].concat(hasCmp ? [r.cmp == null ? '–' : fmt(r.cmp)] : []); }));
  }

  // ---------- Mapa de calor (grade: linhas x colunas, mais escuro = mais) ----------
  // o: { rows: [rótulos], cols: [rótulos], values: [[n]], tip: function (ri, ci, v) → texto, fmt }
  function heat(o) {
    var max = 0;
    o.values.forEach(function (r) { r.forEach(function (v) { if (v > max) max = v; }); });
    if (!max || !o.cols.length) return nothing(o.empty);
    var fmt = o.fmt || num;
    function step(v) { return v > 0 ? Math.max(1, Math.ceil(v / max * 6)) : 0; }
    return '<div class="ch-heat" style="--cols:' + o.cols.length + '"><span></span>' +
      o.cols.map(function (c) { return '<span class="ch-heat-x">' + esc(c) + '</span>'; }).join('') +
      o.rows.map(function (r, ri) {
        return '<span class="ch-heat-y">' + esc(r) + '</span>' + o.cols.map(function (c, ci) {
          var v = o.values[ri][ci] || 0;
          return '<i class="h' + step(v) + '" data-tip-l="' + esc(r + ' · ' + c) + '" data-tip-v="' + esc(o.tip ? o.tip(ri, ci, v) : fmt(v)) + '"></i>';
        }).join('');
      }).join('') + '</div>' +
      '<div class="ch-heat-scale" aria-hidden="true"><span>menos</span>' + [1, 2, 3, 4, 5, 6].map(function (s) { return '<i class="h' + s + '"></i>'; }).join('') + '<span>mais</span></div>' +
      table([o.xName || ''].concat(o.cols), o.rows.map(function (r, ri) { return [r].concat(o.cols.map(function (c, ci) { return fmt(o.values[ri][ci] || 0); })); }));
  }

  // ---------- Barra dividida (um todo em até 6 partes, cada parte com a própria cor fixa) ----------
  // o: { parts: [{ name, value, slot }], fmt }
  function seg(o) {
    var parts = (o.parts || []).filter(function (p) { return p.value > 0; }), fmt = o.fmt || num;
    var total = parts.reduce(function (s, p) { return s + p.value; }, 0);
    if (!total) return nothing(o.empty);
    return '<div class="ch-seg" role="img" aria-label="' + esc(parts.map(function (p) { return p.name + ' ' + Math.round(p.value / total * 100) + '%'; }).join(', ')) + '">' +
      parts.map(function (p) {
        var share = p.value / total * 100;
        return '<i class="s' + p.slot + '" style="flex:' + p.value + '" data-tip-l="' + esc(p.name) + '" data-tip-v="' + esc(fmt(p.value)) + '" data-tip-x="' + Math.round(share) + '% do total">' +
          (share >= 11 ? '<b>' + Math.round(share) + '%</b>' : '') + '</i>';
      }).join('') + '</div>' + legend(parts) +
      table([o.xName || 'Parte', 'Valor', '% do total'], parts.map(function (p) { return [p.name, fmt(p.value), Math.round(p.value / total * 100) + '%']; }));
  }

  // ---------- Número em destaque: valor, variação e minigráfico ----------
  // o: { label, value, delta (em %), good (subir é bom? padrão sim), vs, sub, spark: [n], href }
  function kpi(o) {
    var d = '';
    if (o.delta != null && isFinite(o.delta)) {
      var up = o.delta > 0.5, down = o.delta < -0.5, good = o.good === false ? down : up, bad = o.good === false ? up : down;
      d = '<span class="ch-delta ' + (good ? 'good' : bad ? 'bad' : '') + '">' + (up ? '▲' : down ? '▼' : '=') + ' ' +
        UI.fmt(Math.abs(Math.round(o.delta))) + (o.unit || '%') + '</span>';
    }
    var sp = '';
    if (o.spark && o.spark.length > 1) {
      var mx = Math.max.apply(null, o.spark) || 1, n = o.spark.length;
      sp = '<svg class="ch-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="ch-line s1" vector-effect="non-scaling-stroke" d="' +
        o.spark.map(function (v, i) { return (i ? 'L' : 'M') + (i / (n - 1) * 100).toFixed(1) + ' ' + (96 - v / mx * 92).toFixed(1); }).join('') + '"/></svg>';
    }
    var tag = o.href ? 'a' : 'div';
    return '<' + tag + ' class="card ch-kpi' + (o.href ? ' tap' : '') + '"' + (o.href ? ' href="' + o.href + '"' : '') + '><span class="ch-kpi-label">' + esc(o.label) + '</span>' +
      '<span class="ch-kpi-value">' + esc(o.value) + '</span>' +
      '<span class="ch-kpi-foot">' + d + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</span>' + sp + '</' + tag + '>';
  }

  // ---------- Balão de valores ----------
  function mount(root) {
    var tip = document.createElement('div');
    tip.className = 'ch-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
    var hot = null, cross = null;

    function fill(label, rows) {
      tip.textContent = '';
      var h = document.createElement('div'); h.className = 'ch-tip-l'; h.textContent = label; tip.appendChild(h);
      rows.forEach(function (r) {
        var line = document.createElement('div'); line.className = 'ch-tip-r';
        if (r.slot != null) { var k = document.createElement('i'); k.className = 'ch-key line s' + r.slot; line.appendChild(k); }
        if (r.value) { var b = document.createElement('b'); b.textContent = r.value; line.appendChild(b); }
        if (r.name) { var s = document.createElement('span'); s.textContent = r.name; line.appendChild(s); }
        tip.appendChild(line);
      });
    }
    function place(x, y) {
      tip.hidden = false;
      var w = tip.offsetWidth, h = tip.offsetHeight, vw = document.documentElement.clientWidth;
      var left = Math.max(8, Math.min(vw - w - 8, x - w / 2)), top = y - h - 14;
      if (top < 8) top = y + 18;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function clear() {
      tip.hidden = true;
      if (hot) { hot.classList.remove('hot'); hot = null; }
      if (cross) { cross.hidden = true; cross = null; }
    }
    function move(e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return clear();
      var area = t.closest('[data-ch-line]');
      if (area) {
        var data = area._chData || (area._chData = JSON.parse(area.getAttribute('data-ch-line')));
        var r = area.getBoundingClientRect(), n = data.labels.length;
        var i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left) / r.width * (n - 1))));
        if (hot) { hot.classList.remove('hot'); hot = null; }
        cross = area.querySelector('.ch-cross');
        cross.hidden = false; cross.style.left = (n === 1 ? 50 : i / (n - 1) * 100) + '%';
        fill(data.labels[i], data.series.slice().reverse().filter(function (s) { return s.v[i] != null; }).map(function (s) { return { slot: s.slot, value: s.v[i], name: s.name }; }));
        return place(r.left + (n === 1 ? .5 : i / (n - 1)) * r.width, r.top + 8);
      }
      var m = t.closest('[data-tip-v]');
      if (!m) return clear();
      if (cross) { cross.hidden = true; cross = null; }
      if (hot !== m) { if (hot) hot.classList.remove('hot'); hot = m; m.classList.add('hot'); }
      var rows = [{ value: m.getAttribute('data-tip-v') }];
      if (m.getAttribute('data-tip-x')) rows.push({ value: '', name: m.getAttribute('data-tip-x') });
      fill(m.getAttribute('data-tip-l'), rows);
      var b = m.getBoundingClientRect();
      place(e.clientX || b.left + b.width / 2, b.top);
    }
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerdown', move);
    root.addEventListener('pointerleave', clear);
    window.addEventListener('scroll', clear, { passive: true });
    return function () { window.removeEventListener('scroll', clear); tip.remove(); };
  }

  window.Charts = { num: num, money: money, moneyK: moneyK, scale: scale, card: card, table: table, nothing: nothing,
    line: line, cols: cols, bars: bars, dots: dots, heat: heat, seg: seg, kpi: kpi, legend: legend, mount: mount };
})();
