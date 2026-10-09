import { FileSource, PMTiles, TileType } from 'pmtiles';
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

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
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

async function verifyArchive(region: MapRegion, blob: Blob, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
  if (!crypto.subtle) throw new Error('This browser cannot verify map downloads. Open CollapseAI in a secure context (HTTPS) and retry.');
  const actualHash = toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  if (actualHash !== region.sha256) throw new Error('Map verification failed: the SHA-256 checksum does not match.');

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
  const [west, south, east, north] = region.bounds;
  if (header.minLon > west || header.minLat > south || header.maxLon < east || header.maxLat < north) {
    throw new Error('The PMTiles archive bounds do not cover the published region bounds.');
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
    throw new Error('This map exceeds the supported 128 MB download limit.');
  }
  const storage = await navigator.storage?.estimate?.();
  if (storage?.quota !== undefined && storage.usage !== undefined && storage.quota - storage.usage < region.sizeBytes) {
    throw new Error('There may not be enough browser storage for this map. Free space and try again.');
  }
  const persistentStorage = await hasPersistentStorage();
  const response = await fetch(region.pmtilesUrl, { signal, mode: 'cors', cache: 'no-store' });
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
