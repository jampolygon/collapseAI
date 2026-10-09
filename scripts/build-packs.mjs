/**
 * Build knowledge packs:  content/*.md  ->  public/packs/*.json  (+ sizes.json)
 *
 * Usage:  node scripts/build-packs.mjs [--check]
 *
 * Zero dependencies. This is a direct port of the original build_packs.py so that
 * `public/packs/*.json` stays byte-identical (same key order, same 1-space indent,
 * same non-ASCII handling, no trailing newline) while running on machines without Python.
 *
 * Markdown format (one file per pack):
 *
 *     ---
 *     id: first-aid
 *     name: First Aid
 *     license: ...
 *     version: 1              # optional, defaults to 1
 *     keywords: bleed, wound  # optional, pack-level search hints
 *     updated: 2026-01-01     # optional, defaults to today (build date)
 *     last_verified: 2026-01-01  # optional, inherited by every article that does not set its own
 *     ---
 *
 *     # Article title
 *     category: First aid
 *     source: Where it comes from
 *     tags: bleeding, wound, tourniquet
 *     disaster_types: accident
 *     last_verified: 2026-01-01
 *
 *     Article text, paragraphs separated by blank lines...
 *
 * `tags` / `disaster_types` are comma-separated lists; they feed retrieval filtering
 * and the Library's category filters (see ROADMAP 2A / 2B). They are optional, so packs
 * written before the schema extension keep loading unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = resolve(ROOT, 'content');
const OUT = resolve(ROOT, 'public', 'packs');

/** Recognised per-article metadata keys. */
const ARTICLE_KEYS = new Set(['category', 'source', 'tags', 'disaster_types', 'last_verified']);

/** Matches a `key: value` article metadata line (key must start the line). */
const ARTICLE_FIELD_RE = /^(category|source|tags|disaster_types|last_verified):/;

/**
 * Slugify a title the same way Python's
 * `re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")` did.
 */
export function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
}

/**
 * Parse `---\n...\n---\n` frontmatter into a plain object, mirroring the Python
 * `dict(line.split(":", 1) for line in ...)` behaviour: only the first colon separates
 * key from value, so `license: CC BY-SA 4.0, x: y` keeps its inner colons.
 */
export function parseFrontmatter(header, file = '<string>') {
  const meta = {};
  for (const line of header.trim().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at === -1) throw new Error(`${file}: frontmatter line has no "key: value": ${JSON.stringify(line)}`);
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return meta;
}

/** Split a comma-separated metadata value into a clean list. Returns undefined when empty. */
function list(value) {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}


/**
 * Parse one pack markdown file into the pack object.
 * @param {string} raw file contents (any line endings)
 * @param {string} file path, used in error messages only
 * @param {string} today build date (YYYY-MM-DD), injected so tests stay deterministic
 */
export function parse(raw, file = '<string>', today = new Date().toISOString().slice(0, 10)) {
  // Normalise newlines: Node keeps \r\n, Python's universal newlines did not.
  const text = raw.replace(/\r\n/g, '\n');

  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error(`${file}: missing --- header ---`);
  const meta = parseFrontmatter(m[1], file);
  const body = text.slice(m.index + m[0].length);

  const articles = [];
  // Split on lines beginning with "# ", skipping the empty piece before the first one.
  for (const block of body.split(/^# /m).slice(1)) {
    const lines = block.trim().split('\n');
    const title = lines[0].trim();

    const fields = {};
    let i = 1;
    while (i < lines.length && ARTICLE_FIELD_RE.test(lines[i])) {
      const at = lines[i].indexOf(':');
      const key = lines[i].slice(0, at).trim();
      if (ARTICLE_KEYS.has(key)) fields[key] = lines[i].slice(at + 1).trim();
      i++;
    }

    const article = {
      id: slug(title),
      title,
      category: fields.category || meta.name || '',
      source: fields.source || '',
    };
    // Optional metadata in a stable order; `text` always stays last.
    if (fields.tags) article.tags = list(fields.tags);
    if (fields.disaster_types) article.disaster_types = list(fields.disaster_types);
    // An article may override the pack-wide verification date; otherwise it inherits it.
    const lastVerified = fields.last_verified || meta.last_verified;
    if (lastVerified) article.last_verified = lastVerified;
    article.text = lines.slice(i).join('\n').trim();

    if (!article.id) throw new Error(`${file}: article title "${title}" has no slug-able characters`);
    articles.push(article);
  }

  if (articles.length === 0) throw new Error(`${file}: no articles found`);

  // Duplicate ids would silently collide in the search index, so fail loudly instead.
  const seen = new Set();
  for (const a of articles) {
    if (seen.has(a.id)) throw new Error(`${file}: duplicate article id "${a.id}"`);
    seen.add(a.id);
  }

  const pack = {
    id: meta.id,
    name: meta.name,
    version: Number(meta.version ?? 1),
    license: meta.license || '',
  };
  if (meta.keywords) pack.keywords = list(meta.keywords);
  pack.updated = meta.updated || today;
  pack.articles = articles;

  if (!pack.id) throw new Error(`${file}: frontmatter is missing "id"`);
  if (!pack.name) throw new Error(`${file}: frontmatter is missing "name"`);
  if (!Number.isInteger(pack.version) || pack.version < 1) {
    throw new Error(`${file}: "version" must be a positive integer, got ${JSON.stringify(meta.version)}`);
  }

  return pack;
}

/** Serialise exactly like Python's json.dumps(..., ensure_ascii=False, indent=1). */
export const toJson = (pack) => JSON.stringify(pack, null, 1);

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  mkdirSync(OUT, { recursive: true });

  const sizes = {};
  let stale = 0;

  for (const md of readdirSync(SRC).sort()) {
    if (!md.endsWith('.md')) continue;
    const src = resolve(SRC, md);
    const pack = parse(readFileSync(src, 'utf8'), src);
    const json = toJson(pack);
    const dest = resolve(OUT, `${pack.id}.json`);

    if (check) {
      let same = false;
      try {
        same = readFileSync(dest, 'utf8') === json;
      } catch {
        same = false;
      }
      if (same) continue;
      console.error(`out of date: public/packs/${pack.id}.json  (run "npm run packs")`);
      stale++;
      continue;
    }

    writeFileSync(dest, json, 'utf8');
    sizes[pack.id] = Buffer.byteLength(json, 'utf8');
    console.log(`public/packs/${pack.id}.json: ${pack.articles.length} articles, ${(sizes[pack.id] / 1000).toFixed(1)} KB`);
  }

  if (check) {
    if (stale) process.exit(1);
    console.log('packs are up to date');
    return;
  }

  // Byte sizes the app reads, so Prepare can show real totals instead of hard-coded guesses.
  writeFileSync(resolve(OUT, 'sizes.json'), toJson(sizes), 'utf8');
  console.log('public/packs/sizes.json written');
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) main();
