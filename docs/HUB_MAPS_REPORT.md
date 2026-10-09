# Local LAN Hub and offline maps implementation report

FastAPI is optional. The core PWA still runs independently with wllama/WASM and
OPFS GGUF storage. No database, cloud inference, analytics, uploads, user accounts,
automatic hub discovery or Connect-to-Hub AI UI was introduced.

## Created files

- `backend/hub/README.md`
- `backend/hub/__init__.py`
- `backend/hub/__main__.py`
- `backend/hub/app.py`
- `backend/hub/config.py`
- `backend/hub/file_server.py`
- `backend/hub/llama_proxy.py`
- `backend/hub/maps.py`
- `backend/hub/requirements.txt`
- `backend/hub/tests/fixtures.py`
- `backend/hub/tests/smoke_hub.py`
- `backend/hub/tests/test_hub.py`
- `backend/scripts/build_maps.py`
- `backend/scripts/tests/test_build_maps.py`
- `docs/HUB_MAPS_REPORT.md`
- `docs/OFFLINE_MAPS.md`
- `frontend/public/offline-maps/regions.json`
- `frontend/src/features/map/archiveValidation.test.ts`
- `frontend/src/features/map/archiveValidation.ts`
- `frontend/src/features/map/mapAssets.ts`
- `frontend/src/features/map/mapRuntime.test.ts`
- `frontend/tests/maps-sw.test.mjs`

## Modified files

- `.gitignore`
- `README.md`
- `backend/README.md`
- `backend/scripts/README.md`
- `backend/scripts/build-packs.mjs`
- `backend/scripts/build-packs.test.mjs`
- `backend/scripts/build_packs.py`
- `backend/scripts/tests/test_build_packs.py`
- `frontend/package.json`
- `frontend/public/manifest.json`
- `frontend/public/sw.js`
- `frontend/src/features/map/OfflineMapCanvas.tsx`
- `frontend/src/features/map/OfflineMapPage.tsx`
- `frontend/src/features/map/mapRuntime.ts`
- `frontend/src/features/map/offlineMapRepository.ts`
- `frontend/src/features/map/regionCatalog.test.ts`
- `frontend/src/features/map/regionCatalog.ts`
- `frontend/src/features/map/regionDownload.ts`
- `frontend/src/main.tsx`
- `frontend/vite.config.ts`
- `vercel.json`

No frontend inference, retrieval, catalog model URLs, OPFS download-manager logic,
knowledge source content or existing pack content/metadata was replaced. Pack
bytes remain unchanged; the previously stale resource manifest was regenerated.
Frontend package configuration only adds service-worker tests; no new frontend
dependencies were installed beyond the existing lockfile.

## Backend dependencies and commands

Direct dependencies: `fastapi==0.143.0`, `uvicorn==0.54.0`, `httpx==0.28.1`.
Pip resolves their transitive dependencies. Python 3.10+ is required.

Run from the repository root:

```powershell
python -m pip install -r backend/hub/requirements.txt
python backend/scripts/build_packs.py
python -m uvicorn backend.hub.app:app --host 0.0.0.0 --port 8000
```

Alternative environment-aware launcher: `python -m backend.hub`.
Separately install llama.cpp and start it with an actual local file:

```powershell
llama-server -m 'C:\collapseai-data\models\your-model.gguf' --host 127.0.0.1 --port 8080
```

## Endpoints

- `GET /health`: hub, manifest, pack/model/map directories and llama-server health;
  returns 200 with a degraded state when optional resources are absent.
- `GET /api/info`: manifest-derived packs, catalog/local models, regional files,
  hub version/name and actual upstream health.
- `GET, HEAD /packs/{filename}`, `/models/{filename}`, `/maps/{filename}`: bounded
  file streaming, full responses, single/open/suffix ranges, 206/416, accurate
  length/range headers and directory/filename traversal protection.
- `GET /offline-maps/regions.json`: compatibility catalog from installed maps.
- `GET, HEAD /offline-maps/{filename}`: legacy archive alias.
- `POST /v1/chat/completions`: JSON or incremental SSE to the configured local
  llama-server; unavailable upstream returns 503, without cloud fallback.
- FastAPI documentation: `/docs`, `/redoc`, `/openapi.json`.

## Environment variables

`COLLAPSEAI_HUB_NAME`, `COLLAPSEAI_HOST`, `COLLAPSEAI_PORT`,
`COLLAPSEAI_MODEL_DIR`, `COLLAPSEAI_MAP_DIR`, `COLLAPSEAI_LLAMA_URL`,
`COLLAPSEAI_PACK_DIR`, `COLLAPSEAI_MANIFEST`, `COLLAPSEAI_CORS_ORIGINS`.
Defaults and Windows/POSIX examples are in [Hub README](../backend/hub/README.md).
Host/port variables apply to `python -m backend.hub`; explicit Uvicorn flags
control the normal CLI launch. `COLLAPSEAI_MAP_HUB_URL` is the optional frontend
Vite development/preview map proxy, not a mandatory backend dependency.

## Map audit and fixes

Discovered `frontend/src/features/map/`: MapLibre plus Protomaps styles, PMTiles
v3 vector archives, IndexedDB blobs capped at 128 MiB, local fonts/sprites/CSS/
worker, region selection and browser geolocation. There was no backend map
script, archive, local catalog or Hub endpoint. Existing acquisition routes
pointed to an unpublished Metro Manila release. IndexedDB is retained; maps
were not moved into OPFS merely for consistency.

