import { describe, expect, it } from 'vitest';
import { QUESTIONS, score, summary, toMarkdown, type BenchResult } from './bench';

describe('benchmark scoring', () => {
  it('gives full marks only when every fact group is present', () => {
    const burn = QUESTIONS.find((q) => q.id === 'burn')!;
    expect(score('Cool the burn under running water for 20 minutes and cover it loosely.', burn.expect)).toBe(1);
    expect(score('Cool the burn.', burn.expect)).toBeCloseTo(1 / 3);
    expect(score('', burn.expect)).toBe(0);
  });

  it('does not count a wrong number that merely contains the right digits', () => {
    // Signal 4 speeds (118–184 km/h) must not pass as Signal 3 (89–117 km/h, 18 hours)
    const s3 = QUESTIONS.find((q) => q.id === 'signal3')!;
    expect(score('Typhoon-force winds of 118–184 km/h within 12 hours.', s3.expect)).toBe(0);
    expect(score('Storm-force winds of 89–117 km/h expected within 18 hours.', s3.expect)).toBe(1);
  });

  it('summarizes and exports results', () => {
    const r: BenchResult = {
      modelId: 'm',
      modelName: 'Test',
      family: 'Fam',
      device: 'dev',
      date: '2026-10-09',
      loadSeconds: 2,
      answers: [
        { id: 'a', answer: 'x', score: 1, seconds: 4, promptPerSec: 100, genPerSec: 10, genTokens: 50 },
        { id: 'b', answer: 'y', score: 0, seconds: 6, promptPerSec: 100, genPerSec: 20, genTokens: 30 },
      ],
    };
    expect(summary(r).score).toBe(0.5);
    expect(summary(r).seconds).toBe(5);
    expect(toMarkdown([r])).toContain('| Test (Fam) | 50% | 5.0 s |');
  });
});
