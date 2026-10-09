import { useEffect, useState } from 'react';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import type { DLItem } from '../lib/downloads';
import { APP_RUNTIME_CACHE, appShellCacheName } from '../lib/appCache';

export type CacheState = 'checking' | 'cached' | 'missing' | 'partial' | 'unavailable' | 'development' | 'error';
export interface SystemSnapshot {
  appCache: CacheState;
  engineCache: CacheState;
  storage: { usage: number; quota: number } | null;
  cacheError: string | null;
}

// Observes existing browser state only. Never installs a worker, caches a URL,
// changes download metadata, or claims that a model has been initialized.
export function useSystemSnapshot(downloads: DLItem[]): SystemSnapshot {
  const [snapshot, setSnapshot] = useState<SystemSnapshot>({ appCache: 'checking', engineCache: 'checking', storage: null, cacheError: null });
  const signature = downloads.map(d => `${d.key}:${d.status}`).join('|');
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      let storage: SystemSnapshot['storage'] = null;
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate && typeof estimate.usage === 'number' && typeof estimate.quota === 'number') storage = { usage: estimate.usage, quota: estimate.quota };
      } catch { /* show unavailable, not made-up storage numbers */ }
      let appCache: CacheState = 'missing';
      let engineCache: CacheState = 'missing';
      let cacheError: string | null = null;
      if (!import.meta.env.PROD) {
        appCache = engineCache = 'development';
      } else if (!('caches' in window) || !('serviceWorker' in navigator)) {
        appCache = engineCache = 'unavailable';
      } else {
        try {
          const shellName = await appShellCacheName();
          if (shellName) {
            const required = [new URL('./', document.baseURI).href, ...Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"], link[rel="icon"], link[rel="manifest"]')).map(el => el instanceof HTMLScriptElement ? el.src : el.href)];
            const match = async (url: string) => (await caches.match(url, { cacheName: shellName, ignoreVary: true })) || caches.match(url, { cacheName: APP_RUNTIME_CACHE, ignoreVary: true });
            const hits = await Promise.all(required.map(match));
            appCache = hits.every(Boolean) ? 'cached' : hits.some(Boolean) ? 'partial' : 'missing';
            engineCache = await match(new URL(wasmUrl, document.baseURI).href) ? 'cached' : 'missing';
          }
        } catch (error) {
          appCache = engineCache = 'error';
          cacheError = error instanceof Error ? error.message : 'Browser cache could not be inspected.';
        }
      }
      if (!cancelled) setSnapshot({ appCache, engineCache, storage, cacheError });
      reading = false;
    };
    void read();
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 5000);
    document.addEventListener('visibilitychange', read);
    navigator.serviceWorker?.addEventListener('controllerchange', read);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
      navigator.serviceWorker?.removeEventListener('controllerchange', read);
    };
  }, [signature]);
  return snapshot;
}

export const cacheLabel = (state: CacheState) => ({ checking: 'Checking', cached: 'Cached', missing: 'Not cached', partial: 'Partially cached', unavailable: 'Unavailable', development: 'Dev · not cached', error: 'Could not check' })[state];
