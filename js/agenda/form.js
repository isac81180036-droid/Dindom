// Agenda: painel de detalhes e formulário de criar/editar evento.
(function () {
  var esc = UI.esc;

  function find(id) { return DB.get().events.filter(function (e) { return e.id === id; })[0]; }

  var Form = {};

  Form.detail = function (id, date) {
    var e = find(id);
    if (!e) return;
    // Reserva pelo link público: abre o painel da reserva (status, respostas, WhatsApp), não o editor comum.
    if (e.reserva && window.Reservas) return Reservas.open(e.reserva.id);
    var c = Cal.calendar(e.cal);
    var rep = Cal.repeatLabel(e);
    UI.sheet(
      '<div class="ev-detail" style="--c:var(--cal-' + Cal.colorOf(e) + ')">' +
      '<div class="card-row"><span class="ev-swatch"></span><h2 class="grow">' + esc(e.title) + '</h2></div>' +
      '<div class="ev-lines">' +
      '<div>' + icon('clock', 'sm') + '<span>' + esc(Cal.dayTitle(date)) + '<br><span class="muted num">' + Cal.timeRange(e) + (rep ? ' · ' + rep : '') + '</span></span></div>' +
      (e.place ? '<div>' + icon('mapPin', 'sm') + '<span>' + esc(e.place) + '</span></div>' : '') +
      (e.notes ? '<div>' + icon('message', 'sm') + '<span>' + esc(e.notes) + '</span></div>' : '') +
      '<div>' + icon('calendar', 'sm') + '<span>' + esc(c.name) + '</span></div>' +
      '</div></div>' +
      '<div class="seg"><button type="button" data-edit>' + icon('settings', 'sm') + 'Editar</button><button type="button" data-del>' + icon('x', 'sm') + 'Excluir</button></div>' +
      '<button type="button" class="btn block" data-close>Fechar</button>',
      function (sheet, close) {
        sheet.querySelector('[data-edit]').addEventListener('click', function () { close(); Form.edit(e); });
        sheet.querySelector('[data-del]').addEventListener('click', function () {
          close();
          UI.confirm({
            title: 'Excluir "' + e.title + '"?',
            body: e.repeat !== 'none' ? 'Todas as repetições deste evento serão excluídas.' : 'O evento sai da agenda de todos da unidade.',
            ok: 'Excluir evento', danger: true,
            onOk: function () {
              var copy = JSON.parse(JSON.stringify(e));
              DB.update(function (x) { x.events = x.events.filter(function (y) { return y.id !== e.id; }); });
              refresh();
              UI.toast('Evento excluído', { action: 'Desfazer', ms: 4500, onAction: function () { DB.update(function (x) { x.events.push(copy); }); refresh(); } });
            }
          });
        });
      }
    );
  };

  // ev: evento existente, ou valores iniciais { date, start, end, allDay }.
  // onClose: chamado quando o painel fecha (salvando ou cancelando).
  Form.edit = function (ev, onClose) {
    var d = DB.get();
    var isNew = !ev.id;
    var v = {
      title: ev.title || '', cal: ev.cal || d.calendars[0].id, date: ev.date || Cal.today(),
      start: ev.start || '09:00', end: ev.end || '10:00', allDay: !!ev.allDay,
      repeat: ev.repeat || 'none', place: ev.place || '', notes: ev.notes || '', color: ev.color || 0
    };
    var weekday = Cal.WEEK[Cal.parse(v.date).getDay()];

    UI.sheet(
      '<h2>' + (isNew ? 'Novo evento' : 'Editar evento') + '</h2>' +
      '<div class="field" id="f-ev-title"><label for="ev-title">Título</label><input id="ev-title" class="input" maxlength="80" placeholder="Ex.: entrega de bebidas" value="' + esc(v.title) + '"' + (isNew ? ' autofocus' : '') + '>' +
      '<span class="err" hidden>Dê um nome ao evento.</span></div>' +
      '<div class="field"><span class="label">Agenda</span><div class="chips wrap" data-cals>' + d.calendars.map(function (c) {
        return '<button type="button" class="chip" data-cal="' + c.id + '" aria-pressed="' + (c.id === v.cal) + '" style="--c:var(--cal-' + c.color + ')"><span class="cal-dot"></span>' + esc(c.name) + '</button>';
      }).join('') + '</div></div>' +
      // Cor: "da agenda" (padrão) ou uma cor própria do evento.
      '<div class="field"><span class="label">Cor</span><div class="color-pick" data-colors>' +
      '<button type="button" class="auto" data-color="0" aria-pressed="' + !v.color + '" style="--c:var(--cal-' + Cal.calendar(v.cal).color + ')"><span class="cal-dot"></span>Da agenda</button>' +
      Cal.COLORS.map(function (c) {
        return '<button type="button" data-color="' + c[0] + '" aria-pressed="' + (c[0] === v.color) + '" aria-label="' + c[1] + '" title="' + c[1] + '" style="--c:var(--cal-' + c[0] + ')">' + icon('check', 'sm') + '</button>';
      }).join('') + '</div></div>' +
      '<label class="row" for="ev-allday" style="padding:0;min-height:var(--tap)"><span class="grow card-title">Dia inteiro</span><input id="ev-allday" type="checkbox" class="switch"' + (v.allDay ? ' checked' : '') + '></label>' +
      '<div class="ev-when">' +
      '<div class="field"><label for="ev-date">Data</label><input id="ev-date" type="date" class="input" value="' + v.date + '"></div>' +
      '<div class="field" data-times' + (v.allDay ? ' hidden' : '') + '><label for="ev-start">Início</label><input id="ev-start" type="time" class="input num" step="900" value="' + v.start + '"></div>' +
      '<div class="field" id="f-ev-end" data-times' + (v.allDay ? ' hidden' : '') + '><label for="ev-end">Fim</label><input id="ev-end" type="time" class="input num" step="900" value="' + v.end + '"></div>' +
      '</div>' +
      '<span class="err" id="ev-time-err" hidden style="font-size:var(--fs-xs);color:var(--crit);font-weight:600">O fim precisa ser depois do início.</span>' +
      '<div class="field"><label for="ev-repeat">Repetir</label><select id="ev-repeat" class="select">' +
      '<option value="none"' + (v.repeat === 'none' ? ' selected' : '') + '>Não se repete</option>' +
      '<option value="daily"' + (v.repeat === 'daily' ? ' selected' : '') + '>Todos os dias</option>' +
      '<option value="weekly"' + (v.repeat === 'weekly' ? ' selected' : '') + ' data-weekly>Toda ' + weekday + '</option></select></div>' +
      '<div class="field"><label for="ev-place">Local <span class="faint">(opcional)</span></label><input id="ev-place" class="input" placeholder="Ex.: cozinha, doca, salão" value="' + esc(v.place) + '"></div>' +
      '<div class="field"><label for="ev-notes">Descrição <span class="faint">(opcional)</span></label><textarea id="ev-notes" class="textarea" style="min-height:72px">' + esc(v.notes) + '</textarea></div>' +
      '<button type="button" class="btn primary block" data-save>' + (isNew ? 'Salvar evento' : 'Salvar alterações') + '</button>' +
      '<button type="button" class="btn block" data-close>Cancelar</button>',
      function (sheet, close) {
        function $(s) { return sheet.querySelector(s); }
        sheet.querySelectorAll('[data-cal]').forEach(function (b) {
          b.addEventListener('click', function () {
            sheet.querySelectorAll('[data-cal]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
            v.cal = b.dataset.cal;
            $('[data-color="0"]').style.setProperty('--c', 'var(--cal-' + Cal.calendar(v.cal).color + ')');
          });
        });
        sheet.querySelectorAll('[data-color]').forEach(function (b) {
          b.addEventListener('click', function () {
            sheet.querySelectorAll('[data-color]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
            v.color = Number(b.dataset.color);
          });
        });
        $('#ev-allday').addEventListener('change', function () {
          sheet.querySelectorAll('[data-times]').forEach(function (f) { f.hidden = $('#ev-allday').checked; });
        });
        $('#ev-date').addEventListener('change', function () {
          if ($('#ev-date').value) $('[data-weekly]').textContent = 'Toda ' + Cal.WEEK[Cal.parse($('#ev-date').value).getDay()];
        });
        // Mudar o início empurra o fim, mantendo a duração.
        var dur = Cal.mins(v.end) - Cal.mins(v.start);
        $('#ev-start').addEventListener('change', function () {
          if (!$('#ev-start').value) return;
          var e = Math.min(Cal.mins($('#ev-start').value) + Math.max(dur, 15), 23 * 60 + 59);
          $('#ev-end').value = Cal.hhmm(e);
        });
        $('#ev-end').addEventListener('change', function () { dur = Cal.mins($('#ev-end').value) - Cal.mins($('#ev-start').value); });

        var save = $('[data-save]');
        save.addEventListener('click', function () {
          var out = {
            title: $('#ev-title').value.trim(), cal: v.cal, date: $('#ev-date').value || v.date,
            allDay: $('#ev-allday').checked, start: $('#ev-start').value, end: $('#ev-end').value,
            repeat: $('#ev-repeat').value, place: $('#ev-place').value.trim(), notes: $('#ev-notes').value.trim()
          };
          var ok = true;
          $('#f-ev-title').classList.toggle('error', !out.title);
          $('#f-ev-title .err').hidden = !!out.title;
          if (!out.title) ok = false;
          var badTime = !out.allDay && (!out.start || !out.end || Cal.mins(out.end) <= Cal.mins(out.start));
          $('#f-ev-end').classList.toggle('error', badTime);
          $('#ev-time-err').hidden = !badTime;
          if (badTime) ok = false;
          if (!ok) return;
          if (out.allDay) { delete out.start; delete out.end; }
          if (v.color) out.color = v.color;
          UI.busy(save, function () {
            DB.update(function (x) {
              if (isNew) { out.id = 'e' + Date.now(); x.events.push(out); }
              else { var t = x.events.filter(function (y) { return y.id === ev.id; })[0]; Object.keys(out).forEach(function (k) { t[k] = out[k]; }); if (out.allDay) { delete t.start; delete t.end; } if (!v.color) delete t.color; }
            });
            close();
            if (window.Agenda) Agenda.focus(out.date);
            refresh(); UI.buzz(15);
            UI.toast(isNew ? 'Evento criado para ' + Cal.dayTitle(out.date).toLowerCase() : 'Evento atualizado');
          });
        });
      },
      onClose
    );
  };

  window.CalForm = Form;
})();
