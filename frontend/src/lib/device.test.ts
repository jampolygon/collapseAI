import { describe, expect, it } from 'vitest';
import { fmtBytes, fmtMB, recommendModel, type DeviceInfo } from './device';
import { MODELS, PACKS } from './catalog';

const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  ramGB: 4,
  ramKnown: true,
  cores: 4,
  webgpu: false,
  mobile: false,
  freeStorageMB: 5000,
  multithread: true,
  ...over,
});

describe('recommendModel', () => {
  it('only ever recommends models that exist in the catalog', () => {
    for (const d of [
      device(),
      device({ mobile: true, ramGB: 1, cores: 2 }),
      device({ mobile: true, ramGB: 3, cores: 4 }),
      device({ mobile: true, ramGB: 8, cores: 8 }),
      device({ webgpu: true, ramGB: 16, cores: 12 }),
      device({ ramGB: 2 }),
    ]) {
      expect(MODELS).toContain(recommendModel(d).model);
    }
  });

  it('gives a strong phone the balanced 1.2B model', () => {
    const r = recommendModel(device({ mobile: true, ramGB: 6, cores: 8 }));
    expect(r.model.id).toBe('lfm25-1.2b');
    expect(r.reason).toMatch(/6\+ GB/);
  });

  it('gives a mid phone the small 0.8B model', () => {
    expect(recommendModel(device({ mobile: true, ramGB: 3, cores: 4 })).model.id).toBe('qwen35-0.8b');
  });

  it('gives a weak phone the lightest model', () => {
    expect(recommendModel(device({ mobile: true, ramGB: 2, cores: 4 })).model.id).toBe('lfm25-350m');
    expect(recommendModel(device({ mobile: true, ramGB: 1, cores: 2 })).model.id).toBe('lfm25-350m');
  });

  it('never hands a phone a 2B+ model, because phones are CPU-bound', () => {
    const r = recommendModel(device({ mobile: true, ramGB: 8, cores: 8 }));
    expect(r.model.sizeMB).toBeLessThan(1000);
  });

  it('gives a GPU computer the smart model', () => {
    expect(recommendModel(device({ webgpu: true, ramGB: 8 })).model.id).toBe('qwen35-2b');
  });

  it('gives a CPU-only computer the balanced model', () => {
    expect(recommendModel(device({ ramGB: 4 })).model.id).toBe('lfm25-1.2b');
    expect(recommendModel(device({ ramGB: 16, webgpu: false })).model.id).toBe('lfm25-1.2b');
  });

  it('gives a computer with little memory the small model', () => {
    expect(recommendModel(device({ ramGB: 2 })).model.id).toBe('qwen35-0.8b');
  });
});

describe('fmtBytes', () => {
  it('uses KB below 1 MB', () => {
    expect(fmtBytes(0)).toBe('0 KB');
    expect(fmtBytes(999_000)).toBe('999 KB');
  });

  it('uses MB below 1000 MB', () => {
    // `+mb.toFixed(1)` drops a trailing .0, so whole megabytes print without a decimal.
    expect(fmtBytes(1_000_000)).toBe('1 MB');
    expect(fmtBytes(2_500_000)).toBe('2.5 MB');
    expect(fmtBytes(9_912_000)).toBe('9.9 MB');
    expect(fmtBytes(100_000_000)).toBe('100 MB');
  });

  it('uses GB from 1000 MB up', () => {
    expect(fmtBytes(1_000_000_000)).toBe('1.0 GB');
    expect(fmtBytes(2_019_000_000)).toBe('2.0 GB');
  });
});

describe('fmtMB', () => {
  it('is fmtBytes of megabytes', () => {
    expect(fmtMB(0.005)).toBe('5 KB');
    expect(fmtMB(1.5)).toBe('1.5 MB');
    expect(fmtMB(2019)).toBe('2.0 GB');
  });
});

describe('pack catalog sizes', () => {
  it('reports the real measured size of every built pack, not a guess', () => {
    for (const p of PACKS) {
      // Built packs are KB to a few MB (Wikipedia packs are the largest, ~1.7 MB). The old
      // hard-coded guesses were 15-40 MB, so anything that large means sizes.json is stale.
      expect(p.sizeMB, `${p.id} sizeMB`).toBeGreaterThan(0);
      expect(p.sizeMB, `${p.id} sizeMB`).toBeLessThan(5);
    }
  });

  it('has no duplicate pack or model ids', () => {
    const ids = PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mids = MODELS.map((m) => m.id);
    expect(new Set(mids).size).toBe(mids.length);
  });
});
