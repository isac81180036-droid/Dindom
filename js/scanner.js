// Leitor de QR Code pela câmera ou por foto. Usa o leitor nativo do aparelho quando existe (Android/Chrome)
// e, se não, a biblioteca jsQR (carregada só quando precisa).
(function () {
  var jsqrLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrLoading) jsqrLoading = new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'js/vendor/jsQR.js';
      s.onload = function () { ok(window.jsQR); };
      s.onerror = function () { jsqrLoading = null; fail(new Error('jsqr')); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }

  var native = null;
  function nativeDetector() {
    if (native !== null) return Promise.resolve(native);
    if (!('BarcodeDetector' in window)) { native = false; return Promise.resolve(false); }
    return window.BarcodeDetector.getSupportedFormats().then(function (f) {
      native = f.indexOf('qr_code') >= 0 ? new window.BarcodeDetector({ formats: ['qr_code'] }) : false;
      return native;
    }, function () { native = false; return false; });
  }

  // Lê o QR de uma imagem/vídeo desenhado no canvas.
  function decodeCanvas(canvas, ctx, src, w, h, both) {
    canvas.width = w; canvas.height = h;
    ctx.drawImage(src, 0, 0, w, h);
    var r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
    return r ? r.data : null;
  }

  var Scanner = {};

  Scanner.supported = function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); };

  // Liga a câmera traseira no <video> e chama onResult(texto) ao achar um QR. Retorna { stop, torch }.
  Scanner.start = function (video, onResult, onError) {
    var stream = null, stopped = false, timer = 0;
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

    function tick(detector) {
      if (stopped) return;
      if (video.readyState >= 2) {
        var done = function (text) { if (text && !stopped) { ctl.stop(); onResult(text); } else timer = setTimeout(function () { tick(detector); }, 160); };
        if (detector) {
          detector.detect(video).then(function (codes) { done(codes[0] && codes[0].rawValue); }, function () { done(null); });
          return;
        }
        var s = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
        done(decodeCanvas(canvas, ctx, video, Math.round(video.videoWidth * s), Math.round(video.videoHeight * s), false));
        return;
      }
      timer = setTimeout(function () { tick(detector); }, 160);
    }

    var ctl = {
      stop: function () {
        stopped = true; clearTimeout(timer);
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      },
      // Lanterna (quando o aparelho permite): ajuda a ler nota em lugar escuro.
      torch: function (on) {
        var t = stream && stream.getVideoTracks()[0];
        if (!t || !t.getCapabilities || !t.getCapabilities().torch) return Promise.resolve(false);
        return t.applyConstraints({ advanced: [{ torch: on }] }).then(function () { return true; }, function () { return false; });
      },
      hasTorch: function () {
        var t = stream && stream.getVideoTracks()[0];
        return !!(t && t.getCapabilities && t.getCapabilities().torch);
      }
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (s) {
        if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; video.srcObject = s; video.setAttribute('playsinline', ''); video.muted = true;
        return video.play().then(function () {
          return nativeDetector().then(function (det) {
            if (det) return tick(det);
            return loadJsQR().then(function () { tick(null); });
          });
        });
      })
      .catch(function (err) { if (!stopped) onError(err); });
    return ctl;
  };

  // Lê o QR de uma foto tirada ou escolhida da galeria.
  Scanner.decodeFile = function (file) {
    return new Promise(function (ok, fail) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        nativeDetector().then(function (det) {
          if (det) return det.detect(img).then(function (c) { return c[0] && c[0].rawValue; }, function () { return null; });
          return null;
        }).then(function (text) {
          if (text) return text;
          return loadJsQR().then(function () {
            var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
            // Tenta alguns tamanhos: fotos grandes demais ou pequenas demais atrapalham a leitura.
            var sizes = [1400, 900, 600];
            for (var i = 0; i < sizes.length; i++) {
              var s = Math.min(1, sizes[i] / Math.max(img.width, img.height));
              var r = decodeCanvas(canvas, ctx, img, Math.round(img.width * s), Math.round(img.height * s), true);
              if (r) return r;
            }
            return null;
          });
        }).then(function (text) { URL.revokeObjectURL(url); text ? ok(text) : fail(new Error('notfound')); },
          function (e) { URL.revokeObjectURL(url); fail(e); });
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error('image')); };
      img.src = url;
    });
  };

  window.Scanner = Scanner;
})();
