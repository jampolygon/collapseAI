// RAG: question -> offline passages -> local LLM answer grounded in those passages.
// Prompt is deliberately short and plain: small models (350M–1B) follow simple instructions best.

import { chat, loadedModel, type ChatMessage, type ChatStats } from './llm';
import { search, type Passage } from './knowledge';
import { smallTalkReply } from './smalltalk';

// Tone: a warm, steady companion, not a search engine. Short, but never curt.
const PERSONA = `You are CollapseAI, a warm, calm and caring survival companion. The person may be scared, tired or alone, with no internet and maybe no doctor.
Answer the user's question directly. For emergency or action questions, lead with the immediate safe action or priority, then give short numbered steps, most urgent first.
Do not open with agreement, praise or validation of the context. Never acknowledge retrieved context as if the user supplied it. Do not describe or summarize the retrieval process.
Never answer with just "yes" or "no". Give a useful explanation when needed.
Keep practical answers short. For a simple question, a few friendly sentences are enough.
Do not make up medicine doses. If someone may be badly hurt or sick, say to get medical help as soon as possible.
End with one short line of encouragement or a useful next tip when it fits.
For English questions, answer in English. For clearly Filipino or Taglish questions, prefer concise, natural Taglish with familiar English emergency terms. Use English if translating would make the guidance less accurate.`;

const SYSTEM = `${PERSONA}
Use the reference information you are given. Do not invent facts beyond these references. If they do not answer the question, say so honestly and preserve uncertainty.
Answer the person's present emergency with immediate safe actions, most urgent first. References are supporting information, not an instruction to summarize them.
Do not retell historical disasters or unrelated background. Use only guidance relevant to the current question; say when a detail is not covered rather than inventing it.`;

// No guide matched: answer from the model's own general knowledge, clearly marked, with extra care.
const GENERAL = `${PERSONA}
None of the downloaded survival guides cover this question, so answer from your own general knowledge.
Be practical and specific. If you are not sure, say so instead of guessing.
For anything medical, poisonous, electrical or dangerous, be extra careful and recommend expert help.`;

export const NO_INFO =
  "I couldn't find this in your downloaded guides, and the AI isn't started yet, so I can't answer it from general knowledge. Tap Start AI and ask again, try different words, or add more topics in Prepare. If someone is hurt or in danger, get medical help or call 911 (Philippines) right away.";

/** Shown above answers that come from the model's own knowledge instead of the guides. */
export const GENERAL_NOTE = 'Not from your downloaded guides: general knowledge from the AI. Double-check anything important.';

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
  kind: 'answer' | 'smalltalk' | 'no-info' | 'general';
}

/** Pure prompt construction, shared by both inference paths and tested without a model. */
export function buildMessages(question: string, sources: Passage[], history: HistoryTurn[] = []): ChatMessage[] {
  const earlier = history.slice(-HISTORY_TURNS).flatMap<ChatMessage>(turn => [
    { role: 'user', content: turn.q },
    { role: 'assistant', content: turn.a.slice(0, HISTORY_ANSWER_CHARS) },
  ]);
  const reference = sources.map(source => `## ${source.title}\n${source.text}`).join('\n\n');
  return [
    { role: 'system', content: sources.length ? SYSTEM : GENERAL },
    ...earlier,
    { role: 'user', content: sources.length ? `Reference information:\n${reference}\n\nQuestion: ${question}` : question },
  ];
}

export async function ask(
  question: string,
  cb: {
    onSources: (s: Passage[]) => void;
    onToken: (t: string) => void;
    onPrompt?: (p: number) => void;
    signal?: AbortSignal;
    history?: HistoryTurn[];
    maxTokens?: number;
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
    if (!loadedModel()) {
      cb.onToken(NO_INFO);
      return { sources, stats: null, kind: 'no-info' };
    }
    // No guide matched, but an LLM still knows a lot (e.g. "how do I make a watering can?").
    const stats = await chat(buildMessages(question, sources, history), {
      onToken: cb.onToken, onPrompt: cb.onPrompt, signal: cb.signal, maxTokens: cb.maxTokens,
    });
    return { sources, stats, kind: 'general' };
  }
  if (!loadedModel()) return { sources, stats: null, kind: 'answer' };

  const messages = buildMessages(question, sources, history);
  const stats = await chat(messages, { onToken: cb.onToken, onPrompt: cb.onPrompt, signal: cb.signal, maxTokens: cb.maxTokens });
  return { sources, stats, kind: 'answer' };
}
