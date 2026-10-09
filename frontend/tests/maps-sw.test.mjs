// Execute actual worker handlers in a synthetic VM, not a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://phone.test';
const SCOPE = ORIGIN + '/';
const ACTIVE_URL = SCOPE + '__collapseai_active_shell__';
const READY_URL = SCOPE + '__collapseai_shell_ready__';
const shellName = version => 'collapseai-app-shell-%2F-' + version;
const absolute = value => value?.url ?? new URL(value, SCOPE).href;

// Each cache is independent, with real Response clones and delete/open behavior.
// Shared storage lets two worker versions observe the same origin's caches.
function storage(initial = new Map(), onPut = async () => {}) {
  const entries = initial;
  const key = request => absolute(request);
  const handle = name => {
    if (!entries.has(name)) entries.set(name, new Map());
    const records = entries.get(name);
    return {
      match: async request => records.get(key(request))?.clone(),
      put: async (request, response) => {
        await onPut(name, key(request));
        records.set(key(request), response.clone());
      },
      keys: async () => [...records.keys()].map(url => ({ url })),
      delete: async request => records.delete(key(request)),
    };
  };
  return {
    entries,
    api: {
      open: async name => handle(name),
      has: async name => entries.has(name),
      keys: async () => [...entries.keys()],
      delete: async name => entries.delete(name),
      match: async (request, options = {}) => {
        const names = options.cacheName ? [options.cacheName] : [...entries.keys()];
        for (const name of names) {
          const found = entries.get(name)?.get(key(request));
          if (found) return found.clone();
        }
      },
    },
  };
}

