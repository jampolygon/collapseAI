# CollapseAI — Hackathon Plan (web only)

> "CollapseOS, but modern." An offline survival assistant **in the browser**: a local AI that answers
> "how do I…" questions from an offline library (first aid, water, shelter, medicine, PH disasters).
> Open once while online, download your kit, then it works with **no internet**.

**Hackathon:** AppBuildersPH 2026 — Local AI · **24 hours** · **3 people, all web**
**Challenge:** *"Build an AI product that remains genuinely useful when the cloud disappears."*
**Base test device:** Infinix HOT 60 Pro in Chrome (Helio G200, 8 GB RAM, weak GPU → CPU-bound)

---

## 1. Priorities

### P0: the demo doesn't exist without these (must work by hour 8)
| # | Feature | Done when… |
|---|---|---|
| 1 | **Local LLM in the browser** (wllama) | A model answers a question on the Infinix in Chrome; tokens/sec recorded |
| 2 | **Offline knowledge + RAG** | Question → top 2–3 passages from the pack → answer **with sources shown** |
| 3 | **Essentials pack** (written by us, bundled) | ~30 short articles: bleeding, burns, CPR, fractures, dehydration, water purification, fire, shelter, typhoon/flood/earthquake |
| 4 | **Setup wizard + download manager** | Detect device → recommend model in plain language → one "Download" button → progress, pause/resume, survives refresh |
| 5 | **Works offline** | Service worker + OPFS. **Airplane mode → reload → still answers** |
| 6 | **Deployed on HTTPS** | Public URL with COOP/COEP headers (multi-threaded AI); opens on the Infinix |

### P1: what makes it win (by hour 18)
| # | Feature | Why |
|---|---|---|
| 7 | **Library browser** | Read/search articles without AI; works even on phones too weak for a model |
| 8 | **Taglish keywords** (sugat, lagnat, baha, lindol, bagyo…) | Local relevance; cheap (synonym map before search) |
| 9 | **Survival tools**: SOS flashlight/Morse, water purification calculator, go-bag checklist | Useful with no AI at all; great on stage |
| 10 | **Compass** (DeviceOrientation + sun direction) | Phone sensor, works offline in Chrome |
| 11 | **Field Manual pack** (~500 Wikipedia articles via Python builder) | Shows "Prepared" tier is real |
| 12 | **Speed test in wizard** | Picks the model from measured speed, not RAM (Infinix reports 8 GB like a laptop) |

### P2: only if ahead of schedule
13. **Hub mode** (Python FastAPI on a laptop: serves packs/models over LAN, runs a bigger model)
14. **Photo understanding** (Qwen3.5 vision add-on: plant / wound / pill)
15. **Offline map** (PMTiles, GPS, saved waypoints) — app flow and local storage are implemented; Metro Manila release data and verified POIs remain unpublished.
16. **Voice input**, night (red) mode, Full Archive pack

### Not doing
Android app / React Native, Capacitor, Python on the phone, user accounts, any cloud AI.

---

## 2. Stack
| Layer | Choice |
|---|---|
| App | Vite + React + TypeScript, PWA (service worker + manifest) |
| On-device LLM | `@wllama/wllama` 3.x (llama.cpp → WebAssembly; WebGPU if available) |
| Search / RAG | MiniSearch (BM25) over passages ~500 chars |
| Storage | OPFS for models/packs + `navigator.storage.persist()`; localStorage for settings/checklists |
| Hosting | Cloudflare Pages / Netlify / Vercel, with headers `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` |
| Python | Pack builder (P1), Hub server (P2). Not needed for the core demo |

**Browser limits to remember:** Chrome/Edge only (Safari weak). Max **2 GB per model file**. User must open the site once online. Clearing browser data deletes models.

## 3. Models (auto-recommended)
| Name | Model | Size | For |
|---|---|---|---|
| Ember | LFM2.5 350M | 229 MB | Very weak / old phones |
| **Spark** | Qwen3.5 0.8B | 533 MB | Budget phones. **Candidate default for Infinix** |
| **Torch** | LFM2.5 1.2B | 731 MB | Mid-range. **Candidate default for Infinix** |
| Lantern | Qwen3.5 2B | 1.3 GB | Laptops / strong phones |
| Beacon | Llama 3.2 3B | 2.0 GB | Laptops with GPU |

