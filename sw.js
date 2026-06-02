const CACHE = 'ispeaker-v12';
const BASE = new URL('./', self.registration.scope).href;
const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'css/style.css',
  BASE + 'js/app.js',
  BASE + 'js/broadcast.js',
  BASE + 'manifest.json',
  BASE + 'icon.svg',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(BASE + 'index.html')
        .then(cached => cached || fetch(BASE + 'index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
