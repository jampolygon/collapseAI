import { defineConfig, loadEnv, type ProxyOptions, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};
const localMaps = fileURLToPath(new URL('./public/maps/', import.meta.url));
const localCatalog = fileURLToPath(new URL('./public/offline-maps/regions.json', import.meta.url));

// One local resource flow for dev and preview. Omit with a Hub selected so
// local files cannot shadow the LAN bridge.
function localMapAssetsPlugin(releaseSelected: boolean) {
  const configure = (server: Pick<ViteDevServer, 'middlewares' | 'config'>) => {
    server.middlewares.use(async (request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (releaseSelected && pathname.startsWith('/offline-maps/')) return next();
      const catalog = pathname === '/offline-maps/regions.json' || pathname === '/maps/regions.json';
      const match = /^\/(?:maps|offline-maps)\/([a-z0-9]+(?:-[a-z0-9]+)*\.pmtiles)$/.exec(pathname);
      if (!catalog && !match) return next();
      const assetPath = catalog ? localCatalog : path.join(localMaps, match![1]);
      try {
        const resolved = await realpath(assetPath);
        if (path.dirname(resolved) !== await realpath(path.dirname(assetPath))) {
          response.writeHead(404).end('Local map asset not found.');
          return;
        }
        const info = await stat(resolved);
        if (!info.isFile()) { response.writeHead(404).end('Local map asset not found.'); return; }
        if (catalog) {
          const value = JSON.parse(await readFile(resolved, 'utf8'));
          if (!Array.isArray(value.regions)) throw new Error('Invalid local map catalog.');
          const entries = await Promise.all(value.regions.map(async (entry: { id?: string; sizeBytes?: number }) => {
            if (!entry.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) return null;
            try {
              const file = await realpath(path.join(localMaps, entry.id + '.pmtiles'));
              const fileInfo = await stat(file);
              return path.dirname(file) === await realpath(localMaps) && fileInfo.isFile() && fileInfo.size === entry.sizeBytes ? entry : null;
            } catch { return null; }
          }));
          value.regions = entries.filter(Boolean);
          const bytes = Buffer.from(JSON.stringify(value));
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': bytes.length });
          response.end(request.method === 'HEAD' ? undefined : bytes);
          return;
        }
        const headers: Record<string, string | number> = {
          'accept-ranges': 'bytes', 'cache-control': 'no-store', 'content-type': 'application/vnd.pmtiles',
        };
        let start = 0;
        let end = info.size - 1;
        if (request.headers.range !== undefined) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
          const first = range?.[1] ? Number(range[1]) : undefined;
          const last = range?.[2] ? Number(range[2]) : undefined;
          const valid = range && (first !== undefined || last !== undefined) && info.size > 0 &&
            (first === undefined || Number.isSafeInteger(first)) && (last === undefined || Number.isSafeInteger(last));
          if (valid) {
            start = first === undefined ? Math.max(0, info.size - last!) : first;
            end = first !== undefined && last !== undefined ? Math.min(last, end) : end;
          }
          if (!valid || (first === undefined && last === 0) || start >= info.size || start > end) {
            response.writeHead(416, { ...headers, 'content-range': 'bytes */' + info.size, 'content-length': 0 }).end();
            return;
          }
          headers['content-range'] = 'bytes ' + start + '-' + end + '/' + info.size;
          response.statusCode = 206;
        }
        headers['content-length'] = Math.max(0, end - start + 1);
        response.writeHead(response.statusCode || 200, headers);
        if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
        const stream = createReadStream(resolved, { start, end });
        stream.on('error', error => response.destroy(error));
        response.on('close', () => stream.destroy());
        stream.pipe(response);
      } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
        response.writeHead(missing ? 404 : 500, { 'content-type': 'text/plain' });
        response.end(missing ? 'Local map asset not found.' : 'Could not read or validate local map asset.');
      }
    });
  };
  return { name: 'collapseai-local-map-assets', configureServer: configure, configurePreviewServer: configure };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'COLLAPSEAI_');
  const hub = environment.COLLAPSEAI_MAP_HUB_URL;
  const release = environment.COLLAPSEAI_MAPS_RELEASE_BASE;
  const proxy: Record<string, ProxyOptions> = {};
  if (hub) {
    for (const route of ['/offline-maps', '/maps']) proxy[route] = { target: hub, changeOrigin: true };
  } else if (release) {
    proxy['/offline-maps'] = {
      target: release, changeOrigin: true, followRedirects: true,
      timeout: 20 * 60_000, proxyTimeout: 20 * 60_000,
      rewrite: url => url.replace(/^\/offline-maps/, ''),
    };
  }
  return {
    plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : []), ...(!hub ? [localMapAssetsPlugin(Boolean(release))] : [])],
    base: './',
    // .trycloudflare.com: temporary HTTPS demo links (cloudflared quick tunnel) for phone testing
    server: { headers: isolation, host: true, proxy, allowedHosts: ['.trycloudflare.com'] },
    preview: { headers: isolation, host: true, proxy, allowedHosts: ['.trycloudflare.com'] },
    optimizeDeps: { exclude: ['@wllama/wllama'] },
    build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  };
});
