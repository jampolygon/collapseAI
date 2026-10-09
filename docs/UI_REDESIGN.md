# Frontend redesign

The redesign builds on the existing screens and their handlers. The original
Prepare/Survive selection is still used internally, including Prepare as the
first screen on an empty device. Sidebar navigation exposes Ask, Prepare,
Library, and Tools without adding URL routes.

## Visual structure

- `frontend/src/styles.css`: shared light/dark tokens, typography, responsive
  shell, screen layouts, focus states, and reduced-motion rules.
- `frontend/src/components/`: consistent outline SVG icons, reusable text/dot
  statuses, and a small safe text renderer for headings, paragraphs, lists,
  warning notes, retrieved references, floating sidebar labels, and loading skeletons.
  The OFL-licensed Inter variable font is embedded in the stylesheet for offline use.
- `frontend/src/ui/theme.ts` and the startup script in `frontend/index.html`:
  light by default, a saved light/dark choice, and theme application before the
  first paint. Legacy system-theme preferences fall back to light.
- `frontend/src/ui/system.ts`: read-only cache and storage observation. It checks
  the existing app cache for the page, current script/styles, icon, manifest,
  and WASM engine. It never writes cache entries, registers a worker, or changes
  download metadata.

The sidebar can collapse on desktop and becomes a drawer on mobile. The drawer
supports Escape, focus trapping, background inertness, and return focus. Ask
uses an anchored, growing textarea: Enter sends, Shift+Enter adds a line, and
IME composition does not send accidentally. Existing generation cancellation,
model controls, GPU selection, sources, and timing output remain available.

Prepare shows downloaded model files separately from loaded AI, selected knowledge
packs, shell/engine caching, and estimated browser storage usage. Download rows
say "Downloaded" rather than claiming overall offline readiness. Library adds
display filters after the existing search results; the retrieval algorithm is
unchanged. Tools keep the original formulas, SOS timing, and saved checklist keys.

## Preserved implementation

No changes were made to `frontend/src/lib/`, `frontend/src/hooks.ts`,
`frontend/src/main.tsx`, or `frontend/public/sw.js`. Inference, model downloads,
OPFS storage, retrieval, and service-worker behavior retain their existing
implementation and audit limitations. Icon and manifest changes are visual only.

## Validation

Run from the repository root:

```sh
npm run typecheck
npm run build
npm run test:ui
```

The nine UI checks compile the screens and render them with React in Node,
without launching a browser or running inference. They cover startup theme
selection (including blocked localStorage), safe formatting of generated text,
downloaded versus loaded model state, cache/download distinctions, error/actions
and real progress values, library controls, preserved checklist selections,
the existing water result, text contrast in both themes, the two appearance
choices, and loading placeholders that do not invent download progress.

Browser preview access was declined, so visual verification, mobile interactions,
and service-worker-controlled offline reload were not completed in this session.
The code-level checks do not substitute for those checks on the actual device.
