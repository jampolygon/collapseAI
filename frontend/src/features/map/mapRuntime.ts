import * as maplibregl from 'maplibre-gl';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { DownloadedMapRegion } from './mapTypes';

export const pmtilesProtocol = new Protocol();
let protocolRegistered = false;
let archiveSequence = 0;
maplibregl.setWorkerUrl(mapLibreWorkerUrl);

export function registerPmtilesProtocol(): void {
  if (protocolRegistered) return;
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);
  protocolRegistered = true;
}

export function registerDownloadedArchive(region: DownloadedMapRegion): string {
  const file = new File([region.blob], `${region.id}-${region.revision}-${archiveSequence++}.pmtiles`, {
    type: 'application/vnd.pmtiles',
  });
  pmtilesProtocol.add(new PMTiles(new FileSource(file)));
  return `pmtiles://${file.name}`;
}

export function unregisterDownloadedArchive(url: string): void {
  // pmtiles 4.x exposes its registry but has no public remove method.
  pmtilesProtocol.tiles.delete(url.replace(/^pmtiles:\/\//, ''));
}
