import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// COOP/COEP enable SharedArrayBuffer -> multi-threaded llama.cpp in the browser.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// `npm run dev:phone` uses mode "phone": HTTPS with a self-signed certificate, so phones on the
// same Wi-Fi get a secure context (needed for on-device storage, multi-threading and offline mode).
export default defineConfig(({ mode }) => {
  // Optional same-origin LAN bridge. No Hub URL means static, standalone maps.
  const hub = loadEnv(mode, process.cwd(), 'COLLAPSEAI_').COLLAPSEAI_MAP_HUB_URL;
  const proxy = hub ? Object.fromEntries(['/offline-maps', '/maps'].map(route => [route, { target: hub, changeOrigin: true }])) : undefined;
  return {
    plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
    base: './',
    server: {
      headers: isolation,
      host: true,
      proxy,
    },
    preview: { headers: isolation, host: true, proxy },
    optimizeDeps: { exclude: ['@wllama/wllama'] },
    build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  };
});
