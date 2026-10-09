// Run the actual service-worker handlers in a synthetic VM, not a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker({ fetch, put = async () => {}, stored = new Map() } = {}) {
  const handlers = new Map();
  const cache = {
    put, keys: async () => [...stored.keys()].map(url => ({ url })),
    delete: async request => stored.delete(request.url),
  };
  vm.runInNewContext(source, {
    URL, Response, location: { origin: 'https://phone.test' }, fetch,
    caches: { open: async () => cache, match: async request => stored.get(request.url ?? request)?.clone() },
    self: { addEventListener: (name, callback) => handlers.set(name, callback), skipWaiting() {}, clients: { claim: async () => {} } },
  });
  return {
    stored,
    fetch(path) {
      let response;
      handlers.get('fetch')({ request: { url: `https://phone.test${path}`, method: 'GET', mode: 'cors' }, respondWith: promise => { response = promise; } });
      return response;
    },
    activate() { let wait; handlers.get('activate')({ waitUntil: promise => { wait = promise; } }); return wait; },
  };
}

test('large archives, models and Hub APIs bypass app-shell caching', () => {
  const sw = worker({ fetch: () => { throw new Error('Should bypass interception'); } });
  for (const path of ['/maps/luzon.pmtiles', '/offline-maps/visayas.pmtiles', '/models/local.gguf', '/packs/first-aid.json', '/api/info', '/v1/chat/completions']) {
    assert.equal(sw.fetch(path), undefined);
  }
});

test('catalog uses reachable metadata instead of a previously cached empty catalog', async () => {
  const path = 'https://phone.test/offline-maps/regions.json';
  const stale = new Response(JSON.stringify({ regions: [] }));
  const current = JSON.stringify({ regions: [{ id: 'luzon' }] });
  const stored = new Map([[path, stale]]);
  const sw = worker({ stored, fetch: async () => new Response(current), put: async (request, response) => stored.set(request.url, response) });
  assert.equal((await (await sw.fetch('/offline-maps/regions.json')).json()).regions[0].id, 'luzon');
});

test('unreachable catalogs retain cached metadata and otherwise return an empty catalog', async () => {
  const path = 'https://phone.test/offline-maps/regions.json';
  const stored = new Map([[path, new Response(JSON.stringify({ regions: [{ id: 'visayas' }] }))]]);
  const sw = worker({ stored, fetch: async () => { throw new Error('Synthetic offline'); } });
  assert.equal((await (await sw.fetch('/offline-maps/regions.json')).json()).regions[0].id, 'visayas');
  stored.clear();
  assert.deepEqual((await (await sw.fetch('/offline-maps/regions.json')).json()).regions, []);
});

test('renderer code cache writes complete before the fetch handler resolves', async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const sw = worker({ fetch: async () => new Response('renderer code'), put: async () => { started(); await gate; } });
  let complete = false;
  const result = sw.fetch('/assets/OfflineMapPage-fixture.js').then(response => { complete = true; return response; });
  await waiting;
  assert.equal(complete, false);
  release();
  assert.equal(await (await result).text(), 'renderer code');
});

test('activation removes old duplicate archives while retaining local renderer assets', async () => {
  const stored = new Map([
    ['https://phone.test/offline-maps/luzon.pmtiles', new Response('archive')],
    ['https://phone.test/map-assets/sprites/v4/light.png', new Response('sprite')],
  ]);
  const sw = worker({ stored });
  await sw.activate();
  assert.equal(stored.has('https://phone.test/offline-maps/luzon.pmtiles'), false);
  assert.equal(stored.has('https://phone.test/map-assets/sprites/v4/light.png'), true);
});
