import { describe, expect, it, vi } from 'vitest';
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn(), addProtocol: vi.fn() }));
import { pmtilesProtocol, registerDownloadedArchive, unregisterDownloadedArchive } from './mapRuntime';
import type { DownloadedMapRegion } from './mapTypes';
import { offlineMapAssetUrls } from './mapAssets';

describe('offline archive lifecycle (no WebGL renderer)', () => {
  it('keeps separate canvases independent and releases their local file references', () => {
    const record = { id: 'luzon', revision: 'fixture', blob: new Blob(['fixture, not map data']) } as DownloadedMapRegion;
    const first = registerDownloadedArchive(record);
    const second = registerDownloadedArchive(record);
    expect(first).not.toBe(second);
    expect(pmtilesProtocol.get(first.slice(10))).toBeDefined();
    unregisterDownloadedArchive(first);
    expect(pmtilesProtocol.get(first.slice(10))).toBeUndefined();
    expect(pmtilesProtocol.get(second.slice(10))).toBeDefined();
    unregisterDownloadedArchive(second);
    expect(pmtilesProtocol.get(second.slice(10))).toBeUndefined();
  });

  it('prepares both themes and local glyph ranges without CDN URLs', () => {
    const urls = offlineMapAssetUrls('https://phone.test/app/');
    expect(urls.some(url => url.endsWith('/dark@2x.png'))).toBe(true);
    expect(urls.some(url => url.endsWith('/light.json'))).toBe(true);
    expect(urls.some(url => url.endsWith('/Noto%20Sans%20Regular/256-511.pbf'))).toBe(true);
    expect(urls.every(url => new URL(url).origin === 'https://phone.test')).toBe(true);
  });
});