function worker({ fetch, data = storage(), version = 'test' } = {}) {
  const handlers = new Map();
  let claimed = 0;
  let skipped = 0;
  vm.runInNewContext(source, {
    SHELL_VERSION: version, URL, Response, location: { origin: ORIGIN }, fetch,
    caches: data.api,
    self: {
      registration: { scope: SCOPE },
      addEventListener: (name, callback) => handlers.set(name, callback),
      skipWaiting: async () => { skipped++; },
      clients: { claim: async () => { claimed++; } },
    },
  });
  const lifecycle = event => {
    let pending;
    handlers.get(event)({ waitUntil: promise => { pending = promise; } });
    return pending;
  };
  return {
    data, claimed: () => claimed, skipped: () => skipped,
    install: () => lifecycle('install'), activate: () => lifecycle('activate'),
    fetch(path, mode = 'cors') {
      let response;
      handlers.get('fetch')({ request: { url: absolute(path), method: 'GET', mode }, respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

function shellFetch(version, { fail, urls = ['./', './index.html', './assets/style.css', './assets/' + version + '.js', './assets/engine.wasm', './map-assets/font.pbf'] } = {}) {
  return async url => {
    const address = absolute(url);
    if (address.includes('/precache.json')) return new Response(JSON.stringify({ version, urls }));
    if (fail && address.endsWith(fail)) return new Response('missing', { status: 503 });
    const body = address === SCOPE || address.endsWith('/index.html')
      ? '<html><script src="./assets/' + version + '.js"></script></html>'
      : version + ':' + address;
    return new Response(body);
  };
}

async function snapshot(data, name) {
  return Promise.all([...data.entries.get(name)].map(async ([url, response]) => [url, await response.clone().text()]));
}

async function installed(version = 'old', data = storage()) {
  const sw = worker({ version, data, fetch: shellFetch(version) });
  await sw.install();
  await sw.activate();
  return sw;
}

test('large archives, models and Hub APIs bypass app-shell caching', () => {
  const sw = worker({ fetch: () => { throw new Error('Should bypass interception'); } });
  for (const path of ['/maps/luzon.pmtiles', '/offline-maps/visayas.pmtiles', '/models/local.gguf', '/local.gguf', '/packs/first-aid.json', '/api/info', '/v1/chat/completions']) {
    assert.equal(sw.fetch(path), undefined);
  }
});

test('catalog uses reachable metadata instead of a previously cached empty catalog', async () => {
  const path = SCOPE + 'offline-maps/regions.json';
  const data = storage(new Map([['collapseai-app', new Map([[path, new Response(JSON.stringify({ regions: [] }))]])]]));
  const sw = worker({ data, fetch: async () => new Response(JSON.stringify({ regions: [{ id: 'luzon' }] })) });
  assert.equal((await (await sw.fetch('/offline-maps/regions.json')).json()).regions[0].id, 'luzon');
});

test('unreachable catalogs retain runtime metadata and otherwise return an empty catalog', async () => {
  const path = SCOPE + 'offline-maps/regions.json';
  const data = storage(new Map([['collapseai-app', new Map([[path, new Response(JSON.stringify({ regions: [{ id: 'visayas' }] }))]])]]));
  const sw = worker({ data, fetch: async () => { throw new Error('Synthetic offline'); } });
  assert.equal((await (await sw.fetch('/offline-maps/regions.json')).json()).regions[0].id, 'visayas');
  data.entries.get('collapseai-app').clear();
  assert.deepEqual((await (await sw.fetch('/offline-maps/regions.json')).json()).regions, []);
});

test('renderer runtime cache writes complete before the fetch handler resolves', async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const data = storage(new Map(), async name => { assert.equal(name, 'collapseai-app'); started(); await gate; });
  const sw = worker({ data, fetch: async () => new Response('renderer code') });
  let complete = false;
  const result = sw.fetch('/assets/OfflineMapPage-fixture.js').then(response => { complete = true; return response; });
  await waiting;
  assert.equal(complete, false);
  release();
  assert.equal(await (await result).text(), 'renderer code');
});

test('failed update leaves old HTML/JS unchanged and removes incomplete new cache', async () => {
  const old = await installed();
  const data = old.data;
  const before = await snapshot(data, shellName('old'));
  const activeBefore = await snapshot(data, 'collapseai-app');
  const writes = [];
  const rawPut = data.api.open;
  data.api.open = async name => {
    const cache = await rawPut(name);
    const put = cache.put;
    cache.put = async (request, response) => { writes.push([name, absolute(request)]); return put(request, response); };
    return cache;
  };
  const next = worker({ version: 'next', data, fetch: shellFetch('next', { fail: '/assets/next.js' }) });
  await assert.rejects(next.install(), /HTTP 503/);
  assert.ok(writes.some(([name, url]) => name === shellName('next') && url.endsWith('/index.html')));
  assert.deepEqual(await snapshot(data, shellName('old')), before);
  assert.deepEqual(await snapshot(data, 'collapseai-app'), activeBefore);
  assert.equal(data.entries.has(shellName('next')), false);
  assert.equal(next.claimed(), 0);
  assert.equal(next.skipped(), 0);
  const offlineOld = worker({ version: 'old', data, fetch: async () => { throw new Error('offline'); } });
  assert.match(await (await offlineOld.fetch('/', 'navigate')).text(), /assets\/old\.js/);
  assert.match(await (await offlineOld.fetch('/assets/old.js')).text(), /^old:/);
});

test('complete update waits, activates without network, uses new shell and removes obsolete shells', async () => {
  const old = await installed();
  const data = old.data;
  const before = await snapshot(data, shellName('old'));
  const next = worker({ version: 'next', data, fetch: shellFetch('next') });
  await next.install();
  assert.deepEqual(await snapshot(data, shellName('old')), before);
  assert.equal((await (await data.api.match(ACTIVE_URL, { cacheName: 'collapseai-app' })).json()).cacheName, shellName('old'));
  assert.equal(next.skipped(), 0, 'Do not replace a worker underneath existing windows');
  assert.ok(data.entries.get(shellName('next')).has(READY_URL));

  const offlineNext = worker({ version: 'next', data, fetch: async () => { throw new Error('offline activation'); } });
  await offlineNext.activate();
  assert.equal(offlineNext.claimed(), 1);
  assert.equal(data.entries.has(shellName('old')), false);
  assert.equal((await (await data.api.match(ACTIVE_URL, { cacheName: 'collapseai-app' })).json()).cacheName, shellName('next'));
  assert.match(await (await offlineNext.fetch('/', 'navigate')).text(), /assets\/next\.js/);
  assert.match(await (await offlineNext.fetch('/assets/next.js')).text(), /^next:/);
  assert.match(await (await offlineNext.fetch('/assets/style.css')).text(), /^next:/);
  assert.ok(await offlineNext.fetch('/assets/engine.wasm'));
  assert.ok(await offlineNext.fetch('/map-assets/font.pbf'));
});

test('activation rejects a missing required cached asset before promotion or cleanup', async () => {
  const old = await installed();
  const next = worker({ version: 'next', data: old.data, fetch: shellFetch('next') });
  await next.install();
  old.data.entries.get(shellName('next')).delete(SCOPE + 'assets/next.js');
  await assert.rejects(next.activate(), /asset missing/);
  assert.ok(old.data.entries.has(shellName('old')));
  assert.equal((await (await old.data.api.match(ACTIVE_URL, { cacheName: 'collapseai-app' })).json()).cacheName, shellName('old'));
  assert.equal(next.claimed(), 0);
});

test('cache write failure also preserves the old shell and removes the candidate', async () => {
  const old = await installed();
  const before = await snapshot(old.data, shellName('old'));
  const rawOpen = old.data.api.open;
  old.data.api.open = async name => {
    const cache = await rawOpen(name);
    if (name === shellName('next')) {
      const rawPut = cache.put;
      cache.put = async (request, response) => {
        if (absolute(request).endsWith('/index.html')) throw new Error('Synthetic quota error');
        return rawPut(request, response);
      };
    }
    return cache;
  };
  await assert.rejects(worker({ version: 'next', data: old.data, fetch: shellFetch('next') }).install(), /quota/);
  assert.deepEqual(await snapshot(old.data, shellName('old')), before);
  assert.equal(old.data.entries.has(shellName('next')), false);
});

test('completed-cache reinstall does not mutate it; abandoned candidates are cleaned after success', async () => {
  const old = await installed();
  const before = await snapshot(old.data, shellName('old'));
  const rawOpen = old.data.api.open;
  old.data.api.open = async name => {
    const cache = await rawOpen(name);
    if (name === shellName('old')) cache.put = async () => { throw new Error('Active cache must be immutable'); };
    return cache;
  };
  await worker({ version: 'old', data: old.data, fetch: shellFetch('old') }).install();
  assert.deepEqual(await snapshot(old.data, shellName('old')), before);
  old.data.entries.set(shellName('abandoned'), new Map([[SCOPE, new Response('partial')]]));
  await installed('next', old.data);
  assert.equal(old.data.entries.has(shellName('abandoned')), false);
});

test('legacy migration removes duplicate archives but keeps runtime catalog and unrelated caches', async () => {
  const catalog = SCOPE + 'offline-maps/regions.json';
  const data = storage(new Map([
    ['collapseai-app', new Map([
      [SCOPE, new Response('legacy HTML')],
      [SCOPE + 'maps/luzon.pmtiles', new Response('duplicate archive')],
      [SCOPE + 'models/local.gguf', new Response('duplicate model')],
      [catalog, new Response(JSON.stringify({ regions: [] }))],
      [SCOPE + 'map-assets/extra.pbf', new Response('runtime font')],
    ])],
    ['another-app', new Map([[SCOPE, new Response('unrelated')]])],
  ]));
  await installed('next', data);
  assert.equal(data.entries.get('collapseai-app').has(SCOPE), false);
  assert.equal(data.entries.get('collapseai-app').has(SCOPE + 'maps/luzon.pmtiles'), false);
  assert.equal(data.entries.get('collapseai-app').has(SCOPE + 'models/local.gguf'), false);
  assert.ok(data.entries.get('collapseai-app').has(catalog));
  assert.ok(data.entries.get('collapseai-app').has(SCOPE + 'map-assets/extra.pbf'));
  assert.ok(data.entries.has('another-app'));
});

test('navigation cannot overwrite matching shell HTML with a newer network build', async () => {
  const old = await installed();
  old.data.entries.get('collapseai-app').set(SCOPE + '?legacy=1', new Response('<script src="missing-new.js"></script>'));
  const sw = worker({ version: 'old', data: old.data, fetch: async () => new Response('<script src="missing-new.js"></script>') });
  assert.match(await (await sw.fetch('/', 'navigate')).text(), /assets\/old\.js/);
  assert.match(await (await sw.fetch('/?legacy=1', 'navigate')).text(), /assets\/old\.js/);
  assert.match(await old.data.entries.get(shellName('old')).get(SCOPE).clone().text(), /assets\/old\.js/);
});

test('interrupted upgrade from a legacy worker leaves every legacy cache entry unchanged', async () => {
  const data = storage(new Map([['collapseai-app', new Map([
    [SCOPE, new Response('<html><script src="./assets/legacy.js"></script></html>')],
    [SCOPE + 'index.html', new Response('<html><script src="./assets/legacy.js"></script></html>')],
    [SCOPE + 'assets/legacy.js', new Response('working legacy code')],
    [SCOPE + 'assets/engine.wasm', new Response('working legacy engine')],
  ])]]));
  const before = await snapshot(data, 'collapseai-app');
  const next = worker({ version: 'next', data, fetch: shellFetch('next', { fail: '/assets/next.js' }) });
  await assert.rejects(next.install(), /HTTP 503/);
  assert.deepEqual(await snapshot(data, 'collapseai-app'), before);
  assert.equal(data.entries.has(shellName('next')), false);
  assert.equal(await data.api.match(ACTIVE_URL, { cacheName: 'collapseai-app' }), undefined);
});

test('mismatched manifests and large precache entries fail without touching active caches', async () => {
  const old = await installed();
  const before = await snapshot(old.data, shellName('old'));
  await assert.rejects(worker({ version: 'next', data: old.data, fetch: shellFetch('wrong') }).install(), /does not match/);
  await assert.rejects(worker({ version: 'next', data: old.data, fetch: shellFetch('next', { urls: ['./', './models/huge.gguf'] }) }).install(), /only local app-shell/);
  assert.deepEqual(await snapshot(old.data, shellName('old')), before);
  assert.equal(old.data.entries.has(shellName('next')), false);
});
