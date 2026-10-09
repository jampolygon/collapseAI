// Resumable download manager backed by the Origin Private File System (OPFS).
// - survives app restarts (progress kept in localStorage, bytes kept in OPFS)
// - resumes with HTTP Range requests after a dropped connection or a closed tab
// - each download is stored as 16 MB part files: a finished part is saved for good,
//   so a crash loses at most one part (OPFS only commits a file when it is closed)
// - one download at a time: gentler on weak phone connections

export type DLStatus = 'queued' | 'downloading' | 'paused' | 'error' | 'done';

export interface DLItem {
  key: string; // stable id, also the OPFS folder name
  label: string;
  url: string; // internet URL (absolute) or app-relative path
  total: number; // bytes, 0 = unknown
  done: number;
  status: DLStatus;
  error?: string;
  speed?: number; // bytes/s
  source?: 'internet' | 'app';
}

const LS_KEY = 'cai.downloads.v1';
const PART = 16 * 1024 * 1024;
type Listener = (items: DLItem[]) => void;

let items: DLItem[] = load();
const listeners = new Set<Listener>();
let active: { key: string; ctrl: AbortController } | null = null;
let wakeLock: any = null;
const ready = cleanup();

function load(): DLItem[] {
  try {
    const raw: DLItem[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    // anything that was mid-download when the app closed becomes "paused"
    return raw.map((i) => (i.status === 'downloading' || i.status === 'queued' ? { ...i, status: 'paused', speed: 0 } : i));
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    /* storage full / private mode */
  }
}

function emit() {
  save();
  const snapshot = items.map((i) => ({ ...i }));
  listeners.forEach((l) => l(snapshot));
}

export function subscribeDownloads(fn: Listener): () => void {
  listeners.add(fn);
  fn(items.map((i) => ({ ...i })));
  return () => listeners.delete(fn);
}

export function getDownload(key: string) {
  return items.find((i) => i.key === key);
}

function patch(key: string, p: Partial<DLItem>) {
  items = items.map((i) => (i.key === key ? { ...i, ...p } : i));
  emit();
}

// ---------- storage layout: dl/<key>/00000, 00001, ... ----------

async function root() {
  const r = await navigator.storage.getDirectory();
  return r.getDirectoryHandle('dl', { create: true });
}

function folderName(key: string) {
  return key.replace(/[^a-z0-9._-]/gi, '_');
}

async function folder(key: string, create = false) {
  return (await root()).getDirectoryHandle(folderName(key), { create });
}

const partName = (n: number) => String(n).padStart(5, '0');

async function listParts(d: FileSystemDirectoryHandle): Promise<{ name: string; file: File }[]> {
  const out: { name: string; file: File }[] = [];
  for await (const [name, h] of (d as any).entries()) {
    if (h.kind === 'file' && /^\d{5}$/.test(name)) out.push({ name, file: await (h as FileSystemFileHandle).getFile() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Remove swap files left behind by a tab that was killed mid-write. */
async function cleanup() {
  try {
    const r = await navigator.storage.getDirectory();
    await r.removeEntry('files', { recursive: true }).catch(() => {}); // old layout
    const d = await root();
    for await (const [, sub] of (d as any).entries()) {
      if (sub.kind !== 'directory') continue;
      for await (const [name] of (sub as any).entries()) {
        if (name.endsWith('.crswap')) await (sub as FileSystemDirectoryHandle).removeEntry(name).catch(() => {});
      }
    }
    // forget "done" items whose files are gone (e.g. browser data cleared)
    const missing: string[] = [];
    for (const i of items) if (i.status === 'done' && !(await getFile(i.key))) missing.push(i.key);
    if (missing.length) {
      items = items.filter((i) => !missing.includes(i.key));
      emit();
    }
  } catch {
    /* OPFS unavailable */
  }
}

/** The downloaded file as one Blob (parts are joined lazily; nothing is copied into memory). */
export async function getFile(key: string): Promise<Blob | null> {
  try {
    const parts = await listParts(await folder(key));
    if (!parts.length) return null;
    return new Blob(parts.map((p) => p.file));
  } catch {
    return null;
  }
}

/** Save an already-available file (e.g. imported from SD card / USB) as a finished download. */
export async function importFile(key: string, label: string, file: File) {
  await removeFolder(key);
  const d = await folder(key, true);
  const h = await d.getFileHandle(partName(0), { create: true });
  const w = await (h as any).createWritable();
  await file.stream().pipeTo(w);
  const item: DLItem = { key, label, url: 'local', total: file.size, done: file.size, status: 'done', source: 'app' };
  items = [...items.filter((i) => i.key !== key), item];
  emit();
}

async function removeFolder(key: string) {
  try {
    await (await root()).removeEntry(folderName(key), { recursive: true });
  } catch {
    /* not there */
  }
}

export async function removeDownload(key: string) {
  if (active?.key === key) active.ctrl.abort();
  items = items.filter((i) => i.key !== key);
  emit();
  await removeFolder(key);
}

// ---------- queue ----------

export function enqueue(req: { key: string; label: string; url: string; sizeMB?: number }) {
  const existing = getDownload(req.key);
  if (existing?.status === 'done') return;
  if (existing) {
    patch(req.key, { status: 'queued', error: undefined });
  } else {
    items = [...items, { ...req, total: Math.round((req.sizeMB ?? 0) * 1e6), done: 0, status: 'queued' }];
    emit();
  }
  void pump();
}

export function pause(key: string) {
  if (active?.key === key) active.ctrl.abort('paused');
  patch(key, { status: 'paused', speed: 0 });
}

export function resume(key: string) {
  patch(key, { status: 'queued', error: undefined });
  void pump();
}

async function pump() {
  if (active) return;
  const next = items.find((i) => i.status === 'queued');
  if (!next) {
    releaseWake();
    return;
  }
  // claim the slot synchronously so concurrent pump() calls can't start the same item twice
  const ctrl = new AbortController();
  active = { key: next.key, ctrl };
  try {
    await ready;
    await holdWake();
    await run(next, ctrl.signal);
  } catch (e: any) {
    const cur = getDownload(next.key);
    // 'queued' too: a failed first request must not leave the item queued (pump would retry forever)
    if (cur && (cur.status === 'downloading' || cur.status === 'queued')) {
      if (ctrl.signal.aborted) patch(next.key, { status: 'paused', speed: 0 });
      else patch(next.key, { status: 'error', error: friendlyError(e), speed: 0 });
    }
  } finally {
    active = null;
    void pump();
  }
}

function friendlyError(e: any): string {
  const m = String(e?.message || e);
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'This page is open over plain http, so the browser blocks saving files. Open the https link and try again.';
  if (/file changed on the server/.test(m)) return m;
  if (/QuotaExceeded|quota/i.test(m)) return 'Storage is full. Free up space and tap Resume.';
  if (!navigator.onLine) return 'No connection. It will resume automatically when you are back online.';
  if (/404/.test(m)) return 'File not found on the server.';
  return 'Connection problem. Tap Resume to continue where it stopped.';
}

/** Where to fetch from. (Later: try a LAN hub first, then the internet.) */
function sourceUrl(item: DLItem): { url: string; source: DLItem['source'] } {
  if (/^https?:/.test(item.url)) return { url: item.url, source: 'internet' };
  return { url: new URL(item.url, document.baseURI).href, source: 'app' };
}

async function run(item: DLItem, signal: AbortSignal) {
  const d = await folder(item.key, true);

  // Keep only full parts; a short last part may be incomplete, so it is downloaded again.
  let parts = await listParts(d);
  for (const p of parts.filter((p) => p.file.size !== PART)) await d.removeEntry(p.name);
  parts = parts.filter((p) => p.file.size === PART);
  for (let i = 0; i < parts.length; i++) {
    // a gap in numbering means something went wrong: start over from the gap
    if (parts[i].name !== partName(i)) {
      for (const p of parts.slice(i)) await d.removeEntry(p.name);
      parts = parts.slice(0, i);
      break;
    }
  }
  let partNo = parts.length;
  let offset = partNo * PART;

  const { url, source } = sourceUrl(item);
  const res = await fetch(url, { signal, headers: offset > 0 ? { Range: `bytes=${offset}-` } : {} });
  if (res.status === 416) {
    // 416 only means "done" if the server's real length equals what we already hold.
    const size = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]);
    if (offset > 0 && size === offset) {
      patch(item.key, { status: 'done', done: offset, total: offset, source, speed: 0 });
      return;
    }
    // The file changed on the server (or the saved parts do not fit it): start clean next time.
    for (const p of parts) await d.removeEntry(p.name).catch(() => {});
    patch(item.key, { done: 0 });
    throw new Error('The file changed on the server. Tap Resume to download it again.');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.status !== 206 && offset > 0) {
    // server ignored Range: start over
    for (const p of parts) await d.removeEntry(p.name);
    partNo = 0;
    offset = 0;
  }
  const len = Number(res.headers.get('content-length') || 0);
  const total = len ? offset + len : item.total;
  patch(item.key, { status: 'downloading', total, done: offset, source, error: undefined });

  const reader = res.body!.getReader();
  let done = offset;
  let w: any = null;
  let inPart = 0;
  let lastTick = performance.now();
  let lastBytes = done;

  const openPart = async () => {
    const h = await d.getFileHandle(partName(partNo), { create: true });
    w = await (h as any).createWritable();
    inPart = 0;
  };
  const closePart = async () => {
    if (w) await w.close(); // commits the part to disk
    w = null;
    partNo++;
  };

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      let chunk: Uint8Array = value;
      while (chunk.byteLength) {
        if (!w) await openPart();
        const take = Math.min(chunk.byteLength, PART - inPart);
        await w.write(chunk.subarray(0, take));
        inPart += take;
        done += take;
        chunk = chunk.subarray(take);
        if (inPart === PART) await closePart();
      }
      const now = performance.now();
      if (now - lastTick > 500) {
        const speed = ((done - lastBytes) * 1000) / (now - lastTick);
        lastTick = now;
        lastBytes = done;
        patch(item.key, { done, speed });
      }
    }
    if (w) await closePart();
    // A stream that ended early (dropped connection without an error) must not count as finished.
    if (len && done !== total) throw new Error(`Incomplete download: ${done} of ${total} bytes`);
  } catch (e) {
    // drop the unfinished part's writer; its bytes are re-downloaded on resume
    await w?.abort?.().catch(() => {});
    throw e;
  }
  patch(item.key, { status: 'done', done, total: total || done, speed: 0 });
}

async function holdWake() {
  try {
    if (!wakeLock && 'wakeLock' in navigator) wakeLock = await (navigator as any).wakeLock.request('screen');
  } catch {
    /* not allowed */
  }
}

function releaseWake() {
  try {
    wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

// Auto-resume when the signal comes back.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    items.filter((i) => i.status === 'error').forEach((i) => patch(i.key, { status: 'queued', error: undefined }));
    void pump();
  });
  // Ask the browser not to evict our files when storage gets low.
  navigator.storage?.persist?.().catch(() => {});
}
