const CACHE_NAME = 'movie-catalogue-v2026.03.16.2228';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/api.js',
  './js/ui.js',
  './js/stats.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Let TMDB API and image requests go to network only
  if (url.hostname.includes('themoviedb.org') || url.hostname.includes('tmdb.org')) {
    return;
  }

  // Network-first for same-origin: always try fresh, fall back to cache offline
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
  }
});
