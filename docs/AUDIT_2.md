# CollapseAI audit #2 (read-only)

Audited on 9 October 2026 against `main` @ `dd7ee7c`. No code was changed; this file is the only output.

## Summary

- **Builds and tests are green.** `npm ci`, `typecheck`, `build`, `npm test` (56 + 23 + 15 + 3 tests) and all three Python suites (28 + 29 + 20 tests) pass. The problems below are mostly things the tests don't cover: phone browser rules, offline reload, and AI behaviour.
- **Bug 1 (maps on `http://192.168.x.x`) affects the whole app, not just maps.** Over plain HTTP on a LAN address, Chrome also turns off on-device storage (OPFS), the service worker, the cache, GPS, WebGPU and multi-threading. Model and pack downloads fail with a misleading "Connection problem" message. The self-signed HTTPS from `npm run dev:phone` / `preview:phone` doesn't fully fix it either, because Chrome won't register a service worker on a page with a certificate error. The map check also refuses to run without `crypto.subtle`, even though the hash code doesn't use it.
- **Bug 2 ("hello" → survival tips) is confirmed and explained.** "hello" finds no articles, and the prompt then tells the model to give general advice as numbered steps. "hello po" finds the *12-volt power* articles, because `po` prefix-matches `power`. "how are you" also returns power articles. There is no chat history, no small-talk handling and no minimum relevance score.
- **Bug 3 (GPU garbage):** the GPU is on by default for everyone (`llm.ts:27-33`), and nothing checks that the output makes sense. I can't reproduce this without the phone, but the fix (CPU by default on phones, plus a quick self-test that falls back to CPU) is cheap.
- **The deployed (Vercel) map catalog is probably always empty.** `vercel.json` sends `/offline-maps/regions.json` to GitHub, but Vercel serves a static file first if one exists, and the repo ships an empty `frontend/public/offline-maps/regions.json`. This needs a quick check on the live URL.
- **Offline gaps:** the Map screen's code is only cached if Map was opened while online, and the app has no error boundary. Opening Map offline on a fresh install can white-screen the whole app.
- **The LAN hub isn't used by the app.** The frontend never calls the hub's packs, models, `/api/info` or chat endpoints (only the Vite dev proxy uses its maps). The hub doesn't serve the PWA, and an HTTPS page can't call `http://192.168…` (browsers block this as "mixed content").
- **Phases A–C (radius download, routing, trails, companion AI) aren't started on `main`.** Map downloads keep the whole file in RAM and can't resume after a dropped connection; that has to change before radius download.

## Verification results (real runs)

| Command | Result |
|---|---|
| `npm ci` | OK (warning: esbuild postinstall not approved; harmless, the build uses Vite 8/rolldown) |
| `npm run typecheck` | OK |
| `npm run build` | OK. `index.js` 621 kB (241 kB gz), `OfflineMapPage.js` 1.12 MB (305 kB gz, lazy), MapLibre worker 508 kB, `wllama.wasm` 8.8 MB (2.4 MB gz) |
| `npm test` | OK: vitest 56/56, packs 23/23, UI 15/15, map proxy 3/3 |
| `python -m unittest discover -s backend/hub/tests` | OK 28 (1 skipped: symlinks not allowed on Windows) |
| `python -m unittest discover -s backend/scripts/tests` | OK 29 |
| `python -m unittest discover -s backend/evals/tests` | OK 20 |
| `node backend/scripts/build-packs.mjs --check` | "packs are up to date" |
| Python builder → scratch dir, compared with the repo | All 6 packs **byte-identical**; `manifest.json` identical. Python now accepts `last_verified` (that earlier drift is fixed). |
| Retrieval replay (real packs, same MiniSearch options as `knowledge.ts`) | See P0-5 for the outputs |

Note: `python -m unittest discover -s backend/<x>/tests -t .` fails because the `tests` folders have no `__init__.py`. The commands in the READMEs (without `-t`) work.

## Status of findings from docs/SYSTEM_AUDIT.md

