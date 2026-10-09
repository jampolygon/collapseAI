# CollapseAI — Development Roadmap & Design Direction

> Working roadmap for completing the parts that are not yet fully developed in the current CollapseAI foundation.

## Progress

Work is done one phase per branch, merged into `main` by pull request. Each finished phase ticks its
box in §14 below. Phase details live in the PR description.

| Phase | Status | Notes |
|---|---|---|
| 0 — Foundation | ✅ done | `npm ci` installs; typecheck/build/test green. Pack builder ported to zero-dep Node (`scripts/build-packs.mjs`), so `npm run packs` no longer needs Python. Pack/article schema extended with `tags`, `disaster_types`, `last_verified`, `updated`. Pack sizes now measured from the built JSON instead of hard-coded. 57 tests. |
| 1 — Foundation/design system | 🟡 partial | Shared light/dark theme tokens, responsive app shell, reusable icons/statuses/skeletons, keyboard/focus behavior, reduced-motion rules, and read-only cache/storage reporting are implemented. Versioned service-worker lifecycle, broader design-system coverage, and production/offline verification remain. Motion and React Bits libraries were not added. |
| 2 — UI overhaul | 🟡 in progress | Ask, Prepare, Library, and Tools have been substantially redesigned while retaining their existing handlers. The focused follow-up sets 44px button targets, 16px answer text, a labeled offline notice, and source/verification metadata where supplied. Browser checks at 320–430px found no horizontal overflow and kept the Ask composer visible. Broader accessibility review, tablet/desktop visual QA, and real model/offline scenarios remain unverified. |
| 3 — AI/RAG | ☐ | |
| 4 — Philippine emergency layer | ☐ | `tags`/`disaster_types` are in the schema and on the first-aid + disasters packs; remaining packs still need them |
| 5 — Offline tools | 🟡 partial | Offline map screen, Philippines-wide prepared-region catalog contract, local style assets, GPS, verified download flow, and IndexedDB storage are implemented. The Philippines archive/release catalog, verified emergency POIs, and real-device airplane-mode testing remain. |
| 6 — Reliability | ☐ | |
| 7 — Polish | ☐ | |

> Phase 0 note: the pack sizes in `catalog.ts` are now real (5–12 KB each, not the 2–40 MB the
> placeholders claimed). The larger packs only reach those sizes once Phase 4 writes the content.

---

## 1. Project Goal

Build a polished, offline-first AI emergency and survival assistant for situations where internet access may be unavailable or unreliable.

Core principle:

**Prepare online → download what you need → operate offline during an emergency.**

The existing project already provides the foundation for local AI, knowledge packs/RAG, downloads, PWA behavior, and Prepare/Survive flows. This document focuses on the unfinished, expandable, or production-hardening work.

---

# 2. Not-Fully-Developed Areas

## A. Philippine-first emergency knowledge

### Goals
- Expand disaster knowledge for Philippine conditions.
- Cover typhoons, floods, earthquakes, volcanic eruptions, landslides, storm surge, extreme heat, fires, and power/network outages.
- Add practical household and evacuation guidance.
- Add Filipino/Tagalog terminology and common local phrasing.
- Add source metadata and update dates to every knowledge pack.

### Future knowledge packs
- Typhoon
- Flood
- Earthquake
- Volcanic eruption
- Landslide
- Storm surge
- Fire
- Heat emergency
- Water safety
- Food safety
- First aid
- Missing-person/emergency procedures
- Evacuation preparation
- Post-disaster cleanup and recovery

### Quality requirement
Medical and emergency content must be sourced from authoritative organizations and clearly distinguish general information from professional/emergency care.

---

## B. Better RAG / knowledge retrieval

Improve the existing retrieval pipeline with:

- Better chunking
- Metadata filtering
- Category and disaster-type filters
- Keyword + semantic retrieval
- Filipino/English query normalization
- Source ranking
- Duplicate removal
- Confidence/relevance indicators
- Better citation presentation
- Offline indexing optimized for low-end devices

