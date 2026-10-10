# CollapseAI

**An offline-first survival AI PWA for AppBuildersPH Hackathon 2026 — Local AI.**

CollapseAI runs a downloaded GGUF model on your phone or computer through
wllama/llama.cpp compiled to WASM. It searches downloaded survival guides locally
with MiniSearch/BM25 and supplies relevant passages to the model. No cloud AI
or server is required for the core experience.

Ask in English or Taglish; selected Tagalog emergency terms are expanded for
retrieval, and the AI is instructed to reply in English. The Library and basic
tools remain useful without a loaded AI model.

## Current app

- **Prepare:** device recommendations, model/pack downloads, pause/resume,
  known-model file import and separate cache/storage/download status.
- **Ask:** local streaming answers, sources, limited conversation context,
  saved chats, small-talk replies and clearly labelled general-knowledge answers.
- **Library:** local search, pack/category filters and source attribution.
- **Map:** MapLibre with downloaded PMTiles v3 vector archives in IndexedDB,
  bundled fonts/sprites/worker, pan/zoom, GPS and manual point selection.
- **Compass:** phone sensor when available, GPS, saved places, straight-line
  bearing/distance and calculated sun direction. This is **not walking routing**.
- **Photo AI:** local SmolVLM plus its vision encoder for captured/chosen photos.
  Loading it replaces the chat model; photo interpretation can be wrong.
- **Tools:** SOS screen/compatible flashlight, go-bag checklist, water calculator
  and an on-device model benchmark.

The team reports successful maps, PWA use, model loading and network-offline
generation on the actual demo phone. The latest retrieval/prompt fix must still
be retested there. Automated tests are not evidence of phone sensors, medical
correctness or native-model performance.

## What works without internet

After preparation on the **same installed origin/browser profile**:

- The cached PWA shell, WASM engine and bundled application/map assets.
- Downloaded GGUF inference and local MiniSearch retrieval.
- Downloaded knowledge and saved conversations.
- Already-downloaded maps, without external tile/CDN requests.
- Go-bag, water calculator and SOS screen; torch support depends on the device.
- Compass/GPS/saved-place tools when hardware and browser permissions allow.
- Photo inference after both its model and encoder have been downloaded.

GPS can be unavailable or slow even offline. Local bearings are not obstacle-
aware routes or evacuation recommendations. Browser data eviction/clearing can
remove downloaded files; request persistent storage and test a real relaunch.

## What needs a connection initially

A normal public setup needs internet to open/install the website, precache the
shell, download model weights from their publishers and obtain map assets.
Wikipedia/map generation and developer dependency installation also acquire
external assets before offline use. Knowledge packs are shipped with the static
site but must be saved locally through Prepare.

Previously acquired files can be provisioned locally or served over a trusted
LAN; the Hub itself needs no internet once dependencies/resources are installed.
There is no cloud AI fallback. An installed PWA icon alone is not proof that all
models, knowledge or maps are ready.

## Install and test on a phone

1. Open the team's **stable, trusted HTTPS** app link in Chrome/Edge on Android.
   Use the install prompt, Prepare's install card, or the browser install menu.
2. In Prepare, choose a model and kit, download them, and check app/engine
   caching and actual file status separately.
3. Open Ask and press **Start AI**. Check a question and its retrieved sources.
4. Download a Map region if needed. Missing archives are shown as unavailable.
5. Close and reopen the installed app in airplane mode. Open the Library/Map
   and generate another answer. Do not clear browser data.

Safari/iPhone has manual Add to Home Screen instructions; model performance,
storage and sensor compatibility need device testing. App-shell updates are
staged separately and activate after existing controlled windows/tabs close.
Keep the origin stable: a different domain/tunnel URL has different local storage.

## Models and technology disclosures

Current text models in `frontend/src/lib/catalog.ts`:

| App name | GGUF model | Approximate download |
|---|---|---:|
| Ember | HuggingFace SmolLM2 360M Instruct Q8_0 | 386 MB |
| Spark | Qwen3.5 0.8B Q4_K_M | 533 MB |
| Torch | LiquidAI LFM2.5 1.2B Instruct Q4_K_M | 731 MB |
| Lantern | Qwen3.5 2B Q4_K_M | 1,281 MB |
| Beacon | Meta Llama 3.2 3B Instruct Q4_K_M | 2,019 MB |

Photo AI is **HuggingFace SmolVLM 256M Instruct Q8_0**, approximately 175 MB plus
a 104 MB mmproj encoder. Tools also offers benchmark-only LFM 350M Q4/Q8 and
Gemma 270M models. CPU is the default; GPU is opt-in with a basic output sanity
check. Actual speed/memory limits must be measured on the target device.

