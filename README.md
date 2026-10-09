# CollapseAI

**Your survival guide that still works when the internet doesn't.**

CollapseAI is an AI assistant that lives on your phone or computer. Ask it things like *"how do I stop heavy bleeding?"* or *"how do I make water safe to drink?"* and it answers step by step from a built-in library of first aid, survival and disaster guides, **with no internet**.

> AppBuildersPH Hackathon 2026 · Local AI

---

##  Install on your phone (Android)

1. Open the CollapseAI link in **Chrome**.
2. Tap the **⋮ menu** (top right) → **Add to Home screen** (or **Install app**).
3. Open **CollapseAI** from your home screen.
4. Go to **Prepare** and tap the big **Download** button. Use Wi-Fi if you can.
5. Wait until everything says **✓ Ready offline**.

**Test it:** turn on **Airplane mode**, open CollapseAI, go to **Survive** and ask a question. 🎉

> iPhone: open the link in Safari → **Share** → **Add to Home Screen**. The library and tools work; the AI may be slow.

##  Install on your computer

1. Open the CollapseAI link in **Chrome** or **Edge**.
2. Click the **install icon** in the address bar (a small screen with an arrow) → **Install**.
3. Go to **Prepare** → **Download**. Done. It now works offline too.

## Good to know

- **Do it now, while you have internet.** You only need internet once, to download.
- **Which AI should I pick?** The app recommends one for your device. Smaller = faster, bigger = smarter.
- **Save space:** pick only the topics you need (First Aid, Survival, Disasters…). You can add more later.
- **Don't clear your browser data.** That deletes the downloaded AI.
- **No internet but a friend has the AI file?** Prepare → *Import a model file* (from SD card, USB or a file sent to you).
- ⚕ CollapseAI is not a doctor. Use it when no help is available, and get professional help as soon as you can.

---

##  For the team: run it from the code

You need **[Node.js](https://nodejs.org)** (the LTS version) and **[Git](https://git-scm.com)**.

```bash
git clone https://github.com/jampolygon/collapseAI.git
cd collapseAI
npm ci
npm run dev
```

Open **http://localhost:5173** in Chrome. Edit any file and the page updates by itself.

### Testing on your phone

Phones need a secure (https) link, so use this instead of `npm run dev`:

```bash
npm run dev:phone
```

1. Your phone must be on the **same Wi-Fi** as your computer.
2. In the terminal, find the **Network** line, e.g. `https://192.168.1.23:5173`, and open it in Chrome on your phone.
3. Chrome will say *"Your connection is not private"*. That's expected (it's your own computer). Tap **Advanced → Proceed**.

> **This is for looking at the UI only.** Chrome does not allow a service worker (offline mode) on a page whose certificate it rejected, so maps and airplane-mode tests will not work this way. For real offline testing use the deployed https link, or on the phone open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add your `http://192.168.x.x:4173` address (from `npm run preview`), enable it and relaunch Chrome.

> Windows may ask to allow Node.js through the firewall. Click **Allow**.

### Branches (who works where)

