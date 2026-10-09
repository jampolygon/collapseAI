# CollapseAI Local LAN Hub

FastAPI is **optional**. The core React PWA still runs wllama/WASM against a
GGUF in browser OPFS, without this service. Hub mode serves existing local
resources and proxies a separately running llama.cpp server, allowing larger
models on a laptop or Raspberry Pi. Neither mode falls back to cloud AI.

```
On-device: PWA → wllama/WASM → browser GGUF
Local Hub: LAN client → FastAPI → local files / local llama-server → GGUF
```

Dependencies need to be installed in advance. Once installed and provisioned,
runtime requests require only local files and local Wi-Fi/hotspot connectivity.
The service never downloads models, maps or pack sources at runtime.

## Install and launch

Python 3.10+; commands below run from the repository root. A virtual environment
is recommended (`python -m venv .venv`, then `.\.venv\Scripts\Activate.ps1`
on Windows, or `source .venv/bin/activate` on Linux/macOS).

```powershell
python -m pip install -r backend/hub/requirements.txt
python backend/scripts/build_packs.py
python -m uvicorn backend.hub.app:app --host 0.0.0.0 --port 8000
```

Alternatively `python -m backend.hub` reads the host/port environment variables.
The explicit Uvicorn command uses its CLI host/port flags instead. Missing model
or map directories and an unavailable llama-server do not prevent startup.

For an offline installation, prepare a wheel directory on an online machine
with the **same OS, Python version and architecture**:

```powershell
python -m pip download -r backend/hub/requirements.txt -d hub-wheels
# Transfer hub-wheels to the offline machine:
python -m pip install --no-index --find-links hub-wheels -r backend/hub/requirements.txt
```

## Configuration

| Variable | Default / behavior |
|---|---|
| `COLLAPSEAI_HUB_NAME` | `CollapseAI Hub` |
| `COLLAPSEAI_HOST` | `0.0.0.0` for `python -m backend.hub` |
| `COLLAPSEAI_PORT` | `8000` for `python -m backend.hub` |
| `COLLAPSEAI_MODEL_DIR` | repository `backend/data/models` |
| `COLLAPSEAI_MAP_DIR` | repository `backend/data/maps` |
| `COLLAPSEAI_LLAMA_URL` | `http://127.0.0.1:8080`; no redirects followed |
| `COLLAPSEAI_PACK_DIR` | repository `frontend/public/packs` |
| `COLLAPSEAI_MANIFEST` | repository `frontend/public/manifest.json` |
| `COLLAPSEAI_CORS_ORIGINS` | empty; optional comma-separated, explicit browser origins |

Resource paths resolve independently of the terminal working directory. Directories
are not created by the Hub. Provision files before use; changes are discovered
on later requests. Use complete directory paths for predictable deployment.

```powershell
$env:COLLAPSEAI_MODEL_DIR = 'C:\collapseai-data\models'
$env:COLLAPSEAI_MAP_DIR = 'C:\collapseai-data\maps'
$env:COLLAPSEAI_LLAMA_URL = 'http://127.0.0.1:8080'
python -m uvicorn backend.hub.app:app --host 0.0.0.0 --port 8000
```

POSIX equivalents: `export COLLAPSEAI_MODEL_DIR=/srv/collapseai/models` and
`export COLLAPSEAI_MAP_DIR=/srv/collapseai/maps`.

## llama-server

Install [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)
separately and supply an actual GGUF. The Hub does not start subprocesses or
expose a shell endpoint. In another terminal:

```powershell
llama-server -m 'C:\collapseai-data\models\your-model.gguf' --host 127.0.0.1 --port 8080
```

