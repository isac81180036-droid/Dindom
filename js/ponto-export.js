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

  X.filename = function (kind, from, to, unit) {
    var u = unit && unit !== 'todas' ? '-' + unitName(unit).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-') : '';
    return 'dindom-ponto-' + kind + '-' + from + '-a-' + to + u + '.csv';
  };

  // Baixa o arquivo no aparelho. Devolve false se o navegador não permitir.
  X.download = function (name, text) {
    try {
      var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
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
