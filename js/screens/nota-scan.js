// Estoque › Escanear nota: câmera com moldura, foto da galeria ou chave digitada.
(function () {
  var esc = UI.esc;

  // Valida o que foi lido e segue para a conferência dos itens.
  function handle(text, onBad) {
    var p = NFCe.parse(text);
    if (p.error) { UI.buzz(40); UI.toast(p.error, { tone: 'crit', ms: 3800 }); if (onBad) onBad(); return; }
    UI.buzz(25);
    NotaFlow.pending = { text: text, parsed: p };
    go('estoque/nota/' + p.key);
  }

  function keySheet() {
    UI.sheet('<h2>Digitar chave de acesso</h2>' +
      '<p class="muted">Os 44 números que ficam embaixo do QR Code, na parte de baixo da nota.</p>' +
      '<div class="field" id="f-key"><label for="nf-key">Chave de acesso</label>' +
      '<input id="nf-key" class="input num key-input" inputmode="numeric" autocomplete="off" placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" autofocus>' +
      '<span class="hint" data-count>0 de 44 números</span><span class="err" hidden></span></div>' +
      '<button type="button" class="btn primary block" data-ok>Buscar nota</button><button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        var inp = sheet.querySelector('#nf-key'), f = sheet.querySelector('#f-key');
        inp.addEventListener('input', function () {
          var d = inp.value.replace(/\D/g, '').slice(0, 44);
          inp.value = NFCe.formatKey(d);
          sheet.querySelector('[data-count]').textContent = d.length + ' de 44 números';
          f.classList.remove('error'); f.querySelector('.err').hidden = true;
        });
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          var p = NFCe.parse(inp.value);
          if (p.error) { f.classList.add('error'); var e = f.querySelector('.err'); e.hidden = false; e.textContent = p.error; return; }
          close(); handle(inp.value);
        });
      });
  }

  function fromPhoto(after) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', function () {
      if (!inp.files[0]) return;
      UI.toast('Lendo o QR Code da foto…', { icon: 'image', ms: 1500 });
      Scanner.decodeFile(inp.files[0]).then(function (text) { handle(text); },
        function () { UI.toast('Não achamos um QR Code na foto. Tente mais de perto, com a nota reta e bem iluminada.', { tone: 'crit', ms: 4500 }); if (after) after(); });
    });
    inp.click();
  }

  window.NotaFlow = window.NotaFlow || {};

  Screens.estoque_scan = function () {
    var html = '<main class="scan-screen">' +
      '<video class="scan-video" playsinline muted></video>' +
      '<div class="scan-top"><a class="icon-btn scan-btn" href="#estoque" aria-label="Fechar">' + icon('x') + '</a>' +
      '<span class="scan-title">Escanear nota fiscal</span>' +
      '<button type="button" class="icon-btn scan-btn" data-torch aria-label="Lanterna" hidden>' + icon('flashlight') + '</button></div>' +
      '<div class="scan-frame" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="scan-line"></span></div>' +
      '<p class="scan-msg" data-msg>Aponte a câmera para o QR Code da nota</p>' +
      '<div class="scan-actions">' +
      '<button type="button" class="btn scan-alt" data-photo>' + icon('image', 'sm') + 'Ler de uma foto</button>' +
      '<button type="button" class="btn scan-alt" data-key>' + icon('key', 'sm') + 'Digitar a chave</button>' +
      '</div></main>';

    return {
      html: html, tab: 'estoque', nav: false,
      mount: function (root) {
        var video = root.querySelector('video'), msg = root.querySelector('[data-msg]'), torchBtn = root.querySelector('[data-torch]');
        var ctl = null, torchOn = false;

        function startCam() {
          if (!Scanner.supported()) { camFail(); return; }
          msg.textContent = 'Aponte a câmera para o QR Code da nota';
          ctl = Scanner.start(video, function (text) { handle(text, startCam); }, camFail);
          setTimeout(function () { if (ctl && ctl.hasTorch()) torchBtn.hidden = false; }, 1500);
        }
        function camFail() {
          root.querySelector('.scan-screen').classList.add('no-cam');
          msg.innerHTML = '<b>Não foi possível abrir a câmera.</b><br>Permita o acesso à câmera nas configurações do navegador, ou use uma das opções abaixo.';
        }

        torchBtn.addEventListener('click', function () {
          torchOn = !torchOn;
          ctl.torch(torchOn).then(function (ok) { torchBtn.classList.toggle('on', ok && torchOn); });
        });
        root.querySelector('[data-photo]').addEventListener('click', function () { fromPhoto(); });
        root.querySelector('[data-key]').addEventListener('click', keySheet);

        startCam();
        return function () { if (ctl) ctl.stop(); };
      }
    };
  };
})();
