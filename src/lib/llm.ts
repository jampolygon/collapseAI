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

/** GPU (WebGPU) on/off. Weak/integrated GPUs can be slower than the CPU, so this is user-switchable. */
const LS_GPU = 'cai.gpu';
export function gpuEnabled(): boolean {
  try {
    return localStorage.getItem(LS_GPU) !== 'off';
  } catch {
    return true;
  }
}
export function setGpuEnabled(on: boolean) {
  try {
    localStorage.setItem(LS_GPU, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export async function loadModel(model: ModelEntry, file: Blob) {
  await unload();
  const w = new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug, suppressNativeLog: true });
  await w.loadModel([file], {
    n_ctx: 4096,
    n_batch: 512,
    ...(gpuEnabled() ? {} : { n_gpu_layers: 0 }),
    ...(model.loadParams ?? {}),
  });
  wllama = w;
  current = model;
}

export async function unload() {
  const w = wllama;
  wllama = null;
  current = null;
  if (w) await w.exit().catch(() => {});
}

/** Stream a chat answer. onToken gets each new piece of text; onPrompt gets prompt-reading progress (0..1). */
export async function chat(
  messages: ChatMessage[],
  opts: { onToken: (t: string) => void; onPrompt?: (p: number) => void; signal?: AbortSignal; maxTokens?: number },
): Promise<ChatStats | null> {
  if (!wllama || !current) throw new Error('No model loaded');
  let stats: ChatStats | null = null;
  const stream = await wllama.createChatCompletion({
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 400,
    temperature: 0.3,
    abortSignal: opts.signal,
    return_progress: true,
    chat_template_kwargs: current.chatKwargs,
  });
  for await (const chunk of stream) {
    const p = chunk.prompt_progress;
    if (p && p.total > 0) opts.onPrompt?.(p.processed / p.total);
    const t = chunk.choices?.[0]?.delta?.content;
    if (t) opts.onToken(t);
    if (chunk.timings) {
      stats = {
        promptTokens: chunk.timings.prompt_n,
        promptPerSec: chunk.timings.prompt_per_second,
        genTokens: chunk.timings.predicted_n,
        genPerSec: chunk.timings.predicted_per_second,
      };
    }
  }
  return stats;
}
