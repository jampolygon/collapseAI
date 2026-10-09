import { afterEach, expect, it, vi } from 'vitest';
import { APP_RUNTIME_CACHE, appShellCacheName } from './appCache';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uses only the activated shell pointer, never the newest incomplete cache', async () => {
  vi.stubEnv('BASE_URL', './');
  vi.stubGlobal('document', { baseURI: 'https://phone.test/app/' });
  const active = 'collapseai-app-shell-%2Fapp%2F-old';
  const match = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cacheName: active })));
  vi.stubGlobal('caches', { match, has: vi.fn().mockResolvedValue(true) });
  expect(await appShellCacheName()).toBe(active);
  expect(match).toHaveBeenCalledWith('https://phone.test/app/__collapseai_active_shell__', { cacheName: APP_RUNTIME_CACHE });
});

it('supports an older worker legacy cache without a published version pointer', async () => {
  vi.stubGlobal('document', { baseURI: 'https://phone.test/' });
  vi.stubGlobal('caches', { match: vi.fn().mockResolvedValue(undefined), has: vi.fn().mockResolvedValue(true) });
  expect(await appShellCacheName()).toBe(APP_RUNTIME_CACHE);
});

it('does not report an evicted or invalid published shell as ready', async () => {
  vi.stubGlobal('document', { baseURI: 'https://phone.test/' });
  vi.stubGlobal('caches', { match: vi.fn().mockResolvedValue(new Response(JSON.stringify({ cacheName: 'collapseai-app-shell-%2F-old' }))), has: vi.fn().mockResolvedValue(false) });
  expect(await appShellCacheName()).toBeNull();
});
