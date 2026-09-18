const CACHE_NAME = 'movie-catalogue-v2026.09.18.1305';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/api.js',
  './js/ui.js',
  './js/stats.js',
  './js/sync.js',
  './js/posters.js',
  './js/app.js',
  './manifest.json',
  './icons/logo.jpg',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // cache.addAll() is atomic: a single 404 rejects it, the install fails,
      // the worker never activates or claims clients, and offline support
      // disappears silently (registration errors used to be swallowed too).
      // Cache each asset on its own so one missing file costs only that file.
      Promise.all(ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('[sw] could not precache', url, err))
      ))
    )
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

  // Let Wikipedia/Wikidata API requests go to network only
  if (url.hostname.includes('wikipedia.org') || url.hostname.includes('wikidata.org')) {
    return;
  }

  // Let GitHub API requests go to network only
  if (url.hostname.includes('github.com') || url.hostname.includes('api.github.com')) {
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
        // index.html requests assets as `styles.css?v=...`, but install-time
        // precached them unversioned. Without ignoreSearch the precache is
        // never hit and a first-run-offline launch finds nothing.
        return caches.match(e.request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html', { ignoreSearch: true });
          }
        });
      })
    );
  }
});
