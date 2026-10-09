# CollapseAI initial system audit

Audited on 9 October 2026. Scope: application code, content pipeline, offline
storage, service worker, package setup, and deployment configuration. This is a
code and local build audit, not a clinical review or a target-phone benchmark.

## System context

CollapseAI is an offline survival assistant delivered as a React/TypeScript PWA.
Vite builds a static website. There is no running backend API, database, login,
or cloud inference service. Python converts team-authored Markdown into packs
before deployment. The LAN hub and larger archive builders remain planned work.

The implemented flow is:

1. Prepare checks browser/device capabilities and recommends a catalog model.
2. Users select a kit; topic JSON files are downloaded before the larger GGUF model.
3. The download manager writes 16 MiB parts to OPFS and metadata to localStorage.
   Resume uses HTTP Range requests. A wake lock is attempted during downloads.
4. Downloaded articles are split at paragraph boundaries and indexed with MiniSearch.
   Tagalog/Taglish keywords are expanded to English search terms.
5. Ask retrieves the top three passages, builds a short prompt, and streams an answer
   through wllama in the browser. Retrieved sources and timing statistics are shown.
   Without a model, it displays matching passages directly.
6. The library and SOS/water/go-bag tools operate in the browser. The service worker
   caches the app shell and engine; downloaded packs/models use OPFS separately.

There are six source packs with **36 articles**: first aid (10), survival (6),
disasters (5), medicine (6), food (5), and engineering (4).
There are five catalog model options. The catalog's pack size estimates describe
planned larger packs; the checked-in JSON files total only about 33.5 KB.
Compass, maps, measured device speed recommendations, Wikipedia/Kiwix builders,
vision, and a LAN hub are not implemented in this checkout.

## Findings

These are existing behavior risks found during inspection. The folder migration
does not change application behavior or resolve the findings below.

| Priority | Finding and evidence | Impact / recommended follow-up |
|---|---|---|
| P1 | **A Range error can mark an incomplete model as ready.** `frontend/src/lib/downloads.ts:243` treats every HTTP 416 response as completion, without comparing the server's actual length with the stored offset. Successful stream completion at line 304 also has no checksum or expected-length assertion. `cleanup()` only checks that a Blob exists. | A stale or truncated model can appear downloaded and later fail to load. Validate Content-Range and expected file length, retain an ETag or immutable revision across resumes, and verify downloaded assets before reporting readiness. Test a changed server file and mismatched offsets. |
| P1 | **Offline readiness is not verified.** `frontend/src/main.tsx:25` discards `cache.addAll()` failures. Individual download rows in `frontend/src/views/Prepare.tsx:238` say "Ready offline" independently of app-shell/engine cache state. | A user can finish downloading a model and packs while shell or WASM caching has failed, then lose app access after an offline reload. Expose caching state and errors, verify required cached URLs, and run an airplane-mode reload test before the demo. |
| P2 | **Imported unknown models cannot be used.** `frontend/src/views/Prepare.tsx:72` stores an unfamiliar GGUF under its filename, but `frontend/src/views/Ask.tsx:33` lists only model IDs in `MODELS`. | Import appears successful and consumes storage, but the model is unavailable to Start AI. Either register an imported model entry with its configuration or reject unsupported files with an explanation. |
| P2 | **Model operations can overlap and failed loads can leak resources.** `frontend/src/views/Ask.tsx:128` and `:138` disable selection/loading only during a load, while the GPU toggle can unload during inference. There is no abort-on-unmount effect when leaving Ask. `frontend/src/lib/llm.ts:44` assigns the new engine to global state only after `loadModel()` succeeds. | Changing model/GPU or leaving the screen during generation can leave an active request running; failed initialization can leave the temporary engine alive because `unload()` cannot see it. Serialize engine operations, cancel on unmount, disable conflicting controls, and exit temporary engines on load failure. |
| P2 | **Retrieved references are suggestions, not verified citations.** `frontend/src/lib/ask.ts:25` always retrieves three hits; there is no relevance threshold or deterministic refusal when references are absent. `frontend/src/lib/knowledge.ts:97` splits only between paragraphs, so a single long paragraph can exceed the intended context budget. | Irrelevant passages can be presented as sources and small models can exceed prompt budgets. Add an explicit token budget, evaluate retrieval with relevant/irrelevant English and Taglish questions, and define a predictable no-reference fallback. The displayed source list does not prove each generated claim is supported. |
| P2 | **Pack parsing trusts data shape.** `frontend/src/lib/knowledge.ts:119` casts JSON to `Pack`; subsequent indexing assumes an articles array and valid text/IDs. The Python builder does not check duplicate article slugs or required article fields. | Syntactically valid but malformed packs can reject index loading; `App.tsx` does not handle that rejection. Validate schemas and unique IDs before publishing/loading and keep a bad pack from disabling good ones. |
| P2 | **SOS can retain a late camera track.** `frontend/src/views/Tools.tsx:39` awaits camera permission before saving the track; cleanup may run first if the user stops SOS or leaves the screen. | If permission resolves later with torch support, the track can be retained after cleanup. Check cancellation immediately after permission resolves and stop all tracks for cancelled requests. |
| P2 | **Water calculator accepts invalid amounts.** `frontend/src/views/Tools.tsx:109` stores raw numeric input, while `min` on an input does not prevent the computed result from rendering. The result appears for zero or negative values. | Validate a finite positive quantity before displaying any calculated instructions. Tool and content sources need a separate specialist review; source labels generally name organizations rather than dated, traceable references. |

