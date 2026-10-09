import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../../ui/theme';

export function createOfflineMapStyle(archiveUrl: string, theme: Theme, pageUrl = window.location.href): StyleSpecification {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const flavor = theme === 'dark' ? 'dark' : 'light';
  const mapLayers = layers('collapseai', namedFlavor(flavor), { lang: 'en' });
  const poiLayer = mapLayers.find(layer => layer.id === 'pois');
  const poiIcons = poiLayer?.type === 'symbol' ? poiLayer.layout?.['icon-image'] : undefined;
  if (
    Array.isArray(poiIcons) &&
    poiIcons[0] === 'match' &&
    Array.isArray(poiIcons[1]) &&
    poiIcons[1][0] === 'get' &&
    poiIcons[1][1] === 'kind' &&
    poiIcons.length >= 5
  ) {
    poiIcons.splice(-1, 0, 'townhall', 'townspot');
  }
  return {
    version: 8,
    glyphs: `${base}map-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: new URL(`${base}map-assets/sprites/v4/${flavor}`, pageUrl).href,
    sources: {
      collapseai: {
        type: 'vector',
        url: archiveUrl,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Landcover: <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover</a> (CC BY 4.0) · <a href="https://github.com/protomaps/basemaps">Protomaps Basemaps</a>',
      },
    },
    layers: mapLayers,
  };
}
