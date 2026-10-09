// App-shell service worker: network first for pages, cache first for assets.
// Big files (models, packs) are NOT cached here; they live in OPFS via the download manager.
const CACHE = 'collapseai-app';
// ignoreVary: module scripts send an Origin header; cached copies were stored without one
const MATCH = { ignoreVary: true };

async function remember(request, response) {
  if (response.ok) {
    try { await (await caches.open(CACHE)).put(request, response.clone()); } catch { /* A full cache must not hide a reachable response. */ }
  }
  return response;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Remove redundant archives cached by the previous map downloader.
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.endsWith('.pmtiles')) await cache.delete(request);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/packs/') || url.pathname.includes('/models/') || url.pathname.endsWith('.pmtiles') || url.pathname.includes('/api/') || url.pathname.includes('/v1/')) return;

  // Catalogs change when a Hub installs a map; use current metadata when reachable.
  if (url.pathname.endsWith('/offline-maps/regions.json')) {
    e.respondWith(fetch(req).then(async res => {
      if (res.ok) {
        try { await (await caches.open(CACHE)).put(req, res.clone()); } catch { /* Keep reachable metadata usable even if cache storage is full. */ }
      }
      return res;
    }).catch(async () => (await caches.match(req, MATCH)) || new Response(JSON.stringify({ version: 1, updatedAt: '1970-01-01T00:00:00Z', attribution: '© OpenStreetMap contributors', regions: [] }), { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => remember(req, res))
        .catch(() => caches.match(req, MATCH).then((r) => r || caches.match('./', MATCH))),
    );
    return;
  }

  e.respondWith(
    caches.match(req, MATCH).then(
      (hit) =>
        hit ||
        fetch(req).then(res => remember(req, res)),
    ),
  );
});
