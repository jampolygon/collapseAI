import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const stored = new Map();
globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, storage: { persist: async () => true } } });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

// No browser or listening server. Compile TSX once for React server rendering.
const entryFile = path.join(root, 'tests/.ui-test-entry.ts');
const compiledFile = path.join(root, 'tests/.ui-test-generated.mjs');
after(() => { for (const file of [entryFile, compiledFile]) if (fs.existsSync(file)) fs.unlinkSync(file); });
fs.writeFileSync(entryFile, `
  export { RichText } from '../src/components/RichText';
  export { default as Ask } from '../src/views/Ask';
  export { default as Prepare } from '../src/views/Prepare';
  export { default as Library } from '../src/views/Library';
  export { default as Tools } from '../src/views/Tools';
  export { default as App } from '../src/App';
  export { default as Survive } from '../src/views/Survive';
  export { default as Compass } from '../src/views/Compass';
  export { Skeleton } from '../src/components/Skeleton';
`);
const result = await build({ root, configFile: false, plugins: [react()], logLevel: 'silent', build: { ssr: entryFile, write: false, minify: false } });
fs.writeFileSync(compiledFile, result.output.find(item => item.type === 'chunk' && item.isEntry).code);
const { RichText, Ask, Prepare, Library, Tools, App, Survive, Compass, Skeleton } = await import(pathToFileURL(compiledFile).href);
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const noop = () => {};

test('Compass loads SunCalc named exports and renders solar data', () => {
  stored.set('cai.lastfix', JSON.stringify({ lat: 14.6, lon: 120.98, accuracy: 10, time: Date.now() }));
  try {
    const html = render(Compass);
    assert.match(html, /Find your way/);
    assert.match(html, /Sunrise/);
    assert.match(html, /Sunset/);
    assert.doesNotMatch(html, /NaN|Invalid Date|Needs your location/);
  } finally {
    stored.delete('cai.lastfix');
  }
});

test('startup defaults to light, migrates system preference, and preserves explicit dark', () => {
  const script = read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [saved, dark, expected] of [[null, true, 'light'], [null, false, 'light'], ['light', true, 'light'], ['dark', false, 'dark'], ['system', true, 'light'], ['invalid', false, 'light']]) {
    const element = { dataset: {}, style: {} };
    const meta = {};
    vm.runInNewContext(script, { localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: dark }), document: { documentElement: element, querySelector: () => meta } });
    assert.equal(element.dataset.theme, expected);
    assert.equal(meta.content, expected === 'dark' ? '#151515' : '#fafafa');
  }
  const element = { dataset: {}, style: {} };
  vm.runInNewContext(script, { localStorage: { getItem: () => { throw new Error('blocked'); } }, matchMedia: () => ({ matches: true }), document: { documentElement: element, querySelector: () => ({}) } });
  assert.equal(element.dataset.theme, 'light');
});

test('sidebar appearance has only light and dark; loading has named skeletons', () => {
  stored.set('cai.theme', 'system');
  const html = render(App);
  assert.match(html, /<option value="light" selected="">Light theme/);
  assert.match(html, /<option value="dark">Dark theme/);
  assert.doesNotMatch(html, /System theme|value="system"/);
  for (const label of ['Ask', 'Prepare', 'Library', 'Tools', 'Map', 'Collapse sidebar']) assert.match(html, new RegExp(`aria-label="${label}"`));
  assert.match(html, /Checking your device/);
  assert.match(html, /skeleton-inline/);
  stored.clear();
});