Keep llama-server bound to loopback when it shares the Hub machine. It exposes
the [health and OpenAI-compatible chat APIs](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
used here. Hub `ai.available` means upstream `/health` returned 200; it does
not mean that any particular inference benchmark passed or a particular model
was validated. Multiple installed GGUFs can be downloaded, but one running
llama-server selects the inference model. Model files are checked for readability
and nonzero size, not parsed or tested as GGUFs by discovery.

## Endpoints

| Method | Route | Behavior |
|---|---|---|
| GET | `/health` | HTTP 200 with `ok` or `degraded`; individual component states |
| GET | `/api/info` | name, version, manifest packs/models, local model files, regional maps, AI availability |
| GET, HEAD | `/packs/{filename}` | direct `.json` file within configured pack directory |
| GET, HEAD | `/models/{filename}` | direct `.gguf` file within configured model directory |
| GET, HEAD | `/maps/{filename}` | direct `.pmtiles` file within configured map directory |
| GET | `/offline-maps/regions.json` | existing PWA catalog schema; compatible regional maps ≤128 MiB, optional Philippines ≤256 MiB |
| GET, HEAD | `/offline-maps/{filename}` | legacy same-origin PMTiles route alias |
| POST | `/v1/chat/completions` | non-streaming JSON or incremental SSE proxy |

FastAPI also provides `/docs`, `/redoc` and `/openapi.json`. There is no upload,
authentication, discovery, pairing or synchronization API. This is a trusted
LAN service; do not configure router port forwarding or a public tunnel.

Filename access allows ASCII letters, digits, dots, underscores and hyphens,
rejects `..`, separators and wrong extensions, and checks the resolved file
stays directly inside its configured directory. Symlinks outside that directory
are rejected. Keep resource directories writable only by trusted administrators
and avoid editing files in place during downloads; use atomic replacement.

File routes use an open descriptor and at most 256 KiB per read, not whole-file
buffers. They implement full GET/HEAD, single bounded/open-ended/suffix byte
ranges, `206`, `Content-Range`, exact `Content-Length`, `Accept-Ranges: bytes`,
and `416` with `bytes */<size>`. Multipart/multiple ranges are intentionally
rejected with 416. `If-Range` accepts the file ETag; an outdated validator causes
a full response. The ETag is a stat-based change validator, **not a content hash**.

The AI proxy uses a lifespan-managed HTTPX client, ignores environment HTTP
proxies and does not follow redirects. It forwards each received SSE chunk;
disconnects close upstream responses. Initial connection failures and upstream
5xx return 503 JSON, while client errors are preserved. After SSE response headers
have been sent, a later connection failure is reported as an SSE error event,
because an HTTP status can no longer change. Connect timeout is 3 seconds,
read timeout is 300 seconds between chunks; concurrency is bounded to 16 upstream
connections. The proxy sends the client's prompt unchanged; it does not perform
retrieval or apply the browser survival prompt automatically.

## Metadata and manifest decision

Pack IDs, paths, sizes, hashes and article counts come from Pack Builder v2's
resource manifest. Discovery also checks installed pack size/hash before marking
it available. Rebuild stale metadata with `python backend/scripts/build_packs.py`.
The Node pack command now refreshes existing manifest pack hashes too; run the
Python builder after catalog model changes. Model catalog download URLs are
reported as `source_url` for provenance, not contacted. Available model URLs point
to local `/models/...` files. Extra models have `local:<filename-stem>` IDs.
Unknown model hashes stay `null`; actual installed sizes are measured.

Maps stay separate from `frontend/public/manifest.json` in this task. They live
in a configurable machine-specific directory, unlike checked-in generated packs.
`/api/info.maps` lists Luzon, Visayas and Mindanao even if absent, with `available:
false`, `size: null`, `sha256: null` and an explanation. Valid installed maps
expose real sizes/bounds; inspection checks PMTiles v3 MVT, section bounds,
root directory and compatible basemap layer metadata. It does not decode every
tile. The legacy catalog calculates SHA-256 by streaming the file, caches it
until file stat changes, and only publishes maps within the existing PWA size
limit. Info hashes are `null` until computed; values are never invented. Hashing
a large file can delay the first catalog request, but runs outside the event loop.
Larger valid archives remain downloadable at `/maps/...` and visible in info;
the current browser downloader deliberately rejects them.
The merge also discovers `philippines.pmtiles` when installed, checks country
coverage/all basemap layers and emits its SHA-256-bound revision. The three
regional missing-file entries remain present regardless of country availability.

## Another device on the LAN

Connect the phone and Hub to the same Wi-Fi or laptop hotspot. Allow TCP 8000
on the private-network firewall and find the laptop's LAN IPv4 address (Windows
`ipconfig`, Linux `ip addr`). From the phone, open:

