# Offline maps: audit, fixes and provisioning

## Existing implementation discovered

The audit searched all backend/frontend tooling, source/assets, configuration,
docs and map-related keywords without assuming a map location. No AGENTS.md
instructions were found.

| Existing files | Purpose |
|---|---|
| `frontend/src/features/map/OfflineMapPage.tsx`, `OfflineMapCanvas.tsx` | region selection, GPS, MapLibre WebGL renderer |
| `regionCatalog.ts`, `mapTypes.ts`, `regionCatalog.test.ts` | version-1 catalog, size/hash/bounds validation, tests |
| `regionDownload.ts`, `offlineMapRepository.ts` | verified downloads and IndexedDB blob storage |
| `mapRuntime.ts`, `mapStyle.ts` | PMTiles FileSource protocol, bundled worker and Protomaps style |
| `emergencyPois.ts` | intentionally empty emergency dataset |
| `frontend/public/map-assets/` | Noto Sans glyph PBFs, sprite JSON/PNG, licenses |
| `frontend/src/views/Survive.tsx`, `App.tsx`, `styles.css` | lazy Map view and monochrome UI |
| `frontend/vite.config.ts`, `vercel.json` | previously hardwired unpublished GitHub Release proxy |
| `frontend/public/sw.js`, `frontend/src/main.tsx` | shell cache, previously also cached map archives |

Libraries were already MapLibre, PMTiles and Protomaps Basemaps. Archives use
PMTiles v3 MVT vector tiles and Protomaps basemap layers. No Leaflet code, real
archive, MBTiles/OSM source, local region catalog, map backend/build script or
API endpoint existed. The backend contained pack builders and Python evals.
The only map server routes were development/hosting proxies to a Metro Manila
GitHub release that was not published.

Maps were stored in IndexedDB `collapseai-offline-maps`, version 1, store
`regions`: a verified Blob plus metadata. PMTiles FileSource reads local blob
slices; it does not request online tiles. Downloads had cancel/retry, not resume,
and a 128 MiB cap. This storage is preserved; models/packs retain their separate
OPFS resumable manager. The design supported local rendering, but real
archive/device rendering was not verified in this audit.

## Bug fixes

- Preserve renderer, IndexedDB, PMTiles and the light/dark UI. Luzon, Visayas
  and Mindanao now appear with honest missing-source/not-downloaded states.
  No fake bounds, sizes, hashes, map data or emergency POIs were added.
- Default local empty catalog removes dependence on an unpublished release.
  Missing catalogs give an empty list; malformed catalogs still fail clearly.
  Legacy Metro Manila entries remain supported if supplied.
- Existing catalog URLs now accept `/maps/...` as well as `/offline-maps/...`,
  resolve against the app deployment base and still reject external URLs and
  traversal. Downloads attempt a reachable source even if `navigator.onLine`
  is false, allowing local networks without internet.
- Saved records are hashed/reopened before availability is shown. Broken records
  are excluded with a replacement-download explanation, retained in IDB, and
  replaced only after a successful new download. No data is silently deleted.
- Small extracts can omit empty layer types. Validation rejects incompatible
  basemap metadata and zero-tile archives, opens the directory/center tile and
  keeps size/hash checks. It does not decode every geometry or certify coverage.
- Production downloads prepare both themes' bundled sprites/glyphs and worker
  before committing a new map; a missing service-worker controller gives a clear
  reload message. Old redundant archive cache entries are removed on activation.
  Archives/models/API requests bypass shell caching; catalogs are network-first
  with an offline fallback, avoiding stale metadata and duplicate archive storage.
- Archive registrations are removed on unmount. The view initially fits regional
  bounds, GPS outside coverage does not force a camera jump, stored selection
  remains independent of GPS, and asynchronous storage/catalog loading no longer
  clears a published-region selection.

## New Hub integration

The optional `backend/hub/` discovers actual Luzon/Visayas/Mindanao files, serves
Range downloads at `/maps/{filename}`, and adapts compatible regional archives ≤128 MiB
to `/offline-maps/regions.json`. Missing/corrupt files are unavailable. The legacy
archive route remains an alias. Hashes, sizes and bounds come from actual files.

An opt-in Vite proxy (`COLLAPSEAI_MAP_HUB_URL`) bridges existing catalog/archive
requests. This is not a Connect-to-Hub UI, AI mode switch or automatic discovery.
See [Hub setup](../backend/hub/README.md) for launch/phone/HTTPS commands. Default
builds work standalone with static files and no hardcoded cloud map proxy.

Maps remain separate from Pack Builder's manifest: Hub files are configurable,
machine-specific resources rather than checked-in generated packs. The audit
also found newer Node pack metadata unsupported by Python v2. Python now
preserves tags/disaster types/verification dates, and the resource manifest
matches unchanged current pack bytes. Node rebuilds refresh existing manifest
pack hashes; Python remains the source for model catalog metadata.

## Create extracts

