// Agenda: pressionar e arrastar num horário vazio para criar um evento, como no Google Agenda.
// Mouse: clicar e arrastar. Toque: segurar um instante e arrastar (um toque rápido só cria no horário).
(function () {
  var SNAP = 15;          // minutos
  var HOLD = 320;         // ms segurando até o arraste começar no toque
  var SLOP = 8;           // px que o dedo pode mexer antes de virar rolagem
  var EDGE = 48;          // px perto da borda que fazem a grade rolar sozinha

  function minutesAt(col, clientY) {
    var y = clientY - col.getBoundingClientRect().top;
    return Math.max(0, Math.min(24 * 60, y / CalViews.HOUR * 60));
  }
  function snapDown(m) { return Math.floor(m / SNAP) * SNAP; }
  function snapRound(m) { return Math.round(m / SNAP) * SNAP; }
  function label(s, e) {
    var d = e - s, h = Math.floor(d / 60), m = d % 60;
    return Cal.hhmm(s) + ' – ' + Cal.hhmm(Math.min(e, 1439)) + ' · ' + (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }

  // onCreate(date, startMin, endMin, ghost): chamado ao soltar (ou num toque rápido).
  window.CalDrag = {
    attach: function (scroller, onCreate) {
      var st = null;          // arraste em andamento
      var lastTouch = 0;      // evita o clique "fantasma" que o navegador gera depois do toque
      var raf = 0;

      function ghostFor(col) {
        var g = document.createElement('div');
        g.className = 'ev ghost';
        g.innerHTML = '<b>Novo evento</b><span class="num"></span>';
        col.appendChild(g);
        return g;
      }

      function update(clientY) {
        st.y = clientY;
        var m = minutesAt(st.col, clientY);
        var a = st.anchor, s, e;
        // Arrastar para cima do ponto inicial também funciona: o ponto inicial vira o fim.
        if (m >= a) { s = a; e = Math.max(snapRound(m), a + SNAP); }
        else { s = snapDown(m); e = a + SNAP; }
        if (st.minEnd && e < st.minEnd && m >= a) e = st.minEnd;
        e = Math.min(e, 24 * 60);
        st.s = s; st.e = e;
        st.ghost.style.top = (s / 60 * CalViews.HOUR) + 'px';
        st.ghost.style.height = ((e - s) / 60 * CalViews.HOUR - 2) + 'px';
        st.ghost.querySelector('span').textContent = label(s, e);
        st.ghost.classList.toggle('short', (e - s) <= 30);
      }

      // Rola a grade quando o arraste chega perto da borda de cima ou de baixo.
      function edgeLoop() {
        if (!st || !st.active) return;
        var r = scroller.getBoundingClientRect();
        var dy = 0;
        if (st.y > r.bottom - EDGE) dy = Math.min(14, (st.y - (r.bottom - EDGE)) / 3);
        else if (st.y < r.top + EDGE + 60) dy = -Math.min(14, ((r.top + EDGE + 60) - st.y) / 3);
        if (dy) { scroller.scrollTop += dy; update(st.y); }
        raf = requestAnimationFrame(edgeLoop);
      }

      function begin(col, clientY, minEnd) {
        var a = snapDown(minutesAt(col, clientY));
        st.col = col; st.anchor = Math.min(a, 24 * 60 - SNAP); st.minEnd = minEnd ? st.anchor + minEnd : 0;
        st.active = true;
        st.ghost = ghostFor(col);
        scroller.classList.add('dragging');
        update(clientY);
        raf = requestAnimationFrame(edgeLoop);
      }

      function finish() {
        var s = st;
        st = null;
        cancelAnimationFrame(raf);
        scroller.classList.remove('dragging');
        if (!s.active) return;
        s.ghost.classList.add('placed');
        UI.buzz(12);
        onCreate(s.col.dataset.date, s.s, s.e, s.ghost);
      }

      function abort() {
        if (!st) return;
        clearTimeout(st.timer);
        cancelAnimationFrame(raf);
        scroller.classList.remove('dragging');
        if (st.ghost) st.ghost.remove();
        st = null;
      }

      function colFrom(target) {
        // Só começa em área vazia da coluna, nunca em cima de um evento.
        return target.classList && target.classList.contains('tg-col') ? target : null;
      }

      // ---------- Mouse ----------
      scroller.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || Date.now() - lastTouch < 800) return;
        var col = colFrom(e.target);
        if (!col) return;
        e.preventDefault(); // evita selecionar texto
        st = { col: col, x0: e.clientX, y0: e.clientY, y: e.clientY, active: false };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      function onMouseMove(e) {
        if (!st) return;
        if (!st.active) {
          if (Math.abs(e.clientY - st.y0) < 4) return;
          begin(st.col, st.y0);
        }
        update(e.clientY);
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!st) return;
        // Clique sem arrastar: cria 1 hora a partir daquele horário.
        if (!st.active) begin(st.col, st.y0, 60);
        finish();
      }

      // ---------- Toque ----------
      scroller.addEventListener('touchstart', function (e) {
        lastTouch = Date.now();
        if (e.touches.length !== 1) { abort(); return; }
        var col = colFrom(e.target);
        if (!col) return;
        var t = e.touches[0];
        st = { col: col, x0: t.clientX, y0: t.clientY, y: t.clientY, active: false, moved: false };
        st.timer = setTimeout(function () {
          if (!st || st.moved) return;
          UI.buzz(18);
          begin(col, st.y0, 30); // segurou: já aparece um bloco de 30 min, que cresce ao arrastar
        }, HOLD);
      }, { passive: true });

      scroller.addEventListener('touchmove', function (e) {
        if (!st) return;
        var t = e.touches[0];
        if (!st.active) {
          // Mexeu antes do tempo: é rolagem, não criação.
          if (Math.abs(t.clientY - st.y0) > SLOP || Math.abs(t.clientX - st.x0) > SLOP) { st.moved = true; clearTimeout(st.timer); st = null; }
          return;
        }
        e.preventDefault(); // segura a rolagem enquanto arrasta o bloco
        update(t.clientY);
      }, { passive: false });

      scroller.addEventListener('touchend', function (e) {
        lastTouch = Date.now();
        if (!st) return;
        clearTimeout(st.timer);
        if (st.active) { e.preventDefault(); finish(); return; }
        if (!st.moved) {
          // Toque rápido: cria 1 hora no horário tocado.
          e.preventDefault();
          begin(st.col, st.y0, 60);
          finish();
        } else st = null;
      }, { passive: false });

      scroller.addEventListener('touchcancel', abort);
      // Segurar o dedo não deve abrir o menu do navegador.
      scroller.addEventListener('contextmenu', function (e) { if (colFrom(e.target) || (st && st.active)) e.preventDefault(); });
    }
  };
})();
