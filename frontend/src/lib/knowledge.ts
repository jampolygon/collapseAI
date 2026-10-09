// Offline knowledge: downloaded packs -> passages -> MiniSearch (BM25) index.

import MiniSearch from 'minisearch';
import { PACKS, packKey } from './catalog';
import { getFile } from './downloads';
import { isLocationQuestion } from './smalltalk';

export interface Article {
  id: string;
  title: string;
  category: string;
  text: string;
  source?: string;
  /** free-form search hints, e.g. ['bleeding', 'tourniquet'] */
  tags?: string[];
  /** disaster types this article applies to, e.g. ['typhoon', 'flood'] — used to filter retrieval */
  disaster_types?: string[];
  /** ISO date the content was last checked against its source */
  last_verified?: string;
}

export interface Pack {
  id: string;
  name: string;
  version: number;
  license?: string;
  /** ISO date the pack was built */
  updated?: string;
  keywords?: string[];
  articles: Article[];
}

export interface Passage {
  id: string; // packId/articleId#n
  packId: string;
  articleId: string;
  title: string;
  category: string;
  text: string;
  source?: string;
  tags?: string[];
  disaster_types?: string[];
  last_verified?: string;
}

// Tagalog / Taglish words -> English search terms. Add more!
const TAGLISH: Record<string, string> = {
  sugat: 'wound cut bleeding',
  dugo: 'blood bleeding',
  lagnat: 'fever',
  ubo: 'cough',
  sipon: 'cold',
  pagtatae: 'diarrhea',
  tae: 'diarrhea',
  suka: 'vomiting',
  nagsusuka: 'vomiting',
  paso: 'burn',
  napaso: 'burn',
  nasunog: 'burn fire',
  bali: 'fracture broken bone',
  baling: 'fracture broken bone',
  nalunod: 'drowning',
  nabulunan: 'choking',
  hinimatay: 'fainting unconscious shock',
  tubig: 'water',
  inumin: 'drinking water',
  apoy: 'fire',
  pagkain: 'food',
  bagyo: 'typhoon storm',
  baha: 'flood',
  lindol: 'earthquake',
  bulkan: 'volcano ash',
  abo: 'ash volcano',
  silungan: 'shelter',
  kagat: 'bite',
  ahas: 'snake',
  aso: 'dog rabies',
  lamok: 'mosquito dengue',
  daga: 'rat leptospirosis',
  gamot: 'medicine treatment',
  sakit: 'illness pain',
  ulo: 'head',
  tiyan: 'stomach',
  paano: '',
  ano: '',
  ang: '',
  ng: '',
  sa: '',
  na: '',
  ko: '',
  mga: '',
};

export function expandQuery(q: string): string {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => (w in TAGLISH ? TAGLISH[w] : w))
    .filter(Boolean)
    .join(' ');
}

// Filler words that only add noise to a search ("do", "about", "you" match half the library).
const STOP = new Set(
  ('a an the and or but if of to in on at by for with from about as is are was were be been am i me my we our you your ' +
    'he she it its they them their this that these those what which who whom how when where why do does did doing done ' +
    'can could should would will shall may might must have has had having get got some someone somebody something any ' +
    'there here very just so not no yes please help need want know tell make po ho opo naman lang din rin kasi').split(' '),
);

