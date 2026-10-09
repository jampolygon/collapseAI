// Cache names are published by the worker only after a complete shell activates.
// The legacy cache remains the small runtime cache and supports older workers.
export const APP_RUNTIME_CACHE = 'collapseai-app';

export async function appShellCacheName(): Promise<string | null> {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const pointer = await caches.match(new URL('./__collapseai_active_shell__', base).href, { cacheName: APP_RUNTIME_CACHE });
  if (pointer) {
    const { cacheName } = await pointer.json();
    return typeof cacheName === 'string' && cacheName.startsWith('collapseai-app-shell-') && await caches.has(cacheName) ? cacheName : null;
  }
  return await caches.has(APP_RUNTIME_CACHE) ? APP_RUNTIME_CACHE : null;
}
