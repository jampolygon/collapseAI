import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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

// Offline support: the service worker installs the whole app shell from precache.json
// (see public/sw.js and appShellPrecachePlugin in vite.config.ts).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline mode unavailable:', e));
}