Bug fixes: remove hardwired unpublished cloud proxy; show Luzon/Visayas/Mindanao
honestly; handle missing catalogs/files; resolve same-origin archive URLs under
the app base; permit reachable LAN downloads with the browser internet flag off;
reopen/hash saved archives; validate structure and compatible layer metadata;
permit legitimately empty layer types; prepare both themes' offline assets;
prevent duplicate large-file caching and stale catalogs; await code cache writes;
remove archive references on unmount; handle renderer initialization errors;
fit region bounds; retain consistent selection and graceful GPS behavior.

New Hub functionality: configurable map directory, actual-file discovery,
Range-serving, compatible catalog adapter and an opt-in same-origin Vite map
bridge. No Connect-to-Hub AI workflow was added. The Python extraction wrapper
uses a LOCAL Protomaps source and external `pmtiles extract` / `pmtiles verify`;
missing tools/files, CLI errors, invalid output and oversized output fail clearly.
No enormous source download or map extraction was performed. See
[Offline maps audit/guide](OFFLINE_MAPS.md) for generation commands and coverage.

Maps remain separate from the pack resource manifest because Hub resources are
machine-local. Unknown map/model hashes/sizes stay null. The Hub calculates real
map hashes when creating the browser catalog and caches them until file stat
changes. Existing Python/Node pack-schema drift was repaired without changing
current pack bytes; both builders now keep manifest pack hashes current.

## Verification performed

Exact commands:

```powershell
python -m unittest discover -s backend/hub/tests -q
python -m unittest discover -s backend/scripts/tests -q
python -m unittest discover -s backend/evals/tests -q
python -m compileall -q backend
python backend/hub/tests/smoke_hub.py
python backend/scripts/build_maps.py --help
npm run typecheck
npm test
npm run build
npm run packs:check
npm run packs
python backend/scripts/build_packs.py
git diff --check
```

Results:

- Hub: 26 passed, 1 skipped (Windows did not allow symlink creation).
- Python scripts: 29 passed, including 8 map-tool tests and 21 pack-builder tests.
- Evaluation harness: 20 passed.
- Frontend: 53 Vitest tests, 23 Node pack tests, 10 UI rendering tests and
  5 synthetic service-worker handler tests passed (91 total).
- Typecheck, production build, compileall, pack consistency and diff checks passed.
- Real Uvicorn smoke: startup, degraded health, six verified repository packs,
  full/range pack transfer, missing map/model responses and actual unreachable
  upstream 503 passed. This is loopback HTTP, not a phone/LAN reachability test.
- An independent byte comparison verified repeated Python/Node builds are
  identical, all manifest sizes/hashes match, and pack content/metadata equals
  the existing Git HEAD. Production assets/catalog are bundled locally.
- Actual absent CLI invocations fail with an explicit installation message.
  Missing-source and extraction-failure cases are mocked tests because the
  pmtiles CLI is not installed. No extraction success is claimed.

Mocked AI responses verify protocol handling, not inference. Synthetic PMTiles
fixtures exercise actual parsing/structure checks, not geographic coverage or
WebGL rendering. Storage/download/cache tests use mocks or a VM, not real IDB
or a running browser. The FastAPI TestClient emitted a transitive Starlette
HTTPX deprecation warning; tests still passed.

## Remaining real integration checks and limitations

- Actual regional PMTiles files and the external pmtiles CLI are required to
  generate/verify extracts and test real labels/coverage. None are installed here.
- A real browser/phone is required for pan/zoom/WebGL, both themes, GPS permissions,
  offline relaunch, storage pressure and rendering after Hub disconnection.
- A second device is required for real LAN/hotspot/firewall/client-isolation
  and secure-context checks. Raw LAN HTTP serves APIs but does not make the PWA
  secure for GPS/OPFS/hashing/install behavior.
- Actual GGUF and llama-server are required for successful inference, long SSE
  sessions, cancellation/concurrency and performance. Successful AI tests were mocked.
- Actual large files are needed for multi-GB transfer/soak testing. Range tests
  used tiny files; streaming is bounded in code, not a measured memory benchmark.
- PWA map downloads retain their 128 MiB cap and restart after interruption;
  they do not gain OPFS/resume from the new Hub's Range support. Larger archives
  are Hub-downloadable but excluded from the existing browser catalog.
- Bundled glyphs cover Latin Unicode 0–511; other scripts can lack labels.
  GPS may be unavailable offline. No routing, live data or verified emergency POIs.
- Missing/corrupt IDB records are kept for replacement, not silently deleted.
  The extraction rectangles overlap and require coverage review; they are not
  official region boundaries. Hashing a map delays the first catalog request.
- Single ranges are supported; multipart ranges return 416. File ETags are change
  validators, not hashes. Resource publication is not a multi-file transaction.
- The trusted LAN service has no authentication and must not be publicly tunneled.
  The current PWA Ask view still uses on-device AI; direct Hub API clients can use
  local-server AI. The Hub does not serve the PWA shell or perform automatic RAG.
- Existing Vitest 3 development-dependency audit advisories remain outside this
  focused task. No runtime frontend dependency upgrade was included.
