// Exportação do ponto para a contabilidade: planilhas CSV no padrão brasileiro
// (separador ";", UTF-8 com BOM para o Excel reconhecer acentos, datas DD/MM/AAAA e horas HH:MM).
(function () {
  var P = window.Ponto;
  var WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var TYPE = { entrada: 'Entrada', intervalo: 'Saída para intervalo', retorno: 'Volta do intervalo', saida: 'Saída' };
  var ORIGIN = { app: 'Aplicativo', codigo: 'Código no aparelho da loja', ajuste: 'Ajuste aprovado' };

  function pad(n) { return String(n).padStart(2, '0'); }
  function br(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function dateOf(ts) { var d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function timeOf(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  // Duração em HH:MM (com sinal quando pedido, para saldo de banco de horas).
  function hm(min, signed) {
    var s = min < 0 ? '-' : (signed && min > 0 ? '+' : ''), a = Math.abs(Math.round(min));
    return s + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }
  function cpf(c) { c = String(c || ''); return c.length === 11 ? c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : ''; }
  function pis(c) { c = String(c || ''); return c.length === 11 ? c.replace(/^(\d{3})(\d{5})(\d{2})(\d)$/, '$1.$2.$3-$4') : ''; }
  function cell(v) {
    v = v == null ? '' : String(v);
    return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csv(header, rows) { return '﻿' + [header].concat(rows).map(function (r) { return r.map(cell).join(';'); }).join('\r\n') + '\r\n'; }
  function unitName(id) { var u = DB.get().units.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }

  // Quem entra na exportação: colaboradores que batem ponto (ativos ou não, para não perder quem saiu no mês).
  function people(unit) {
    return DB.get().employees.filter(function (e) {
      return e.ponto !== false && e.role !== 'contador' && (!unit || unit === 'todas' || e.unit === unit);
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
  }
  function jornadas(e, from, to) { return P.jornadas(e.id).filter(function (j) { return j.date >= from && j.date <= to; }); }
  function situacao(j) {
    if (P.isStale(j)) return 'Sem registro de saída';
    if (!j.marks.saida) return 'Em andamento';
    return j.list.some(function (p) { return p.method === 'ajuste'; }) ? 'Completo (com ajuste)' : 'Completo';
  }

  var X = {};

  X.marcacoes = function (from, to, unit) {
    var rows = [];
    people(unit).forEach(function (e) {
      jornadas(e, from, to).forEach(function (j) {
        j.list.forEach(function (p) {
          rows.push([br(j.date), dateOf(p.ts), timeOf(p.ts), e.name, cpf(e.cpf), pis(e.pis), unitName(p.unit || e.unit), e.func,
            TYPE[p.type] || p.type, ORIGIN[p.method] || p.method, p.nsr ? pad(p.nsr).padStart(9, '0') : '', p.adjust ? p.adjust.reason : '']);
        });
      });
    });
    rows.sort(function (a, b) { return (a[3] + a[1].split('/').reverse().join('') + a[2]).localeCompare(b[3] + b[1].split('/').reverse().join('') + b[2], 'pt-BR'); });
    return csv(['Data da jornada', 'Data da marcação', 'Hora', 'Colaborador', 'CPF', 'PIS', 'Unidade', 'Função', 'Registro', 'Origem', 'NSR', 'Motivo do ajuste'], rows);
  };

  X.espelho = function (from, to, unit) {
    var rows = [];
    people(unit).forEach(function (e) {
      var prev = P.shift(e).hours * 60;
      jornadas(e, from, to).forEach(function (j) {
        var m = j.marks, w = P.worked(j);
        rows.push([br(j.date), WD[Cal.parse(j.date).getDay()], e.name, cpf(e.cpf), pis(e.pis), unitName(e.unit), e.shift,
          m.entrada ? timeOf(m.entrada.ts) : '', m.intervalo ? timeOf(m.intervalo.ts) : '', m.retorno ? timeOf(m.retorno.ts) : '', m.saida ? timeOf(m.saida.ts) : '',
          hm(w), m.saida ? hm(prev) : '', m.saida ? hm(w - prev, true) : '', P.lateBy(j, e) || '', situacao(j)]);
      });
    });
    return csv(['Data', 'Dia', 'Colaborador', 'CPF', 'PIS', 'Unidade', 'Turno', 'Entrada', 'Saída para intervalo', 'Volta do intervalo', 'Saída',
      'Horas trabalhadas', 'Horas previstas', 'Saldo do dia', 'Atraso (min)', 'Situação'], rows);
  };

  X.resumo = function (from, to, unit) {
    var adj = DB.get().adjusts || [];
    var rows = people(unit).map(function (e) {
      var s = P.summary(e.id, from, to);
      var nAdj = adj.filter(function (a) { return a.emp === e.id && a.status === 'aprovado' && a.date >= from && a.date <= to; }).length;
      return [e.name, cpf(e.cpf), pis(e.pis), e.func, unitName(e.unit), e.shift, e.active ? 'Ativo' : 'Inativo',
        s.days, hm(s.worked), hm(s.expected), hm(s.balance, true), s.lateCount, s.late, s.missing, nAdj];
    });
    return csv(['Colaborador', 'CPF', 'PIS', 'Função', 'Unidade', 'Turno', 'Situação', 'Dias trabalhados', 'Horas trabalhadas', 'Horas previstas',
      'Banco de horas', 'Atrasos', 'Atrasos (min)', 'Dias sem saída', 'Ajustes aprovados'], rows);
  };

  // ---------- TXT ----------
  function ascii(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' '); }
  function rpad(s, n) { s = ascii(s); return (s + ' '.repeat(n)).slice(0, n); }
  function lpad(s, n, c) { s = String(s == null ? '' : s); return (String(c || '0').repeat(n) + s).slice(-n); }
  function ddmmaaaa(d) { return pad(d.getDate()) + pad(d.getMonth() + 1) + d.getFullYear(); }

  X.company = function () {
    var o = DB.get().org || {};
    return { cnpj: String(o.cnpj || '').replace(/\D/g, ''), legalName: o.legalName || o.name || '' };
  };

  // AFD no leiaute padrão de relógio de ponto (Portaria 1510): cabeçalho (tipo 1), uma linha por
  // marcação (tipo 3: NSR, data, hora e PIS) e o fechamento (tipo 9). Arquivo texto ASCII com CRLF.
  // Retorna { text, lines, skipped } — skipped são os funcionários sem PIS, que ficam de fora.
  X.afd = function (from, to, unit) {
    var c = X.company(), now = new Date();
    var marks = [], skipped = [];
    people(unit).forEach(function (e) {
      var list = [];
      jornadas(e, from, to).forEach(function (j) { list = list.concat(j.list); });
      if (!list.length) return;
      var pisN = String(e.pis || '').replace(/\D/g, '');
      if (pisN.length !== 11) { skipped.push(e.name); return; }
      list.forEach(function (p) { marks.push({ p: p, pis: pisN }); });
    });
    marks.sort(function (a, b) { return (a.p.nsr || 0) - (b.p.nsr || 0) || a.p.ts - b.p.ts; });
    var seq = 0;
    var lines = [
      '000000000' + '1' + '1' + lpad(c.cnpj, 14) + lpad('', 12) + rpad(c.legalName, 150) + lpad('', 17) +
      ddmmaaaa(Cal.parse(from)) + ddmmaaaa(Cal.parse(to)) + ddmmaaaa(now) + pad(now.getHours()) + pad(now.getMinutes())
    ];
    marks.forEach(function (m) {
      var d = new Date(m.p.ts);
      var nsr = m.p.nsr || ++seq; // sem NSR (modo sem servidor): numera na ordem
      lines.push(lpad(nsr, 9) + '3' + ddmmaaaa(d) + pad(d.getHours()) + pad(d.getMinutes()) + lpad(m.pis, 12));
    });
    lines.push('999999999' + lpad(0, 9) + lpad(marks.length, 9) + lpad(0, 9) + lpad(0, 9) + '9');
    return { text: lines.join('\r\n') + '\r\n', lines: marks.length, skipped: skipped };
  };

  // Espelho de ponto em texto, em colunas fixas, para conferir ou arquivar.
  X.espelhoTxt = function (from, to, unit) {
    var c = X.company(), out = [], line = '-'.repeat(96);
    out.push('ESPELHO DE PONTO');
    out.push('Empresa: ' + ascii(c.legalName || 'Dindom') + (c.cnpj ? '   CNPJ: ' + c.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : ''));
    out.push('Periodo: ' + br(from) + ' a ' + br(to) + (unit && unit !== 'todas' ? '   Unidade: ' + ascii(unitName(unit)) : '') + '   Gerado em: ' + dateOf(Date.now()) + ' ' + timeOf(Date.now()));
    people(unit).forEach(function (e) {
      var js = jornadas(e, from, to), s = P.summary(e.id, from, to), prev = P.shift(e).hours * 60;
      if (!js.length && !e.active) return; // quem saiu da empresa só aparece se trabalhou no período
      out.push(''); out.push(line);
      out.push(rpad(e.name, 40) + ' CPF: ' + rpad(cpf(e.cpf) || '-', 15) + ' PIS: ' + (pis(e.pis) || '-'));
      out.push(rpad('Funcao: ' + e.func, 40) + ' Turno: ' + rpad(e.shift + ' (' + P.shift(e).start + ', ' + P.shift(e).hours + 'h)', 22) + ' Unidade: ' + ascii(unitName(e.unit)));
      out.push(line);
      out.push(rpad('Data', 11) + rpad('Dia', 5) + rpad('Entrada', 9) + rpad('Interv.', 9) + rpad('Volta', 9) + rpad('Saida', 9) + rpad('Trab.', 8) + rpad('Saldo', 8) + rpad('Atraso', 8) + 'Situacao');
      if (!js.length) out.push('  Nenhuma marcacao no periodo.');
      js.forEach(function (j) {
        var m = j.marks, w = P.worked(j), late = P.lateBy(j, e);
        out.push(rpad(br(j.date), 11) + rpad(WD[Cal.parse(j.date).getDay()], 5) +
          rpad(m.entrada ? timeOf(m.entrada.ts) : '--:--', 9) + rpad(m.intervalo ? timeOf(m.intervalo.ts) : '--:--', 9) +
          rpad(m.retorno ? timeOf(m.retorno.ts) : '--:--', 9) + rpad(m.saida ? timeOf(m.saida.ts) : '--:--', 9) +
          rpad(hm(w), 8) + rpad(m.saida ? hm(w - prev, true) : '', 8) + rpad(late ? late + ' min' : '', 8) + ascii(situacao(j)));
      });
      out.push(line);
      out.push('Dias: ' + s.days + '   Trabalhadas: ' + hm(s.worked) + '   Previstas: ' + hm(s.expected) + '   Banco de horas: ' + hm(s.balance, true) +
        '   Atrasos: ' + s.lateCount + (s.late ? ' (' + s.late + ' min)' : '') + '   Dias sem saida: ' + s.missing);
    });
    out.push(''); out.push('Assinatura do colaborador: ______________________________   Assinatura do empregador: ______________________________');
    return out.join('\r\n') + '\r\n';
  };

  X.filename = function (kind, from, to, unit) {
    var u = unit && unit !== 'todas' ? '-' + unitName(unit).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') : '';
    var ext = kind === 'afd' || kind === 'espelhoTxt' ? '.txt' : '.csv';
    var name = kind === 'espelhoTxt' ? 'espelho' : kind;
    return 'dindom-ponto-' + name + '-' + from + '-a-' + to + u + ext;
  };

  // Baixa o arquivo no aparelho. Devolve false se o navegador não permitir.
  X.download = function (name, text) {
    try {
      var txt = /\.txt$/.test(name);
      var blob = new Blob([text], { type: txt ? 'text/plain;charset=us-ascii' : 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
      return true;
    } catch (e) { return false; }
  };

  X.count = function (from, to, unit) {
    var n = 0, ppl = people(unit);
    ppl.forEach(function (e) { n += jornadas(e, from, to).length; });
    return { people: ppl.length, days: n };
  };

  window.PontoExport = X;
})();
