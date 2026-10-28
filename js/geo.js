// Trava de localização do ponto: só deixa bater o ponto perto da loja.
// O local de cada unidade fica em unit.geo = { lat, lng, radius } (definido pelo administrador no Perfil).
// Unidade sem local definido: sem trava. Aparelho marcado como "fica na loja" (ex.: computador do
// ponto por código, que não tem GPS): sem trava, porque ele não sai do estabelecimento.
(function () {
  var TRUSTED = 'dindom:aparelho-da-loja';
  var MAX_ACC = 100;   // precisão pior que isso não serve para decidir
  var SLACK = 20;      // folga pela margem de erro do GPS, somada ao raio

  function rad(x) { return x * Math.PI / 180; }

  var Geo = {
    RADIUS: 30,
    // Distância em metros entre dois pontos (fórmula de haversine).
    distance: function (a, b) {
      var R = 6371000, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
      var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return 2 * R * Math.asin(Math.sqrt(h));
    },
    trusted: function () { try { return localStorage.getItem(TRUSTED) === '1'; } catch (e) { return false; } },
    setTrusted: function (on) { try { if (on) localStorage.setItem(TRUSTED, '1'); else localStorage.removeItem(TRUSTED); } catch (e) {} },

    // Posição atual do aparelho: { lat, lng, acc }. Rejeita com { reason: 'denied' | 'off' | 'unsupported' }.
    here: function () {
      return new Promise(function (resolve, reject) {
        if (!navigator.geolocation || !window.isSecureContext) return reject({ reason: 'unsupported' });
        navigator.geolocation.getCurrentPosition(function (p) {
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) });
        }, function (err) {
          reject({ reason: err && err.code === 1 ? 'denied' : 'off' });
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
      });
    },

    // Confere se dá para bater o ponto na unidade. Resolve com { ok, msg, geo }:
    // geo vai junto da marcação, para conferência ({ dist, acc } ou { trusted: true }).
    check: function (unit) {
      var g = unit && unit.geo;
      if (!g || g.lat == null || g.lng == null) return Promise.resolve({ ok: true, geo: null });
      if (Geo.trusted()) return Promise.resolve({ ok: true, geo: { trusted: true } });
      var radius = g.radius || Geo.RADIUS;
      return Geo.here().then(function (pos) {
        if (pos.acc > MAX_ACC) {
          return { ok: false, msg: 'O sinal de localização está fraco (erro de ' + pos.acc + ' m). Ligue o GPS em modo de alta precisão, chegue perto da porta ou de uma janela e tente de novo.' };
        }
        var dist = Math.round(Geo.distance(pos, g));
        if (dist <= radius + Math.min(pos.acc, SLACK)) return { ok: true, geo: { dist: dist, acc: pos.acc } };
        return { ok: false, far: true, dist: dist, msg: 'Você está a ' + (dist >= 1000 ? (dist / 1000).toFixed(1).replace('.', ',') + ' km' : dist + ' m') +
          ' da loja. O ponto só pode ser batido a até ' + radius + ' m do estabelecimento.' };
      }, function (e) {
        var msg = e.reason === 'denied'
          ? 'O app precisa da sua localização para bater o ponto. Toque no cadeado ao lado do endereço do site (ou nas configurações do app), permita "Localização" e tente de novo.'
          : e.reason === 'unsupported' ? 'Este aparelho não informa a localização. Bata o ponto pelo celular ou no aparelho da loja.'
          : 'Não consegui pegar sua localização. Ligue a localização (GPS) do celular e tente de novo.';
        return { ok: false, msg: msg };
      });
    },

    // "0.0812672, -51.0640875" (ou link do Google Maps com essas coordenadas) → { lat, lng }.
    parse: function (s) {
      var m = String(s || '').match(/(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
      if (!m) return null;
      var lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
      return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;
    },
    mapLink: function (g) { return 'https://www.google.com/maps?q=' + g.lat + ',' + g.lng; }
  };

  window.Geo = Geo;
})();
