import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary message="Something went wrong. Reload the page; your downloaded files are safe on this device.">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Offline support: the service worker caches the app itself (models/packs live in OPFS).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').then(async () => {
    await navigator.serviceWorker.ready;
    // Cache everything this page already loaded, so the very first visit is enough to go offline.
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.startsWith(location.origin) && !/\/(?:packs|models|api|v1)\/|\.pmtiles(?:\?|$)/.test(u));
    const cache = await caches.open('collapseai-app');
    // + the AI engine (only fetched when the AI starts) and app icons
    const extra = [wasmUrl, './', './icon.svg', './manifest.webmanifest'].map((u) => new URL(u, location.href).href);
    await cache.addAll([...new Set([...extra, ...urls])]).catch(() => {});
  });
}
