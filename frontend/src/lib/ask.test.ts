import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ask, NO_INFO, retrieve, type HistoryTurn } from './ask';
import { indexPacks, search, type Pack } from './knowledge';

// The real, built packs: these tests guard the "hello gives random survival tips" bug.
beforeAll(() => {
  const ids = ['first-aid', 'survival', 'disasters', 'medicine', 'food', 'engineering'];
  indexPacks(ids.map((id) => JSON.parse(readFileSync(`public/packs/${id}.json`, 'utf8')) as Pack));
});

const run = async (q: string, history: HistoryTurn[] = []) => {
  let text = '';
  const res = await ask(q, { onSources: () => {}, onToken: (t) => (text += t), history });
  return { ...res, text };
};

describe('search relevance (real packs)', () => {
  it('finds nothing for greetings, chit-chat and off-topic questions', () => {
    for (const q of ['hello', 'hello po', 'hi', 'how are you', 'what is your name', 'tell me a joke', 'what is the capital of France', 'bitcoin price', 'nearest hospital']) {
      expect(search(q), q).toEqual([]);
    }
  });
  it('still finds real survival questions in English and Taglish', () => {
    expect(search('how do I stop heavy bleeding')[0].articleId).toBe('severe-bleeding');
    expect(search('paano gamutin ang sugat')[0].articleId).toBe('severe-bleeding');
    expect(search('may lagnat ang anak ko')[0].articleId).toBe('fever');
    expect(search('snake bite')[0].articleId).toBe('snake-bite');
    expect(search('CPR')[0].articleId).toContain('cpr');
  });
  it('does not confuse flood with food', () => {
    expect(search('ano gagawin pag may baha')[0].articleId).toBe('flood-safety');
  });
});

describe('ask without a loaded model', () => {
  it('answers a greeting directly with no references', async () => {
    const r = await run('hello');
    expect(r.kind).toBe('smalltalk');
    expect(r.sources).toEqual([]);
    expect(r.text).toMatch(/CollapseAI/);
  });
  it('says it has no information instead of citing unrelated articles', async () => {
    const r = await run('what is the price of bitcoin');
    expect(r.kind).toBe('no-info');
    expect(r.sources).toEqual([]);
    expect(r.text).toBe(NO_INFO);
  });
  it('returns the matching library passages for a real question', async () => {
    const r = await run('how do I stop heavy bleeding');
    expect(r.kind).toBe('answer');
    expect(r.sources[0].articleId).toBe('severe-bleeding');
  });
});

describe('follow-up questions use the previous question', () => {
  const history: HistoryTurn[] = [{ q: 'my child has a fever', a: '1. Give fluids.', hadSources: true }];
  it('"what about kids?" alone finds nothing, but with history it stays on the fever topic', () => {
    expect(retrieve('what about kids?', [])).toEqual([]);
    expect(retrieve('what about kids?', history)[0].articleId).toBe('fever');
  });
  it('ignores history that was only small talk or "no info"', () => {
    const talk: HistoryTurn[] = [{ q: 'hello', a: 'Hi!', hadSources: false }];
    expect(retrieve('what about kids?', talk)).toEqual([]);
  });
  it('a new, clear topic is not mixed with the previous one', () => {
    expect(retrieve('how do I stop heavy bleeding', history)[0].articleId).toBe('severe-bleeding');
  });
});
