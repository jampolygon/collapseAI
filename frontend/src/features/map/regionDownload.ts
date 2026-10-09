import { verifyArchive } from './archiveValidation';
import type { DownloadedMapRegion, MapRegion } from './mapTypes';
import { mapArchiveLimit } from './mapTypes';
import { saveDownloadedRegion } from './offlineMapRepository';
import { resolveMapAssetUrl } from './regionCatalog';
import { prepareOfflineMapAssets } from './mapAssets';
import { createMapHash, mapHashHex } from './mapHash';


export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadResult {
  region: DownloadedMapRegion;
  persistentStorage: boolean;
}

async function hasPersistentStorage(): Promise<boolean> {
  try {
    return typeof navigator.storage?.persist === 'function' && await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function downloadMapRegion(
  region: MapRegion,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadResult> {
  const limit = mapArchiveLimit(region.id);
  if (region.sizeBytes <= 0 || region.sizeBytes > limit) {
    throw new Error(`This map exceeds the supported ${limit / 1024 ** 2} MiB download limit.`);
  }
  const storage = await navigator.storage?.estimate?.();
  if (storage?.quota !== undefined && storage.usage !== undefined && storage.quota - storage.usage < region.sizeBytes) {
    throw new Error('There may not be enough browser storage for this map. Free space and try again.');
  }
  const persistentStorage = await hasPersistentStorage();
  const timeout = AbortSignal.timeout(20 * 60_000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetch(resolveMapAssetUrl(region.pmtilesUrl), { signal: requestSignal, cache: 'no-store' });
  } catch (error) {
    if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
    if (timeout.aborted) throw new Error('Map download timed out. Check the map source and retry.');
    throw new Error(`Could not reach the same-origin map source: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (response.status === 404) throw new Error(`Map source does not contain ${region.id}.pmtiles (${region.name}).`);
  if (!response.ok) throw new Error(`Map download failed (HTTP ${response.status}).`);
  const headerLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLength) && headerLength > 0 && headerLength !== region.sizeBytes) {
    throw new Error('Map download stopped: the release file size does not match its catalog entry.');
  }
  const chunks: ArrayBuffer[] = [];
  const digest = createMapHash();
  let receivedBytes = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        if (requestSignal.aborted) throw new DOMException('Map download cancelled or timed out.', 'AbortError');
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > region.sizeBytes || receivedBytes > limit) {
          await reader.cancel();
          throw new Error('Map download stopped because it exceeded the published size limit.');
        }
        const chunk = new ArrayBuffer(value.byteLength);
        new Uint8Array(chunk).set(value);
        chunks.push(chunk);
        digest.update(value);
        onProgress({ receivedBytes, totalBytes: region.sizeBytes });
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    receivedBytes = bytes.byteLength;
    chunks.push(bytes.buffer);
    digest.update(bytes);
    onProgress({ receivedBytes, totalBytes: region.sizeBytes });
  }
  if (receivedBytes !== region.sizeBytes) {
    throw new Error(`Map download is incomplete (${receivedBytes} of ${region.sizeBytes} bytes).`);
  }
  const blob = new Blob(chunks, { type: 'application/vnd.pmtiles' });
  const checksum = mapHashHex(digest.digest());
  digest.destroy();
  await verifyArchive(region, blob, requestSignal, checksum);
  await prepareOfflineMapAssets();
  if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');

  const now = new Date().toISOString();
  const record: DownloadedMapRegion = {
    id: region.id,
    name: region.name,
    province: region.province,
    blob,
    sizeBytes: blob.size,
    sha256: region.sha256,
    bounds: region.bounds,
    center: region.center,
    revision: region.revision,
    updatedAt: region.updatedAt,
    downloadedAt: now,
    verifiedAt: now,
  };
  await saveDownloadedRegion(record);
  return { region: record, persistentStorage };
}
