export type MapBounds = [west: number, south: number, east: number, north: number];
export type MapCenter = [longitude: number, latitude: number];
export const PHILIPPINES_COVERAGE_BOUNDS: MapBounds = [116.9, 4.5, 126.7, 21.2];

export interface MapRegion {
  id: string;
  name: string;
  province: string;
  pmtilesUrl: string;
  sizeBytes: number;
  sha256: string;
  bounds: MapBounds;
  center: MapCenter;
  revision: string;
  updatedAt: string;
  tileSchema: 'protomaps-basemaps';
}

export interface MapCatalog {
  version: 1;
  updatedAt: string;
  attribution: '© OpenStreetMap contributors';
  regions: MapRegion[];
}

export interface DownloadedMapRegion {
  id: string;
  name: string;
  province: string;
  blob: Blob;
  sizeBytes: number;
  sha256: string;
  bounds: MapBounds;
  center: MapCenter;
  revision: string;
  updatedAt: string;
  downloadedAt: string;
  verifiedAt: string;
}

export type EmergencyPoiType =
  | 'evacuation_center'
  | 'hospital'
  | 'fire_station'
  | 'police_station'
  | 'disaster_office'
  | 'safe_place';

export interface EmergencyPoi {
  id: string;
  name: string;
  type: EmergencyPoiType;
  latitude: number;
  longitude: number;
  address?: string;
  municipality?: string;
  phone?: string;
  sourceName: string;
  sourceUrl?: string;
  lastVerifiedAt: string;
}

// IndexedDB still holds a whole Blob. Keep regional downloads at their existing
// cap; bounded incremental hashing permits the larger country extract safely.
export const MAX_MAP_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_REGIONAL_MAP_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const mapArchiveLimit = (id: string) => id === 'philippines' ? MAX_MAP_ARCHIVE_BYTES : MAX_REGIONAL_MAP_ARCHIVE_BYTES;