| Branch | For | Main files |
|---|---|---|
| `main` | Working, demo-ready code only. Merge into it via pull requests | everything |
| `frontend` | Screens, design, offline/PWA, tools (SOS, compass, map) | `frontend/src/views/`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/public/sw.js` |
| `backend` | Python: knowledge pack builder (Wikipedia etc.), LAN hub server | `backend/scripts/`, `backend/content/`, `backend/hub/` (new) |
| `ai` | Running the AI, search, prompts, model choice, speed tests | `frontend/src/lib/llm.ts`, `frontend/src/lib/ask.ts`, `frontend/src/lib/knowledge.ts`, `frontend/src/lib/catalog.ts` |

```bash
git checkout frontend        # switch to your branch
git pull                     # get the latest
# ...work, then:
git add -A && git commit -m "what you did"
git push
```

Then open a **pull request** into `main` on GitHub when something works. Merge `main` into your branch often (`git merge main`) so the three branches don't drift apart.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run on your computer |
| `npm run dev:phone` | Run with https so phones on your Wi-Fi can use it |
| `npm run build` | Build the final website into `frontend/dist/` |
| `npm run preview` | Run the final build (this is where offline mode works) |
| `npm run typecheck` | Check the code for type errors |
| `npm test` | Run frontend, UI regression, and knowledge-pack tests |
| `npm run packs` | Rebuild knowledge packs from `backend/content/*.md` (Node — no Python needed) |
| `npm run packs:check` | Fail if `frontend/public/packs/*.json` is out of date vs `backend/content/` (use in CI) |
| `npm run test:ui` | Run frontend rendering and theme regression checks |

### How it works

```
PREPARE (online)                          SURVIVE (offline)
Check device → recommend an AI            Question (English, Tagalog keywords ok)
Pick a kit or custom topics                     ↓
Download manager (pause/resume)           Search the downloaded packs → top 3 passages
  ├─ AI model (.gguf from Hugging Face)         ↓
  └─ knowledge packs (JSON)               AI on the device (llama.cpp in the browser)
                                                ↓
                                          Step-by-step answer + sources
```

### Where things are

```
frontend/src/lib/catalog.ts     AI models, topic packs, kits  ← add models/packs here
frontend/src/lib/device.ts      device check + which AI to recommend
frontend/src/lib/downloads.ts   download manager (saved on the device, resumes after crashes)
frontend/src/lib/llm.ts         runs the AI (wllama)
frontend/src/lib/knowledge.ts   search + Tagalog keyword list  ← add words here
frontend/src/lib/ask.ts         the instructions we give the AI
frontend/src/views/             screens: Prepare, Survive (Ask, Library, Tools, Map)
backend/content/*.md           the knowledge itself  ← write articles here
backend/scripts/build_packs.py turns backend/content/*.md into frontend/public/packs/*.json
PLAN.md                hackathon plan and priorities
```

**Adding knowledge:** write in `backend/content/*.md` (copy the style of the existing articles), then run `npm run packs`.

The builder is `backend/scripts/build-packs.mjs` (zero dependencies, Node only — no Python needed).
`backend/scripts/build_packs.py` is the original and produces the same JSON, if you prefer Python
(`npm run packs:py`). Run `npm run packs:check` to fail if the checked-in packs are out of date.

Per-article fields (`category` is required by Python Pack Builder v2):

| Field | Meaning |
|---|---|
| `category:` | shown in the Library and used as a search field |
| `source:` | attribution shown with every citation |
| `tags:` | comma-separated search hints, Tagalog included (`tags: bleeding, dugo, sugat`) |
| `disaster_types:` | comma-separated types used to filter retrieval (`disaster_types: flood, typhoon`) |
| `last_verified:` | ISO date the article was last checked. Set it once in the pack header to cover every article. |

### Putting it online

Any static hosting works (Vercel, Netlify, Cloudflare Pages). Build command `npm run build`, output folder `frontend/dist`. The needed settings are already in `vercel.json` and `frontend/public/_headers`.


### Repository layout

```text
frontend/             React + TypeScript PWA and browser AI
  src/                screens, search, downloads, on-device inference
  public/             service worker, manifest, icons, generated packs
  package.json        frontend dependencies and Vite commands
backend/              content/evaluation tooling and optional FastAPI LAN Hub
  content/            editable knowledge pack Markdown
  scripts/            knowledge pack builders and offline map provisioning
  hub/                optional local file server and llama-server proxy
  evals/              Python evaluation harness
package.json          workspace commands; run npm commands here
package-lock.json     shared dependency lockfile
vercel.json           deploys frontend/dist from the repository root
docs/SYSTEM_AUDIT.md   architecture, findings, and validation
```

Run `npm ci` once at the repository root. All commands above still work there.
You can also run frontend commands from `frontend/`. The Python builder uses
paths relative to its own file, so `python backend/scripts/build_packs.py` works
from the root, and `python scripts/build_packs.py` works from `backend/`.
Generated JSON stays in `frontend/public/packs/` for static hosting and offline use.
See [backend/README.md](backend/README.md) for the content workflow and
[docs/SYSTEM_AUDIT.md](docs/SYSTEM_AUDIT.md) for the initial system audit.

### Offline maps and optional LAN Hub

The Map view uses the existing MapLibre/PMTiles renderer with locally bundled
assets and verified IndexedDB storage. Luzon, Visayas and Mindanao show honest
missing-file states until real extracts are supplied. No archives are included.
The standalone PWA has no online tile or backend requirement after preparation.
See [the maps audit and provisioning guide](docs/OFFLINE_MAPS.md) for existing
architecture, fixes, extraction commands and remaining device tests.

FastAPI is an optional local edge backend: it serves packs, models and maps with
HTTP Range support and proxies a separately running local llama-server. The
core browser AI continues using wllama/WASM without it. From the root:

```powershell
python -m pip install -r backend/hub/requirements.txt
python backend/scripts/build_packs.py
python -m uvicorn backend.hub.app:app --host 0.0.0.0 --port 8000
```

No internet is required once dependencies and resource files are provisioned.
See [Hub setup](backend/hub/README.md) for directory/environment configuration,
llama-server, endpoints, Range checks and LAN phone access. There is no
Connect-to-Hub AI workflow yet; the optional Vite map bridge only reuses the
existing map downloader. Raw LAN HTTP API access is distinct from the secure
context required for the PWA's GPS, storage and install behavior.

### Map archives and release workflow

The same Map view accepts Luzon, Visayas, Mindanao and an optional Philippines
archive. Regional downloads retain the 128 MiB limit; Philippines is capped at
256 MiB with incremental SHA-256. IndexedDB still holds a complete Blob, so
larger downloads need adequate device memory/storage. GPS and map-click location
selection work with the selected local archive. Map attribution includes
OpenStreetMap, ESA WorldCover (CC BY 4.0) and Protomaps Basemaps.

There is one browser catalog route: `/offline-maps/regions.json`. Default local
development and preview serve files from `frontend/public/maps/` and the catalog
from `frontend/public/offline-maps/regions.json`. No Hub or internet is required.
`COLLAPSEAI_MAP_HUB_URL` selects the optional Hub bridge and takes priority over
local assets and `COLLAPSEAI_MAPS_RELEASE_BASE`, the opt-in release proxy. Release
acquisition may use internet during preparation; downloaded rendering uses only
local files, worker, fonts, sprites and CSS.

To prepare a real country archive, install go-pmtiles (the workflows pin CLI
1.31.2), obtain permitted Protomaps source data, then extract and verify it:

```powershell
pmtiles extract 'C:\map-data\protomaps-source.pmtiles' frontend/public/maps/philippines.pmtiles --bbox=116.8,4.4,126.8,21.3 --minzoom=0 --maxzoom=13
pmtiles verify frontend/public/maps/philippines.pmtiles
npm run maps:catalog
```

Create the output directory first. Reduce zoom/coverage if the output exceeds
256 MiB. The generator requires country coverage, the expected vector layers,
actual size/hash/header bounds and a checksum-bound revision. It writes the
canonical frontend catalog; missing input fails clearly. Large archives remain
Git-ignored. The incoming metadata is retained only as a provenance example at
`docs/examples/philippines-regions.example.json`: its referenced archive is not
present in this checkout, and the example is not used by the app.

`.github/workflows/build-offline-maps.yml` finds a dated official Protomaps build,
extracts Philippines bounds through zoom 13, verifies the PMTiles file and creates
the `offline-map-release` artifact. Inspect the artifact and test real offline
rendering before manually dispatching `.github/workflows/publish-offline-maps.yml`
with that successful build run ID. Publishing revalidates and uploads exactly
`regions.json` and `philippines.pmtiles` to `offline-maps-v1`. These workflows are
explicit provisioning jobs; ordinary builds/tests do not download source maps.

For a release-backed static deployment, provision the published catalog into
`frontend/public/offline-maps/regions.json` before building, after verifying the
release exists. Vercel retains the catalog/archive release rewrites and COOP/COEP
headers; it never needs the local FastAPI Hub. The checked-in empty catalog keeps
an unprovisioned static build honest. Deployed rewrite behavior and real archives
still need integration testing. Vite tests cover redirect/range/404 propagation,
Hub precedence and standalone local Range serving with synthetic fixtures.
Never bulk-download public OpenStreetMap tile-server tiles.

### Frontend appearance

The sidebar provides Ask, Prepare, Library, Tools, and Map. Collapse it on desktop or
open it as a drawer on mobile. Floating labels identify collapsed icons on hover
or keyboard focus. Light is the default; choose Light or Dark in the sidebar,
and the choice is saved locally. Inter typography is bundled for offline use.
Skeletons mark device, knowledge, cache, and model loading. Prepare reports file downloads, loaded AI, app/engine
caching, and browser storage separately. See [docs/UI_REDESIGN.md](docs/UI_REDESIGN.md)
for implementation details and verification limits.