The project uses pretrained third-party weights, not a model trained by the team.
Model licenses vary: review the linked publisher/model cards before redistribution.
The exact publishers, URLs, formats and template options are in the catalog.

Technologies: React, TypeScript, Vite, wllama/llama.cpp WASM, GGUF, OPFS,
MiniSearch, Cache API/service workers, IndexedDB, MapLibre, PMTiles and SunCalc.
The optional backend uses Python, FastAPI, Uvicorn and HTTPX.

**Limits/disclosures:** answers are not medically certified and factual accuracy
is not guaranteed. Prefer relevant cited instructions; unsupported details should
be acknowledged. General-knowledge answers are labelled separately. Do not rely
on photo AI alone for plant edibility, medicine or injury decisions. Benchmark
scores are keyword checks, not clinical or factual certification.

## Nine offline knowledge packs

Six compact team-authored packs: First Aid, Survival Basics, Disasters (PH),
Health & Illness, Food & Farming, and Engineering & Power.

Three general-reference packs: Wikipedia Essentials (90 articles), Wikipedia
Prepared (169) and Wikipedia Full Survival (275). The nine packs currently total
570 articles. Wikipedia text retains page/revision attribution and CC BY-SA
notices; ingestion dates do not mean expert medical review.

Retrieved context contains **up to three strong passages**, not a mandatory
top-three. Query expansion removes Taglish filler, action requests prefer
procedural guidance, weak matches are filtered and historical disaster-event
passages are excluded for action intent. Explicit historical lookups remain
possible. No relevant passages uses the existing cautious general-knowledge
path when AI is loaded, or the no-information response when it is not.

Pack bytes/hashes/counts are generated in `frontend/public/manifest.json`;
`sizes.json` supplies frontend download estimates. Browser pack/model downloads
do not currently verify all resource-manifest hashes end to end. Do not confuse
repository metadata validation with downloaded-model integrity verification.

## Developer setup

Use Node **22.20+ or 24.12+** (compatible with the installed Vite version).
Python 3.10+ is needed only for backend tooling/Hub/evaluations.

```powershell
git clone https://github.com/jampolygon/collapseAI.git
cd collapseAI
npm ci
npm run dev
```

Open `http://localhost:5173`. For a production/offline-capable build:

```powershell
npm run build
npm run preview
```

`npm run dev:phone` and `npm run preview:phone` offer self-signed HTTPS for LAN
development. The browser must actually trust the certificate; bypassing a warning
is not proof that service workers/offline installation will work. Use a trusted
HTTPS origin for the demo. Development mode does not register the production
service worker.

| Command | Purpose |
|---|---|
| `npm run typecheck` | Frontend TypeScript checks |
| `npm test` | Frontend, pack, UI/cache and map-proxy tests |
| `npm run build` | Static PWA into `frontend/dist` |
| `npm run packs:check` | Check generated pack consistency |
| `npm run packs` | Node pack rebuild; refresh existing manifest pack metadata |
| `npm run packs:py` | Python Pack Builder v2 and model/pack manifest |
| `npm run maps:catalog` | Validate actual local map input and generate catalog |
| `npm run test:ui` / `npm run test:map-proxy` | Focused regression suites |

The current repository is the implementation source of truth. Older audit and
merge reports under `docs/` are historical snapshots, not current feature guarantees.

## Optional FastAPI LAN Hub

On-device:

```text
PWA -> local MiniSearch guides -> wllama/WASM -> OPFS GGUF
```

Optional local edge service:

```text
phone/API client -> local Wi-Fi/hotspot -> FastAPI Hub
                                        |-- local packs/models/maps
                                        '-- local llama-server -> GGUF
```

FastAPI is **optional**. The current PWA has a configurable map bridge but **no
Connect-to-Hub AI chat UI**. API availability must not be presented as full phone
Hub-AI integration. The Hub does not host the PWA shell or perform browser RAG.

From the root:

```powershell
python -m pip install -r backend/hub/requirements.txt
$env:COLLAPSEAI_MODEL_DIR = 'C:\collapseai-data\models'
$env:COLLAPSEAI_MAP_DIR = 'C:\collapseai-data\maps'
python -m uvicorn backend.hub.app:app --host 0.0.0.0 --port 8000
```

Run a separately installed llama.cpp server with an actual GGUF:

```powershell
llama-server -m 'C:\collapseai-data\models\your-model.gguf' --host 127.0.0.1 --port 8080
```

