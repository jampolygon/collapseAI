import { describe, expect, it } from 'vitest';
import { parse, parseFrontmatter, slug, toJson } from './build-packs.mjs';

const pack = (body, meta = {}) =>
  `---\nid: test\nname: Test Pack\nlicense: MIT\n${Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body}`;

describe('slug', () => {
  it('lowercases and hyphenates, matching the Python implementation', () => {
    expect(slug('Severe bleeding')).toBe('severe-bleeding');
    expect(slug('Typhoon: before, during and after')).toBe('typhoon-before-during-and-after');
    expect(slug('CPR (cardiopulmonary resuscitation)')).toBe('cpr-cardiopulmonary-resuscitation');
  });

  it('strips leading and trailing separators', () => {
    expect(slug('  ...Wound care!  ')).toBe('wound-care');
    expect(slug('Dehydration and oral rehydration solution (ORS)')).toBe('dehydration-and-oral-rehydration-solution-ors');
  });
});

describe('parseFrontmatter', () => {
  it('splits on the first colon only, so licenses keep their punctuation', () => {
    const meta = parseFrontmatter('license: CC BY-SA 4.0, x: y\nname: A B');
    expect(meta).toEqual({ license: 'CC BY-SA 4.0, x: y', name: 'A B' });
  });

  it('rejects a line with no colon', () => {
    expect(() => parseFrontmatter('just words')).toThrow(/no "key: value"/);
  });
});

describe('parse', () => {
  it('splits a file into articles and keeps paragraphs intact', () => {
    const p = parse(pack('# First aid\ncategory: First aid\nsource: WHO\n\nLine one.\n\nLine two.'));
    expect(p.id).toBe('test');
    expect(p.articles).toHaveLength(1);
    expect(p.articles[0]).toMatchObject({
      id: 'first-aid',
      title: 'First aid',
      category: 'First aid',
      source: 'WHO',
      text: 'Line one.\n\nLine two.',
    });
  });

  it('falls back to the pack name when an article has no category', () => {
    const p = parse(pack('# Untitled one\n\nBody.'));
    expect(p.articles[0].category).toBe('Test Pack');
    expect(p.articles[0].source).toBe('');
  });

  it('parses tags and disaster_types as comma-separated lists', () => {
    const p = parse(
      pack('# Flood safety\ncategory: Disasters\ntags: flood, baha , water\ndisaster_types: flood,typhoon\nlast_verified: 2026-01-15'),
    );
    expect(p.articles[0].tags).toEqual(['flood', 'baha', 'water']);
    expect(p.articles[0].disaster_types).toEqual(['flood', 'typhoon']);
    expect(p.articles[0].last_verified).toBe('2026-01-15');
  });

  it('lets every article inherit the pack-wide last_verified date', () => {
    const p = parse(pack('# A\n\nx\n\n# B\n\nx', { last_verified: '2026-02-02' }));
    expect(p.articles.map((a) => a.last_verified)).toEqual(['2026-02-02', '2026-02-02']);
  });

  it('lets an article override the pack-wide last_verified date', () => {
    const p = parse(
      pack('# A\nlast_verified: 2025-01-01\n\nx\n\n# B\n\nx', { last_verified: '2026-02-02' }),
    );
    expect(p.articles.map((a) => a.last_verified)).toEqual(['2025-01-01', '2026-02-02']);
  });

  it('omits optional metadata entirely when absent', () => {
    const p = parse(pack('# Burns\ncategory: First aid'));
    expect(p.articles[0]).not.toHaveProperty('tags');
    expect(p.articles[0]).not.toHaveProperty('disaster_types');
    expect(p.articles[0]).not.toHaveProperty('last_verified');
    expect(Object.keys(p.articles[0]).at(-1)).toBe('text');
  });

  it('defaults version to 1 and honours an explicit version', () => {
    expect(parse(pack('# A\n\nx')).version).toBe(1);
    expect(parse(pack('# A\n\nx', { version: 2 })).version).toBe(2);
  });

  it('uses the injected build date when updated is not given', () => {
    expect(parse(pack('# A\n\nx'), 'f.md', '2026-03-04').updated).toBe('2026-03-04');
    expect(parse(pack('# A\n\nx', { updated: '2025-12-31' }), 'f.md', '2026-03-04').updated).toBe('2025-12-31');
  });

  it('ignores metadata-like lines that appear in the body', () => {
    const p = parse(pack('# A\n\ncategory: not a header\n\nStill body.'));
    expect(p.articles[0].category).toBe('Test Pack');
    expect(p.articles[0].text).toBe('category: not a header\n\nStill body.');
  });

  it('normalises CRLF line endings', () => {
    const p = parse('---\r\nid: test\r\nname: Test Pack\r\n---\r\n\r\n# Title\r\ncategory: C\r\n\r\nBody.\r\n');
    expect(p.articles[0].title).toBe('Title');
    expect(p.articles[0].text).toBe('Body.');
    expect(p.articles[0].category).toBe('C');
  });

  it('throws when the frontmatter header is missing', () => {
    expect(() => parse('# No header\n\nBody')).toThrow(/missing --- header ---/);
  });

  it('throws on duplicate article ids instead of silently colliding', () => {
    expect(() => parse(pack('# Wound Care\n\none\n\n# Wound care\n\ntwo'))).toThrow(/duplicate article id/);
  });

  it('throws when a pack has no articles', () => {
    expect(() => parse(pack(''))).toThrow(/no articles found/);
  });

  it('throws when required frontmatter is missing', () => {
    expect(() => parse('---\nname: Only name\n---\n\n# A\n\nx')).toThrow(/missing "id"/);
    expect(() => parse('---\nid: only-id\n---\n\n# A\n\nx')).toThrow(/missing "name"/);
  });

  it('rejects a non-integer version', () => {
    expect(() => parse(pack('# A\n\nx', { version: 'one' }))).toThrow(/positive integer/);
  });
});

describe('toJson', () => {
  it('matches Python json.dumps(indent=1): 1-space indent, no BOM, no trailing newline', () => {
    const json = toJson({ id: 'a', name: 'B', version: 1, updated: '2026-01-01', articles: [{ id: 'x' }] });
    expect(json).toBe(
      ['{', ' "id": "a",', ' "name": "B",', ' "version": 1,', ' "updated": "2026-01-01",', ' "articles": [', '  {', '   "id": "x"', '  }', ' ]', '}'].join('\n'),
    );
    expect(json.endsWith('\n')).toBe(false);
    expect(json).toContain('"version": 1,'); // compact separator, as Python emits
  });

  it('preserves non-ASCII characters unescaped (ensure_ascii=False)', () => {
    expect(toJson({ s: 'bulkan · abo — baha' })).toContain('bulkan · abo — baha');
    expect(toJson({ s: 'bulkan' })).not.toContain('\\u');
  });

  it('orders pack keys as id, name, version, license, keywords, updated, articles', () => {
    const p = parse(pack('# A\n\nx', { keywords: 'a, b' }));
    expect(Object.keys(p)).toEqual(['id', 'name', 'version', 'license', 'keywords', 'updated', 'articles']);
  });
});
