import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyArchive } from './archiveValidation';
import { validateStoredRegion } from './offlineMapRepository';
import * as repository from './offlineMapRepository';
import { downloadMapRegion } from './regionDownload';
import { hashMapBlob } from './mapHash';
import type { DownloadedMapRegion, MapRegion } from './mapTypes';

// Synthetic directory/metadata/tile fixture. This is not geographic map data
// and these tests do not render a browser map or exercise real IndexedDB.
function fixture(): Blob {
  const directory = new Uint8Array([1, 0, 1, 2, 1]);
  const metadata = new TextEncoder().encode(JSON.stringify({ vector_layers: [{ id: 'earth' }] }));
  const header = new Uint8Array(127);
  header.set(new TextEncoder().encode('PMTiles'));
  header[7] = 3;
  const view = new DataView(header.buffer);
  [127, directory.length, 127 + directory.length, metadata.length, 127 + directory.length + metadata.length,
    0, 127 + directory.length + metadata.length, 2, 1, 1, 1].forEach((value, index) => view.setBigUint64(8 + index * 8, BigInt(value), true));
  header.set([1, 1, 1, 1, 0, 0], 96);
  [116, 4, 127, 22].forEach((value, index) => view.setInt32(102 + index * 4, value * 1e7, true));
  view.setInt32(119, 121 * 1e7, true);
  view.setInt32(123, 14 * 1e7, true);
  return new Blob([header, directory, metadata, new Uint8Array([26, 0])]);
}

async function metadata(blob = fixture()): Promise<MapRegion> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return { id: 'luzon', name: 'Luzon', province: 'Luzon', pmtilesUrl: './maps/luzon.pmtiles',
    sizeBytes: blob.size, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    bounds: [116, 4, 127, 22], center: [121, 14], revision: 'fixture', updatedAt: '2026-10-09T00:00:00Z', tileSchema: 'protomaps-basemaps' };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('local archive verification', () => {
  it('hashes multiple stored-file slices without copying the entire Blob', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 17);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    const expected = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const blob = new Blob([bytes]);
    vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('Whole-file copy is forbidden in this test'));
    expect(await hashMapBlob(blob, new AbortController().signal)).toBe(expected);
  });
  it('opens the real PMTiles parser against a synthetic archive', async () => {
    await expect(verifyArchive(await metadata(), fixture())).resolves.toBeUndefined();
  });

  it('rejects corrupt files, wrong sizes and wrong hashes', async () => {
    const region = await metadata();
    await expect(verifyArchive(region, new Blob())).rejects.toThrow(/size/);
    await expect(verifyArchive({ ...region, sha256: '0'.repeat(64) }, fixture())).rejects.toThrow(/checksum/);
    const corrupt = new Blob(['Not a PMTiles file']);
    await expect(verifyArchive(await metadata(corrupt), corrupt)).rejects.toThrow(/readable PMTiles/);
  });

  it('rejects cancelled verification and missing secure-context hashing', async () => {
    const region = await metadata();
    const controller = new AbortController();
    controller.abort();
    await expect(verifyArchive(region, fixture(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('crypto', {});
    await expect(verifyArchive(region, fixture())).rejects.toThrow(/secure context/);
  });

  it('rejects out-of-file sections even with a matching published checksum', async () => {
    const bytes = new Uint8Array(await fixture().arrayBuffer());
    new DataView(bytes.buffer).setBigUint64(64, BigInt(999999), true);
    const blob = new Blob([bytes]);
    await expect(verifyArchive(await metadata(blob), blob)).rejects.toThrow(/sections/);
  });

  it('reopens stored records rather than trusting a saved ready flag', async () => {
    const record: DownloadedMapRegion = { ...await metadata(), blob: fixture(), downloadedAt: '2026-10-09T00:00:00Z', verifiedAt: '2026-10-09T00:00:00Z' };
    await expect(validateStoredRegion(record)).resolves.toBeUndefined();
    await expect(validateStoredRegion({ ...record, blob: new Blob() })).rejects.toThrow(/size/);
  });
});

describe('map downloads with mocked fetch/storage', () => {
  it('attempts a reachable local source even when navigator.onLine is false', async () => {
    vi.stubEnv('BASE_URL', './');
    const region = await metadata();
    vi.stubGlobal('document', { baseURI: 'https://phone.test/app/' });
    vi.stubGlobal('navigator', { onLine: false, storage: { persist: async () => true, estimate: async () => ({ quota: 1e6, usage: 0 }) } });
    const fetch = vi.fn().mockResolvedValue(new Response(fixture()));
    vi.stubGlobal('fetch', fetch);
    const save = vi.spyOn(repository, 'saveDownloadedRegion').mockResolvedValue();
    await downloadMapRegion(region, new AbortController().signal, vi.fn());
    expect(fetch.mock.calls[0][0]).toBe('https://phone.test/app/maps/luzon.pmtiles');
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not save truncated or size-mismatched downloads', async () => {
    const region = await metadata();
    vi.stubGlobal('document', { baseURI: 'https://phone.test/' });
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]))));
    const save = vi.spyOn(repository, 'saveDownloadedRegion').mockResolvedValue();
    await expect(downloadMapRegion(region, new AbortController().signal, vi.fn())).rejects.toThrow(/incomplete/);
    expect(save).not.toHaveBeenCalled();
  });
});
