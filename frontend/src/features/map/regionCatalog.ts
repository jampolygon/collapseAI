import type { MapBounds, MapCatalog, MapCenter, MapRegion } from './mapTypes';
import { MAX_MAP_ARCHIVE_BYTES } from './mapTypes';

const MAP_ASSET_BASE = `${import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`}offline-maps/`;
export const MAP_CATALOG_URL = `${MAP_ASSET_BASE}regions.json`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBounds(value: unknown): value is MapBounds {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return false;
  const [west, south, east, north] = value;
  return west >= -180 && west < east && east <= 180 && south >= -90 && south < north && north <= 90;
}

function isCenter(value: unknown, bounds: MapBounds): value is MapCenter {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) return false;
  const [longitude, latitude] = value;
  return longitude >= bounds[0] && longitude <= bounds[2] && latitude >= bounds[1] && latitude <= bounds[3];
}

function parseRegion(value: unknown): MapRegion {
  if (!isRecord(value)) throw new Error('Map catalog contains an invalid region entry.');
  const { id, name, province, pmtilesUrl, sizeBytes, sha256, bounds, center, revision, updatedAt, tileSchema } = value;
  if (typeof id !== 'string' || !/^[a-z0-9-]{2,64}$/.test(id)) throw new Error('Map catalog contains an invalid region ID.');
  if (typeof name !== 'string' || !name.trim() || typeof province !== 'string' || !province.trim()) {
    throw new Error(`Map region "${id}" is missing its name or province.`);
  }
  if (
    typeof pmtilesUrl !== 'string' ||
    !/^(?:\.\/|\/)?offline-maps\/[a-z0-9-]+\.pmtiles$/.test(pmtilesUrl)
  ) {
    throw new Error(`Map region "${id}" does not point to a supported same-origin map asset.`);
  }
  if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0 || (sizeBytes as number) > MAX_MAP_ARCHIVE_BYTES) {
    throw new Error(`Map region "${id}" has an invalid size or exceeds the 128 MB download limit.`);
  }
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error(`Map region "${id}" is missing a valid SHA-256 checksum.`);
  }
  if (!isBounds(bounds)) throw new Error(`Map region "${id}" has invalid geographic bounds.`);
  if (!isCenter(center, bounds)) throw new Error(`Map region "${id}" has an invalid center point.`);
  if (typeof revision !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(revision)) {
    throw new Error(`Map region "${id}" has an invalid revision.`);
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error(`Map region "${id}" has an invalid update date.`);
  }
  if (tileSchema !== 'protomaps-basemaps') throw new Error(`Map region "${id}" uses an unsupported tile schema.`);
  return {
    id,
    name: name.trim(),
    province: province.trim(),
    pmtilesUrl,
    sizeBytes: sizeBytes as number,
    sha256: sha256.toLowerCase(),
    bounds,
    center,
    revision,
    updatedAt,
    tileSchema,
  };
}

export function parseMapCatalog(value: unknown): MapCatalog {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(value.updatedAt)) ||
    value.attribution !== '© OpenStreetMap contributors' ||
    !Array.isArray(value.regions)
  ) {
    throw new Error('The published offline-map catalog has an unsupported or invalid format.');
  }
  const regions = value.regions.map(parseRegion);
  if (new Set(regions.map(region => region.id)).size !== regions.length) {
    throw new Error('The published offline-map catalog contains duplicate region IDs.');
  }
  return { version: 1, updatedAt: value.updatedAt, attribution: value.attribution, regions };
}

export async function loadMapCatalog(signal?: AbortSignal): Promise<MapCatalog> {
  const response = await fetch(MAP_CATALOG_URL, { signal, cache: 'no-store' });
  if (response.status === 404) throw new Error('Metro Manila map files have not been published yet.');
  if (!response.ok) throw new Error(`Could not load the offline-map catalog (HTTP ${response.status}).`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('The published offline-map catalog is not valid JSON.');
  }
  return parseMapCatalog(value);
}

export function regionContains(region: Pick<MapRegion, 'bounds'> | Pick<DownloadedRegionBounds, 'bounds'>, point: MapCenter): boolean {
  const [west, south, east, north] = region.bounds;
  const [longitude, latitude] = point;
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}

type DownloadedRegionBounds = { bounds: MapBounds };
