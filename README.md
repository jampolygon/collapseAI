# CollapseAI

**A survival assistant that keeps working when the internet, the cloud and the power grid are gone.**

Open the app: **https://collapseai.vercel.app**

Built for the AppBuildersPH Hackathon 2026, theme "Local AI".

---

## What is CollapseAI?

When a typhoon, earthquake or flood hits, the signal and electricity are often the first things to go. That is exactly when people need answers most: how to stop bleeding, whether water is safe to drink, where to go.

CollapseAI puts a small AI, a library of survival guides and offline maps **on your phone**. You download them once while you still have internet. After that, everything works with no signal at all.

The name is a nod to [Collapse OS](https://collapseos.org), an operating system designed to keep old computers useful after a collapse. CollapseAI takes the same idea and modernizes it for the phone you already own.

- No account or sign-up
- No tracking; your questions never leave your phone
- Works on budget phones (tested on an Infinix HOT 60 Pro)
- Ask in English or Taglish

---

## What you can do

The app has two halves: **Prepare** (while you have internet) and **Survive** (when you don't).

| Screen | What it does |
|---|---|
| **Prepare** | Recommends an AI that fits your phone, and downloads it plus the knowledge packs you choose. Downloads can be paused and resumed. |
| **Ask** | Ask a question and get a step-by-step answer, written on your phone, with the sources it used. Chats are saved. |
| **Library** | Read and search all downloaded guides directly, even without the AI. |
| **Map** | Offline maps of Luzon, Visayas and Mindanao, with your GPS location. |
| **Compass** | Phone compass, saved places (home, evacuation center, water source) with distance and direction, and the sun's direction as a backup. |
| **Photo AI** | Take a photo of a sign, label or object and the AI describes it. |
| **Tools** | SOS screen and flashlight, go-bag checklist, water purification calculator, and an AI speed test for your phone. |

---

## Get started

### On an Android phone

1. Open **https://collapseai.vercel.app** in **Chrome**.
2. When asked, tap **Install app**. If you missed it, tap the menu (three dots) and choose **Install app** or **Add to Home screen**.
3. Open CollapseAI from your home screen.
4. Go to **Prepare**:
   - Download the AI model it recommends for your phone.
   - Choose a kit of knowledge packs (start with the recommended one).
   - Download a map of your region.
5. Wait until everything says **Downloaded**. Stay on Wi-Fi if you can; the files are large.

### On an iPhone

1. Open **https://collapseai.vercel.app** in **Safari**.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**.
3. Open it from the home screen and follow step 4 above.

### On a computer

Open **https://collapseai.vercel.app** in Chrome or Edge. Click the install icon in the address bar if you want it as an app. Then use **Prepare** as above.

---

## Test it before you need it

Do this once after downloading, so you know it really works offline:

1. Turn on **airplane mode**.
2. Close the app completely, then open it again from the home screen.
3. Go to **Ask**, tap **Start AI**, and ask: *"may lindol at walang kuryente, ano muna ang dapat naming gawin?"*
4. Open **Map** and **Compass** and check that they load.

If all four steps work, you are ready.

---

## Which AI should I pick?

Prepare recommends one automatically based on your phone's memory (RAM). Bigger models give better answers but are slower and need more space.

| Name | Best for | Download size |
|---|---|---:|
| **Ember** | Any phone; tiny, fastest | about 390 MB |
| **Spark** | Most budget phones | about 530 MB |
| **Torch** | Mid-range phones; clear step-by-step answers | about 730 MB |
| **Lantern** | Laptops and strong phones | about 1.3 GB |
| **Beacon** | Laptops with a good graphics card | about 2 GB |

Photo AI is a separate download of about 280 MB.

---

## Tips and common questions

**Do I need internet to use it?**
Only once, to install the app and download the AI, packs and maps. After that, no.

**I downloaded everything, but now it's gone.**
Downloads are stored in your browser. Clearing browser data, or using a different browser or website address, starts from zero. Always use the installed app from your home screen.

**The answers are slow.**
Pick a smaller model (Ember), close other apps, and keep the phone charged. Use **Tools > AI benchmark** to compare speeds.

**The compass says "no compass sensor".**
Many budget phones don't have one. Walk a few steps and the app will use GPS to tell your direction, or use the sun direction shown below the compass.

**The AI said something that seems wrong.**
Small AIs make mistakes. Check the sources under each answer, and use the **Library** to read the full guide.

**Can several phones share one download?**
Yes, with the optional Hub on a laptop (see the technical section). One download can then serve a whole group over local Wi-Fi.

---

## Important safety notice

CollapseAI is an assistant, not a doctor or an emergency authority. Answers are not medically certified and can be wrong. Always follow official instructions from NDRRMC, PAGASA, PHIVOLCS, DOH and local officials, and contact emergency services (911) when you can. Do not rely on Photo AI alone to decide whether a plant is edible, or for medicine or injury decisions.

---
---

# Technical section

Everything below is for developers, judges and anyone who wants to run or change the project.

## How it works

```text
Your question
   -> search the downloaded guides on the phone (MiniSearch, BM25-style ranking)
   -> pick up to 3 strong passages
   -> local AI model writes the answer from them (llama.cpp compiled to WebAssembly)
   -> answer plus sources shown on screen
```

- **Inference**: open-weight GGUF models run in the browser through `@wllama/wllama` (llama.cpp WASM). The CPU is the default; WebGPU is optional and checked with a quick sanity test.
- **Retrieval (RAG)**: knowledge packs are indexed with MiniSearch. Taglish words are mapped to English search terms, filler words are removed, "what should I do" questions prefer step-by-step guides, and historical disaster articles are skipped for action questions. If nothing relevant is found, the AI answers from general knowledge and the answer is labelled as such.
- **Offline shell**: a service worker precaches every app file at install (HTML, all JS chunks, CSS, the WASM engine, map fonts and icons). Updates are installed into a separate cache and switch over atomically.
- **Storage**: models and packs are stored in OPFS with resumable 16 MB part downloads; map regions are stored in IndexedDB; settings and chats in localStorage.
- **Maps**: MapLibre GL renders PMTiles vector archives (Protomaps basemap, OpenStreetMap data) entirely from local storage.

## Tech stack

| Area | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Vitest |
| On-device AI | @wllama/wllama (llama.cpp WASM), GGUF models |
| Search | MiniSearch |
| Maps | MapLibre GL, PMTiles, @protomaps/basemaps |
| Other libraries | SunCalc, @noble/hashes, Inter (Fontsource) |
| Browser APIs | Service Worker, Cache API, OPFS, IndexedDB, Geolocation, DeviceOrientation, Generic Sensor API |
| Backend (optional) | Python, FastAPI, Uvicorn, HTTPX |
| Tooling | Node.js and Python pack builders, go-pmtiles CLI, Python eval harness |
| Hosting | Vercel (static site) |

## Models

All models are pretrained by their publishers; the team did not train a model. Exact URLs, formats and chat templates are in `frontend/src/lib/catalog.ts`.

| App name | Model |
|---|---|
| Ember | Hugging Face SmolLM2 360M Instruct, Q8_0 |
| Spark | Qwen3.5 0.8B, Q4_K_M |
| Torch | Liquid AI LFM2.5 1.2B Instruct, Q4_K_M |
| Lantern | Qwen3.5 2B, Q4_K_M |
| Beacon | Meta Llama 3.2 3B Instruct, Q4_K_M |
| Photo AI | Hugging Face SmolVLM 256M Instruct, Q8_0, plus mmproj encoder |
| Benchmark only | LFM2 350M (Q4, Q8), Gemma 3 270M |

Model licenses vary; check each publisher's model card before redistributing.

## Knowledge packs

Nine packs, 570 articles in total:

- **Team-written** (based on WHO, CDC, Red Cross, DOH, PHIVOLCS and the public-domain US Army Survival Manual FM 21-76): First Aid, Survival Basics, Disasters (PH), Health and Illness, Food and Farming, Engineering and Power.
- **Wikipedia** (CC BY-SA, with page and revision attribution): Essentials (90 articles), Prepared (169), Full Survival (275).

Pack sizes, hashes and counts are generated into `frontend/public/manifest.json`.

## Run it on your computer

Requirements: **Node.js 22.20+ or 24.12+**. Python 3.10+ is only needed for the backend tools, Hub and evals.

```bash
git clone https://github.com/jampolygon/collapseAI.git
cd collapseAI
npm ci
npm run dev
```

Open http://localhost:5173. Development mode does not register the offline service worker. To test the real offline build:

```bash
npm run build
npm run preview
```

### Testing on a phone over Wi-Fi

`npm run dev:phone` and `npm run preview:phone` serve the app over HTTPS with a self-signed certificate on your local network. Offline features (service worker, OPFS, GPS) need a trusted secure page, so for a real demo use a proper HTTPS address such as the Vercel deployment.

Each address (localhost, LAN IP, Vercel) has its own separate storage, so downloads made on one are not visible on another.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Build the offline-capable PWA into `frontend/dist` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Frontend, pack, UI/cache and map tests |
| `npm run packs` | Rebuild knowledge packs (Node) |
| `npm run packs:check` | Check that the packs are consistent |
| `npm run packs:py` | Rebuild packs and the model manifest (Python) |
| `npm run maps:catalog` | Validate local map files and generate the map catalog |

## Optional: LAN Hub

A laptop can act as a local server for a group: it shares models, packs and maps over Wi-Fi or a hotspot, and can run a larger model with llama.cpp's `llama-server`. No internet is needed once the files are on the laptop.

```bash
python -m pip install -r backend/hub/requirements.txt
python -m uvicorn backend.hub.app:app --host 0.0.0.0 --port 8000
```

Set `COLLAPSEAI_MODEL_DIR` and `COLLAPSEAI_MAP_DIR` to the folders holding your files, and `COLLAPSEAI_LLAMA_URL` to a running `llama-server`. The Hub serves `/health`, `/api/info`, `/packs/*`, `/models/*`, `/maps/*` (with Range support), `/offline-maps/regions.json` and an OpenAI-style `/v1/chat/completions`.

Current limit: the app uses the Hub for maps, but there is no "chat with the Hub" screen in the app yet. See [backend/hub/README.md](backend/hub/README.md) for all settings, firewall and LAN notes.

## Maps

Luzon, Visayas and Mindanao are cut from the Protomaps daily build with the `go-pmtiles` CLI and checked with `backend/scripts/build_maps.py`. They ship with the site in `frontend/public/maps/` and are listed in `frontend/public/offline-maps/regions.json`. Map data is from OpenStreetMap contributors (ODbL) and may be incomplete. The app shows straight-line direction and distance; it does not do turn-by-turn routing.

See [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md) for how to rebuild maps.

## Evaluation harness

`backend/evals` tests answer and retrieval quality against a local `llama-server`, using the same prompts as the app. It uses only the Python standard library and never downloads a model.

```bash
python backend/evals/run_eval.py --server http://127.0.0.1:8080
```

The Python retrieval is a close BM25 approximation of the app's MiniSearch, not an exact copy, and desktop timings are not phone timings. See [backend/evals/README.md](backend/evals/README.md).

## Full verification

```bash
npm run typecheck
npm test
npm run build
npm run packs:check
python -m unittest discover -s backend/hub/tests -q
python -m unittest discover -s backend/scripts/tests -q
python -m unittest discover -s backend/evals/tests -q
python backend/hub/tests/smoke_hub.py
```

## Project layout

```text
frontend/src/        app screens, AI, search, downloads and tools
frontend/public/     service worker, packs, maps and icons
backend/content/     editable guides and generated Wikipedia articles
backend/scripts/     pack, Wikipedia and map build tools
backend/hub/         optional LAN server and llama-server proxy
backend/evals/       answer and retrieval evaluation
docs/                guides and older audit reports
```

## Credits and licenses

- Map data: OpenStreetMap contributors (ODbL), via Protomaps.
- Wikipedia text: CC BY-SA; attribution is kept with each article.
- Guidance adapted from WHO, CDC, Red Cross, DOH, PHIVOLCS and US Army FM 21-76 (public domain).
- AI models: see each publisher's license on Hugging Face.
- AI development tools used while building: Claude Code, OpenAI Codex, GitHub Copilot.

## Team

Built by jampolygon, Zatous and frogrest for AppBuildersPH Hackathon 2026.