The Hub exposes `/health`, `/api/info`, GET/HEAD `/packs/{filename}`,
`/models/{filename}` and `/maps/{filename}` with Range support,
`/offline-maps/regions.json` and POST `/v1/chat/completions` with JSON/SSE.
Missing resources/upstream produce unavailable/degraded states rather than
cloud fallback. `COLLAPSEAI_LLAMA_URL` configures the upstream.

The existing map bridge is selected before launching the frontend:

```powershell
$env:COLLAPSEAI_MAP_HUB_URL = 'http://127.0.0.1:8000'
npm run preview:phone
```

See [Hub setup](backend/hub/README.md) for the remaining variables, CORS,
firewall/LAN instructions and Range checks. Use the service on a trusted local
LAN; raw LAN HTTP API access does not make the PWA a secure context.

## Maps and compass

Luzon, Visayas and Mindanao use the same catalog/storage/renderer flow; an
optional Philippines archive is also supported. Regional downloads are capped
at 128 MiB and the country archive at 256 MiB. Downloads are complete IndexedDB
Blobs and restart after interruption; there is no offline route engine.

Map files must actually exist and open. GPS is permission-dependent; manual map
selection/clicks remain available. There is no independently verified emergency
POI dataset or guaranteed evacuation-center lookup. OSM features may be incomplete
or outdated. Attribution includes OpenStreetMap, ESA WorldCover and Protomaps;
bundled glyphs/sprites include license notices.

Map preparation uses `backend/scripts/build_maps.py` or the existing release
generator/workflows. It requires real source data and the external go-pmtiles
CLI; tests do not download enormous source maps. See
[map provisioning](docs/OFFLINE_MAPS.md) and
[release generator](frontend/scripts/prepare-offline-map-release.mjs).
Do not bulk-download public OSM tile-server tiles.

## Python evaluation harness

The harness extracts the current composed `PERSONA`/`SYSTEM`/`GENERAL` prompts,
uses local generated packs and talks to llama-server. It uses only Python's
standard library and never downloads/installs a model.

```powershell
python backend/evals/run_eval.py --server http://127.0.0.1:8080
python backend/evals/run_eval.py --server http://127.0.0.1:8080 --pack-ids first-aid survival disasters wikipedia-essentials
python backend/evals/run_eval.py --llama-server 'C:\llama\llama-server.exe' --models 'C:\models\model.gguf'
```

Python retrieval mirrors the query/ranking policy but is an explicitly labelled
BM25 approximation, **not exact MiniSearch parity**. Native server timings are
not phone/WASM timings. Reports include prompts, retrieved passages, errors and
heuristic checks; mocked tests do not prove inference quality. See
[evaluation instructions and differences](backend/evals/README.md).

## Complete verification

```powershell
npm run typecheck
npm test
npm run build
npm run packs:check
python -m unittest discover -s backend/hub/tests -q
python -m unittest discover -s backend/scripts/tests -q
python -m unittest discover -s backend/evals/tests -q
python backend/hub/tests/smoke_hub.py
python -m compileall -q backend
git diff --check
```

Hub/evaluation tests use marked synthetic files/responses; map parser tests use
synthetic archives. Real phone/offline and actual GGUF tests are separate.

## Short demo flow

1. Show Prepare: model/knowledge downloaded, shell/engine cached, CPU selected.
2. Turn off the network; close/reopen the installed app.
3. Start the local AI and ask:
   `may lindol at walang kuryente. ano muna ang dapat naming gawin`.
   Show the immediate safety references instead of historical events.
4. Show Library without AI, then the already-downloaded Map and Compass.
   Explain that bearing/distance is not routing.
5. Optionally show Photo AI with preloaded weights, using a simple label/object
   example rather than a medical diagnosis.
6. Present the Hub as an optional local API/resource service, clearly identifying
   that frontend Hub-AI chat integration is not implemented.

### Screenshots / demo evidence

Capture the actual phone's Prepare, offline Ask with sources, Map and Compass
screens, plus an airplane-mode relaunch video. No placeholder image is evidence
of working inference. Keep a backup video of the tested flow.

## Repository layout

```text
frontend/src/       PWA, inference, retrieval, downloads and tools
frontend/public/    service worker, manifests, packs and map assets
backend/content/    editable guides and generated Wikipedia Markdown
backend/scripts/    pack/Wikipedia/map tooling
backend/hub/        optional LAN resource server and llama-server proxy
backend/evals/      Python evaluation harness and tests
docs/               guides and historical audits/reports
.github/workflows/  explicit map build/release jobs
```

Runtime questions/photos are processed locally; initial asset downloads contact
their publishers. This project is a hackathon assistant, not an emergency
authority or a medically certified system.
