const CACHE_NAME = 'cashflow-v9';
const ASSETS = [
  '/cashflow-app/',
  '/cashflow-app/index.html',
  '/cashflow-app/app.js',
  '/cashflow-app/style.css',
  '/cashflow-app/icons/icon-192.png',
  '/cashflow-app/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
