// Everything the user can download, described in plain language.
// Model files must stay under 2 GB (WebAssembly ArrayBuffer limit).

import SIZES from '../../public/packs/sizes.json';

/** Real byte size of each built pack, written by `npm run packs` (scripts/build-packs.mjs). */
const PACK_BYTES = SIZES as Record<string, number>;

export interface ModelEntry {
  id: string;
  name: string; // friendly name shown to non-technical users
  family: string; // real model name, shown in "details"
  url: string;
  sizeMB: number;
  blurb: string;
  speed: 'fastest' | 'fast' | 'balanced' | 'smart' | 'smartest';
  /** passed to wllama.loadModel */
  loadParams?: Record<string, unknown>;
  /** passed to every chat request (e.g. turn off "thinking" for Qwen3.5) */
  chatKwargs?: Record<string, unknown>;
}

const HF = 'https://huggingface.co';
const noThink = { enable_thinking: false };

export const MODELS: ModelEntry[] = [
  {
    id: 'lfm25-350m',
    name: 'Ember',
    family: 'LiquidAI LFM2.5 350M · Q4_K_M',
    url: `${HF}/LiquidAI/LFM2.5-350M-GGUF/resolve/main/LFM2.5-350M-Q4_K_M.gguf`,
    sizeMB: 229,
    speed: 'fastest',
    blurb: 'Tiny and very fast, but answers are basic. Only for very old phones; the Library is often more useful.',
  },
  {
    id: 'qwen35-0.8b',
    name: 'Spark',
    family: 'Qwen3.5 0.8B · Q4_K_M',
    url: `${HF}/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf`,
    sizeMB: 533,
    speed: 'fast',
    blurb: 'Small but smart. Good for most budget phones.',
    loadParams: { reasoning: false },
    chatKwargs: noThink,
  },
  {
    id: 'lfm25-1.2b',
    name: 'Torch',
    family: 'LiquidAI LFM2.5 1.2B Instruct · Q4_K_M',
    url: `${HF}/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf`,
    sizeMB: 731,
    speed: 'balanced',
    blurb: 'Clear step-by-step answers and still quick on phones. Best for mid-range phones.',
  },
  {
    id: 'qwen35-2b',
    name: 'Lantern',
    family: 'Qwen3.5 2B · Q4_K_M',
    url: `${HF}/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf`,
    sizeMB: 1281,
    speed: 'smart',
    blurb: 'Smarter, better reasoning. For laptops and strong phones.',
    loadParams: { reasoning: false },
    chatKwargs: noThink,
  },
  {
    id: 'llama32-3b',
    name: 'Beacon',
    family: 'Meta Llama 3.2 3B Instruct · Q4_K_M',
    url: `${HF}/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
    sizeMB: 2019,
    speed: 'smartest',
    blurb: 'Biggest model that runs in a browser. Laptops with a good GPU.',
  },
];

// ---- Knowledge: small topic packs, so people only download what they need ----

export interface PackEntry {
  id: string;
  name: string;
  icon: string;
  url: string; // relative to the app (later: CDN / hub)
  sizeMB: number; // measured from the built JSON, so totals and progress bars are honest
  blurb: string;
}

/**
 * Pack sizes come from public/packs/sizes.json, which `npm run packs` regenerates from the
 * real bytes of each built pack. The literal below is only a fallback for a pack that has not
 * been built yet (so Prepare still renders before the first build).
 */
const packSizeMB = (id: string, fallback: number) =>
  typeof PACK_BYTES[id] === 'number' && PACK_BYTES[id] > 0 ? PACK_BYTES[id] / 1e6 : fallback;

export const PACKS: PackEntry[] = [
  { id: 'first-aid', name: 'First Aid', icon: '🩹', url: 'packs/first-aid.json', sizeMB: packSizeMB('first-aid', 4), blurb: 'Bleeding, burns, CPR, choking, fractures, shock, heat stroke.' },
  { id: 'survival', name: 'Survival Basics', icon: '🔥', url: 'packs/survival.json', sizeMB: packSizeMB('survival', 3), blurb: 'Safe water, fire, shelter, signaling for rescue, navigation.' },
  { id: 'disasters', name: 'Disasters (PH)', icon: '🌀', url: 'packs/disasters.json', sizeMB: packSizeMB('disasters', 2), blurb: 'Typhoon, flood, earthquake, volcano, go-bag, evacuation.' },
  { id: 'medicine', name: 'Health & Illness', icon: '💊', url: 'packs/medicine.json', sizeMB: packSizeMB('medicine', 25), blurb: 'Fever, diarrhea, dengue, leptospirosis, infections, hygiene.' },
  { id: 'food', name: 'Food & Farming', icon: '🌾', url: 'packs/food.json', sizeMB: packSizeMB('food', 15), blurb: 'Food storage, preserving, gardening, fishing, edible plants.' },
  { id: 'engineering', name: 'Engineering & Power', icon: '🔧', url: 'packs/engineering.json', sizeMB: packSizeMB('engineering', 40), blurb: 'Solar & batteries, water filters, simple tools, radio, repairs.' },
];

export interface Kit {
  id: string;
  name: string;
  packs: string[];
  blurb: string;
}

export const KITS: Kit[] = [
  { id: 'essentials', name: 'Essentials', packs: ['first-aid', 'survival', 'disasters'], blurb: 'Smallest. Stay alive for the first 72 hours.' },
  { id: 'prepared', name: 'Prepared', packs: ['first-aid', 'survival', 'disasters', 'medicine', 'food'], blurb: 'Recommended. Adds health and food for weeks without help.' },
  { id: 'full', name: 'Full Survival', packs: PACKS.map((p) => p.id), blurb: 'Everything, including engineering to rebuild.' },
];

export const modelKey = (id: string) => `model:${id}`;
export const packKey = (id: string) => `pack:${id}`;
