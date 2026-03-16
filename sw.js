const CACHE_NAME = 'cashflow-v11';
const ASSETS = [
  '/cashflow-app/',
  '/cashflow-app/index.html',
  '/cashflow-app/app.js',
  '/cashflow-app/style.css',
  '/cashflow-app/icons/icon-192-v2.png',
  '/cashflow-app/icons/icon-512-v2.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        // Force-reload all open tabs so they get the fresh code
        clients.forEach(client => client.navigate(client.url));
      })
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const ext = url.pathname.split('.').pop();
  // Network-first for code files — always get fresh JS/CSS/HTML
  if (['html', 'js', 'css'].includes(ext) || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for static assets (icons etc.)
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