### Desired flow

User question
→ classify intent/disaster
→ retrieve relevant local knowledge
→ rank evidence
→ generate answer
→ show supporting sources

The AI should prefer retrieved evidence over unsupported model knowledge.

---

## C. Local AI improvements

### Model management
- Device capability detection
- Recommended model profiles
- Low / balanced / high quality options
- Model size and storage estimates
- CPU/WebGPU fallback
- Download resume/retry
- Model verification
- Clear storage management

### AI behavior
- Short emergency-first answers
- Step-by-step instructions
- "Do this now" priority section
- Warnings for dangerous actions
- Ask a clarifying question only when necessary
- Cite retrieved knowledge
- Avoid pretending to know live conditions
- Clearly state when professional emergency help is required

---

## D. Emergency tools

Expand the existing tools area into a real emergency toolkit.

### Priority tools
- SOS screen
- Emergency contacts
- Philippine emergency numbers
- Compass
- Flashlight integration where supported
- Location display
- Offline map
- Evacuation/shelter lookup
- Basic first-aid reference
- Emergency checklist
- Water/food safety guides

### Later
- Offline routing
- Safe-location planning
- Hazard overlays
- Cached barangay/LGU information
- Peer-to-peer/offline communication research

---

## E. Offline maps and navigation

Research and implement an offline-first map system using open data where licensing permits.

**Implementation status:** the Map navigation, local MapLibre/PMTiles renderer, region selection,
GPS permission flow, archive verification and IndexedDB storage are in place. The app accesses
`regions.json` and the Philippines PMTiles file on the `offline-maps-v1` GitHub Release through a
same-origin proxy because browser CORS blocks direct GitHub Release asset requests;
that release and its real archive have not been published, so the UI must continue to report that
coverage as unavailable until the catalog contains verified metadata. Emergency POIs remain empty
until sourced and verified. Offline routing, arbitrary-area downloads, live hazards, and saved
locations are not implemented.

Potential capabilities:
- Download map regions before an emergency
- Current location
- Saved safe locations
- Evacuation centers
- Hospitals
- Fire stations
- Police stations
- Offline route calculation

Do not depend on a live map API for core emergency functionality.

---

## F. Emergency location data

Create a versioned local dataset containing, where legally and operationally appropriate:

- Evacuation centers
- Hospitals
- Fire stations
- Police stations
- Disaster response offices
- Government emergency contacts
- Important hotlines

Each record should have:
- Name
- Type
- Coordinates
- Address
- Municipality/city
- Source
- Last verified date

---

## G. Offline reliability

Treat offline behavior as a primary feature, not an afterthought.

Test:
- First launch with no network
- App reload while offline
- Model unavailable
- Partial model download
- Interrupted knowledge download
- Low storage
- Low memory
- Older Android devices
- iOS PWA limitations
- Browser cache eviction
- Corrupted local data

Provide clear recovery states instead of blank screens or silent failures.

---

# 3. UI / UX Direction

The interface should feel like a **calm emergency instrument**, not a generic AI chatbot.

Design goals:
- Clear hierarchy
- High readability
- Fast scanning
- Strong information grouping
- Minimal cognitive load
- Touch-friendly controls
- Excellent mobile behavior
- Distinct emergency states
- Accessible contrast
- Respectful motion

Avoid:
- Generic AI-dashboard appearance
- Excessive glassmorphism
- Decorative animation that competes with emergency information
- Huge hero sections inside emergency workflows
- Excessive rounded cards everywhere
- Animation during critical instructions

---

# 4. Design Skills / Agent Guidance

Use design-agent skills to prevent generic AI-generated UI.

## Taste Skill

Use the frontend design Taste Skill as a design-quality constraint.

Recommended:
- `design-taste-frontend`
- `redesign-existing-projects`
- `output-skill`
- `minimalist-skill` where appropriate

