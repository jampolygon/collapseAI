import { FileSource, PMTiles, TileType } from 'pmtiles';
import { sha256 } from '@noble/hashes/sha256.js';
import type { DownloadedMapRegion, MapRegion } from './mapTypes';
import { MAX_MAP_ARCHIVE_BYTES } from './mapTypes';
import { saveDownloadedRegion } from './offlineMapRepository';

const REQUIRED_LAYERS = ['earth', 'landcover', 'landuse', 'roads', 'water', 'buildings', 'boundaries', 'pois', 'places'];

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadResult {
  region: DownloadedMapRegion;
  persistentStorage: boolean;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function vectorLayerIds(metadata: unknown): Set<string> {
  if (typeof metadata !== 'object' || metadata === null || !('vector_layers' in metadata)) {
    throw new Error('This PMTiles archive has no vector-layer metadata.');
  }
  const layers = (metadata as { vector_layers?: unknown }).vector_layers;
  if (!Array.isArray(layers)) throw new Error('This PMTiles archive has invalid vector-layer metadata.');
  return new Set(layers.flatMap(layer =>
    typeof layer === 'object' && layer !== null && 'id' in layer && typeof layer.id === 'string' ? [layer.id] : [],
  ));
}

async function verifyArchive(region: MapRegion, blob: Blob, signal: AbortSignal, digest: Uint8Array): Promise<void> {
  if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
  const actualHash = toHex(digest);
  if (actualHash !== region.sha256) throw new Error('Map verification failed: the SHA-256 checksum does not match.');
  if (region.revision !== `sha256-${actualHash}`) throw new Error('Map verification failed: the catalog revision does not match the downloaded archive.');

  const file = new File([blob], `${region.id}.pmtiles`, { type: 'application/octet-stream' });
  const archive = new PMTiles(new FileSource(file));
  let header;
  try {
    header = await archive.getHeader();
  } catch {
    throw new Error('Map verification failed: the file is not a readable PMTiles archive.');
  }
  if (header.specVersion !== 3 || header.tileType !== TileType.Mvt) {
    throw new Error('This map is not a supported PMTiles v3 vector archive.');
  }
  if (header.numAddressedTiles <= 0) throw new Error('This PMTiles archive contains no map tiles.');
  const [west, south, east, north] = region.bounds;
  if (header.minLon !== west || header.minLat !== south || header.maxLon !== east || header.maxLat !== north) {
    throw new Error('The PMTiles archive bounds do not match the published region bounds.');
  }
  const layers = vectorLayerIds(await archive.getMetadata());
  const missing = REQUIRED_LAYERS.filter(layer => !layers.has(layer));
  if (missing.length) throw new Error(`This archive is not compatible with the CollapseAI map style (missing layers: ${missing.join(', ')}).`);
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
  if (!navigator.onLine) throw new Error('Connect to the internet before downloading this map.');
  if (region.sizeBytes <= 0 || region.sizeBytes > MAX_MAP_ARCHIVE_BYTES) {
    throw new Error('This map exceeds the supported 1 GiB download limit.');
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
    response = await fetch(region.pmtilesUrl, { signal: requestSignal, mode: 'cors', cache: 'no-store' });
  } catch (error) {
    if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
    if (timeout.aborted) throw new Error('Map download timed out. Check your connection and retry.');
    throw new Error(`Could not reach the same-origin map release asset: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (response.status === 404) {
    throw new Error(`Map release asset for ${region.name} (${region.id}) was not found (HTTP 404). The offline-maps-v1 release must include ${region.id}.pmtiles.`);
  }
  if (!response.ok) throw new Error(`Map download failed (HTTP ${response.status}).`);
  const headerLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLength) && headerLength > 0 && headerLength !== region.sizeBytes) {
    throw new Error('Map download stopped: the release file size does not match its catalog entry.');
  }
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;
  const digest = sha256.create();
  const reader = response.body?.getReader();
  try {
    if (reader) {
      try {
        while (true) {
          if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
          if (timeout.aborted) throw new Error('Map download timed out. Check your connection and retry.');
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
  } catch (error) {
    if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
    if (timeout.aborted) throw new Error('Map download timed out. Check your connection and retry.');
    throw error;
  }
  if (receivedBytes !== region.sizeBytes) {
    throw new Error(`Map download is incomplete (${receivedBytes} of ${region.sizeBytes} bytes).`);
  }
  const blob = new Blob(chunks, { type: 'application/vnd.pmtiles' });
  if (timeout.aborted) throw new Error('Map download timed out. Check your connection and retry.');
  await verifyArchive(region, blob, signal, digest.digest());
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
