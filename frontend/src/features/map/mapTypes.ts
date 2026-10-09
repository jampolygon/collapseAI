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

export const MAX_MAP_ARCHIVE_BYTES = 1024 * 1024 * 1024;
