/* Control Hogar — service worker: guarda la interfaz para que abra rápido.
   Los datos SIEMPRE se piden en vivo a la hoja (nunca se guardan aquí). */
var CACHE = 'control-hogar-1.0.0';
var ARCHIVOS = [
  './', 'index.html', 'styles.css?v=1.0.0', 'config.js?v=1.0.0', 'app.js?v=1.0.0',
  'manifest.webmanifest', 'icons/glyph.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // API y Google: directo a la red
  // Página principal: red primero (para recibir actualizaciones), caché si no hay conexión.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () { return caches.match('./'); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
});
