import { describe, expect, it } from 'vitest';
import { parseMapCatalog, regionContains } from './regionCatalog';
import { createOfflineMapStyle } from './mapStyle';
import type { MapRegion } from './mapTypes';

const region: MapRegion = {
  id: 'philippines',
  name: 'Philippines',
  province: 'Philippines',
  pmtilesUrl: './offline-maps/philippines.pmtiles',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  bounds: [116.5, 4, 127, 22],
  center: [121.75, 13],
  revision: `sha256-${'a'.repeat(64)}`,
  updatedAt: '2026-10-01T00:00:00Z',
  tileSchema: 'protomaps-basemaps',
};

const catalog = (regions: MapRegion[]) => ({
  version: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  attribution: '© OpenStreetMap contributors',
  regions,
});

describe('offline map catalog', () => {
  it('accepts a valid, published region manifest', () => {
    expect(parseMapCatalog(catalog([region]))).toEqual(catalog([region]));
  });

  it('rejects external asset URLs and invalid archive sizes', () => {
    expect(() => parseMapCatalog(catalog([{ ...region, pmtilesUrl: 'https://example.com/philippines.pmtiles' }]))).toThrow(/same-origin/);
    expect(() => parseMapCatalog(catalog([{ ...region, pmtilesUrl: './offline-maps/metro-manila.pmtiles' }]))).toThrow(/philippines\.pmtiles/);
    expect(() => parseMapCatalog(catalog([{ ...region, sizeBytes: 0 }]))).toThrow(/size/);
    expect(parseMapCatalog(catalog([{ ...region, sizeBytes: 1024 ** 3 }])).regions[0].sizeBytes).toBe(1024 ** 3);
    expect(() => parseMapCatalog(catalog([{ ...region, sizeBytes: 1024 ** 3 + 1 }]))).toThrow(/1 GiB/);
  });

  it('accepts only the Philippines region covered by the release proxy', () => {
    expect(() => parseMapCatalog(catalog([{ ...region, id: 'metro-manila' }]))).toThrow(/unsupported region ID/);
  });

  it('requires the revision to match the archive checksum', () => {
    expect(() => parseMapCatalog(catalog([{ ...region, revision: 'geofabrik-old' }]))).toThrow(/revision/);
  });

  it('rejects duplicate region IDs', () => {
    expect(() => parseMapCatalog(catalog([region, region]))).toThrow(/duplicate region IDs/);
  });
});

describe('offline map region coverage', () => {
  it('includes edge coordinates and excludes points outside the bounds', () => {
    expect(regionContains(region, [116.9, 4.5])).toBe(true);
    expect(regionContains(region, [126.7, 21.2])).toBe(true);
    expect(regionContains(region, [127.001, 13])).toBe(false);
  });
});

describe('offline map style', () => {
  it('uses only the downloaded archive and bundled fonts and sprites', () => {
    const style = createOfflineMapStyle('pmtiles://philippines-2026-10.pmtiles', 'dark', 'http://localhost:5173/');
    expect(style.glyphs).toMatch(/^(?:\.\/|\/)?map-assets\/fonts\//);
    expect(style.sprite).toBe('http://localhost:5173/map-assets/sprites/v4/dark');
    expect(style.sources.collapseai).toMatchObject({
      type: 'vector',
      url: 'pmtiles://philippines-2026-10.pmtiles',
    });
    expect(JSON.stringify(style.layers)).toContain('"townhall","townspot"');
    expect(JSON.stringify(style)).not.toMatch(/https?:\/\/(?!(?:localhost:5173\/|www\.openstreetmap\.org|esa-worldcover\.org|github\.com\/protomaps\/basemaps))/);
    expect(JSON.stringify(style.sources.collapseai)).toContain('ESA WorldCover');
  });
});