/** Very small plural stemmer so "wounds"/"fires" match "wound"/"fire". */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3 || /(ss|us|is)$/.test(w)) return w;
  if (/(sses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Search terms for a question: Taglish expanded, filler words dropped. */
export function searchTerms(q: string): string[] {
  return expandQuery(q)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

/** Packs that are general reference material: they rank below the hand-written guides. */
const REFERENCE_PACKS = new Set(['wikipedia-essentials', 'wikipedia-prepared', 'wikipedia-full']);

let index: MiniSearch<Passage> | null = null;
let passages = new Map<string, Passage>();
let loaded: Pack[] = [];

/** Split long articles into ~600-char passages along paragraph boundaries. */
export function chunk(pack: Pack, a: Article): Passage[] {
  const paras = a.text.split(/\n\s*\n/);
  const out: Passage[] = [];
  let buf = '';
  // Metadata every passage inherits from its article, so retrieval can filter and cite it.
  const meta: Partial<Passage> = {
    source: a.source,
    ...(a.tags ? { tags: a.tags } : {}),
    ...(a.disaster_types ? { disaster_types: a.disaster_types } : {}),
    ...(a.last_verified ? { last_verified: a.last_verified } : {}),
  };
  const flush = () => {
    if (!buf.trim()) return;
    out.push({
      id: `${pack.id}/${a.id}#${out.length}`,
      packId: pack.id,
      articleId: a.id,
      title: a.title,
      category: a.category,
      text: buf.trim(),
      ...meta,
    });
    buf = '';
  };
  for (const p of paras) {
    if (buf && buf.length + p.length > 600) flush();
    buf += (buf ? '\n\n' : '') + p;
  }
  flush();
  return out;
}

/** (Re)load every downloaded pack from on-device storage and rebuild the index. */
export async function loadKnowledge(): Promise<Pack[]> {
  const packs: Pack[] = [];
  for (const p of PACKS) {
    const f = await getFile(packKey(p.id));
    if (!f || f.size === 0) continue;
    try {
      packs.push(JSON.parse(await f.text()) as Pack);
    } catch {
      // A pack that cannot be parsed is skipped, not fatal: the rest of the library still works.
      console.warn('Bad pack file', p.id);
    }
  }
  indexPacks(packs);
  return packs;
}

/**
 * Build the search index from already-loaded packs. Pure, so tests can index fixtures
 * without OPFS, and so reading files stays separate from indexing them.
 */
export function indexPacks(packs: Pack[]): { passages: number; articles: number } {
  const ms = new MiniSearch<Passage>({
    fields: ['title', 'category', 'text', 'tags'],
    storeFields: ['id'],
    processTerm: stem,
    searchOptions: {
      boost: { title: 3, category: 1.5, tags: 2 },
      // Only longer words get prefix/typo matching, so "po" never matches "power" and "flood" never matches "food".
      prefix: (term: string) => term.length >= 5,
      fuzzy: (term: string) => (term.length >= 6 ? 0.2 : false),
      // Long general reference text (Wikipedia) must not outrank the short, team-reviewed survival guides.
      boostDocument: (id: string) => (REFERENCE_PACKS.has(id.split('/')[0]) ? 0.4 : 1),
    },
  });
  passages = new Map();
  const all = packs.flatMap((pk) => pk.articles.flatMap((a) => chunk(pk, a)));
  all.forEach((p) => passages.set(p.id, p));
  ms.addAll(all);
  index = ms;
  loaded = packs;
  return { passages: all.length, articles: packs.reduce((n, p) => n + p.articles.length, 0) };
}

export const loadedPacks = () => loaded;

/** A hit must score at least this share of the best hit, or it is treated as unrelated. */
const RELATIVE_CUTOFF = 0.35;
/**
 * ...and the best hit must reach a minimum score (one stray word is not an answer). Scores grow with
 * the library size, so the floor does too: about 10 for the 61 passages of the default packs.
 */
const minScore = () => (passages.size < 20 ? 0 : 2.4 * Math.log(passages.size)); // tiny test libraries have tiny scores

export function search(query: string, k = 3): Passage[] {
  if (!index) return [];
  if (isLocationQuestion(query)) return []; // "where" questions belong to Map/Compass, not the library
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const results = index.search(terms.join(' '), { combineWith: 'OR' });
  if (!results.length || results[0].score < minScore()) return [];
  const floor = results[0].score * RELATIVE_CUTOFF;
  return results
    .filter((r) => r.score >= floor)
    .slice(0, k)
    .map((r) => passages.get(r.id as string)!)
    .filter(Boolean);
}

export function allArticles(): (Article & { packId: string })[] {
  return loaded.flatMap((p) => p.articles.map((a) => ({ ...a, packId: p.id })));
}