| Old finding | Status |
|---|---|
| P1 Range 416 / truncated model marked ready | **Still open**: `downloads.ts:243-245`, `:304` (see P1-5) |
| P1 Offline readiness not verified | **Partly fixed**: Prepare now shows the app-shell/engine cache state (`ui/system.ts`). Still open: `main.tsx:25` swallows errors, and lazy chunks are not cached (P1-3) |
| P2 Imported unknown models unusable | **Still open**: `Prepare.tsx:78-79`, `Ask.tsx:36` |
| P2 Overlapping model loads / leak on failed load | **Still open** (P1-2) |
| P2 No relevance threshold | **Still open** and now confirmed as part of bug 2 (P0-5) |
| P2 Pack parsing trusts the data shape | **Still open**: `knowledge.ts:146`, `:167` |
| P2 SOS keeps a late camera track | **Still open**: `Tools.tsx:40-50` |
| P2 Water calculator accepts 0 / negative | **Still open**: `Tools.tsx:104,111` |

---

## P0 — demo-breaking

### P0-1 Plain `http://192.168.x.x` breaks almost everything, not just maps
- **Where:** `frontend/src/lib/downloads.ts:73-76` (`navigator.storage.getDirectory()`), `downloads.ts:209-215` (error text), `frontend/src/main.tsx:14` (service worker), `ui/system.ts:86`, `lib/device.ts:17,35`, `features/map/OfflineMapPage.tsx:25-38`.
- **What's wrong:** Chrome only enables these on HTTPS or localhost ("secure context"): `navigator.storage` (OPFS + persist + estimate), service workers, CacheStorage, `crypto.subtle`, geolocation, WebGPU (`navigator.gpu`), the wake lock, and `crossOriginIsolated` (needed for multi-threaded WASM).
- **How it fails for a user:** On the phone via `http://192.168…`, every pack/model download fails, and `friendlyError` says *"Connection problem. Tap Resume…"*, which is wrong and endless. The app can't work offline, GPS fails, and the AI (if it loads at all) runs single-threaded.
- **Fix:**
  1. In `App.tsx`, if `!window.isSecureContext`, show a full-width banner: "Open CollapseAI over HTTPS (the deployed link) — offline mode, downloads, GPS and maps are disabled on plain http".
  2. In `friendlyError`, check `!navigator.storage?.getDirectory` first and return "This page is not secure (http). Open the https link."
  3. Pick one phone demo route (see P0-2).

