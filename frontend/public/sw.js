// App-shell service worker: makes CollapseAI open and run with no internet.
//
// Install: download EVERY file in precache.json (written at build time: HTML, all JS chunks including
// screens you never opened, CSS, the AI engine .wasm, map fonts/sprites, icons). The worker only
// counts as installed once all of them are cached, so "installed" really means "works offline".
// The build stamps SHELL_VERSION at the top of this file, so each new build is a new worker and
// phones update cleanly. Old build files are removed on activate.
//
// Big user downloads (packs, models, map regions) are NOT cached here; they live in OPFS / their
// own managers. In `vite dev` this file is not registered.

/* global SHELL_VERSION */
const VERSION = typeof SHELL_VERSION === 'string' ? SHELL_VERSION : 'dev';
const CACHE = 'collapseai-app'; // shared name: the map downloader and system status read it too
// ignoreVary: module scripts send an Origin header; cached copies were stored without one
const MATCH = { ignoreVary: true };

async function remember(request, response) {
  if (response.ok) {
    try { await (await caches.open(CACHE)).put(request, response.clone()); } catch { /* A full cache must not hide a reachable response. */ }
  }
  return response;
}

async function precacheList() {
  const res = await fetch(`./precache.json?v=${VERSION}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`precache.json: HTTP ${res.status}`);
  const { urls } = await res.json();
  return urls.map((u) => new URL(u, self.registration.scope).href);
}

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const urls = await precacheList();
  const cache = await caches.open(CACHE);
  // cache: 'reload' skips the HTTP cache so a new build never stores an old file
  await Promise.all(urls.map(async (url) => {
    const res = await fetch(url, { cache: 'reload' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await cache.put(url, res);
  }));
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  let keep = null;
  try { keep = new Set(await precacheList()); } catch { /* offline during activate: keep everything */ }
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    // Old map archives from an earlier downloader, and JS/CSS/wasm from previous builds.
    if (path.endsWith('.pmtiles') || (keep && path.includes('/assets/') && !keep.has(request.url))) await cache.delete(request);
  }
  await self.clients.claim();
})()));

self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source?.postMessage({ type: 'shell-version', version: VERSION });
});

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

  // Pages: network first (to get new builds), cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => remember(req, res))
        .catch(() => caches.match(req, MATCH).then((r) => r || caches.match(new URL('./', self.registration.scope).href, MATCH))),
    );
    return;
  }

  // Everything else (hashed assets, wasm, fonts): cache first, network as fallback.
  e.respondWith(
    caches.match(req, MATCH).then(
      (hit) =>
        hit ||
        fetch(req).then(res => remember(req, res)),
    ),
  );
});
