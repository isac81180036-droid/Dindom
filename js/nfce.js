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

  // Busca os itens da nota. A consulta à SEFAZ precisa do servidor (o navegador é bloqueado de acessar direto),
  // então, por enquanto, a nota entra em modo manual: loja, número e data vêm da chave e os itens são lançados à mão.
  NFCe.fetchItems = function (parsed) {
    var d = DB.get();
    var store = d.stores.filter(function (s) { return s.cnpj === parsed.cnpj; })[0];
    return Promise.resolve({
      manual: true,
      store: { name: store ? store.name : '', cnpj: parsed.cnpj, known: !!store },
      date: Cal.today(),
      items: [],
      total: 0
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
