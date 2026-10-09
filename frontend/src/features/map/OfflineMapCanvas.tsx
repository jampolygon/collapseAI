import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { Theme } from '../../ui/theme';
import type { DownloadedMapRegion, EmergencyPoi, MapCenter } from './mapTypes';
import { EMERGENCY_POIS } from './emergencyPois';
import { createOfflineMapStyle } from './mapStyle';
import { regionContains } from './regionCatalog';
import { registerDownloadedArchive, registerPmtilesProtocol, unregisterDownloadedArchive } from './mapRuntime';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  region: DownloadedMapRegion;
  theme: Theme;
  location: MapCenter | null;
  onLocationSelect: (point: MapCenter) => void;
}

function poiCollection(points: EmergencyPoi[]): FeatureCollection<Point, EmergencyPoi> {
  return {
    type: 'FeatureCollection',
    features: points.map(point => ({
      type: 'Feature',
      id: point.id,
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      properties: point,
    })),
  };
}

function locationCollection(location: MapCenter | null): FeatureCollection<Point, { label: string }> {
  return {
    type: 'FeatureCollection',
    features: location ? [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: location },
      properties: { label: 'Selected location' },
    }] : [],
  };
}

export default function OfflineMapCanvas({ region, theme, location, onLocationSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    registerPmtilesProtocol();
    const sourceUrl = registerDownloadedArchive(region);
    setMapReady(false);
    setMapError(null);
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: createOfflineMapStyle(sourceUrl, theme),
        center: region.center,
        zoom: region.id === 'philippines' ? 4.6 : 11,
        maxZoom: region.id === 'philippines' ? 13 : 22,
        maxBounds: [
          [region.bounds[0] - 0.1, region.bounds[1] - 0.1],
          [region.bounds[2] + 0.1, region.bounds[3] + 0.1],
        ],
        attributionControl: { compact: true },
        localIdeographFontFamily: 'sans-serif',
      });
    } catch (error) {
      unregisterDownloadedArchive(sourceUrl);
      setMapError(`Could not open the offline renderer: ${error instanceof Error ? error.message : 'WebGL is unavailable'}`);
      return;
    }
    mapRef.current = map;
    map.fitBounds([[region.bounds[0], region.bounds[1]], [region.bounds[2], region.bounds[3]]], { padding: 24, duration: 0 });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.on('load', () => {
      map.addSource('collapseai-emergency-pois', {
        type: 'geojson',
        data: poiCollection(EMERGENCY_POIS),
      });
      map.addLayer({
        id: 'collapseai-emergency-poi-dots',
        type: 'circle',
        source: 'collapseai-emergency-pois',
        paint: {
          'circle-radius': 7,
          'circle-color': '#202020',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addSource('collapseai-user-location', {
        type: 'geojson',
        data: locationCollection(location),
      });
      map.addLayer({
        id: 'collapseai-user-location-dot',
        type: 'circle',
        source: 'collapseai-user-location',
        paint: {
          'circle-radius': 8,
          'circle-color': '#202020',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
      setMapReady(true);
    });
    map.on('click', event => onLocationSelect([event.lngLat.lng, event.lngLat.lat]));
    map.on('error', event => {
      if (event.error) setMapError(`Map rendering failed: ${event.error.message}`);
    });
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      unregisterDownloadedArchive(sourceUrl);
      mapRef.current = null;
    };
  }, [region, theme, onLocationSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource('collapseai-user-location') as maplibregl.GeoJSONSource | undefined;
    source?.setData(locationCollection(location));
    if (location && regionContains(region, location)) map.flyTo({ center: location, zoom: Math.max(map.getZoom(), 13), duration: 500 });
  }, [location, mapReady, region]);

  return (
    <section className="offline-map-frame" aria-label={`Offline map of ${region.name}`}>
      <div ref={containerRef} className="offline-map-canvas" role="application" aria-label={`Interactive map of ${region.name}`} />
      {!mapReady && !mapError && <div className="map-overlay" role="status">Opening locally stored map…</div>}
      {mapError && <p className="map-error" role="alert">{mapError}</p>}
    </section>
  );
}