```
http://192.168.1.23:8000/api/info
http://192.168.1.23:8000/packs/first-aid.json
http://192.168.1.23:8000/maps/luzon.pmtiles
```

The example address must be replaced with the actual machine address. A missing
map returns 404. No internet connection is needed; Wi-Fi client isolation or
firewall rules may block peers. The Hub currently serves API/resources only;
it does not host the PWA shell, and the PWA Ask view still uses on-device AI.

For the **small existing-map bridge**, start the Hub, then in a frontend terminal:

```powershell
$env:COLLAPSEAI_MAP_HUB_URL = 'http://127.0.0.1:8000'
npm run dev:phone
# Or use the production PWA build with HTTPS and its service worker:
npm run preview:phone
```

Vite forwards only `/offline-maps` and `/maps` to that Hub. Open the frontend's
HTTPS network address on the phone, enter Map, refresh the catalog, and download
an installed compatible region. The renderer, styles and IndexedDB data remain
at the PWA origin. Disconnecting the Hub after a complete verified download
should leave local rendering available; this still needs real-device validation.
An already-installed PWA on a different domain has **no Connect-to-Hub UI yet**.
For static production hosting, provision files/catalog in `frontend/public/` or
configure a same-origin reverse proxy; no hardcoded cloud release proxy remains.
Browser CORS can be enabled explicitly for other API clients, but HTTPS-to-HTTP
mixed-content/private-network restrictions still apply. A raw LAN HTTP page
can inspect APIs but is not a secure context for GPS, OPFS, hashing or PWA install.

## Range and chat checks

These commands work in PowerShell with `curl.exe` (use `curl` on POSIX):

```powershell
curl.exe -i http://127.0.0.1:8000/health
curl.exe -i http://127.0.0.1:8000/api/info
curl.exe -I http://127.0.0.1:8000/packs/first-aid.json
curl.exe -i -H 'Range: bytes=0-126' http://127.0.0.1:8000/maps/luzon.pmtiles
curl.exe -i -H 'Range: bytes=999999999999-' http://127.0.0.1:8000/maps/luzon.pmtiles
curl.exe -i -H 'Range: bytes=0-15' http://127.0.0.1:8000/models/your-model.gguf
```

Put `{"messages":[{"role":"user","content":"Hello"}],"stream":true}`
in `chat.json` outside the resource directories, then:

```powershell
curl.exe -N -H 'Content-Type: application/json' --data-binary '@chat.json' http://127.0.0.1:8000/v1/chat/completions
```

## Tests and limits

```powershell
python -m unittest discover -s backend/hub/tests -v
python -m unittest discover -s backend/scripts/tests -v
python -m unittest discover -s backend/evals/tests -v
python backend/hub/tests/smoke_hub.py
npm run typecheck
npm test
npm run build
```

Hub unit tests use tiny synthetic files and mocked llama-server responses.
The SSE test gates the upstream between chunks to verify incremental forwarding.
Synthetic PMTiles fixtures test file parsing, not geographic accuracy or WebGL
rendering. Symlink tests skip when Windows denies link creation. No real GGUF is
required. Existing evaluation-harness tests also use synthetic HTTP fixtures.
`smoke_hub.py` launches actual Uvicorn on an ephemeral loopback port, downloads
repository packs, checks Range responses and confirms absent resources/upstream
degrade cleanly. It shuts the process down and tests no successful inference.

See [the maps audit and guide](../../docs/OFFLINE_MAPS.md) for extraction,
browser storage, bundled asset coverage and the remaining device checks.
Actual regional archives, actual llama-server inference, multi-GB transfer under
load, phone GPS/permission flows, firewall reachability, storage pressure and
Hub-disconnected/airplane-mode rendering require separate integration testing.