The Taste Skill should guide:
- Layout
- Typography
- Spacing
- Visual hierarchy
- Motion restraint
- Component composition
- Anti-generic/anti-slop design decisions

For this project, favor a restrained, utilitarian interpretation rather than an experimental marketing-site aesthetic.

Suggested design dials:
- DESIGN_VARIANCE: 3–5
- MOTION_INTENSITY: 2–4 for emergency screens, 4–6 for non-critical navigation
- VISUAL_DENSITY: 4–6

---

# 5. Impeccable / Design-Quality Practices

Use Impeccable-style design review principles during UI implementation and review.

Apply them to:
- Typography hierarchy
- Spacing consistency
- Alignment
- Color/contrast
- Component consistency
- Responsive behavior
- Accessibility
- Content clarity
- Interaction states
- Empty/loading/error states

Every major screen should receive a visual audit before being considered finished.

Design should prioritize **clarity under stress** over visual novelty.

---

# 6. React Bits

Use React Bits as a component source for polished React interactions and visual details.

Use it selectively for:
- Animated text where appropriate
- Loading states
- Background treatments
- Navigation transitions
- Interactive buttons
- Status indicators
- Subtle visual feedback
- Empty states
- Onboarding/Prepare mode

React Bits should enhance the interface rather than become the visual identity of the whole application.

Prefer simple, performant components on emergency-critical screens.

---

# 7. Motion / Framer Motion / Motion.dev

Use **Motion for React (`motion/react`)** for application-level visual flow.

Motion should communicate state and hierarchy, not simply decorate the UI.

### AI conversation flow

Example:

User question
→ input acknowledges submission
→ retrieval/search state
→ evidence appears
→ AI response streams/appears
→ source chips/cards settle into place
→ follow-up actions become available

### Useful Motion patterns
- `AnimatePresence` for state transitions
- `layout` for expanding/collapsing content
- `layoutId` for shared navigation indicators
- spring transitions for physical UI controls
- subtle enter/exit animations
- staggered evidence/source appearance
- reduced-motion fallback

### Emergency rule

Critical instructions should remain immediately readable.

Do not delay emergency information behind long animations.

---

# 8. AI Visual Language

The AI should feel like a **reliable field assistant**, not a fictional robot.

Suggested states:

### Thinking / retrieving
Show:
- "Searching your offline emergency guide…"
- retrieval/source activity
- restrained progress indicator

### Answer
Structure:
1. Immediate action
2. Step-by-step instructions
3. Important warnings
4. When to seek professional help
5. Sources

### Uncertainty
Use explicit language:
- "I don't have enough information to answer this safely."
- "Your downloaded guide does not contain information about this."
- "This requires local emergency services/professional help."

Never fabricate an offline source or live emergency condition.

---

# 9. Prepare Mode Improvements

Prepare Mode should make the user confident that their device is ready.

Add:
- Storage requirement
- Available storage
- Model recommendation
- Knowledge-pack checklist
- Map-pack checklist
- Download progress
- Verification status
- Offline readiness test
- "Ready for offline use" screen

Example readiness state:

**OFFLINE READY**
- AI model ✓
- First aid ✓
- Disaster guides ✓
- Emergency contacts ✓
- Maps ✓
- Storage verified ✓

---

# 10. Survive Mode Improvements

Survive Mode should prioritize immediate access.

Primary navigation:
- Ask AI
- Emergency
- First Aid
- Map
- Tools
- Library

Potential home layout:

**What do you need help with?**

[ Ask the offline AI ]

Quick actions:
- 🩹 First Aid
- 🌊 Flood
- 🌋 Earthquake
- 🌀 Typhoon
- 🗺️ Map
- 🆘 Emergency

---

# 11. Accessibility

Required:
- Keyboard navigation
- Screen-reader labels
- Reduced-motion support
- Sufficient contrast
- Large touch targets
- Clear focus states
- No information conveyed by color alone
- Readable typography
- Offline error states that are understandable without icons

