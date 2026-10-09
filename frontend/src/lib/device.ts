import { MODELS, type ModelEntry } from './catalog';

export interface DeviceInfo {
  ramGB: number; // navigator.deviceMemory: rounded, capped at 8
  ramKnown: boolean;
  cores: number;
  webgpu: boolean;
  mobile: boolean;
  freeStorageMB: number;
  multithread: boolean;
}

export async function detectDevice(): Promise<DeviceInfo> {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: any };
  let webgpu = false;
  try {
    webgpu = !!(nav.gpu && (await nav.gpu.requestAdapter()));
  } catch {
    /* no WebGPU */
  }
  let freeStorageMB = 0;
  try {
    const est = await navigator.storage.estimate();
    freeStorageMB = Math.round(((est.quota ?? 0) - (est.usage ?? 0)) / 1e6);
  } catch {
    /* unknown */
  }
  return {
    ramGB: nav.deviceMemory ?? 4,
    ramKnown: typeof nav.deviceMemory === 'number',
    cores: navigator.hardwareConcurrency || 4,
    webgpu,
    mobile: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
    freeStorageMB,
    multithread: (self as any).crossOriginIsolated === true,
  };
}

/**
 * Pick a model the device can run comfortably.
 * Phones are limited by CPU speed more than RAM (e.g. Infinix HOT 60 Pro reports 8 GB
 * but has only 2 fast cores), so phones never get the 2B+ models by default.
 * TODO: replace with a 5-second speed test.
 */
export function recommendModel(d: DeviceInfo): { model: ModelEntry; reason: string } {
  const pick = (id: string) => MODELS.find((m) => m.id === id)!;
  if (d.mobile) {
    if (d.ramGB >= 6 && d.cores >= 8) return { model: pick('lfm25-1.2b'), reason: `Phone with ${d.ramGB}+ GB memory and ${d.cores} cores.` };
    if (d.ramGB >= 3) return { model: pick('qwen35-0.8b'), reason: `Phone with about ${d.ramGB} GB memory.` };
    return { model: pick('smollm2-360m'), reason: 'Phone with little memory, so we picked the lightest model.' };
  }
  if (d.webgpu && d.ramGB >= 8) return { model: pick('qwen35-2b'), reason: 'Computer with a GPU and 8+ GB memory.' };
  if (d.ramGB >= 4) return { model: pick('lfm25-1.2b'), reason: `Computer with about ${d.ramGB} GB memory, no fast GPU.` };
  return { model: pick('qwen35-0.8b'), reason: 'Computer with limited memory.' };
}

export function fmtBytes(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 1) return `${mb >= 100 ? Math.round(mb) : +mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export const fmtMB = (mb: number) => fmtBytes(mb * 1e6);
