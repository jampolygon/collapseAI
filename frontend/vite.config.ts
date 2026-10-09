import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// COOP/COEP enable SharedArrayBuffer -> multi-threaded llama.cpp in the browser.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// `npm run dev:phone` uses mode "phone": HTTPS with a self-signed certificate, so phones on the
// same Wi-Fi get a secure context (needed for on-device storage, multi-threading and offline mode).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  base: './',
  server: {
    headers: isolation,
    host: true,
    proxy: {
      '/offline-maps': {
        target: 'https://github.com/jampolygon/collapseAI/releases/download/offline-maps-v1',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/offline-maps/, ''),
      },
    },
  },
  preview: { headers: isolation, host: true },
  optimizeDeps: { exclude: ['@wllama/wllama'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
}));
