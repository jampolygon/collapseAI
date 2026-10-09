import { PHILIPPINES_COVERAGE_BOUNDS, type MapBounds, type MapCatalog, type MapCenter, type MapRegion } from './mapTypes';
import { MAX_MAP_ARCHIVE_BYTES } from './mapTypes';

const MAP_ASSET_BASE = import.meta.env.DEV
  ? '/maps/'
  : `${import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`}offline-maps/`;
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

function covers(bounds: MapBounds, coverage: MapBounds): boolean {
  return bounds[0] <= coverage[0] && bounds[1] <= coverage[1] &&
    bounds[2] >= coverage[2] && bounds[3] >= coverage[3];
}

function parseRegion(value: unknown): MapRegion {
  if (!isRecord(value)) throw new Error('Map catalog contains an invalid region entry.');
  const { id, name, province, pmtilesUrl, sizeBytes, sha256, bounds, center, revision, updatedAt, tileSchema } = value;
  if (typeof id !== 'string' || !/^[a-z0-9-]{2,64}$/.test(id)) throw new Error('Map catalog contains an invalid region ID.');
  if (id !== 'philippines') throw new Error(`Map catalog contains an unsupported region ID "${id}".`);
  if (typeof name !== 'string' || !name.trim() || typeof province !== 'string' || !province.trim()) {
    throw new Error(`Map region "${id}" is missing its name or province.`);
  }
  const assetPath = typeof pmtilesUrl === 'string' ? pmtilesUrl.replace(/^(?:\.\/|\/)/, '') : '';
  const validAssetUrl = assetPath === `maps/${id}.pmtiles` || assetPath === `offline-maps/${id}.pmtiles`;
  if (typeof pmtilesUrl !== 'string' || !validAssetUrl) {
    throw new Error(`Map region "${id}" must point to its matching same-origin map asset "${id}.pmtiles".`);
  }
  if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0 || (sizeBytes as number) > MAX_MAP_ARCHIVE_BYTES) {
    throw new Error(`Map region "${id}" has an invalid size or exceeds the 1 GiB download limit.`);
  }
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error(`Map region "${id}" is missing a valid SHA-256 checksum.`);
  }
  if (!isBounds(bounds)) throw new Error(`Map region "${id}" has invalid geographic bounds.`);
  if (!covers(bounds, PHILIPPINES_COVERAGE_BOUNDS)) {
    throw new Error(`Map region "${id}" bounds do not cover the required Philippines coverage envelope.`);
  }
  if (!isCenter(center, bounds)) throw new Error(`Map region "${id}" has an invalid center point.`);
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error(`Map region "${id}" has an invalid update date.`);
  }
  if (typeof revision !== 'string' || revision !== `sha256-${String(sha256).toLowerCase()}`) {
    throw new Error(`Map region "${id}" revision does not match its SHA-256 checksum.`);
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
  const timeout = AbortSignal.timeout(20_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(MAP_CATALOG_URL, { signal: requestSignal, cache: 'no-store' });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new Error('Timed out while checking the offline-map release. Check your connection and retry.');
    throw new Error(`Could not reach the same-origin offline-map release route: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (response.status === 404) {
    throw new Error(import.meta.env.DEV
      ? 'Local map catalog asset "public/maps/regions.json" was not found. Generate the local catalog after placing the validated archive there.'
      : 'Offline map catalog asset "regions.json" has not been published in the offline-maps-v1 GitHub Release.');
  }
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
