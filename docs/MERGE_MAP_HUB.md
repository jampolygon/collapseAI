# Map/frontend and optional LAN Hub merge

Resolved the existing merge on `backend/features`, combining its Hub commit
with the incoming map work. The merge was not aborted, reset or moved to another
branch. No blanket ours/theirs checkout was used.

## Nine conflict files

- `README.md`: retain Hub setup and add consolidated local/release map instructions.
- `frontend/package.json`: retain UI/service-worker tests, incoming proxy tests,
  streaming hash dependency and frontend scripts; add Node types for Vite config.
- `frontend/public/sw.js`: preserve cache-write completion, network-first catalogs,
  archive/API exclusions and removal of old duplicate cached archives.
- `frontend/src/features/map/OfflineMapCanvas.tsx`: retain error handling, bounds,
  archive cleanup and GPS; incorporate map-click selection and country zoom.
- `frontend/src/features/map/OfflineMapPage.tsx`: retain honest region availability,
  verified storage, LAN downloads and selection consistency; incorporate click UI.
- `frontend/src/features/map/regionCatalog.ts`: one same-origin catalog supporting
  regional and country maps, with matching filenames, checksums and timeouts.
- `frontend/src/features/map/regionDownload.ts`: LAN-compatible downloads,
  cancellation/timeout, incremental SHA-256 and shared reopening validation.
- `frontend/vite.config.ts`: optional Hub bridge, opt-in release proxy, standalone
  local Range serving in development/preview; correct frontend public paths.
- `vercel.json`: static deployment, COOP/COEP headers and release acquisition
  rewrites; no FastAPI dependency or runtime online tile service.

## Preserved architecture

Core browser AI still uses wllama/WASM and on-device OPFS GGUFs. Hub usage is
optional; no frontend AI mode switch or cloud fallback was added. Existing
Hub Range/HEAD/file streaming, traversal protection, metadata/health endpoints,
llama-server proxy/SSE/503 behavior, configuration and tests remain.

Maps use MapLibre, PMTiles v3, IndexedDB and locally bundled fonts/sprites/CSS/
worker. `/offline-maps/regions.json` is the authoritative browser catalog route.
Luzon, Visayas and Mindanao remain supported; Philippines is optional and only
appears in Hub discovery when a corresponding real file exists. Country
validation checks coverage/all expected layer types and SHA-256-bound revisions.
Saved archives are still reopened and hashed before being considered available.

Regional downloads retain 128 MiB. The optional country cap is 256 MiB, with
incremental hashing in bounded slices; the incoming 1 GiB in-memory policy was
not retained. IndexedDB still needs the complete Blob, so this is not a promise
of low-memory phone compatibility or resumable map downloads. Hashing no longer
requires a second whole-file copy. The Hub can still serve larger files to other
Range-capable clients, but excludes oversized files from the PWA catalog.

The incoming release workflows, generator, country metadata checks, map-click
selection, POI sprite mapping, attribution, punctuation glyph and proxy tests
are retained. `npm run maps:catalog` now writes the canonical frontend catalog.
Local assets live in `frontend/public/maps/`, not a competing root public tree.
The incoming catalog snapshot is preserved at
`docs/examples/philippines-regions.example.json`; its archive is absent here and
the example is not used to advertise local availability. No PMTiles source was
downloaded, generated, committed or published by this merge.

Hub configuration takes priority over the release proxy. With neither selected,
development/preview work from local files without FastAPI or internet. Release
proxy configuration is opt-in; deployment can provision a verified release
catalog before building. A release may require internet for initial acquisition;
downloaded rendering uses only local assets. Vercel never needs the LAN Hub.

## Verification

Commands run successfully against the merged implementation:

```powershell
npm install
npm install --save-dev '@types/node@^24' --workspace @collapse-ai/frontend
npm run typecheck
npx tsc --noEmit --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --types node frontend/vite.config.ts
npm test
npm run build
npm run packs:check
npm run packs
python -m unittest discover -s backend/hub/tests -q
python -m unittest discover -s backend/scripts/tests -q
python -m unittest discover -s backend/evals/tests -q
python -m compileall -q backend
python backend/hub/tests/smoke_hub.py
git diff --check
git diff --name-only --diff-filter=U
```

Python: 76 passed, one skipped (Windows does not permit symlink creation).
Frontend/pack/rendering/cache/proxy: 97 passed. Typecheck, Vite config typecheck,
production build, pack consistency/generation, compileall and diff checks pass.
Conflict-marker search and unmerged-path listing return no entries.

The exact Hub startup command was also run:

```powershell
python -m uvicorn backend.hub.app:app --host 127.0.0.1 --port 8000
```

Actual HTTP `/health` and `/api/info` returned successfully: Hub/manifest healthy,
six verified packs, zero installed maps/models and unavailable llama-server.
The aggregate health was degraded rather than crashing. The separate real
Uvicorn smoke test checked pack full/Range downloads and unavailable-AI 503.

AI success/SSE tests use mocked upstream responses; PMTiles tests use synthetic
archives, and UI/cache tests use rendering/VM fixtures. Proxy tests run actual
Vite/HTTP servers against synthetic local/upstream bytes. None of these certify
geographic coverage, real phone rendering, GPS, real GGUF inference or large-file
performance. CI release jobs and deployed Vercel rewrites were not exercised.

## Remaining checks

Real PMTiles and phones/browsers are needed for WebGL, labels/themes, GPS, memory/
storage, relaunch and disconnected offline rendering. Actual GGUF/llama-server
are needed for inference, long SSE sessions and load. Real LAN peers are needed
for firewall/hotspot/HTTPS checks, and a real release/static host for deployment
rewrites. Existing Vitest development-dependency audit advisories remain; the
merge did not perform an unrelated major dependency upgrade.

The final merge commit is created only after verification and staging checks,
with message `Merge map updates with FastAPI LAN hub`. Nothing is pushed.
