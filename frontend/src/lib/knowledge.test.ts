import { describe, expect, it } from 'vitest';
import { chunk, expandQuery, indexPacks, search, type Article, type Pack } from './knowledge';

const article = (over: Partial<Article> = {}): Article => ({
  id: 'a',
  title: 'Severe bleeding',
  category: 'First aid',
  text: 'Press hard on the wound with a clean cloth for at least ten minutes.',
  ...over,
});

const pack = (articles: Article[], over: Partial<Pack> = {}): Pack => ({
  id: 'first-aid',
  name: 'First Aid',
  version: 1,
  updated: '2026-01-01',
  articles,
  ...over,
});

/** Paragraphs of a given length, so chunking boundaries are predictable. */
const para = (n: number) => `${'x'.repeat(n - 4)} end`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('chunk', () => {
  it('keeps a short article as a single passage', () => {
    const out = chunk(pack([article()]), article());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'first-aid/a#0',
      packId: 'first-aid',
      articleId: 'a',
      title: 'Severe bleeding',
      category: 'First aid',
    });
  });

  it('splits on paragraph boundaries and stays under the 600-char target', () => {
    const a = article({ text: [para(500), para(500), para(500)].join('\n\n') });
    const out = chunk(pack([a]), a);
    expect(out.length).toBeGreaterThan(1);
    for (const p of out) expect(p.text.length).toBeLessThanOrEqual(600);
    // No text may be lost or duplicated by the split.
    expect(out.map((p) => p.text).join('\n\n')).toBe(a.text);
  });

  it('never splits a single paragraph, even when it exceeds the target', () => {
    const a = article({ text: words(200) });
    const out = chunk(pack([a]), a);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(a.text);
  });

  it('carries tags, disaster_types, last_verified and source onto every passage', () => {
    const a = article({
      source: 'WHO',
      tags: ['bleeding', 'wound'],
      disaster_types: ['accident'],
      last_verified: '2026-01-15',
      text: [para(500), para(500)].join('\n\n'),
    });
    const out = chunk(pack([a]), a);
    expect(out.length).toBeGreaterThan(1);
    for (const p of out) {
      expect(p.source).toBe('WHO');
      expect(p.tags).toEqual(['bleeding', 'wound']);
      expect(p.disaster_types).toEqual(['accident']);
      expect(p.last_verified).toBe('2026-01-15');
    }
  });

  it('omits metadata keys the article does not define', () => {
    const out = chunk(pack([article()]), article());
    expect(out[0]).not.toHaveProperty('tags');
    expect(out[0]).not.toHaveProperty('disaster_types');
    expect(out[0]).not.toHaveProperty('last_verified');
  });

  it('numbers passages so ids stay unique', () => {
    const a = article({ text: [para(500), para(500)].join('\n\n') });
    const ids = chunk(pack([a]), a).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('expandQuery', () => {
  it('maps Tagalog words to English search terms', () => {
    expect(expandQuery('sugat')).toBe('wound cut bleeding');
    expect(expandQuery('lindol')).toBe('earthquake');
  });

  it('maps several Tagalog words in one Taglish query', () => {
    expect(expandQuery('malalim na sugat at dugo')).toBe('malalim wound cut bleeding at blood bleeding');
  });

  it('leaves words that have no mapping in place, rather than dropping them', () => {
    // 'malalim' (deep) is not yet in the map, so it survives into the query untouched.
    expect(expandQuery('malalim na sugat')).toBe('malalim wound cut bleeding');
  });

  it('drops stopwords rather than leaving them in the query', () => {
    expect(expandQuery('paano ang tubig')).toBe('water');
    expect(expandQuery('ano ang gamot sa sakit')).toBe('medicine treatment illness pain');
  });

  it('keeps English words untouched and lowercases them', () => {
    expect(expandQuery('Stop Heavy BLEEDING')).toBe('stop heavy bleeding');
  });

  it('ignores punctuation and emoji', () => {
    expect(expandQuery('sugat!!! 🩹 dugo?')).toBe('wound cut bleeding blood bleeding');
  });

  it('returns an empty string when nothing is searchable', () => {
    expect(expandQuery('paano ang mga ng sa na')).toBe('');
    expect(expandQuery('   ')).toBe('');
  });
});


describe('indexPacks / search', () => {
  const packs = [
    pack([
      article({ id: 'bleeding', title: 'Severe bleeding', text: 'Press hard on the wound. Use a tourniquet only for life-threatening limb bleeding.', tags: ['bleeding'], disaster_types: ['accident'] }),
      article({ id: 'cpr', title: 'CPR', text: 'Push hard and fast in the centre of the chest, 100 to 120 times per minute.', tags: ['cpr'] }),
    ]),
    {
      id: 'disasters',
      name: 'Disasters',
      version: 1,
      articles: [
        {
          id: 'flood',
          title: 'Flood safety',
          category: 'Disasters',
          text: 'Move to higher ground. Never walk through moving water.',
          disaster_types: ['flood', 'typhoon'],
        },
      ],
    },
  ];

  it('reports how many passages and articles were indexed', () => {
    const r = indexPacks(packs);
    expect(r.articles).toBe(3);
    expect(r.passages).toBe(3);
  });

  it('returns real passages, not just ids', () => {
    const hits = search('bleeding');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toBeTruthy();
    expect(hits[0].text).toBeTruthy();
  });

  it('ranks the matching article first', () => {
    expect(search('tourniquet limb')[0].articleId).toBe('bleeding');
  });

  it('finds articles by their Tagalog name', () => {
    expect(search('baha')[0].articleId).toBe('flood');
  });

  it('respects the k limit', () => {
    expect(search('bleeding chest water', 1)).toHaveLength(1);
    expect(search('bleeding chest water', 99).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for a query of only stopwords', () => {
    expect(search('paano ang mga')).toEqual([]);
  });

  it('returns nothing before any pack is indexed', () => {
    indexPacks([]);
    expect(search('bleeding')).toEqual([]);
  });

  it('re-indexes cleanly when the downloaded packs change', () => {
    indexPacks(packs);
    expect(search('tourniquet')[0].articleId).toBe('bleeding');
    indexPacks([packs[1]]);
    expect(search('tourniquet')).toEqual([]);
    expect(search('higher ground')[0].articleId).toBe('flood');
  });
});