---

# 12. Performance

The application must remain usable on low-end devices.

Priorities:
1. Fast app shell
2. Minimal JavaScript on initial load
3. Lazy-load heavy AI/map functionality
4. Avoid unnecessary React re-renders
5. Keep animations GPU-friendly
6. Avoid excessive DOM effects
7. Monitor memory usage around local models
8. Provide lightweight fallback UI

---

# 13. Security / Safety

- Never expose private API keys in the client.
- Validate downloaded model/knowledge assets.
- Treat downloaded content as untrusted until verified.
- Avoid executing arbitrary downloaded code.
- Keep personal location data local unless the user explicitly chooses otherwise.
- Make emergency limitations obvious.
- Do not represent AI output as professional medical diagnosis.

---

# 14. Development Priority

## Phase 1 — Foundation
- [x] Audit existing CollapseAI code
- [x] Preserve working offline AI/RAG
- [x] Establish the initial shared frontend foundation (theme tokens, shell, reusable UI/accessibility patterns)
- [ ] Install design-agent skills
- [ ] Add Motion for React
- [ ] Add selected React Bits components
- [ ] Version and verify the service-worker lifecycle
- [ ] Complete production/offline verification

## Phase 2 — UI overhaul
- [x] Prepare Mode redesign (initial pass)
- [x] Survive Mode redesign (initial pass)
- [x] AI conversation redesign (initial pass)
- [x] Library redesign (initial pass)
- [x] Tools redesign (initial pass)
- [ ] Responsive/mobile pass
- [ ] Accessibility pass
- [ ] Complete tablet/desktop and device-based QA
- [ ] Verify long answers, loaded-model, offline, and error states in browser/device

## Phase 3 — AI/RAG
- [ ] Improve retrieval
- [ ] Better source citations
- [ ] Better multilingual retrieval
- [ ] Emergency response prompting
- [ ] Model management improvements

## Phase 4 — Philippine emergency layer
- [ ] Philippine disaster knowledge
- [ ] Emergency numbers
- [ ] Evacuation centers
- [ ] Hospitals / fire / police
- [ ] LGU/barangay datasets
- [ ] Source/update metadata

## Phase 5 — Offline tools
- [x] Offline map browsing and local map archive flow (Philippines release data still unpublished)
- [x] Device location and manual region selection
- [ ] Publish and validate the Philippines PMTiles archive and `regions.json` catalog
- [ ] Source and independently verify emergency-location POIs
- [ ] Validate offline rendering on target mobile devices in airplane mode
- [ ] Offline routing
- [ ] Compass
- [ ] Emergency toolkit
- [ ] Preparedness checklists

## Phase 6 — Reliability
- [ ] Offline-only testing
- [ ] Low-memory testing
- [ ] Interrupted downloads
- [ ] Storage failure handling
- [ ] Mobile browser/PWA testing

## Phase 7 — Polish
- [ ] Motion audit
- [ ] Taste/design audit
- [ ] Accessibility audit
- [ ] Performance audit
- [ ] Error-state audit
- [ ] Final emergency UX review

---

# 15. Definition of Done

CollapseAI should not be considered complete until a user can:

1. Install/open the app.
2. Prepare the device while online.
3. Download an appropriate local AI model.
4. Download emergency knowledge.
5. Download required offline maps/data.
6. Verify that the device is offline-ready.
7. Disable the internet.
8. Ask an emergency question.
9. Receive a useful evidence-grounded answer.
10. See the sources used.
11. Access emergency tools without internet.
12. Find relevant local emergency information.
13. Navigate available offline map data.
14. Understand when the AI cannot safely answer.
15. Use the application comfortably on a mobile device.

---

# 16. Design Principle

**Make it beautiful enough to trust, simple enough to use under stress, and reliable enough to work when everything else is offline.**
