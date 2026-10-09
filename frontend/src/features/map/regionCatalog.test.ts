import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPECTED_MAP_REGIONS, loadMapCatalog, parseMapCatalog, regionContains, resolveMapAssetUrl } from './regionCatalog';
import { createOfflineMapStyle } from './mapStyle';
import type { MapRegion } from './mapTypes';

const region: MapRegion = {
  id: 'metro-manila',
  name: 'Metro Manila',
  province: 'National Capital Region',
  pmtilesUrl: './offline-maps/metro-manila.pmtiles',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  bounds: [120.85, 14.35, 121.15, 14.8],
  center: [121, 14.6],
  revision: '2026-10-01',
  updatedAt: '2026-10-01T00:00:00Z',
  tileSchema: 'protomaps-basemaps',
};

const catalog = (regions: MapRegion[]) => ({
  version: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  attribution: '© OpenStreetMap contributors',
  regions,
});

afterEach(() => vi.unstubAllGlobals());

describe('offline map catalog', () => {
  it('accepts a valid, published region manifest', () => {
    expect(parseMapCatalog(catalog([region]))).toEqual(catalog([region]));
  });

  it('rejects external asset URLs and invalid archive sizes', () => {
    expect(() => parseMapCatalog(catalog([{ ...region, pmtilesUrl: 'https://example.com/metro-manila.pmtiles' }]))).toThrow(/same-origin/);
    expect(() => parseMapCatalog(catalog([{ ...region, sizeBytes: 0 }]))).toThrow(/size/);
  });

  it('rejects duplicate region IDs', () => {
    expect(() => parseMapCatalog(catalog([region, region]))).toThrow(/duplicate region IDs/);
  });

  it('keeps all intended regions without inventing file metadata', () => {
    expect(EXPECTED_MAP_REGIONS).toEqual([{ id: 'luzon', name: 'Luzon' }, { id: 'visayas', name: 'Visayas' }, { id: 'mindanao', name: 'Mindanao' }]);
    expect(parseMapCatalog(catalog([])).regions).toEqual([]);
  });

  it('resolves legacy and Hub URLs against the app base, including subpaths', () => {
    expect(resolveMapAssetUrl('./maps/luzon.pmtiles', 'https://device.test/app/')).toBe('https://device.test/app/maps/luzon.pmtiles');
    expect(resolveMapAssetUrl('/offline-maps/metro-manila.pmtiles', 'https://device.test/app/')).toBe('https://device.test/app/offline-maps/metro-manila.pmtiles');
    expect(parseMapCatalog(catalog([{ ...region, pmtilesUrl: './maps/luzon.pmtiles' }])).regions[0].pmtilesUrl).toBe('./maps/luzon.pmtiles');
  });

  it('handles an absent catalog without claiming maps are available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    expect((await loadMapCatalog()).regions).toEqual([]);
  });

  it('rejects path traversal, unsafe URLs, bounds, centers and missing hashes', () => {
    for (const pmtilesUrl of ['./maps/../luzon.pmtiles', '//example.test/maps/luzon.pmtiles', './maps/luzon.pmtiles?remote=1']) {
      expect(() => parseMapCatalog(catalog([{ ...region, pmtilesUrl }]))).toThrow();
    }
    expect(() => parseMapCatalog(catalog([{ ...region, bounds: [121, 14, 120, 15] }]))).toThrow(/bounds/);
    expect(() => parseMapCatalog(catalog([{ ...region, center: [0, 0] }]))).toThrow(/center/);
    expect(() => parseMapCatalog(catalog([{ ...region, sha256: '' }]))).toThrow(/SHA-256/);
  });
});

describe('offline map region coverage', () => {
  it('includes edge coordinates and excludes points outside the bounds', () => {
    expect(regionContains(region, [120.85, 14.35])).toBe(true);
    expect(regionContains(region, [121.15, 14.8])).toBe(true);
    expect(regionContains(region, [121.151, 14.6])).toBe(false);
  });
});

describe('offline map style', () => {
  it('uses only the downloaded archive and bundled fonts and sprites', () => {
    const style = createOfflineMapStyle('pmtiles://metro-manila-2026-10.pmtiles', 'dark');
    expect(style.glyphs).toMatch(/^(?:\.\/|\/)?map-assets\/fonts\//);
    expect(style.sprite).toMatch(/^(?:\.\/|\/)?map-assets\/sprites\/v4\/dark$/);
    expect(style.sources.collapseai).toMatchObject({
      type: 'vector',
      url: 'pmtiles://metro-manila-2026-10.pmtiles',
    });
    expect(JSON.stringify(style)).not.toMatch(/https?:\/\/(?!www\.openstreetmap\.org)/);
  });
});
