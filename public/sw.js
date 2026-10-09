// App-shell service worker: network first for pages, cache first for assets.
// Big files (models, packs) are NOT cached here; they live in OPFS via the download manager.
const CACHE = 'collapseai-app';
// ignoreVary: module scripts send an Origin header; cached copies were stored without one
const MATCH = { ignoreVary: true };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/packs/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, MATCH).then((r) => r || caches.match('./', MATCH))),
    );
    return;
  }

  e.respondWith(
    caches.match(req, MATCH).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
