import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { APP_RUNTIME_CACHE, appShellCacheName } from '../../lib/appCache';

export function offlineMapAssetUrls(base = new URL(import.meta.env.BASE_URL, document.baseURI).href): string[] {
  const paths = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'].flatMap(font =>
    ['0-255', '256-511'].map(range => `map-assets/fonts/${encodeURIComponent(font)}/${range}.pbf`));
  paths.push('map-assets/fonts/Noto%20Sans%20Regular/8192-8447.pbf');
  paths.push(...['light', 'dark'].flatMap(theme => ['', '@2x'].flatMap(scale =>
    ['json', 'png'].map(ext => `map-assets/sprites/v4/${theme}${scale}.${ext}`))));
  return [...paths.map(path => new URL(path, base).href), new URL(workerUrl, base).href];
}

export async function prepareOfflineMapAssets(): Promise<void> {
  // The renderer JS/CSS was loaded with the Map view. Ensure both themes' assets
  // and its worker are available before committing a verified local archive.
  if (import.meta.env.PROD) {
    if (!navigator.serviceWorker?.controller || !('caches' in window)) {
      throw new Error('Offline app caching is not ready. Reload CollapseAI once and retry the map download.');
    }
    const shellName = await appShellCacheName();
    if (!shellName) throw new Error('Offline app caching is not ready. Reload CollapseAI and retry.');
    const shell = await caches.open(shellName);
    const cache = await caches.open(APP_RUNTIME_CACHE);
    const loadedCode = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => {
      const asset = new URL(url);
      return asset.origin === location.origin && /\.(?:js|css)$/.test(asset.pathname);
    });
    for (const url of new Set([...offlineMapAssetUrls(), ...loadedCode])) {
      if (!await shell.match(url, { ignoreVary: true }) && !await cache.match(url, { ignoreVary: true })) await cache.add(url);
    }
  }
}