### P0-2 The README's phone setup (self-signed HTTPS) can't produce an offline-capable app
- **Where:** `README.md:55-63` ("Tap Advanced → Proceed"), `frontend/vite.config.ts:103` (`basicSsl`), `main.tsx:14` (service worker registered only in PROD), `features/map/mapAssets.ts:17-19`.
- **What's wrong:** `dev:phone` never registers a service worker (it's dev mode). `preview:phone` is a production build, but Chrome won't register a service worker on a page whose certificate it rejected, even after "Proceed". So in PROD `prepareOfflineMapAssets()` always throws *"Offline app caching is not ready. Reload CollapseAI once and retry"*. Every map download fails at the very end, after the full file was downloaded and hashed.
- **How it fails:** Teammates test on the phone, maps "download" and then fail, and airplane-mode reload shows Chrome's dino page.
- **Fix (pick one for the demo, ~15 min each):**
  - **Best:** use the deployed Vercel HTTPS URL on the Infinix (but fix P0-4 first for maps).
  - **LAN-only:** on the phone open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.x.x:4173` (and the hub URL), and relaunch. Chrome then treats it as secure: service worker, OPFS, GPS and hashing all work.
  - **LAN-only, cleaner:** `mkcert` → install the root CA on the phone (Settings → Security → Install certificate). Chrome on Android trusts user CAs, so the service worker registers.
  - Update the README so "Proceed" is described as "UI testing only, not offline testing".

### P0-3 The map check refuses to run without `crypto.subtle` and re-hashes every map on every visit
- **Where:** `frontend/src/features/map/archiveValidation.ts:24`; `features/map/offlineMapRepository.ts:53` and `:56-68`; `features/map/mapHash.ts` (uses `@noble/hashes`, pure JS).
- **What's wrong:** The SHA-256 is computed by `@noble/hashes`, which doesn't need `crypto.subtle` at all. Line 24 is a needless gate, and it's the direct cause of bug 1's map error. Separately, `listDownloadedRegions()` calls `verifyArchive()` with no precomputed hash, so it **re-hashes the entire stored archive (up to 256 MB) every time the Map screen opens** (and again after each download via `refreshDownloaded`).
- **How it fails:** On http, maps that are already stored show *"Stored map … cannot be opened"* and disappear from the list. On https, opening Map on the Helio G200 stalls for several seconds or more while pure-JS SHA-256 reads the whole blob (estimate, not measured), and it uses extra memory.
- **Fix:** Delete line 24. In `validateStoredRegion`, check only `blob.size === sizeBytes` plus the PMTiles header/bounds (skip the hash). Keep the full hash only right after a download (it's already computed while streaming in `regionDownload.ts:59-93`). Optionally add a "Re-verify" button.

### P0-4 The deployed site probably always shows "No regional map files"
- **Where:** `vercel.json` rewrites (`/offline-maps/regions.json` → GitHub release) vs. the checked-in `frontend/public/offline-maps/regions.json` (`"regions": []`).
- **What's wrong:** Vercel applies `rewrites` only when no static file matches the path. Because the empty `regions.json` is copied into `dist/`, the GitHub catalog is never used. (README:243-247 says to provision the catalog before building, but nothing enforces it.) Separately, the `.pmtiles` rewrite goes to a GitHub release download, which redirects to `githubusercontent.com`. Whether a 200+ MB proxied/redirected download with CORS works through Vercel has **not been tested by anyone** (`docs/MERGE_MAP_HUB.md:105`).
- **How it fails:** On the only easy HTTPS option for phones, Map says no regions can be downloaded.
- **Fix:** Before the demo, open `https://<deploy>/offline-maps/regions.json` and check whether it's empty. If it is, either copy the real release `regions.json` into `frontend/public/offline-maps/` before `npm run build`, or remove the static file so the rewrite applies. Then do one full map download on the phone over the deployed URL. If the redirect/CORS fails, host the `.pmtiles` file on the same origin (Vercel Blob / Cloudflare R2 with CORS) or ship a smaller city extract inside `public/maps/`.

### P0-5 "hello" → random survival tips (bug 2): cause confirmed
- **Where:** `frontend/src/lib/ask.ts:7-11` (system prompt always demands numbered steps), `ask.ts:23` (always retrieves), `ask.ts:27-29` (no-hit fallback asks for "general advice"), `ask.ts:31-37` (only the current question is sent, with no history), `lib/knowledge.ts:93-100` (no stopwords), `knowledge.ts:161-165` (prefix on every word, fuzzy 0.15; `tags` not indexed), `knowledge.ts:177-186` (top-3 regardless of score), `views/Ask.tsx:108` (no previous turns passed).
- **Measured with the real packs and the app's search settings:**

  | Typed | Retrieved |
  |---|---|
  | `hello` | nothing → prompt says "No reference found. Give only safe, general advice" + "numbered steps" → model invents survival tips |
  | `hello po` | **12-volt power basics, Charging a phone without grid power** (`po` → `power`) |
  | `how are you` | 12-volt power basics, Earthquake, CPR (matched on *how/are/you*) |
  | `what is your name` | Food safety when the power is out, Snake bite, Leptospirosis |
  | `what about kids?` | Leptospirosis, Snake bite, Food safety |
  | `tell me a joke` | Preserving food, Hygiene, Food after a flood (`a` prefix-matches everything) |
  | `ano gagawin pag may baha` | **Food after a flood** first (fuzzy `flood` ≈ `food`), then Flood safety |
  | `how do I stop heavy bleeding` | Severe bleeding ×2, Shock (good) |

