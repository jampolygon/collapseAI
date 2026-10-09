// On-device LLM via wllama (llama.cpp compiled to WebAssembly, WebGPU when available).
// Contract shared with the rest of the app: loadModel(), chat(), unload().

import { Wllama, LoggerWithoutDebug } from '@wllama/wllama/esm/index.js';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import type { ModelEntry } from './catalog';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatStats {
  promptTokens: number;
  promptPerSec: number;
  genTokens: number;
  genPerSec: number;
}

let wllama: Wllama | null = null;
let current: ModelEntry | null = null;

export const loadedModel = () => current;

/**
 * GPU (WebGPU) on/off. Some phone GPUs give broken output (garbage / Chinese text) and weak GPUs
 * can be slower than the CPU, so phones default to the CPU. A saved choice always wins.
 */
const LS_GPU = 'cai.gpu';
const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
export function gpuEnabled(): boolean {
  try {
    const saved = localStorage.getItem(LS_GPU);
    if (saved === 'on') return true;
    if (saved === 'off') return false;
  } catch {
    /* fall through to the default */
  }
  return !isPhone();
}
export function setGpuEnabled(on: boolean) {
  try {
    localStorage.setItem(LS_GPU, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

/** True when a short self-test answer looks like normal English (not garbage or another script). */
export function looksSane(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && /^[ -~\s]+$/.test(t) && /ok/i.test(t);
}

async function create(model: ModelEntry, file: Blob, gpu: boolean, extra: Blob[] = []) {
  const w = new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug, suppressNativeLog: true });
  try {
    // extra = e.g. the vision add-on (mmproj) for photo models; wllama detects it by its metadata
    await w.loadModel([file, ...extra], {
      n_ctx: 4096,
      n_batch: 512,
      ...(gpu ? {} : { n_gpu_layers: 0 }),
      ...(model.loadParams ?? {}),
    });
  } catch (e) {
    await w.exit().catch(() => {}); // a failed load must not keep hundreds of MB allocated
    throw e;
  }
  return w;
}

async function selfTest(): Promise<boolean> {
  try {
    let out = '';
    await chat([{ role: 'user', content: 'Reply with exactly one word: OK' }], {
      onToken: (t) => { out += t; },
      maxTokens: 8,
      temperature: 0,
    });
    return looksSane(out);
  } catch {
    return false;
  }
}

/**
 * Load a model. With the GPU on, a short self-test checks the output is sane English; if not,
 * it reloads on the CPU and remembers that choice. Returns whether it fell back.
 */
export async function loadModel(model: ModelEntry, file: Blob, extra: Blob[] = []): Promise<{ fellBackToCpu: boolean }> {
  await unload();
  const useGpu = gpuEnabled();
  wllama = await create(model, file, useGpu, extra);
  current = model;
  if (!useGpu || (await selfTest())) return { fellBackToCpu: false };
  await unload();
  setGpuEnabled(false);
  wllama = await create(model, file, false, extra);
  current = model;
  return { fellBackToCpu: true };
}

export async function unload() {
  const w = wllama;
  wllama = null;
  current = null;
  if (w) await w.exit().catch(() => {});
}

/**
 * Tiny models sometimes loop ("Cut the bottle in half again." x30). Returns true when the newest
 * finished line (long enough to matter) already appeared earlier in the answer.
 */
export function repeatsLine(text: string): boolean {
  const lines = text.split('\n').map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim().toLowerCase());
  lines.pop(); // the last line is still being written
  const last = lines.at(-1);
  if (!last || last.length < 12) return false;
  return lines.slice(0, -1).includes(last);
}

/** Stream a chat answer. onToken gets each new piece of text; onPrompt gets prompt-reading progress (0..1). */
export async function chat(
  messages: ChatMessage[],
  opts: { onToken: (t: string) => void; onPrompt?: (p: number) => void; signal?: AbortSignal; maxTokens?: number; temperature?: number },
): Promise<ChatStats | null> {
  if (!wllama || !current) throw new Error('No model loaded');
  let stats: ChatStats | null = null;
  // our own controller, so the loop guard can stop generation without it looking like a user "Stop"
  const ctrl = new AbortController();
  const forward = () => ctrl.abort();
  opts.signal?.addEventListener('abort', forward);
  let text = '';
  let looped = false;
  try {
    const stream = await wllama.createChatCompletion({
      messages,
      stream: true,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.3,
      // mild penalties: small models otherwise repeat the same step over and over
      penalty_repeat: 1.12,
      penalty_last_n: 256,
      abortSignal: ctrl.signal,
      return_progress: true,
      chat_template_kwargs: current.chatKwargs,
    });
    for await (const chunk of stream) {
      const p = chunk.prompt_progress;
      if (p && p.total > 0) opts.onPrompt?.(p.processed / p.total);
      const t = chunk.choices?.[0]?.delta?.content;
      if (t) {
        opts.onToken(t);
        text += t;
        if (t.includes('\n') && repeatsLine(text)) {
          looped = true;
          ctrl.abort();
          break;
        }
      }
      if (chunk.timings) {
        stats = {
          promptTokens: chunk.timings.prompt_n,
          promptPerSec: chunk.timings.prompt_per_second,
          genTokens: chunk.timings.predicted_n,
          genPerSec: chunk.timings.predicted_per_second,
        };
      }
    }
  } catch (e) {
    if (!looped || opts.signal?.aborted) throw e; // a real error or the user's Stop
  } finally {
    opts.signal?.removeEventListener('abort', forward);
  }
  return stats;
}

/** Ask a vision model about an image (JPEG/PNG bytes). Needs a model loaded with its vision add-on. */
export async function describeImage(image: ArrayBuffer, question: string, onToken: (t: string) => void, signal?: AbortSignal) {
  if (!wllama || !current) throw new Error('No model loaded');
  const stream = await wllama.createChatCompletion({
    messages: [{ role: 'user', content: [{ type: 'image', data: image }, { type: 'text', text: question }] }],
    stream: true,
    max_tokens: 250,
    temperature: 0.2,
    abortSignal: signal,
  });
  for await (const chunk of stream) {
    const t = chunk.choices?.[0]?.delta?.content;
    if (t) onToken(t);
  }
}
