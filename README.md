# CollapseAI

**Your survival guide that still works when the internet doesn't.**

CollapseAI is an AI assistant that lives on your phone or computer. Ask it things like *"how do I stop heavy bleeding?"* or *"how do I make water safe to drink?"* and it answers step by step from a built-in library of first aid, survival and disaster guides, **with no internet**.

> AppBuildersPH Hackathon 2026 · Local AI

---

## 📱 Install on your phone (Android)

1. Open the CollapseAI link in **Chrome**.
2. Tap the **⋮ menu** (top right) → **Add to Home screen** (or **Install app**).
3. Open **CollapseAI** from your home screen.
4. Go to **Prepare** and tap the big **Download** button. Use Wi-Fi if you can.
5. Wait until everything says **✓ Ready offline**.

**Test it:** turn on **Airplane mode**, open CollapseAI, go to **Survive** and ask a question. 🎉

> iPhone: open the link in Safari → **Share** → **Add to Home Screen**. The library and tools work; the AI may be slow.

## 💻 Install on your computer

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

## 👩‍💻 For the team: run it from the code

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
| `npm run packs` | Rebuild knowledge packs from `backend/content/*.md` (needs Python) |

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
frontend/src/views/             screens: Prepare, Survive (Ask, Library, Tools)
backend/content/*.md           the knowledge itself  ← write articles here
backend/scripts/build_packs.py turns backend/content/*.md into frontend/public/packs/*.json
PLAN.md                hackathon plan and priorities
```

**Adding knowledge:** write in `backend/content/*.md` (copy the style of the existing articles), then run `npm run packs`.

### Putting it online

Any static hosting works (Vercel, Netlify, Cloudflare Pages). Build command `npm run build`, output folder `frontend/dist`. The needed settings are already in `vercel.json` and `frontend/public/_headers`.


### Repository layout

```text
frontend/             React + TypeScript PWA and browser AI
  src/                screens, search, downloads, on-device inference
  public/             service worker, manifest, icons, generated packs
  package.json        frontend dependencies and Vite commands
backend/              Python content tooling (no runtime API server yet)
  content/            editable knowledge pack Markdown
  scripts/            knowledge pack builder
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