The app renders question/answer strings through React text nodes; there is no
`dangerouslySetInnerHTML` rendering in the reviewed UI. There are no account
credentials or server authentication flows in the implementation. These facts
do not constitute a full dependency/security audit.

## Folder migration

- `frontend/`: existing `src/`, `public/`, entry HTML, Vite/TypeScript config,
  and the frontend dependency manifest. Browser AI and retrieval stay here because
  they run on the user's device.
- `backend/`: existing `content/` and Python `scripts/`. The builder now resolves
  the repository root from its own file and writes to `frontend/public/packs/`.
- Root: npm workspace manifest and shared lockfile, README, hackathon plan,
  deployment config, and this audit. All original root npm commands remain available;
  command-line options are forwarded to the frontend workspace.
- Vercel builds from the root with output `frontend/dist`; static `_headers` stays
  in the frontend public folder. Local preview launch configuration uses the root
  npm command. Runtime URLs, service-worker scope, localStorage keys, and OPFS
  folder names are unchanged when hosted at the same origin and base path.

## Validation

- `npm ci`: succeeds with the shared workspace lockfile; dependency version ranges
  and locked package versions are preserved.
- `npm run typecheck`: passes.
- `npm run build`: passes; outputs HTML, JS, CSS, service worker, manifest, packs,
  and the wllama WASM asset into `frontend/dist/`.
- `npm run packs` from the repository root and `python scripts/build_packs.py`
  from `backend/`: both build all six packs / 36 articles.
- Migration comparison against Git HEAD: 34 moved application/content/config files
  retain their original text (ignoring Windows line endings). The builder's routing
  change was reviewed separately. All 71 existing locked package versions and
  integrity values are preserved.
- Generated packs pass required-field and unique article ID checks.
- Local production preview: all 12 checked assets return success, including compiled
  JS/CSS, the service worker, manifest, icon, six packs, and the WASM engine.
  COOP/COEP response headers are correct. Root CLI option forwarding was verified
  by starting preview on explicitly selected host/port 127.0.0.1:4173.

Not yet tested: a real model load/download, inference speed on the Infinix,
camera torch hardware, actual service-worker-controlled offline reload, or a
deployment on Vercel. Dependencies and model URLs were not audited against
upstream advisories or availability.

Recommended demo order: resolve download/readiness findings, then pre-download
the selected model and packs on the actual demo device, run offline reload and
both English/Taglish question checks, and record timing plus a backup video.
