// Nota fiscal (NFC-e): leitura do QR, validação da chave, busca dos itens e reconhecimento dos produtos.
(function () {
  var UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
    28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };

  // Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita para a esquerda).
  function dv(key43) {
    var sum = 0, w = 2;
    for (var i = key43.length - 1; i >= 0; i--) { sum += Number(key43[i]) * w; w = w === 9 ? 2 : w + 1; }
    var r = 11 - (sum % 11);
    return r >= 10 ? 0 : r;
  }

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // "cx" não entra aqui: nas notas costuma ser "caixa" (ex.: CX PIZZA 35CM), e o sinônimo cuida disso.
  var UNIT_WORDS = { kg: 1, g: 1, un: 1, und: 1, unid: 1, pct: 1, pc: 1, fd: 1, l: 1, lt: 1, ml: 1, de: 1, em: 1, com: 1, c: 1, cong: 1, peca: 1 };
  // Grafias comuns nas notas para o mesmo produto.
  var SYN = { mussarela: 'mucarela', muzzarella: 'mucarela', mozzarella: 'mucarela', mozarela: 'mucarela', mucarela: 'mucarela',
    refrig: 'refrigerante', refri: 'refrigerante', linguica: 'calabresa', requeijao: 'catupiry', cx: 'caixa', maco: 'manjericao' };
  function tokens(s) {
    return norm(s).split(' ').filter(function (t) { return t && !UNIT_WORDS[t]; }).map(function (t) { return SYN[t] || t; });
  }

  var NFCe = {};

  // Aceita o texto do QR (URL da SEFAZ) ou a chave digitada. Retorna { key, uf, cnpj, model, number, url } ou { error }.
  NFCe.parse = function (text) {
    var raw = String(text || '').trim();
    var m = raw.replace(/\s/g, '').match(/(\d{44})/);
    if (!m) return { error: 'Não encontramos a chave de acesso. Confira se é o QR Code da nota fiscal.' };
    var key = m[1];
    if (dv(key.slice(0, 43)) !== Number(key[43])) return { error: 'A chave de acesso está incompleta ou com algum número trocado.' };
    var model = key.slice(20, 22);
    if (model !== '65' && model !== '55') return { error: 'Este código não é de uma nota fiscal (NFC-e ou NF-e).' };
    var uf = UF[Number(key.slice(0, 2))];
    if (!uf) return { error: 'A chave tem um código de estado inválido.' };
    return {
      key: key, uf: uf, model: model, cnpj: key.slice(6, 20), number: String(Number(key.slice(25, 34))),
      period: key.slice(4, 6) + '/20' + key.slice(2, 4), url: /^https?:\/\//i.test(raw) ? raw : ''
    };
  };

  NFCe.formatKey = function (k) { return String(k).replace(/(\d{4})(?=\d)/g, '$1 '); };
  NFCe.formatCnpj = function (c) { return String(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'); };

  // Gera um QR de exemplo válido (mesmo formato da SEFAZ-SP) para testar sem uma nota de verdade.
  NFCe.demoQR = function () {
    var d = new Date();
    var store = DB.get().stores[1];
    var body = '35' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + store.cnpj + '65' + '001' +
      String(Math.floor(Math.random() * 1e9)).padStart(9, '0') + '1' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    return 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=' + body + dv(body) + '|2|1|1|3A5F9C';
  };

  // Como cada produto costuma aparecer escrito na nota.
  var NOTE_DESC = { p1: 'QUEIJO MUSSARELA PECA KG', p2: 'QUEIJO PROVOLONE KG', p3: 'QUEIJO GORGONZOLA KG', p4: 'REQUEIJAO CATUPIRY BISN 1,5KG',
    p5: 'LINGUICA CALABRESA FATIADA KG', p6: 'PRESUNTO COZIDO FATIADO KG', p7: 'FRANGO DESFIADO CONG KG', p8: 'BACON CUBOS KG',
    p9: 'FARINHA TRIGO TIPO 00 25KG', p10: 'FERMENTO BIOLOGICO SECO 500G', p11: 'TOMATE PELADO LATA 2,5KG', p12: 'AZEITONA PRETA BALDE',
    p13: 'PALMITO PUPUNHA POTE', p14: 'TOMATE ITALIANO KG', p15: 'CEBOLA KG', p16: 'MANJERICAO MACO UN', p17: 'REFRIG 2L FD 6UN',
    p18: 'AGUA MINERAL FD 12UN', p19: 'CX PIZZA 35CM UN', p20: 'CX PIZZA BROTO 25CM UN' };
  var NOTE_UNIT = { kg: 'KG', 'bisn.': 'UN', saco: 'UN', pct: 'PCT', lata: 'UN', balde: 'UN', pote: 'UN', 'maço': 'UN', fardo: 'FD', un: 'UN' };

  // Busca os itens da nota. Produção: o servidor consulta a SEFAZ (o navegador é bloqueado de acessar direto).
  // Protótipo: devolve uma nota de exemplo com os itens pendentes da lista de compras.
  NFCe.fetchItems = function (parsed) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var d = DB.get();
        var store = d.stores.filter(function (s) { return s.cnpj === parsed.cnpj; })[0];
        var pend = d.shopping.items.filter(function (i) { return i.received == null; });
        if (!pend.length) pend = d.shopping.items.slice(0, 5);
        var items = pend.map(function (it, n) {
          var p = DB.product(it.pid);
          var qty = n === 1 ? Math.max(1, Math.round(it.need * .8)) : it.need; // um item veio a menos, como acontece
          var price = NFCe.lastPrice(p.id, store && store.id) || 10;
          return { desc: NOTE_DESC[p.id] || p.name.toUpperCase(), qty: qty, unit: NOTE_UNIT[p.unit] || 'UN', unitPrice: price, total: Math.round(qty * price * 100) / 100 };
        });
        items.push({ desc: 'SACOLA PLASTICA REFORCADA UN', qty: 4, unit: 'UN', unitPrice: .25, total: 1 });
        resolve({
          demo: true,
          store: { name: store ? store.name : 'Loja ' + NFCe.formatCnpj(parsed.cnpj), cnpj: parsed.cnpj },
          date: Cal.today(),
          items: items,
          total: Math.round(items.reduce(function (s, i) { return s + i.total; }, 0) * 100) / 100
        });
      }, 900);
    });
  };

  NFCe.lastPrice = function (pid, storeId) {
    var list = DB.get().prices.filter(function (x) { return x.pid === pid && (!storeId || x.store === storeId); });
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return list[0] ? list[0].price : null;
  };

  // Reconhece o produto do cadastro a partir da descrição da nota. Usa primeiro o que já foi corrigido antes.
  NFCe.match = function (desc) {
    var d = DB.get();
    var key = norm(desc);
    if (d.matchMemory && d.matchMemory[key]) return { pid: d.matchMemory[key], score: 1, learned: true };
    var dt = tokens(desc), best = null;
    d.products.forEach(function (p) {
      var pt = tokens(p.name);
      var hit = pt.filter(function (t) { return dt.indexOf(t) >= 0; }).length;
      if (!hit) return;
      var score = hit / pt.length;
      if (!best || score > best.score || (score === best.score && hit > best.hit)) best = { pid: p.id, score: score, hit: hit };
    });
    return best && best.score >= .6 ? { pid: best.pid, score: best.score } : null;
  };

  NFCe.remember = function (desc, pid) {
    DB.update(function (x) { x.matchMemory = x.matchMemory || {}; x.matchMemory[norm(desc)] = pid; });
  };

  // Converte a quantidade da nota para a unidade do cadastro (ex.: gramas → kg).
  NFCe.convert = function (qty, noteUnit, product) {
    if (/^g$/i.test(noteUnit) && product.unit === 'kg') return Math.round(qty / 1000 * 1000) / 1000;
    return qty;
  };

  window.NFCe = NFCe;
})();
