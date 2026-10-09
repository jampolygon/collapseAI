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
    // Benchmark (Tools → AI benchmark): best of the ~300M models tested, 74% of key facts
    // vs 28% for the old Ember (LFM2.5 350M Q4).
    id: 'smollm2-360m',
    name: 'Ember',
    family: 'HuggingFace SmolLM2 360M Instruct · Q8_0',
    url: `${HF}/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf`,
    sizeMB: 386,
    speed: 'fastest',
    blurb: 'Tiny and light. Good at reading the right article back to you, but can mix up numbers, so check the source shown.',
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

/** Extra small models used only by the AI benchmark (Tools), to compare ~300M options on a device. */
export const BENCH_MODELS: ModelEntry[] = [
  {
    id: 'lfm25-350m',
    name: 'LFM 350M Q4',
    family: 'LiquidAI LFM2.5 350M · Q4_K_M',
    url: `${HF}/LiquidAI/LFM2.5-350M-GGUF/resolve/main/LFM2.5-350M-Q4_K_M.gguf`,
    sizeMB: 229,
    speed: 'fastest',
    blurb: 'Former Ember. Scored 28%: too compressed for a model this small.',
  },
  {
    id: 'lfm25-350m-q8',
    name: 'LFM 350M Q8',
    family: 'LiquidAI LFM2.5 350M · Q8_0',
    url: `${HF}/LiquidAI/LFM2.5-350M-GGUF/resolve/main/LFM2.5-350M-Q8_0.gguf`,
    sizeMB: 379,
    speed: 'fastest',
    blurb: 'Less compressed LFM 350M. Scored 53%.',
  },
  {
    id: 'gemma3-270m',
    name: 'Gemma 270M',
    family: 'Google Gemma 3 270M IT · Q8_0',
    url: `${HF}/unsloth/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf`,
    sizeMB: 292,
    speed: 'fastest',
    blurb: "Google's smallest instruction model. Scored 67%.",
  },
];

/** Photo AI: tiny vision-language model + its image encoder (the "vision add-on", mmproj). */
export const VISION_MODEL: ModelEntry & { vision: { url: string; sizeMB: number } } = {
  id: 'smolvlm-256m',
  name: 'Eye',
  family: 'HuggingFace SmolVLM 256M Instruct · Q8_0',
  url: `${HF}/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/SmolVLM-256M-Instruct-Q8_0.gguf`,
  sizeMB: 175,
  speed: 'fastest',
  blurb: 'Looks at photos: plants, injuries, labels, objects.',
  vision: { url: `${HF}/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-256M-Instruct-Q8_0.gguf`, sizeMB: 104 },
};

export const ALL_MODELS: ModelEntry[] = [...MODELS, ...BENCH_MODELS];

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
  { id: 'wikipedia-essentials', name: 'Wikipedia Essentials', icon: '📖', url: 'packs/wikipedia-essentials.json', sizeMB: packSizeMB('wikipedia-essentials', 0.7), blurb: 'Encyclopedia articles for the first days (CC BY-SA): first aid, water, shelter, disasters.' },
  { id: 'wikipedia-prepared', name: 'Wikipedia Prepared', icon: '📚', url: 'packs/wikipedia-prepared.json', sizeMB: packSizeMB('wikipedia-prepared', 1.7), blurb: 'More encyclopedia articles for weeks without help (CC BY-SA): illness, medicine, food, farming, tools.' },
  { id: 'wikipedia-full', name: 'Wikipedia Full Survival', icon: '🏛️', url: 'packs/wikipedia-full.json', sizeMB: packSizeMB('wikipedia-full', 3.2), blurb: 'The largest encyclopedia set (CC BY-SA): rebuilding, engineering, agriculture, chemistry, long-term health.' },
];

export interface Kit {
  id: string;
  name: string;
  packs: string[];
  blurb: string;
}

export const KITS: Kit[] = [
  { id: 'essentials', name: 'Essentials', packs: ['first-aid', 'survival', 'disasters', 'wikipedia-essentials'], blurb: 'Smallest. Stay alive for the first 72 hours.' },
  { id: 'prepared', name: 'Prepared', packs: ['first-aid', 'survival', 'disasters', 'medicine', 'food', 'wikipedia-essentials', 'wikipedia-prepared'], blurb: 'Recommended. Adds health and food for weeks without help.' },
  { id: 'full', name: 'Full Survival', packs: PACKS.map((p) => p.id), blurb: 'Everything, including engineering to rebuild.' },
];

export const modelKey = (id: string) => `model:${id}`;
export const visionKey = (id: string) => `vision:${id}`;
export const packKey = (id: string) => `pack:${id}`;
