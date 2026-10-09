import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const binaryAsset = Buffer.from([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 0x00, 0xff, 0x01, 0x0a]);
const upstreamPaths = [];
let releaseServer;
let vite;

afterEach(async () => {
  delete process.env.COLLAPSEAI_MAPS_RELEASE_BASE;
  delete process.env.COLLAPSEAI_MAP_HUB_URL;
  if (vite) await vite.close();
  if (releaseServer?.listening) await new Promise(resolve => releaseServer.close(resolve));
  vite = null;
  releaseServer = null;
});

test('Vite map proxy follows asset redirects and preserves binary and range responses', async () => {
  releaseServer = createHttpServer((request, response) => {
    upstreamPaths.push(request.url);
    if (request.url === '/releases/download/offline-maps-v1/regions.json?missing=1') {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<html>catalog missing</html>');
      return;
    }
    if (request.url === '/releases/download/offline-maps-v1/regions.json') {
      response.writeHead(302, { location: '/objects/regions.json' });
      response.end();
      return;
    }
    if (request.url === '/objects/regions.json') {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2' });
      response.end('{}');
      return;
    }
    if (request.url === '/releases/download/offline-maps-v1/philippines.pmtiles') {
      response.writeHead(302, { location: '/objects/philippines.pmtiles' });
      response.end();
      return;
    }
    if (request.url === '/objects/philippines.pmtiles') {
      const range = request.headers.range;
      if (range === 'bytes=2-5') {
        const bytes = binaryAsset.subarray(2, 6);
        response.writeHead(206, {
          'accept-ranges': 'bytes',
          'content-range': `bytes 2-5/${binaryAsset.byteLength}`,
          'content-length': String(bytes.byteLength),
          'content-type': 'application/vnd.pmtiles',
        });
        response.end(bytes);
        return;
      }
      response.writeHead(200, {
        'accept-ranges': 'bytes',
        'content-length': String(binaryAsset.byteLength),
        'content-type': 'application/vnd.pmtiles',
      });
      response.end(binaryAsset);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/html' });
    response.end('<html>missing</html>');
  });

  await new Promise(resolve => releaseServer.listen(0, '127.0.0.1', resolve));
  const releasePort = releaseServer.address().port;
  process.env.COLLAPSEAI_MAPS_RELEASE_BASE = `http://127.0.0.1:${releasePort}/releases/download/offline-maps-v1`;
  vite = await createViteServer({
    root: frontend,
    configFile: path.join(frontend, 'vite.config.ts'),
    mode: 'test',
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  await vite.listen();
  const address = vite.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const fullResponse = await fetch(`${baseUrl}/offline-maps/philippines.pmtiles`);
  assert.equal(fullResponse.status, 200, `unexpected upstream path(s): ${upstreamPaths.join(', ')}`);
  assert.equal(fullResponse.headers.get('content-type'), 'application/vnd.pmtiles');
  assert.deepEqual(Buffer.from(await fullResponse.arrayBuffer()), binaryAsset);

  const rangeResponse = await fetch(`${baseUrl}/offline-maps/philippines.pmtiles`, {
    headers: { range: 'bytes=2-5' },
  });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get('content-range'), `bytes 2-5/${binaryAsset.byteLength}`);
  assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), binaryAsset.subarray(2, 6));

  const missingResponse = await fetch(`${baseUrl}/offline-maps/regions.json?missing=1`);
  assert.equal(missingResponse.status, 404);
  assert.match(await missingResponse.text(), /catalog missing/);
});

test('Hub bridge wins over release and local assets', async () => {
  releaseServer = createHttpServer((request, response) => {
    if (request.url === '/offline-maps/regions.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ source: 'synthetic LAN hub', regions: [] }));
    } else if (request.url === '/maps/luzon.pmtiles') {
      response.writeHead(206, { 'content-range': `bytes 2-5/${binaryAsset.length}`, 'content-type': 'application/vnd.pmtiles' });
      response.end(binaryAsset.subarray(2, 6));
    } else { response.writeHead(404).end(); }
  });
  await new Promise(resolve => releaseServer.listen(0, '127.0.0.1', resolve));
  process.env.COLLAPSEAI_MAP_HUB_URL = `http://127.0.0.1:${releaseServer.address().port}`;
  process.env.COLLAPSEAI_MAPS_RELEASE_BASE = 'http://127.0.0.1:1/unreachable-release';
  vite = await createViteServer({ root: frontend, configFile: path.join(frontend, 'vite.config.ts'), mode: 'test', logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: true } });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.equal((await (await fetch(`${base}/offline-maps/regions.json`)).json()).source, 'synthetic LAN hub');
  const range = await fetch(`${base}/maps/luzon.pmtiles`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), binaryAsset.subarray(2, 6));
});

test('standalone local maps use frontend public paths with full/range/HEAD and missing-file handling', async () => {
  const directory = path.join(frontend, 'public/maps');
  const filename = `merge-test-${process.pid}.pmtiles`;
  const file = path.join(directory, filename);
  await mkdir(directory, { recursive: true });
  await writeFile(file, binaryAsset, { flag: 'wx' });
  try {
    vite = await createViteServer({ root: frontend, configFile: path.join(frontend, 'vite.config.ts'), mode: 'test', logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const full = await fetch(`${base}/maps/${filename}`);
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), binaryAsset);
    const range = await fetch(`${base}/offline-maps/${filename}`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 2-5/${binaryAsset.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), binaryAsset.subarray(2, 6));
    const head = await fetch(`${base}/maps/${filename}`, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), String(binaryAsset.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(`${base}/maps/${filename}`, { headers: { Range: 'bytes=-0' } })).status, 416);
    assert.equal((await fetch(`${base}/maps/absent.pmtiles`)).status, 404);
    const catalog = await (await fetch(`${base}/offline-maps/regions.json`)).json();
    // the committed catalog lists the bundled regions, each served from ./maps/ on the same origin
    assert.ok(Array.isArray(catalog.regions));
    for (const region of catalog.regions) assert.match(region.pmtilesUrl, /^\.\/maps\/[a-z0-9-]+\.pmtiles$/);
  } finally {
    await unlink(file);
  }
});
