// Estoque › Ler nota: foto da nota inteira (uma ou mais partes) → leitura pela função dindom-nota
// (supabase/functions/dindom-nota, com o Claude) → conferência dos itens em js/screens/nota.js.
(function () {
  var esc = UI.esc;
  var FN = 'dindom-nota';
  var FN_FILE = 'supabase/functions/dindom-nota/index.ts';
  var MAX_SIDE = 1800, MAX_PHOTOS = 5;
  var photos = []; // { src (dataURL jpeg), data (base64) } — ficam até ler ou sair

  window.NotaFlow = window.NotaFlow || {};

  // Reduz a foto (nota grande demais pesa no envio) mantendo as letras legíveis.
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var src = c.toDataURL('image/jpeg', 0.82);
        ok({ src: src, data: src.split(',')[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(); };
      img.src = url;
    });
  }

  function pick(camera, done) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = !camera;
    if (camera) inp.setAttribute('capture', 'environment');
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inp.files, 0, MAX_PHOTOS - photos.length);
      inp.remove();
      Promise.all(files.map(function (f) { return shrink(f).catch(function () { return null; }); })).then(function (list) {
        list.forEach(function (p) { if (p) photos.push(p); });
        if (list.some(function (p) { return !p; })) UI.toast('Uma das fotos não pôde ser aberta.', { tone: 'crit' });
        done();
      });
    });
    inp.click();
  }

  // Nota sem chave legível: identificador próprio, para a conferência e o histórico.
  function photoKey() { return 'f' + Date.now().toString(36); }

  function unitOf(u) {
    u = String(u || '').toLowerCase().replace(/[^a-z]/g, '');
    return { kg: 'kg', g: 'kg', un: 'un', und: 'un', unid: 'un', uni: 'un', pc: 'un', pca: 'un', l: 'L', lt: 'L', ml: 'L', cx: 'cx', pct: 'pct', pt: 'pct', fd: 'fardo', fardo: 'fardo', sc: 'saco', lata: 'lata', bd: 'balde' }[u] || 'un';
  }

  // Resposta da leitura → o que a conferência (js/screens/nota.js) usa.
  function toFlow(n) {
    var d = DB.get();
    var digits = String(n.access_key || '').replace(/\D/g, '');
    var parsed = digits.length === 44 ? NFCe.parse(digits) : { error: 1 };
    var cnpj = String(n.cnpj || '').replace(/\D/g, '');
    if (parsed.error) parsed = { key: photoKey(), uf: '', model: '', cnpj: cnpj, number: n.number || '', period: '', photo: true };
    else parsed.photo = true;
    var name = String(n.store_name || '').trim();
    var store = d.stores.filter(function (s) { return (cnpj && s.cnpj === cnpj) || (name && s.name.toLowerCase() === name.toLowerCase()); })[0];
    var date = /^\d{4}-\d{2}-\d{2}$/.test(n.date || '') && n.date <= Cal.today() ? n.date : Cal.today();
    return {
      parsed: parsed,
      data: {
        store: { name: store ? store.name : name, cnpj: cnpj || (store && store.cnpj) || '', known: !!store },
        needStore: !store && !name,
        date: date, total: +n.total || 0, notes: n.notes || '',
        items: (n.items || []).filter(function (it) { return it && it.desc; }).map(function (it) {
          return { desc: it.desc, qty: +it.qty || 1, unit: it.unit || '', unitPrice: +it.unit_price || 0, total: +it.total || 0,
            suggest: { pid: it.product_id || '', qty: +it.product_qty || 0, name: it.product_name || '', cat: it.category || '', kind: it.kind || 'apoio', unit: unitOf(it.unit) } };
        })
      }
    };
  }

  function read(btn, help) {
    if (!(window.Cloud && Cloud.client && Cloud.orgId)) { UI.toast('A leitura da nota precisa de internet e do servidor.', { tone: 'crit' }); return; }
    var d = DB.get();
    var closeWait = UI.sheet('<div class="punch-confirm"><div class="tile info" style="margin:0 auto">' + icon('receipt') + '</div>' +
      '<h2>Lendo a nota…</h2><p class="muted">Loja, data e cada item com quantidade e preço. Leva até um minuto.</p>' +
      '<div class="skel" style="height:8px;margin-top:8px"></div></div>');
    btn.disabled = true;
    Cloud.client.functions.invoke(FN, { body: {
      images: photos.map(function (p) { return { data: p.data, media_type: 'image/jpeg' }; }),
      products: d.products.map(function (p) { return { id: p.id, name: p.name, unit: p.unit }; }),
      categories: d.categories
    } }).then(function (r) {
      closeWait(); btn.disabled = false;
      if (r.error) {
        // Função não publicada ou com erro: tenta ler a mensagem que ela mandou.
        var ctx = r.error.context;
        var status = ctx && ctx.status;
        var p = ctx && ctx.json ? ctx.json().catch(function () { return {}; }) : Promise.resolve({});
        return p.then(function (j) {
          if (status === 404 || /not found|failed to send/i.test(r.error.message || '')) {
            UI.toast(UI.isAdmin() ? 'A leitura de notas ainda não está ligada no Supabase.' : 'A leitura de notas ainda não está ligada. Avise o administrador.', { tone: 'crit', ms: 5000 });
            if (UI.isAdmin()) UI.fnHelp(help, { name: FN, file: FN_FILE, secret: true });
            return;
          }
          UI.toast((j && j.error) || 'Não deu para ler a nota. Tente de novo.', { tone: 'crit', ms: 6000 });
          if (UI.isAdmin() && /ANTHROPIC_API_KEY/.test((j && j.error) || '')) UI.fnHelp(help, { name: FN, file: FN_FILE, secret: true });
        });
      }
      var n = r.data && r.data.nota;
      if (!n || !n.is_receipt) { UI.toast('Isso não parece uma nota de compra. Fotografe a nota inteira, reta e bem iluminada.', { tone: 'crit', ms: 5000 }); return; }
      if (!(n.items || []).length) { UI.toast('Não deu para ler os itens. Tente uma foto mais de perto, uma parte da nota por vez.', { tone: 'crit', ms: 5000 }); return; }
      var flow = toFlow(n);
      photos = [];
      NotaFlow.pending = flow;
      UI.buzz(25);
      go('estoque/nota/' + flow.parsed.key);
    }, function () {
      closeWait(); btn.disabled = false;
      UI.toast('Sem conexão. Confira a internet e tente de novo.', { tone: 'crit' });
    });
  }

  // Sem foto: nota lançada item por item (como antes).
  function manual() {
    var key = photoKey();
    NotaFlow.pending = { parsed: { key: key, uf: '', model: '', cnpj: '', number: '', period: '', photo: true },
      data: { manual: true, store: { name: '', cnpj: '', known: false }, needStore: true, date: Cal.today(), total: 0, items: [] } };
    go('estoque/nota/' + key);
  }

  Screens.estoque_scan = function () {
    var html = '<main class="screen no-nav">' + UI.topbar('Ler nota fiscal', { back: '#estoque', sub: 'A nota vai para o estoque e para a ficha técnica' }) +
      '<section class="card"><div class="card-row"><div class="tile accent">' + icon('camera') + '</div><div class="grow">' +
      '<div class="card-title">Fotografe a nota inteira</div><div class="card-meta">Reta, sem dobras e bem iluminada, com todos os itens aparecendo. ' +
      'Nota comprida? Tire uma foto de cada parte, de cima para baixo (até ' + MAX_PHOTOS + ').</div></div></div></section>' +
      '<div class="nota-photos" data-photos></div>' +
      '<div class="section"><button type="button" class="btn primary block" data-cam style="min-height:56px">' + icon('camera', 'sm') + 'Tirar foto</button>' +
      '<button type="button" class="btn block" data-gal>' + icon('image', 'sm') + 'Escolher da galeria</button></div>' +
      '<div data-fnhelp hidden></div>' +
      '<div class="dock no-nav"><div class="dock-inner"><div class="grow"><b data-count></b><span class="card-meta">Depois você confere item por item</span></div>' +
      '<button type="button" class="btn primary" data-read>Ler a nota</button></div></div>' +
      '<button type="button" class="btn ghost block" data-manual>Lançar os itens à mão, sem foto</button>' +
      '</main>';
    return {
      html: html, tab: 'estoque', nav: false,
      mount: function (root) {
        var box = root.querySelector('[data-photos]'), readBtn = root.querySelector('[data-read]');
        function paint() {
          box.innerHTML = photos.map(function (p, i) {
            return '<div class="nota-photo"><img src="' + p.src + '" alt="Parte ' + (i + 1) + ' da nota"><span>' + (i + 1) + '</span>' +
              '<button type="button" class="rm" data-rm="' + i + '" aria-label="Tirar a foto ' + (i + 1) + '">' + icon('x') + '</button></div>';
          }).join('');
          root.querySelector('[data-count]').textContent = photos.length ? photos.length + (photos.length === 1 ? ' foto' : ' fotos') : 'Nenhuma foto ainda';
          readBtn.disabled = !photos.length;
          var full = photos.length >= MAX_PHOTOS;
          root.querySelector('[data-cam]').disabled = full; root.querySelector('[data-gal]').disabled = full;
          root.querySelector('[data-cam]').lastChild.textContent = photos.length ? 'Tirar foto da próxima parte' : 'Tirar foto';
        }
        paint();
        root.addEventListener('click', function (e) {
          if (e.target.closest('[data-cam]')) return pick(true, paint);
          if (e.target.closest('[data-gal]')) return pick(false, paint);
          var rm = e.target.closest('[data-rm]');
          if (rm) { photos.splice(+rm.dataset.rm, 1); return paint(); }
          if (e.target.closest('[data-read]') && photos.length) return read(readBtn, root.querySelector('[data-fnhelp]'));
          if (e.target.closest('[data-manual]')) return manual();
        });
      }
    };
  };
})();
