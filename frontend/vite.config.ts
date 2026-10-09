import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// COOP/COEP enable SharedArrayBuffer -> multi-threaded llama.cpp in the browser.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

const localMapAssets = fileURLToPath(new URL('../public/maps/', import.meta.url));

function localMapAssetsPlugin() {
  return {
    name: 'collapseai-local-map-assets',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const asset = pathname === '/maps/regions.json'
          ? 'regions.json'
          : pathname === '/maps/philippines.pmtiles'
            ? 'philippines.pmtiles'
            : null;
        if (!asset) return next();

        const assetPath = path.join(localMapAssets, asset);
        let info;
        try {
          info = await stat(assetPath);
          if (!info.isFile()) throw Object.assign(new Error('Asset path is not a file.'), { code: 'ENOENT' });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          response.statusCode = code === 'ENOENT' ? 404 : 500;
          response.setHeader('content-type', 'text/plain; charset=utf-8');
          response.end(code === 'ENOENT' ? `Local map asset not found: ${asset}` : 'Could not inspect local map asset.');
          if (code !== 'ENOENT') server.config.logger.error(`[local-map-assets] ${error instanceof Error ? error.message : String(error)}`);
          return;
        }

        const contentType = asset.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/vnd.pmtiles';
        const headers: Record<string, string | number> = {
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
          'content-type': contentType,
        };
        let start = 0;
        let end = info.size - 1;
        const range = request.headers.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) {
            response.statusCode = 416;
            response.setHeader('content-range', `bytes */${info.size}`);
            response.end();
            return;
          }
          if (!match[1]) {
            const suffixLength = Number(match[2]);
            start = Math.max(0, info.size - suffixLength);
          } else {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), end) : end;
          }
          if (start >= info.size || start > end) {
            response.statusCode = 416;
            response.setHeader('content-range', `bytes */${info.size}`);
            response.end();
            return;
          }
          response.statusCode = 206;
          headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
        }
        headers['content-length'] = end - start + 1;
        response.writeHead(response.statusCode || 200, headers);
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        const stream = createReadStream(assetPath, { start, end });
        stream.on('error', error => {
          server.config.logger.error(`[local-map-assets] ${error.message}`);
          if (!response.headersSent) {
            response.statusCode = 500;
            response.end('Could not read local map asset.');
          } else {
            response.destroy(error);
          }
        });
        stream.pipe(response);
      });
    },
  };
}

// `npm run dev:phone` uses mode "phone": HTTPS with a self-signed certificate, so phones on the
// same Wi-Fi get a secure context (needed for on-device storage, multi-threading and offline mode).
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'COLLAPSEAI_');
  const mapReleaseProxy = () => ({
    target: environment.COLLAPSEAI_MAPS_RELEASE_BASE || 'https://github.com/jampolygon/collapseAI/releases/download/offline-maps-v1',
    changeOrigin: true,
    followRedirects: true,
    timeout: 20 * 60_000,
    proxyTimeout: 20 * 60_000,
    rewrite: (path: string) => path.replace(/^\/offline-maps/, ''),
  });
  return {
    plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : []), ...(mode === 'production' ? [] : [localMapAssetsPlugin()])],
    base: './',
    server: {
      headers: isolation,
      host: true,
      proxy: {
        '/offline-maps/regions.json': mapReleaseProxy(),
        '/offline-maps/philippines.pmtiles': mapReleaseProxy(),
      },
    },
    preview: { headers: isolation, host: true },
    optimizeDeps: { exclude: ['@wllama/wllama'] },
    build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  };
});
