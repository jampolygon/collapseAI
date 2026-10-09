import { FileSource, PMTiles, TileType } from 'pmtiles';
import type { MapRegion } from './mapTypes';
import { MAX_MAP_ARCHIVE_BYTES } from './mapTypes';

const BASEMAP_LAYERS = ['earth', 'landcover', 'landuse', 'roads', 'water', 'buildings', 'boundaries', 'pois', 'places'];

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

export async function verifyArchive(region: Pick<MapRegion, 'id' | 'sha256' | 'bounds' | 'sizeBytes'>, blob: Blob, signal = new AbortController().signal): Promise<void> {
  if (signal.aborted) throw new DOMException('Map download cancelled.', 'AbortError');
  if (!(blob instanceof Blob) || blob.size !== region.sizeBytes || blob.size === 0 || blob.size > MAX_MAP_ARCHIVE_BYTES) {
    throw new Error('Map verification failed: local archive is missing or has an invalid size.');
  }
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
  const sections = [
    [header.rootDirectoryOffset, header.rootDirectoryLength],
    [header.jsonMetadataOffset, header.jsonMetadataLength],
    [header.leafDirectoryOffset, header.leafDirectoryLength ?? 0],
    [header.tileDataOffset, header.tileDataLength ?? 0],
  ].filter(([, length]) => length > 0).sort(([a], [b]) => a - b);
  if (!header.rootDirectoryLength || !header.jsonMetadataLength || !header.tileDataLength ||
      sections.some(([offset, length]) => !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 127 || offset + length > blob.size) ||
      sections.some(([offset], index) => index > 0 && sections[index - 1][0] + sections[index - 1][1] > offset)) {
    throw new Error('Map verification failed: PMTiles sections overlap or exceed the local file.');
  }
  if (header.minZoom > header.maxZoom || header.maxZoom > 26 || header.centerZoom < header.minZoom || header.centerZoom > header.maxZoom ||
      header.minLon < -180 || header.maxLon > 180 || header.minLat < -90 || header.maxLat > 90 ||
      header.minLon >= header.maxLon || header.minLat >= header.maxLat ||
      header.centerLon < header.minLon || header.centerLon > header.maxLon || header.centerLat < header.minLat || header.centerLat > header.maxLat) {
    throw new Error('Map verification failed: invalid PMTiles bounds, center or zoom levels.');
  }
  const [west, south, east, north] = region.bounds;
  if (header.minLon > west || header.minLat > south || header.maxLon < east || header.maxLat < north) {
    throw new Error('The PMTiles archive bounds do not cover the published region bounds.');
  }
  const layers = vectorLayerIds(await archive.getMetadata());
  if (!BASEMAP_LAYERS.some(layer => layers.has(layer))) throw new Error('This archive is not compatible with the CollapseAI basemap style.');
  // Small extracts can legitimately omit empty layer types.
  if (!header.numAddressedTiles) throw new Error('This map contains no tiles.');
  const centerZoom = header.centerZoom;
  const scale = 2 ** centerZoom;
  const x = Math.floor((header.centerLon + 180) / 360 * scale);
  const radians = header.centerLat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * scale);
  // Reads the root/leaf directory too. An empty center tile is valid for sparse extracts.
  await archive.getZxy(centerZoom, Math.max(0, Math.min(scale - 1, x)), Math.max(0, Math.min(scale - 1, y)));
}
