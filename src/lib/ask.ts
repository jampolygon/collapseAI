// RAG: question -> offline passages -> local LLM answer grounded in those passages.
// Prompt is deliberately short and plain: small models (350M–1B) follow simple instructions best.

import { chat, loadedModel, type ChatStats } from './llm';
import { search, type Passage } from './knowledge';

const SYSTEM = `You are CollapseAI, an offline survival and first-aid helper. There is no internet and maybe no doctor.
Answer with short, clear numbered steps. Most urgent step first.
Use only the reference information you are given. Do not make up medicine doses.
If it is serious, tell the person to get medical help as soon as possible.
Always answer in English, even if the question is in Tagalog or Taglish.`;

export interface AskResult {
  sources: Passage[];
  stats: ChatStats | null;
}

export async function ask(
  question: string,
  cb: { onSources: (s: Passage[]) => void; onToken: (t: string) => void; onPrompt?: (p: number) => void; signal?: AbortSignal },
): Promise<AskResult> {
  // Small context on purpose: on weak phone CPUs, reading the prompt is the slow part.
  const sources = search(question, 3);
  cb.onSources(sources);
  if (!loadedModel()) return { sources, stats: null };

  const ref = sources.length
    ? sources.map((s) => `## ${s.title}\n${s.text}`).join('\n\n')
    : 'No reference found. Give only safe, general advice and say that you are not sure.';

  const stats = await chat(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Reference information:\n${ref}\n\nQuestion: ${question}` },
    ],
    { onToken: cb.onToken, onPrompt: cb.onPrompt, signal: cb.signal },
  );
  return { sources, stats };
}