test('skeletons communicate loading without inventing download progress', () => {
  const html = render(Skeleton, { label: 'Loading model', lines: 3 });
  assert.match(html, /role="status" aria-busy="true"/);
  assert.match(html, /Loading model/);
  assert.equal((html.match(/class="skeleton skeleton-line"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /progressbar|aria-valuenow/);
  const props = { downloads: [], packs: [], tab: 'library', onModelChange: noop, onGoPrepare: noop };
  const loading = render(Survive, { ...props, knowledgeLoading: true });
  const finished = render(Survive, { ...props, knowledgeLoading: false });
  assert.match(loading, /Loading your knowledge library/);
  assert.doesNotMatch(loading, /Your library is empty|No knowledge downloaded/);
  assert.match(finished, /Your library is empty/);
  assert.doesNotMatch(finished, /library-skeleton/);
});

test('generated content renders semantic steps and escapes executable markup', async () => {
  const html = render(RichText, { text: '# First action\n\n1. Apply **pressure**.\n2. Get help.\n\n- Stay calm.\n- Keep warm.\n\n> Warning: urgent\n\n<script>alert(1)</script>' });
  assert.match(html, /<h3>First action<\/h3>/);
  assert.match(html, /<ol start="1">/);
  assert.match(html, /<strong>pressure<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('downloaded model remains separate from a loaded AI in Ask', async () => {
  const empty = render(Ask, { downloads: [], onModelChange: noop, onGoPrepare: noop });
  assert.match(empty, /No model downloaded/);
  assert.match(empty, /<textarea/);
  assert.match(empty, /aria-label="Send question"/);
  const downloaded = render(Ask, { downloads: [{ key: 'model:qwen35-0.8b', status: 'done' }], onModelChange: noop, onGoPrepare: noop });
  assert.match(downloaded, /Spark/);
  assert.match(downloaded, /Start AI/);
  assert.match(downloaded, /Use GPU/);
  assert.doesNotMatch(downloaded, /status-value">Loaded/);
});

test('Prepare exposes cache, model and knowledge independently, with real download errors/actions', async () => {
  stored.set('cai.prep.model', JSON.stringify('qwen35-0.8b'));
  const system = { appCache: 'missing', engineCache: 'partial', storage: { usage: 12000000, quota: 1000000000 }, cacheError: null };
  const downloads = [
    { key: 'model:qwen35-0.8b', label: 'AI: Spark', status: 'done', total: 533000000, done: 533000000 },
    { key: 'pack:first-aid', label: '🩹 First Aid', status: 'error', total: 4000000, done: 0, error: 'Storage is full.' },
    { key: 'pack:survival', label: 'Survival', status: 'downloading', total: 100, done: 40, speed: 10 },
  ];
  const html = render(Prepare, { downloads, online: false, onGoSurvive: noop, modelName: null, system });
  assert.match(html, /App shell/);
  assert.match(html, /role="status"/);
  assert.match(html, /class="banner-label">Offline<\/span>/);
  assert.match(html, /Not cached/);
  assert.match(html, /Model file/);
  assert.match(html, /Not loaded/);
  assert.match(html, /Storage is full/);
  assert.match(html, /Resume/);
  assert.match(html, /Pause/);
  assert.match(html, /Delete/);
  assert.match(html, /accept=".gguf"/);
  assert.match(html, /aria-valuenow="40"/);
  assert.match(html, /12 MB/);
  assert.doesNotMatch(html, /Ready offline|🩹/);
  stored.clear();
});

test('Library keeps search and both filters accessible without a model', async () => {
  const html = render(Library, { packs: [] });
  assert.match(html, /Search downloaded knowledge/);
  assert.match(html, /All packs/);
  assert.match(html, /All categories/);
  assert.match(html, /Your library is empty/);
});

test('Library exposes only available offline content and its supplied provenance', () => {
  const html = render(Library, { packs: [{
    id: 'first-aid', name: 'First Aid', version: 1,
    articles: [{ id: 'bleeding', title: 'Severe bleeding', category: 'First aid', text: 'Apply firm pressure.', source: 'WHO guide', last_verified: '2026-05-12' }],
  }] });
  assert.match(html, /Severe bleeding/);
  assert.match(html, /Available offline/);
  assert.match(html, /Source: WHO guide/);
  assert.match(html, /Last verified: 2026-05-12/);
});

test('Tools preserve stored checklist keys, water result and SOS control', async () => {
  stored.set('cai.gobag', JSON.stringify(['Phone with CollapseAI downloaded 😉']));
  const html = render(Tools);
  assert.match(html, /Start SOS/);
  assert.match(html, /Add <b>9 drops/);
  assert.match(html, /1\/12/);
  assert.match(html, /checked=""/);
  assert.doesNotMatch(html, /😉|🔦|💧|🎒/);
  stored.clear();
});

test('monochrome text tokens meet contrast in both themes', () => {
  const css = read('src/styles.css');
  const luminance = hex => {
    const expanded = hex.length === 4 ? '#' + [...hex.slice(1)].map(char => char + char).join('') : hex;
    const rgb = expanded.slice(1).match(/../g).map(value => Number.parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const tokenBlock of css.matchAll(/:root(?:\[data-theme='dark'\])?\s*\{([\s\S]*?)\}/g)) {
    const tokens = Object.fromEntries([...tokenBlock[1].matchAll(/--([\w-]+):\s*(#[\da-f]+)/g)].map(match => [match[1], match[2]]));
    for (const text of ['text', 'muted', 'subtle']) for (const bg of ['bg', 'surface', 'raised']) assert.ok(ratio(tokens[text], tokens[bg]) >= 4.5, `${text} on ${bg}: ${ratio(tokens[text], tokens[bg])}`);
    assert.ok(ratio(tokens.contrast, tokens['contrast-text']) >= 7);
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.icon-button\s*\{[^}]*width:\s*44px; height:\s*44px/);
  // answers must stay readable on phones: at least 16px (the text-size bump made it 17px)
  const answerSize = Number(css.match(/\.turn \.a\s*\{[^}]*font-size:\s*(\d+)px/)?.[1]);
  assert.ok(answerSize >= 16, `answer text is ${answerSize}px, expected at least 16px`);
});
