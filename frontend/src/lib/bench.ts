// AI benchmark: fixed survival questions, scored by whether the answer contains the key facts.
// Run it on each target phone (Tools → AI benchmark) to pick the default model with real numbers.

import type { ModelEntry } from './catalog';
import { ask } from './ask';
import { getFile } from './downloads';
import { modelKey } from './catalog';
import { loadModel, unload } from './llm';

export interface BenchQuestion {
  id: string;
  q: string;
  /** every group must match (any word in the group) for full marks */
  expect: string[][];
}

export const QUESTIONS: BenchQuestion[] = [
  { id: 'bleeding', q: 'How do I stop heavy bleeding from a deep cut?', expect: [['pressure', 'press'], ['cloth', 'gauze', 'bandage'], ['tourniquet', 'raise', 'elevat', 'medical', 'hospital']] },
  { id: 'burn', q: 'Someone got burned by boiling water. What should I do?', expect: [['cool'], ['20 min', '20-min', 'twenty'], ['blister', 'ice', 'toothpaste', 'wrap', 'cover']] },
  { id: 'water', q: 'How do I make river water safe to drink?', expect: [['boil'], ['1 minute', 'one minute', 'a minute'], ['bleach', 'chlorine', 'tablet', 'sodis', 'sunlight']] },
  { id: 'quake', q: 'What should I do during an earthquake?', expect: [['drop', 'duck'], ['cover'], ['hold']] },
  { id: 'dengue', q: 'What are the warning signs of dengue?', expect: [['stomach', 'abdominal'], ['vomit'], ['bleed']] },
  { id: 'ors', q: 'How do I make oral rehydration solution at home?', expect: [['liter', 'litre'], ['6', 'six'], ['sugar'], ['salt']] },
  { id: 'snake', q: "A snake bit my friend's leg. What do I do?", expect: [['still', 'calm', 'immobil', 'splint'], ['hospital', 'antivenom', 'medical']] },
  { id: 'tagalog', q: 'Paano gamutin ang paso?', expect: [['cool'], ['20 min', '20-min']] },
  { id: 'cpr', q: 'Someone is not breathing. How do I do CPR?', expect: [['chest', 'compress', 'push'], ['100 to 120', '100-120', '100–120'], ['30 compressions', '30 pushes', '30 chest', 'after 30']] },
  { id: 'signal3', q: 'Typhoon signal number 3 is raised. What does it mean?', expect: [['89–117', '89-117', '89 to 117', '89 and 117'], ['18 hours']] },
];

export interface BenchAnswer {
  id: string;
  answer: string;
  score: number; // 0..1
  seconds: number;
  promptPerSec: number;
  genPerSec: number;
  genTokens: number;
}

export interface BenchResult {
  modelId: string;
  modelName: string;
  family: string;
  device: string;
  date: string;
  loadSeconds: number;
  answers: BenchAnswer[];
}

export function score(answer: string, expect: string[][]): number {
  const a = answer.toLowerCase();
  const hit = expect.filter((g) => g.some((w) => a.includes(w.toLowerCase()))).length;
  return expect.length ? hit / expect.length : 0;
}

export function summary(r: BenchResult) {
  const n = r.answers.length || 1;
  const avg = (f: (a: BenchAnswer) => number) => r.answers.reduce((s, a) => s + f(a), 0) / n;
  return {
    score: avg((a) => a.score),
    seconds: avg((a) => a.seconds),
    promptPerSec: avg((a) => a.promptPerSec),
    genPerSec: avg((a) => a.genPerSec),
    tokens: avg((a) => a.genTokens),
  };
}

export async function runBench(
  model: ModelEntry,
  opts: { onProgress: (msg: string) => void; signal?: AbortSignal; questions?: BenchQuestion[] },
): Promise<BenchResult> {
  const file = await getFile(modelKey(model.id));
  if (!file) throw new Error(`${model.name} is not downloaded`);
  opts.onProgress(`Loading ${model.name}…`);
  const t0 = performance.now();
  await loadModel(model, file);
  const loadSeconds = (performance.now() - t0) / 1000;

  const answers: BenchAnswer[] = [];
  const qs = opts.questions ?? QUESTIONS;
  try {
    for (const [i, q] of qs.entries()) {
      if (opts.signal?.aborted) break;
      opts.onProgress(`${model.name}: question ${i + 1}/${qs.length}`);
      let text = '';
      const t = performance.now();
      const res = await ask(q.q, { onSources: () => {}, onToken: (x) => (text += x), signal: opts.signal, maxTokens: 300 });
      answers.push({
        id: q.id,
        answer: text,
        score: score(text, q.expect),
        seconds: (performance.now() - t) / 1000,
        promptPerSec: res.stats?.promptPerSec ?? 0,
        genPerSec: res.stats?.genPerSec ?? 0,
        genTokens: res.stats?.genTokens ?? 0,
      });
    }
  } finally {
    await unload();
  }
  return {
    modelId: model.id,
    modelName: model.name,
    family: model.family,
    device: `${navigator.hardwareConcurrency} cores, ${(navigator as any).deviceMemory ?? '?'} GB, ${/Android|iPhone/i.test(navigator.userAgent) ? 'phone' : 'computer'}`,
    date: new Date().toISOString(),
    loadSeconds,
    answers,
  };
}

export function toMarkdown(results: BenchResult[]): string {
  const rows = results.map((r) => {
    const s = summary(r);
    return `| ${r.modelName} (${r.family}) | ${(s.score * 100).toFixed(0)}% | ${s.seconds.toFixed(1)} s | ${s.promptPerSec.toFixed(0)} | ${s.genPerSec.toFixed(1)} | ${s.tokens.toFixed(0)} | ${r.loadSeconds.toFixed(1)} s | ${r.device} |`;
  });
  return [
    '| Model | Facts correct | Avg time/answer | Read tok/s | Write tok/s | Avg answer tokens | Load time | Device |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
