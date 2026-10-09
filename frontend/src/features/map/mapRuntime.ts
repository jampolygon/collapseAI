import * as maplibregl from 'maplibre-gl';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { DownloadedMapRegion } from './mapTypes';

export const pmtilesProtocol = new Protocol();
let protocolRegistered = false;
maplibregl.setWorkerUrl(mapLibreWorkerUrl);

export function registerPmtilesProtocol(): void {
  if (protocolRegistered) return;
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);
  protocolRegistered = true;
}

export function registerDownloadedArchive(region: DownloadedMapRegion): string {
  const file = new File([region.blob], `${region.id}-${region.revision}.pmtiles`, {
    type: 'application/vnd.pmtiles',
  });
  pmtilesProtocol.add(new PMTiles(new FileSource(file)));
  return `pmtiles://${file.name}`;
}