- **How it fails:** Greetings and follow-ups get irrelevant "references" and made-up steps, which looks broken in a demo and is risky for medical questions.
- **Fix (in this order):**
  1. **Small-talk gate** before retrieval: match greetings, thanks and identity questions in English and Tagalog (`hi|hello|hey|kumusta|musta|salamat|thanks|thank you|who are you|ano pangalan mo|good (morning|evening)`, with optional `po`). Reply with a short canned or model answer and **no references**, e.g. "Hi! I'm CollapseAI. Ask me about first aid, water, typhoons…".
  2. **Port the `ai` branch search fixes** (stopword list, tiny stemmer, `prefix` only for words ≥5 chars, `fuzzy` only ≥6). Note: on `main` the index is built in `indexPacks()`, not `loadKnowledge()`, so apply them there. Also add `tags` to `fields` (boost ~2), so the Taglish tags already in the packs (`dugo`, `sugat`…) count.
  3. **Relevance threshold:** keep a hit only if at least one non-stopword query term matched, and its score ≥ ~30–40% of the top score (tune with the eval questions). With no hits, **don't call the model**. Show "I don't have information on that in your downloaded packs. Try the Library or download more topics." This also replaces the risky "general advice" fallback.
  4. **Conversation memory (Phase C start):** keep the last 2 turns (question + short answer) in the messages. For short follow-ups ("what about kids?"), search with `previous question + new question`.
  5. Only ask for "numbered steps" when the question is a how-to or emergency. Otherwise allow 1–3 plain sentences.

### P0-6 GPU on by default → garbage output on some phones (bug 3)
- **Where:** `frontend/src/lib/llm.ts:27-33` (`gpuEnabled()` returns true unless the user turned it off), `llm.ts:45-50`, `views/Ask.tsx:153-166`.
- **What's wrong:** WebGPU is used on every device that has it, and no one checks the output. Both Spark (Qwen3.5) and LFM2.5 are newer hybrid architectures. A plausible (unverified) cause is a WebGPU kernel or precision problem on that Mali/PowerVR driver. The CPU path is reported fine.
- **How it fails:** A teammate's phone printed Chinese/garbage. The judges' phone could too.
- **Fix:** (1) Default GPU **off when `device.mobile`** (only use the stored value if the user set it). (2) After `loadModel` with GPU, run a 10-token self-test (`"Reply with exactly: OK"`; pass if the output matches `/\bok\b/i` and is mostly ASCII). On failure, unload, reload with `n_gpu_layers: 0`, save `cai.gpu=off`, and show "GPU gave bad output, switched to CPU". (3) Keep the toggle.

---

## P1 — serious, fix before the demo

### P1-1 Switching tabs wipes the chat and leaves the AI generating in the background
- **Where:** `views/Survive.tsx:37` (Ask is unmounted when another tab is shown), `views/Ask.tsx:52-55` (chat state is local; no cleanup that aborts `abortRef`).
- **How it fails:** The user asks, opens Library to read the source, comes back, and the conversation is gone. The old answer is still being generated inside wllama. The next question starts a second completion on the same engine, which can error or mix output.
- **Fix:** Move `turns` into a small module store (like `downloads.ts`) or into `App`, and keep it in `sessionStorage`. Add `useEffect(() => () => abortRef.current?.abort(), [])`. Or keep Ask mounted and hide it with CSS.

