import { createHash } from 'node:crypto';
import { File } from 'node:buffer';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileSource, PMTiles, TileType } from 'pmtiles';

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const REQUIRED_LAYERS = ['earth', 'landcover', 'landuse', 'roads', 'water', 'buildings', 'boundaries', 'pois', 'places'];
const BUILD_BOUNDS = [116.8, 4.4, 126.8, 21.3];
const PHILIPPINES_COVERAGE = [116.9, 4.5, 126.7, 21.2];
const [archivePath, outputDirectory, distribution = 'local'] = process.argv.slice(2);

if (!archivePath || !outputDirectory || !['local', 'release'].includes(distribution)) {
  throw new Error('Usage: node prepare-offline-map-release.mjs <philippines.pmtiles> <output-directory> [local|release]');
}

const archiveSize = (await stat(archivePath)).size;
if (archiveSize <= 0 || archiveSize > MAX_ARCHIVE_BYTES) {
  throw new Error(`PMTiles archive size ${archiveSize} is invalid or exceeds the app limit of ${MAX_ARCHIVE_BYTES} bytes (1 GiB).`);
}

const bytes = await readFile(archivePath);
if (!bytes.subarray(0, 7).equals(Buffer.from('PMTiles'))) {
  throw new Error('Generated file does not have the PMTiles archive magic bytes.');
}
const file = new File([bytes], 'philippines.pmtiles', { type: 'application/vnd.pmtiles' });
const archive = new PMTiles(new FileSource(file));
const header = await archive.getHeader();
if (header.specVersion !== 3 || header.tileType !== TileType.Mvt) {
  throw new Error('Generated archive must be a PMTiles v3 vector-tile archive.');
}
if (header.numAddressedTiles <= 0) throw new Error('Generated PMTiles archive contains no map tiles.');

const [requestedWest, requestedSouth, requestedEast, requestedNorth] = BUILD_BOUNDS;
if (
  header.minLon > requestedWest || header.minLat > requestedSouth ||
  header.maxLon < requestedEast || header.maxLat < requestedNorth
) {
  throw new Error(
    `Generated PMTiles bounds [${header.minLon}, ${header.minLat}, ${header.maxLon}, ${header.maxLat}] do not cover the requested Philippines build bounds [${BUILD_BOUNDS.join(', ')}].`,
  );
}
const [coverageWest, coverageSouth, coverageEast, coverageNorth] = PHILIPPINES_COVERAGE;
if (
  header.minLon > coverageWest || header.minLat > coverageSouth ||
  header.maxLon < coverageEast || header.maxLat < coverageNorth
) {
  throw new Error(
    `Generated PMTiles bounds do not cover the Philippines coverage envelope [${PHILIPPINES_COVERAGE.join(', ')}].`,
  );
}

const metadata = await archive.getMetadata();
if (typeof metadata !== 'object' || metadata === null || !('vector_layers' in metadata) || !Array.isArray(metadata.vector_layers)) {
  throw new Error('Generated PMTiles metadata has no vector_layers list.');
}
const availableLayers = new Set(metadata.vector_layers.flatMap(layer =>
  typeof layer === 'object' && layer !== null && 'id' in layer && typeof layer.id === 'string' ? [layer.id] : [],
));
const missingLayers = REQUIRED_LAYERS.filter(layer => !availableLayers.has(layer));
if (missingLayers.length) throw new Error(`Generated archive is incompatible with the app style; missing layers: ${missingLayers.join(', ')}.`);

const outputPmtiles = path.join(outputDirectory, 'philippines.pmtiles');
await mkdir(outputDirectory, { recursive: true });
if (path.resolve(archivePath) !== path.resolve(outputPmtiles)) await copyFile(archivePath, outputPmtiles);
const checksum = createHash('sha256').update(bytes).digest('hex');
const catalog = {
  version: 1,
  updatedAt: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors',
  regions: [{
    id: 'philippines',
    name: 'Philippines',
    province: 'Philippines',
    pmtilesUrl: distribution === 'local' ? './maps/philippines.pmtiles' : './offline-maps/philippines.pmtiles',
    sizeBytes: archiveSize,
    sha256: checksum,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    center: [header.centerLon, header.centerLat],
    revision: `sha256-${checksum}`,
    updatedAt: new Date().toISOString(),
    tileSchema: 'protomaps-basemaps',
  }],
};
await writeFile(path.join(outputDirectory, 'regions.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Validated PMTiles v3 archive: ${archiveSize} bytes, sha256 ${checksum}`);
console.log(`Validated region bounds: ${catalog.regions[0].bounds.join(', ')}`);
console.log(`Validated Philippines coverage envelope: ${PHILIPPINES_COVERAGE.join(', ')}`);
console.log(`Validated Protomaps layers: ${REQUIRED_LAYERS.join(', ')}`);
console.log(`Catalog asset route: ${catalog.regions[0].pmtilesUrl}`);
