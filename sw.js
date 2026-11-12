// Service worker: guarda a casca do app para abrir rápido e funcionar sem internet.
var CACHE = 'dindom-v40';
var SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-64.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/logo-white.png', './img/tela-inicio.png', './img/tela-agenda.png', './img/tela-ponto.png', './icons/wordmark-black.png',
  './css/tokens.css', './css/app.css', './css/screens.css', './css/agenda.css', './css/desktop.css', './css/brand.css', './css/nota.css', './css/ponto.css', './css/login.css', './css/cmv.css', './css/relatorios.css',
  './js/agenda/core.js', './js/agenda/views.js', './js/agenda/form.js', './js/agenda/drag.js', './js/screens/agenda.js', './js/screens/reservas.js', './js/screens/equipe.js',
  './js/vendor/supabase.js', './js/config.js', './js/cloud.js', './js/nfce.js', './js/screens/nota-scan.js', './js/screens/nota.js', './js/screens/precos.js',
  './js/ponto-core.js', './js/ponto-export.js', './js/screens/ponto.js', './js/screens/ponto-equipe.js', './js/auth.js', './js/screens/login.js', './js/screens/setup.js', './js/screens/produtos.js', './js/screens/estacoes.js', './js/screens/checklist-edit.js', './js/screens/vendas-insights.js', './js/screens/vendas.js', './js/cmv-core.js', './js/cmv-seed.js', './js/screens/cmv.js', './js/fin-core.js', './js/screens/financeiro.js', './js/charts.js', './js/rel-core.js', './js/screens/relatorios.js',
  './js/icons.js', './js/data.js', './js/ui.js', './js/alerts.js', './js/geo.js', './js/media.js', './js/app.js',
  './js/screens/home.js', './js/screens/fechamento.js', './js/screens/estoque.js',
  './js/screens/checklists.js', './js/screens/manutencao.js', './js/screens/perfil.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Aviso que chega com o app fechado (Web Push, supabase/functions/dindom-push): mostra na barra do celular.
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Dindom', {
    body: d.body || '', tag: d.tag, renotify: true, requireInteraction: true,
    icon: './icons/icon-192.png', badge: './icons/icon-64.png', data: { url: d.url || '#vendas' }
  }));
});

// Toque no aviso: volta para o app aberto ou abre na tela certa (lá aparece a janela com o motivo).
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL('./' + ((e.notification.data && e.notification.data.url) || ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ('focus' in list[i]) return list[i].focus();
    return self.clients.openWindow(url);
  }));
});

// Rede primeiro (para receber atualizações); se falhar, usa o cache.
// Arquivos do próprio site são buscados confirmando com o servidor (no-cache): uma atualização
// publicada aparece na próxima abertura, sem esperar o cache do navegador vencer.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // Só os arquivos do próprio app passam por aqui. Dados do Supabase e fontes vão direto à rede
  // (o app já guarda a própria cópia dos dados; respostas do servidor não ficam no cache).
  if (new URL(e.request.url).origin !== self.location.origin) return;
  var net = fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
  e.respondWith(
    net.then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
