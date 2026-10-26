// Captura de fotos e vídeos. No celular, capture="environment" abre direto a câmera traseira.
(function () {
  var MAX = 720;

  function shrink(file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var s = Math.min(1, MAX / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb({ kind: 'image', src: c.toDataURL('image/jpeg', 0.72), name: file.name });
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  // opts.camera: abre a câmera; opts.video: aceita vídeo também.
  window.pickMedia = function (opts, cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = opts.video ? 'image/*,video/*' : 'image/*';
    if (opts.camera) inp.setAttribute('capture', 'environment');
    inp.multiple = !!opts.multiple;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      Array.prototype.forEach.call(inp.files, function (f) {
        if (f.type.indexOf('video') === 0) {
          // Vídeo fica só na sessão: no envio real ele sobe direto para o servidor.
          cb({ kind: 'video', src: URL.createObjectURL(f), name: f.name, temp: true });
        } else {
          shrink(f, function (m) {
            if (m) cb(m);
            else UI.toast('Não foi possível ler a imagem. Tente outra foto.', { tone: 'crit' });
          });
        }
      });
      inp.remove();
    });
    inp.click();
  };

  window.thumbHtml = function (m, i) {
    return '<div class="thumb">' +
      (m.kind === 'video' ? '<video src="' + m.src + '" muted playsinline></video>' : '<img src="' + m.src + '" alt="Anexo ' + (i + 1) + '">') +
      '<button type="button" class="rm" data-rm="' + i + '" aria-label="Remover anexo">' + icon('x') + '</button></div>';
  };
})();
