import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ask, buildMessages, NO_INFO, retrieve, type HistoryTurn } from './ask';
import { historicalPassage, indexPacks, search, searchTerms, type Pack } from './knowledge';

// The real, built packs: these tests guard the "hello gives random survival tips" bug.
beforeAll(() => {
  const ids = ['first-aid', 'survival', 'disasters', 'medicine', 'food', 'engineering', 'wikipedia-essentials', 'wikipedia-prepared', 'wikipedia-full'];
  indexPacks(ids.map((id) => JSON.parse(readFileSync(`public/packs/${id}.json`, 'utf8')) as Pack));
});

const run = async (q: string, history: HistoryTurn[] = []) => {
  let text = '';
  const res = await ask(q, { onSources: () => {}, onToken: (t) => (text += t), history });
  return { ...res, text };
};

describe('search relevance (real packs)', () => {
  it('prioritizes present earthquake actions for a Taglish earthquake/power-loss question', () => {
    const q = 'may lindol at walang kuryente. ano muna ang dapat naming gawin';
    const hits = search(q);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(3);
    expect(hits[0].articleId).toBe('earthquake-duck-cover-and-hold');
    expect(hits[0].text).toMatch(/DUCK|COVER|HOLD|After shaking/);
    expect(hits.some(historicalPassage)).toBe(false);
    expect(searchTerms(q)).toContain('power');
    expect(searchTerms(q)).not.toContain('naming');
  });
  it('returns actionable references for an English earthquake/power-loss request', () => {
    const hits = search('What should I prioritize after an earthquake if electricity is unavailable?');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(3);
    expect(hits[0].articleId).toBe('earthquake-duck-cover-and-hold');
    expect(hits.some(p => /aftershocks|battery radio|injuries/i.test(p.text))).toBe(true);
    expect(hits.some(historicalPassage)).toBe(false);
  });
  it('does not send earthquake context for a burn question or fill weak results to three', () => {
    const hits = search('Paano gamutin ang paso?');
    expect(hits[0].articleId).toBe('burns');
    expect(hits.some(p => /earthquake/i.test(p.title))).toBe(false);
    expect(search('qzxv blorf zzz')).toEqual([]);
  });
  it('preserves historical lookup when the question is actually about an event', () => {
    expect(search('Tell me about the 1990 Luzon earthquake')[0].articleId).toBe('1990-luzon-earthquake');
  });
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
  it('uses Wikipedia for topics the team guides lack, but ranks the team guides first', () => {
    expect(search('cholera')[0].packId).toMatch(/^wikipedia-/);
    expect(search('what is a tsunami')[0].packId).toMatch(/^wikipedia-/);
    expect(search('fever')[0].packId).toBe('medicine');
  });
  it('does not confuse flood with food', () => {
    expect(search('ano gagawin pag may baha')[0].articleId).toBe('flood-safety');
  });
});

describe('production prompt construction without inference', () => {
  it('grounds the current emergency in the filtered references instead of summarizing history', () => {
    const question = 'may lindol at walang kuryente. ano muna ang dapat naming gawin';
    const sources = retrieve(question);
    const messages = buildMessages(question, sources);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('present emergency');
    expect(messages[0].content).toContain('Do not retell historical disasters');
    expect(messages.at(-1)?.content).toContain(question);
    for (const source of sources) expect(messages.at(-1)?.content).toContain(source.text);
    expect(messages.at(-1)?.content).not.toMatch(/1990 Luzon|2013 Bohol/);
  });
  it('keeps the existing cautious general-knowledge path when no reference matches', () => {
    const messages = buildMessages('qzxv blorf zzz', []);
    expect(messages[0].content).toContain('None of the downloaded survival guides');
    expect(messages[0].content).toContain('If you are not sure');
    expect(messages.at(-1)?.content).toBe('qzxv blorf zzz');
    expect(messages.at(-1)?.content).not.toContain('Reference information:');
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
