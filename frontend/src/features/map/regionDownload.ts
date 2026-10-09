import { verifyArchive } from './archiveValidation';
import type { DownloadedMapRegion, MapRegion } from './mapTypes';
import { MAX_MAP_ARCHIVE_BYTES } from './mapTypes';
import { saveDownloadedRegion } from './offlineMapRepository';
import { resolveMapAssetUrl } from './regionCatalog';
import { prepareOfflineMapAssets } from './mapAssets';


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
  if (region.sizeBytes <= 0 || region.sizeBytes > MAX_MAP_ARCHIVE_BYTES) {
    throw new Error('This map exceeds the supported 128 MB download limit.');
  }
  const storage = await navigator.storage?.estimate?.();
  if (storage?.quota !== undefined && storage.usage !== undefined && storage.quota - storage.usage < region.sizeBytes) {
    throw new Error('There may not be enough browser storage for this map. Free space and try again.');
  }
  const persistentStorage = await hasPersistentStorage();
  const response = await fetch(resolveMapAssetUrl(region.pmtilesUrl), { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Map download failed (HTTP ${response.status}).`);
  const headerLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLength) && headerLength > 0 && headerLength !== region.sizeBytes) {
    throw new Error('Map download stopped: the release file size does not match its catalog entry.');
  }
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > region.sizeBytes || receivedBytes > MAX_MAP_ARCHIVE_BYTES) {
          await reader.cancel();
          throw new Error('Map download stopped because it exceeded the published size limit.');
        }
        const chunk = new ArrayBuffer(value.byteLength);
        new Uint8Array(chunk).set(value);
        chunks.push(chunk);
        onProgress({ receivedBytes, totalBytes: region.sizeBytes });
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    receivedBytes = bytes.byteLength;
    chunks.push(bytes.buffer);
    onProgress({ receivedBytes, totalBytes: region.sizeBytes });
  }
  if (receivedBytes !== region.sizeBytes) {
    throw new Error(`Map download is incomplete (${receivedBytes} of ${region.sizeBytes} bytes).`);
  }
  const blob = new Blob(chunks, { type: 'application/vnd.pmtiles' });
  await verifyArchive(region, blob, signal);
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