### P1-2 Model controls stay active during loading/answering; a failed load leaks memory
- **Where:** `views/Ask.tsx:136,146` (select/Start AI not disabled while `busy`), `Ask.tsx:154-163` (GPU toggle calls `unload()` even mid-answer or mid-load), `lib/llm.ts:42-53` (if `w.loadModel` throws, `w` is never `exit()`ed because it isn't stored yet).
- **How it fails:** Toggling the GPU during an answer kills the engine mid-stream (error). Toggling it during a load does nothing visible, then the model finishes loading with the old GPU setting while the UI says "not loaded". After a failed load, the WASM heap (hundreds of MB) stays allocated, so a retry with another model can crash the tab on the phone.
- **Fix:** In `llm.ts`, run load/unload/chat through one promise queue (`let op = Promise.resolve(); op = op.then(...)`). Wrap `w.loadModel` in try/catch and call `await w.exit()` on failure. In Ask, disable the select, Start AI and the GPU toggle when `loading || busy`.

### P1-3 Opening Map offline can white-screen the whole app
- **Where:** `views/Survive.tsx:10,40` (lazy import, Suspense, **no error boundary anywhere**: `grep ErrorBoundary` finds nothing), `main.tsx:18-25` (caches only the files this page load already fetched), `features/map/mapAssets.ts:15-27` (map code is cached only when a map download finishes).
- **How it fails:** The user installs, downloads packs and a model, never taps Map while online, then goes offline and taps Map. The chunk import fails, React has no boundary, and the entire app disappears. The same applies to the MapLibre worker, fonts and sprites.
- **Fix:** (1) Add a top-level `ErrorBoundary`, plus one around the lazy Map, with the message "Map isn't available offline yet — open it once while online". (2) Precache **every** build asset: a small Vite plugin writes `dist/precache.json` (list of `dist/assets/*`, `map-assets/**`), and `main.tsx` adds that list instead of `performance` entries. (3) Stop swallowing `cache.addAll` errors (`main.tsx:25`); report them to the Prepare "App shell" status.

### P1-4 No complete "ready for airplane mode" check
- **Where:** `ui/system.ts:91-94` checks only `<script>`/`<link>` tags in `index.html` plus the wasm, not lazy chunks, the map worker or map assets.
- **How it fails:** Prepare says "Cached" but the offline Map (P1-3) or a later chunk is missing.
- **Fix:** Check against the precache list from P1-3. Before the demo, run the manual test: install, download, airplane mode, swipe-kill Chrome, reopen, and use Ask, Library and Map.

### P1-5 Truncated or stale model downloads can be marked "Downloaded"
- **Where:** `lib/downloads.ts:243-245` (any HTTP 416 → done, with `total = offset`), `:254-256` (`total` from Content-Length only), `:304` (no check that `done === total`), `public/manifest.json` (all models have `size: null, sha256: null`).
- **How it fails:** If the connection drops and the server answers 416, or the upstream file changes between resumes, the model shows "Downloaded", then "Could not start the AI: …" with a cryptic error, offline, when it's too late to fix.
- **Fix:** On 416, parse `Content-Range: bytes */N` and mark done only if `N === offset`; otherwise delete and restart. At the end, if `total` is known and `done !== total`, mark error. Save the `ETag` and send `If-Range` on resume. Record the real byte size of each model in the catalog (one `curl -I` per model) and compare.

### P1-6 Map downloads keep the whole file in RAM and can't resume
- **Where:** `features/map/regionDownload.ts:58-92` (all chunks in an array, then a `Blob` copy), `:42` (20-minute hard timeout), `offlineMapRepository.ts:74-76` (whole Blob into IndexedDB).
- **How it fails:** A 256 MB country map uses about 0.5 GB of tab memory at peak. With an LLM loaded in the same tab, Android may kill the tab. A drop at 90% restarts from 0. Below ~1.7 Mbit/s (common mobile data), 256 MB **always** hits the 20-minute timeout.
- **Fix:** Reuse `downloads.ts` (OPFS 16 MB parts plus Range resume) for maps. Hash incrementally as parts are written, and store `{metadata, opfsKey}` in IndexedDB instead of the Blob. This is also the foundation for Phase A radius downloads.

### P1-7 Model and prompt sizes are too heavy for the Infinix by default
- **Where:** `lib/device.ts:48` (8-core phone with `deviceMemory` 8 → **Torch 1.2B**, though the Helio G200 has only 2 fast cores; the comment at `:41-43` says phones should stay small), `lib/llm.ts:46-47` (`n_ctx 4096`, no `n_threads`), `lib/ask.ts:23` (3 passages, each up to ~800 chars; longest measured passage 794 chars), plus the system prompt.
- **How it fails (estimate, measure on the device):** A prompt of roughly 600–900 tokens on 2 big cores means a long silent "Preparing context" (tens of seconds) before the first word.
- **Fix:** On mobile, recommend Spark (CPU) or Ember. Use top-k 2, trim each passage to ~450 chars, `n_ctx 2048`. Try `n_threads: 4` vs default and keep the faster one. Port the benchmark screen from the `ai` branch and record tokens/s on the Infinix for the pitch.

### P1-8 The LAN hub can't actually be used from the app
- **Where:** `backend/hub/app.py:107-172` (APIs and files only; no PWA hosting, no COOP/COEP headers), the frontend (no reference to `/api/info`, `/v1/chat/completions`, or a hub URL; `downloads.ts:217-221` has only a "Later: try a LAN hub" comment), `vite.config.ts:93-98` (only the dev/preview proxy forwards maps).
- **How it fails:** The "hub" story can't be shown with the deployed app. An HTTPS page can't fetch `http://192.168…` (mixed content / private network blocking). Opening the hub directly gives JSON, not the app.
- **Fix (hackathon size, ~2 h):** Have the hub serve `frontend/dist` as static files at `/` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. Phones then open `http://<hub>:8000` with the Chrome flag from P0-2 (or HTTPS via mkcert + `uvicorn --ssl-*`). Packs/models are then same-origin, and `downloads.ts` works unchanged if the model URLs in the catalog are relative (`models/<file>.gguf`) when served from the hub. Hub chat (`/v1/chat`) as a "bigger brain" can come later.

---

## P2 — should fix (quality, robustness, safety)

| # | Where | What's wrong → how it fails | Fix |
|---|---|---|---|
| P2-1 | `lib/ask.ts:29` | No-hit fallback invites invented medical advice | With no hits, answer from a fixed "not in your packs" message (P0-5 step 3). For medical categories always end with "get medical help" |
| P2-2 | `lib/knowledge.ts:161-165` | `tags` and `disaster_types` are stored but never searched; fuzzy 0.15 turns `flood`→`food`, `po`→`power` | Index `tags` (boost 2). Prefix ≥5 chars, fuzzy ≥6 (from the `ai` branch) |
| P2-3 | `lib/knowledge.ts:146,167`; `App.tsx:29` | A pack JSON without `articles` makes `indexPacks` throw. `loadKnowledge` rejects with no `.catch` → search is empty and Library shows stale data | Validate each pack (`Array.isArray(articles)`, string id/title/text) and skip bad ones. Add `.catch` in App |
| P2-4 | `views/Prepare.tsx:78-79`, `views/Ask.tsx:36` | Importing an unknown `.gguf` succeeds, but it never appears in Ask's model list (wasted storage) | Reject unknown files with a clear message, or register a generic `ModelEntry` for imports |
| P2-5 | `views/Tools.tsx:40-50` | Stopping SOS before camera permission resolves → the late track is saved after cleanup; torch/camera stay on | After `getUserMedia` resolves, `if (stop) { track.stop(); return; }` |
| P2-6 | `views/Tools.tsx:104,111` | Water calculator shows "Add 0 drops" or negative drops for 0/negative liters | Show the result only when `liters > 0 && isFinite(liters)`; clamp input |
| P2-7 | `lib/downloads.ts:172-180` with `:199-200` | Pause then quick Resume → the abort handler sees `queued` + aborted signal → item ends **Paused** again | In the catch, set paused only if `cur.status === 'downloading'`. Leave `queued` alone when the abort reason is `'paused'` |
| P2-8 | `lib/downloads.ts:151-156` | Deleting an active download removes the folder while a writer is open → `removeEntry` can fail silently and leave orphaned bytes | Await the run's end (store its promise in `active`) before `removeFolder` |
| P2-9 | `backend/scripts/build_packs.py:283-334`, `build-packs.mjs:155,185-196` | Builders match today, but (a) Python never writes `sizes.json`, so Prepare sizes go stale if only `packs:py` runs; (b) Node sets `updated` to *today* when the header lacks it, so hashes change from day to day; (c) Node validates nothing (missing category silently becomes the pack name; no passage-length limit); (d) `--check` ignores `sizes.json` and `manifest.json` | Pick **one** canonical builder (Python, which validates) and have it also write `sizes.json`. Make Node a thin wrapper or remove it. Make `--check` compare all three outputs. Add the check to CI |
| P2-10 | `backend/evals/retrieval.py:1`, `evals/questions.json` | The eval uses its own BM25, explicitly "not MiniSearch parity", so it can't catch `po→power` or `flood→food`. There are no small-talk, off-topic or multi-turn questions (15 total) | Add a Node script that calls the real `indexPacks/search` and outputs JSON for the eval. Add about 10 negative/small-talk and 5 follow-up questions with "must not cite" expectations |
| P2-11 | `features/map/OfflineMapCanvas.tsx:62`, `.github/workflows/build-offline-maps.yml:44` | The country map stops at zoom 13: too coarse for walking directions and missing footpaths | For Phase A/B use radius extracts at z15 (`pmtiles extract --bbox … --maxzoom=15`) |
| P2-12 | `backend/hub/maps.py:14,153` | The hub only serves `luzon/visayas/mindanao/philippines`. A radius extract like `manila-5km.pmtiles` is ignored | Discover any `^[a-z0-9-]+\.pmtiles$` (keep the size limits) |
| P2-13 | `backend/hub/config.py:13`, `app.py:171`, `llama_proxy.py:327` | Hub listens on all interfaces with no auth. `/v1/chat/completions` accepts any body (`request.json()` ignores Content-Type), so any web page open on a LAN device can make the hub run long inferences; `max_tokens` is not capped | Require `Content-Type: application/json`, cap `max_tokens` (e.g. 512), add an optional `COLLAPSEAI_PIN` header check. Document running it on the hotspot only |
| P2-14 | `lib/llm.ts`, map page | The LLM (0.5–2 GB) and a map (Blob + MapLibre) share one tab → tab kill on Android | Fix P1-6, and keep model size small on phones (P1-7) |
| P2-15 | `lib/ask.ts:11` | "Always answer in English" even when a Tagalog user asks; may feel unfriendly | Keep for tiny models (quality), but say in the UI "Answers in English"; revisit with bigger models |

## P3 — cleanup and docs

| # | Where | Note |
|---|---|---|
| P3-1 | `public/sw.js:49-55` | One cache, never pruned: old hashed JS/CSS piles up after each deploy. Delete entries not in the current precache list on `activate` |
| P3-2 | `ui/system.ts:53` | Polls CacheStorage every 5 s while Prepare is open (battery). Use 30 s or event-driven updates |
| P3-3 | `frontend/public/manifest.json` | This is the **hub resource manifest**, but it sits next to the PWA `manifest.webmanifest` and is deployed publicly. Rename it to `resources.json` (update `config.py:15` and both builders) to avoid confusion |
| P3-4 | `views/Prepare.tsx` (text "~… planned", "Catalog estimates reflect planned pack sizes") | Out of date: sizes now come from the real `sizes.json` |
| P3-5 | `docs/SYSTEM_AUDIT.md:31-33` | Says maps and the LAN hub are not implemented; mark it superseded by this file |
| P3-6 | `README.md:55-63` | Phone instructions imply offline works over self-signed HTTPS (see P0-2) |
| P3-7 | `features/map/emergencyPois.ts:4` | Empty list, but layers and code are wired for it. Either fill it (Phase B: hospitals/schools from the map `pois` layer) or hide it |
| P3-8 | `features/map/mapRuntime.ts:25-28` | `unregisterDownloadedArchive` edits pmtiles' internal `tiles` map (no public API). OK, but pin the `pmtiles` version |
| P3-9 | `public/manifest.webmanifest` | Only an SVG icon. Chrome's Android install prompt may want 192/512 PNGs; check "Add to Home screen" on the Infinix |
| P3-10 | local branch `ai` | Its search changes target the old `loadKnowledge` (now split into `indexPacks`). Its Leaflet map (`MapView.tsx`, `tiles.ts`, `MapDownloads.tsx`) should be dropped when porting; take `bench.ts`, `Compass.tsx`, `Camera.tsx`, the stopwords/stemmer and the no-system-prompt variant |
| P3-11 | backend `tests/` folders | No `__init__.py`; `discover -t .` fails. Fine as documented, but add the files for IDE test runners |
| P3-12 | `npm ci` | esbuild postinstall pending approval. Harmless now; run `npm approve-scripts esbuild` if a tool needs it |

---

## Gaps vs NEXT_PHASE_PLAN.md

| Phase | On `main` today | Blockers to fix first |
|---|---|---|
| **A** Radius download | Not started. Only whole published regions (≤128 MB) or the country (≤256 MB, z13). No "area around me", no resume, no per-area coverage overlay | P1-6 (OPFS + resume), P0-3, P2-12 (hub naming). Needs a source of extracts: a hub endpoint that runs `pmtiles extract` on request, or pre-built city/radius files |
| **B** Routing + AI on map | Not started. No road graph, no POIs (`EMERGENCY_POIS` empty), no hazards, no `find_route` tool | Needs z15 data (P2-11). Roads can be read from tiles with `@mapbox/vector-tile` (already in MapLibre's dependency tree) |
| **B6** Trail recording | Not started | Needs `watchPosition` + wake lock (secure context → P0-1), an IndexedDB store, and GPX export |
| **C** Companion AI | Not started. No history (P0-5/P1-1), no profile, no situation awareness | P0-5, P1-1, P1-2 first; extend evals (P2-10) to prove the improvement |

---

## Recommended fix order (hackathon-sized)

| # | Task | Fixes | Rough hours |
|---|---|---|---|
| 1 | Pick the phone demo URL (deployed HTTPS, or Chrome "insecure origin as secure" flag). Add the `isSecureContext` banner and correct download error text | P0-1, P0-2 | 1 |
| 2 | Map check: remove the `crypto.subtle` gate; don't re-hash on list | P0-3 | 0.5 |
| 3 | Check the deployed `regions.json` and a full map download via Vercel; provision the catalog | P0-4 | 1 |
| 4 | GPU off by default on phones + self-test → CPU fallback | P0-6 | 1.5 |
| 5 | Small-talk gate, port `ai`-branch search fixes, index `tags`, relevance threshold, "not in packs" answer | P0-5, P2-1, P2-2 | 2.5 |
| 6 | Serialize model ops, lock controls, abort on unmount, keep chat in a store (+ last 2 turns in the prompt) | P1-1, P1-2 | 2 |
| 7 | Precache all build assets + ErrorBoundary + airplane-mode test on the Infinix | P1-3, P1-4 | 1.5 |
| 8 | Phone model default (Spark CPU/Ember), top-k 2, shorter passages, `n_ctx 2048`, thread test; port the benchmark screen | P1-7 | 1.5 |
| 9 | Download integrity (416, length, ETag) | P1-5 | 1 |
| 10 | Small fixes: SOS track, water calc, pause/resume race, pack validation, import message | P2-3..P2-8 | 1.5 |
| 11 | Map downloads via OPFS + resume (start of Phase A) | P1-6, P2-14 | 3 |
| 12 | Hub serves the PWA with COOP/COEP; relative model URLs when on the hub; JSON-only + `max_tokens` cap | P1-8, P2-13 | 2 |
| 13 | One canonical pack builder + full `--check` in CI; eval uses real MiniSearch + negative questions | P2-9, P2-10 | 2 |
| — | Then Phase A (radius UI, z15 extracts, hub discovery) → B (routing, POIs, trails) → C (profile, situation awareness) | | per plan |

Items 1–8 (~11.5 h) make the current demo reliable on the Infinix. Items 9–13 are robustness, plus the groundwork Phases A–C need.
