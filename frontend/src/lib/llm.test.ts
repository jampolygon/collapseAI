import { afterEach, describe, expect, it, vi } from 'vitest';
import { gpuEnabled, looksSane, setGpuEnabled } from './llm';

const store = new Map<string, string>();
const phone = 'Mozilla/5.0 (Linux; Android 15; Infinix X6870) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

function env(userAgent: string) {
  store.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  vi.stubGlobal('navigator', { userAgent });
}

afterEach(() => vi.unstubAllGlobals());

describe('GPU default', () => {
  it('is off on phones and on for computers until the user chooses', () => {
    env(phone);
    expect(gpuEnabled()).toBe(false);
    env(desktop);
    expect(gpuEnabled()).toBe(true);
  });
  it('respects a saved choice, including turning the GPU on for a phone', () => {
    env(phone);
    setGpuEnabled(true);
    expect(gpuEnabled()).toBe(true);
    setGpuEnabled(false);
    expect(gpuEnabled()).toBe(false);
  });
});

describe('looksSane (GPU self-test)', () => {
  it('accepts a normal answer', () => {
    expect(looksSane('OK')).toBe(true);
    expect(looksSane(' Ok.\n')).toBe(true);
  });
  it('rejects empty output, other scripts and symbol garbage', () => {
    expect(looksSane('')).toBe(false);
    expect(looksSane('好的，我明白了')).toBe(false);
    expect(looksSane('OK 好的')).toBe(false);
    expect(looksSane('@@@@####')).toBe(false);
  });
});