**Findings so far (tested on a desktop PC, AMD integrated GPU, Chrome):**
- **Ember (350M): too weak.** Stops after one line, can't follow the prompt. Keep only as a last resort.
- **Spark (Qwen3.5 0.8B): good.** Correct, grounded step-by-step answer for the bleeding question. Read 543 prompt tokens at ~57/s, wrote ~4 tokens/s with the GPU on.
- **GPU vs CPU:** on this PC, CPU-only took ~80 s just to read the prompt, so the GPU is much faster here. **Still unknown on the Infinix.** There is a "Use GPU" switch in Ask AI to compare.
- Retrieval works for Taglish ("May malalim na sugat…" → Severe bleeding, Shock).

Hour 1–3 spike picks the Infinix default. Fallbacks if Qwen3.5/LFM2.5 misbehave in wllama: Qwen3 0.6B / 1.7B, Gemma 3 1B.
**Speed rule for weak CPUs:** keep the prompt small (system prompt + ≤ 500 tokens of passages). Reading the prompt, not writing the answer, is the slow part.

## 4. Knowledge kits
| Kit | Contents | Size | Priority |
|---|---|---|---|
| Essentials | Our own written pack (bundled) | ~0.2 MB | **P0** |
| Prepared | + Field Manual (Wikipedia, CC BY-SA) | ~10–20 MB | P1 |
| Full Survival | + Full Archive (Wikipedia / Kiwix) | 150 MB+ | P2 |

Pack format (shared contract, define in hour 0):
```json
{ "id": "essentials", "name": "Daily Essentials", "version": 1, "license": "...",
  "articles": [{ "id": "bleeding", "title": "Severe bleeding", "category": "First aid",
                 "text": "...", "source": "..." }] }
```

## 5. Team split
| Who | Owns | P0 deliverables | Then |
|---|---|---|---|
| **A: AI** | Engine + RAG | wllama load/stream, search, prompt w/ citations, chat screen | Speed test, Taglish keywords |
| **B: App** | Shell + downloads + offline | App shell/nav, wizard, download manager (OPFS, resume), service worker, deploy | Library browser, compass, tools |
| **C: Content** | Packs + Python | Essentials pack (30 articles), safety wording | Python pack builder → Field Manual, tools, pitch deck, Hub (P2) |

Hour 0–1 contracts (agree before splitting up): **pack JSON format** (above), **engine interface** `loadModel(file)`, `chat(messages, onToken, signal)`, **search** `search(query, k) → passages`.

## 6. 24-hour timeline
| Hours | Milestone |
|---|---|
| 0–1 | Repo + Vite shell pushed, contracts agreed, deploy pipeline live |
| 1–3 | **Spike:** model answers on the Infinix (record speed) · essentials pack 50% |
| 3–8 | **P0 complete:** wizard → download → ask → answer with sources, **in airplane mode on the Infinix** |
| 8–12 | P1: library, tools, compass, Taglish; Field Manual pack built |
| 12–14 | Sleep in shifts / buffer |
| 14–18 | P1 finish + P2 if ahead (hub, vision, map) |
| 18 | **Feature freeze** |
| 18–22 | Bugs, polish, pre-download kits on demo devices, **record backup video** |
| 22–24 | Slides, README, submit URL |

**Cut rule:** P0 not working by hour 8 → everyone on P0, drop all P2.

## 7. Demo script (2–3 min)
1. "Typhoon hits, signal is gone." **Airplane mode on**, reload the site: it still opens.
2. Ask: *"May malalim na sugat ang kapatid ko, paano patigilin ang dugo?"* → steps + sources.
3. Ask about drinking water → answer + water purification calculator.
4. SOS flashlight + compass.
5. (If built) second phone joins the laptop Hub and gets the bigger model.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Too slow on Infinix | Smaller model, shorter context, show "thinking" progress; Library works without AI |
| Venue Wi-Fi too slow for downloads | Pre-download on all demo devices before hour 18 |
| Medical safety | Answer only from sources, show sources, disclaimer on health answers |
| Multi-thread headers break something | Test deploy in hour 0–1; single-thread still works, just slower |
| Licensing | Our own text + public domain + Wikipedia (CC BY-SA, attributed) |

## 9. Open questions
- Final name? (CollapseAI / Bayanihan / Ligtas / …)
- Who is A, B, C?
- Hosting account: whose?
