// App-shell service worker: makes CollapseAI open and run with no internet.
//
// Install: download EVERY file in precache.json (written at build time: HTML, all JS chunks including
// screens you never opened, CSS, the AI engine .wasm, map fonts/sprites, icons). The worker only
// counts as installed once all of them are cached, so "installed" really means "works offline".
// The build stamps SHELL_VERSION at the top of this file, so each new build is a new worker and
// phones update cleanly. Each complete build has its own cache; existing windows
// finish using their worker before an update activates and old shells are removed.
//
// Big user downloads (packs, models, map regions) are NOT cached here; they live in OPFS / their
// own managers. In `vite dev` this file is not registered.

/* global SHELL_VERSION */
const VERSION = typeof SHELL_VERSION === 'string' ? SHELL_VERSION : 'dev';
const RUNTIME_CACHE = 'collapseai-app'; // small runtime assets/catalog + active-shell pointer
const SCOPE = new URL(self.registration.scope);
const SHELL_PREFIX = `collapseai-app-shell-${encodeURIComponent(SCOPE.pathname)}-`;
const CACHE = `${SHELL_PREFIX}${VERSION}`;
const ACTIVE_URL = new URL('./__collapseai_active_shell__', SCOPE).href;
const READY_URL = new URL('./__collapseai_shell_ready__', SCOPE).href;
// ignoreVary: module scripts send an Origin header; cached copies were stored without one
const MATCH = { ignoreVary: true };

async function remember(request, response) {
  if (response.ok) {
    try { await (await caches.open(RUNTIME_CACHE)).put(request, response.clone()); } catch { /* A full cache must not hide a reachable response. */ }
  }
  return response;
}

function bypass(url) {
  return url.pathname.includes('/packs/') || url.pathname.includes('/models/') || /\.(?:pmtiles|gguf)$/i.test(url.pathname) || url.pathname.includes('/api/') || url.pathname.includes('/v1/');
}

async function cached(request) {
  return (await caches.match(request, { ...MATCH, cacheName: CACHE })) ||
    caches.match(request, { ...MATCH, cacheName: RUNTIME_CACHE });
}

async function precacheList() {
  const res = await fetch(new URL(`./precache.json?v=${VERSION}`, SCOPE).href, { cache: 'no-store' });
  if (!res.ok) throw new Error(`precache.json: HTTP ${res.status}`);
  const { version, urls } = await res.json();
  if (version !== VERSION || !Array.isArray(urls) || !urls.length) throw new Error('Precache manifest does not match this worker.');
  const resolved = [...new Set(urls.map((u) => {
    if (typeof u !== 'string') throw new Error('Invalid precache URL.');
    const url = new URL(u, SCOPE);
    if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname) || bypass(url) || url.href === READY_URL || url.href === ACTIVE_URL) {
      throw new Error('Precache must contain only local app-shell assets.');
    }
    return url.href;
  }))];
  if (!resolved.includes(SCOPE.href)) throw new Error('Precache is missing the app-shell entry page.');
  return resolved;
}

async function completeShell(cache) {
  const ready = await cache.match(READY_URL, MATCH);
  if (!ready) throw new Error('App shell is incomplete.');
  const { version, urls } = await ready.json();
  if (version !== VERSION || !Array.isArray(urls) || !urls.length) throw new Error('Invalid app-shell completion record.');
  for (const url of urls) {
    if (!await cache.match(url, MATCH)) throw new Error(`App-shell asset missing: ${url}`);
  }
  return urls;
}

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const urls = await precacheList();
  if (await caches.has(CACHE)) {
    // Reinstalling identical bytes must not rewrite a complete/active cache.
    try { await completeShell(await caches.open(CACHE)); return; } catch { /* incomplete candidate */ }
    const active = await caches.match(ACTIVE_URL, { cacheName: RUNTIME_CACHE });
    if (active && (await active.json()).cacheName === CACHE) throw new Error('Refusing to overwrite the active shell.');
    await caches.delete(CACHE);
  }
  const cache = await caches.open(CACHE);
  try {
    // Sequential writes leave no in-flight put that can recreate a deleted cache
    // after a failure. This cache is invisible to the active worker/readers.
    for (const url of urls) {
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      await cache.put(url, res);
    }
    await cache.put(READY_URL, new Response(JSON.stringify({ version: VERSION, urls }), { headers: { 'Content-Type': 'application/json' } }));
    await completeShell(cache);
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
  // Do not skipWaiting: existing pages must keep their matching old shell until
  // they close. Normal worker activation is the atomic switch to the new build.
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const keep = new Set(await completeShell(cache)); // no network needed to activate
  const runtime = await caches.open(RUNTIME_CACHE);
  await runtime.put(ACTIVE_URL, new Response(JSON.stringify({ cacheName: CACHE }), { headers: { 'Content-Type': 'application/json' } }));
  // Publish the complete shell before cleaning failed/obsolete version caches.
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== CACHE) await caches.delete(name);
  }
  for (const request of await runtime.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith(SCOPE.pathname) && (/\.(?:pmtiles|gguf)$/i.test(path) ||
        (path.includes('/assets/') && !keep.has(request.url)) || request.url === SCOPE.href || request.url === new URL('./index.html', SCOPE).href)) {
      await runtime.delete(request);
    }
  }
  await self.clients.claim();
})()));

self.addEventListener('message', (e) => {
  if (e.data === 'version') e.source?.postMessage({ type: 'shell-version', version: VERSION, cacheName: CACHE });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || bypass(url)) return;

  // Catalogs change when a Hub installs a map; use current metadata when reachable.
  if (url.pathname.endsWith('/offline-maps/regions.json')) {
    e.respondWith(fetch(req).then(async res => {
      if (res.ok) {
        try { await (await caches.open(RUNTIME_CACHE)).put(req, res.clone()); } catch { /* Keep reachable metadata usable even if cache storage is full. */ }
      }
      return res;
    }).catch(async () => (await cached(req)) || new Response(JSON.stringify({ version: 1, updatedAt: '1970-01-01T00:00:00Z', attribution: '© OpenStreetMap contributors', regions: [] }), { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Installed HTML must stay paired with this worker's complete shell, even if
  // the server already serves another build whose installation later fails.
  if (req.mode === 'navigate') {
    e.respondWith((async () =>
      (await caches.match(req, { ...MATCH, cacheName: CACHE })) ||
      (await caches.match(SCOPE.href, { ...MATCH, cacheName: CACHE })) ||
      (await cached(req)) || (await cached(SCOPE.href)) || remember(req, await fetch(req)))());
    return;
  }

  // Everything else (hashed assets, wasm, fonts): cache first, network as fallback.
  e.respondWith(
    cached(req).then(
      (hit) =>
        hit ||
        fetch(req).then(res => remember(req, res)),
    ),
  );
});
