import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../../ui/theme';

export function createOfflineMapStyle(archiveUrl: string, theme: Theme): StyleSpecification {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const flavor = theme === 'dark' ? 'dark' : 'light';
  return {
    version: 8,
    glyphs: `${base}map-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}map-assets/sprites/v4/${flavor}`,
    sources: {
      collapseai: {
        type: 'vector',
        url: archiveUrl,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    },
    layers: layers('collapseai', namedFlavor(flavor), { lang: 'en' }),
  };
}
