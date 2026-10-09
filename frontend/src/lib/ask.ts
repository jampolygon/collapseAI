// RAG: question -> offline passages -> local LLM answer grounded in those passages.
// Prompt is deliberately short and plain: small models (350M–1B) follow simple instructions best.

import { chat, loadedModel, type ChatMessage, type ChatStats } from './llm';
import { search, type Passage } from './knowledge';
import { smallTalkReply } from './smalltalk';

const SYSTEM = `You are CollapseAI, an offline survival and first-aid helper. There is no internet and maybe no doctor.
Use only the reference information you are given. Do not make up medicine doses.
For how-to and emergency questions answer with short, clear numbered steps, most urgent first. Otherwise answer in one to three short sentences.
If the reference does not answer the question, say you do not have that information.
If it is serious, tell the person to get medical help as soon as possible.
Always answer in English, even if the question is in Tagalog or Taglish.`;

export const NO_INFO =
  "I don't have information on that in your downloaded packs. Try other words, check the Library, or download more topics in Prepare. If someone is hurt or in danger, get medical help or call emergency services (911 in the Philippines) as soon as you can.";

/** A finished earlier exchange, used so follow-up questions make sense. */
export interface HistoryTurn {
  q: string;
  a: string;
  /** whether that answer was grounded in library passages (small talk and "no info" are not) */
  hadSources: boolean;
}

const HISTORY_TURNS = 2; // small on purpose: every extra token slows the phone's prompt reading
const HISTORY_ANSWER_CHARS = 300;

// "what about kids?", "and if it gets worse?", "paano kung bata?": depends on the previous question.
const FOLLOW_UP = /\b(what|how) about\b|\b(it|that|this|them|those|these|he|she|they|him|her)\b|^(and|also|then|paano kung|paano naman|e kung|eh kung)\b/i;

/** Find passages for a question; a follow-up is searched together with the previous question. */
export function retrieve(question: string, history: HistoryTurn[] = [], k = 3): Passage[] {
  const alone = search(question, k);
  const previous = [...history].reverse().find((t) => t.hadSources);
  if (!previous || (alone.length && !FOLLOW_UP.test(question))) return alone;
  const combined = search(`${previous.q} ${question}`, k);
  return combined.length ? combined : alone;
}

export interface AskResult {
  sources: Passage[];
  stats: ChatStats | null;
  kind: 'answer' | 'smalltalk' | 'no-info';
}

export async function ask(
  question: string,
  cb: {
    onSources: (s: Passage[]) => void;
    onToken: (t: string) => void;
    onPrompt?: (p: number) => void;
    signal?: AbortSignal;
    history?: HistoryTurn[];
  },
): Promise<AskResult> {
  const talk = smallTalkReply(question);
  if (talk) {
    cb.onSources([]);
    cb.onToken(talk);
    return { sources: [], stats: null, kind: 'smalltalk' };
  }

  // Small context on purpose: on weak phone CPUs, reading the prompt is the slow part.
  const history = (cb.history ?? []).slice(-HISTORY_TURNS);
  const sources = retrieve(question, history);
  cb.onSources(sources);
  if (!sources.length) {
    cb.onToken(NO_INFO);
    return { sources, stats: null, kind: 'no-info' };
  }
  if (!loadedModel()) return { sources, stats: null, kind: 'answer' };

  const ref = sources.map((s) => `## ${s.title}\n${s.text}`).join('\n\n');
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    ...history.flatMap<ChatMessage>((t) => [
      { role: 'user', content: t.q },
      { role: 'assistant', content: t.a.slice(0, HISTORY_ANSWER_CHARS) },
    ]),
    { role: 'user', content: `Reference information:\n${ref}\n\nQuestion: ${question}` },
  ];
  const stats = await chat(messages, { onToken: cb.onToken, onPrompt: cb.onPrompt, signal: cb.signal });
  return { sources, stats, kind: 'answer' };
}