The Python wrapper uses only the standard library. Install the external
[go-pmtiles CLI](https://docs.protomaps.com/pmtiles/cli) for your OS on PATH or
supply `--pmtiles 'C:\map tools\pmtiles.exe'`. No shell is invoked; Windows paths
with spaces are passed separately and CLI windows are hidden.

Provide a **real local Protomaps PMTiles v3 basemap**. Source provisioning is a
separate step: see [basemap downloads](https://docs.protomaps.com/basemaps/downloads)
and [tile generation](https://docs.protomaps.com/basemaps/build). It may require
internet, significant storage or Planetiler. The wrapper never downloads a
planet archive or converts arbitrary OSM PBF data. Other vector schemas may not
render correctly. Do not bulk-download public OSM tile-server tiles.

From the repository root:

```powershell
python backend/scripts/build_maps.py --source 'C:\map-data\protomaps-source.pmtiles' --output-dir 'C:\collapseai-data\maps'
# Generates luzon.pmtiles, visayas.pmtiles, mindanao.pmtiles and regions.json.

python backend/scripts/build_maps.py --source 'C:\map-data\protomaps-source.pmtiles' --region luzon --maxzoom 10 --output-dir 'C:\collapseai-data\maps'
python backend/scripts/build_maps.py --source 'C:\map-data\protomaps-source.pmtiles' --region visayas --bounds 121 9 126.5 13 --maxzoom 11
python backend/scripts/build_maps.py --publish-only --output-dir 'C:\collapseai-data\maps'
```

Default rectangles are broad, overlapping extraction windows, **not official
administrative boundaries or guaranteed island coverage**. Review them before
distribution; override with `--bounds` for a single selected region.

| Region | west, south, east, north |
|---|---|
| Luzon | `116,12,124.5,21.5` |
| Visayas | `121,9,126.5,13` |
| Mindanao | `121,4.5,127,10.5` |

Actual catalog bounds/center come from output headers, not these windows.
Default max zoom is 12 and max size 128 MiB. Oversized output fails: reduce zoom
or coverage; raising the script limit does not raise the PWA limit.
The wrapper runs `pmtiles extract` and `pmtiles verify`, checks structure and
output presence, measures size and streams SHA-256. Missing CLI/source/output,
nonzero exit status, corrupt files and oversized output fail clearly. Outputs
cannot overwrite the source archive, and a catalog cannot overwrite an archive.
Outputs are staged before replacement and the catalog is published last; disk failure
mid-publication is not a multi-file transaction. The catalog lists selected
regions only; select all three when exporting a complete static catalog.

Standalone hosting uses `/maps/` files and `/offline-maps/regions.json`:

```powershell
python backend/scripts/build_maps.py --source 'C:\map-data\protomaps-source.pmtiles' --output-dir frontend/public/maps --catalog frontend/public/offline-maps/regions.json
npm run build
```

Generated PMTiles/MBTiles/OSM files and `backend/data/` are Git-ignored. Publish
large assets deliberately outside source control. Preserve OpenStreetMap/ODbL
attribution and bundled sprite/font licenses. No real extracts were generated
or added during this task.

## Limitations and device checks

The merge adds optional Philippines archives ≤256 MiB, incoming release/build
workflows and map-click location selection. Regional limits remain 128 MiB.
SHA-256 is now incremental for both download verification and stored-file reopening.
The canonical frontend catalog is still `/offline-maps/regions.json`; local files
live under `frontend/public/maps/`. The optional Hub bridge wins over the opt-in
release proxy (`COLLAPSEAI_MAPS_RELEASE_BASE`). Country archives require checksum-
bound revisions, full-country bounds and all expected basemap layer types. The
incoming catalog snapshot lives in `docs/examples/` because its archive is absent.
See [README release instructions](../README.md#map-archives-and-release-workflow).

PWA maps remain in-memory/IndexedDB blob downloads: interrupted transfers restart,
with no OPFS migration. Hub routes support Range for clients that implement
resume. Regional files over 128 MiB and country files over 256 MiB are downloadable
from the Hub but excluded from the PWA catalog. Near-limit downloads can need several hundred
MiB of transient memory. Smaller extracts suit low-memory phones. Without
persistent permission, browser storage can be evicted.

Bundled Noto Sans Regular/Medium/Italic glyphs cover Unicode 0–511, with the incoming
Regular 8192–8447 punctuation range also prepared for offline use. CJK uses
MapLibre's local ideograph fallback; other scripts/ranges may lack labels.
Missing local glyphs do not trigger external requests; expand bundled assets
when real labels require it. Tiles/styles/fonts/sprites/CSS/worker/library code
are local. WebGL is required; no raster fallback was added. GPS depends on device,
permission and secure context and can time out offline. Manual map selection
still works. The dot is not navigation or an evacuation route.

Automated tests use synthetic PMTiles structures and mocked fetch/storage/AI;
they do not test geographic accuracy, real IDB or WebGL rendering. Real extracts
and devices are required for pan/zoom, labels in both themes, GPS denial/timeouts,
PWA relaunch, asset caching, storage pressure, cancel/retry, and rendering after
Hub disconnect/airplane mode. Real LAN peers are required for firewall,
client-isolation/CORS/HTTPS checks. Actual GGUF/llama-server and large files are
required for inference, long SSE sessions and multi-GB Range transfers under load.
No routing, live conditions, field reports or invented POIs were added.

The existing Vitest 3 development dependency has npm audit advisories. No
frontend dependency upgrades were included in this map/Hub change.
