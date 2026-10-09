import { useEffect, useRef, useState } from 'react';
import { MODELS, modelKey } from '../lib/catalog';
import { getFile, type DLItem } from '../lib/downloads';
import { gpuEnabled, loadModel, loadedModel, setGpuEnabled, unload, type ChatStats } from '../lib/llm';
import { ask } from '../lib/ask';
import type { Passage } from '../lib/knowledge';

interface Turn {
  q: string;
  a: string;
  sources: Passage[];
  stats?: ChatStats | null;
  phase: 'reading' | 'answering' | 'done' | 'error';
  progress?: number;
  error?: string;
}

const EXAMPLES = [
  'How do I stop heavy bleeding?',
  'Paano gamutin ang paso?',
  'How do I make water safe to drink?',
  'What should I do during an earthquake?',
  'What are the warning signs of dengue?',
];

interface Props {
  downloads: DLItem[];
  onModelChange: () => void;
  onGoPrepare: () => void;
}

export default function Ask({ downloads, onModelChange, onGoPrepare }: Props) {
  const available = MODELS.filter((m) => downloads.some((d) => d.key === modelKey(m.id) && d.status === 'done'));
  // default: the loaded AI, else the one picked in Prepare, else the first downloaded one
  const prepPick = (() => {
    try {
      return JSON.parse(localStorage.getItem('cai.prep.model') || 'null') as string | null;
    } catch {
      return null;
    }
  })();
  const [selected, setSelected] = useState<string>(
    loadedModel()?.id ?? available.find((m) => m.id === prepPick)?.id ?? available[0]?.id ?? '',
  );
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [current, setCurrent] = useState(loadedModel()?.id ?? null);
  const [gpu, setGpu] = useState(gpuEnabled());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected && available[0]) setSelected(available[0].id);
  }, [available.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const doLoad = async () => {
    const m = MODELS.find((x) => x.id === selected);
    if (!m) return;
    setLoading(true);
    setLoadErr(null);
    try {
      const f = await getFile(modelKey(m.id));
      if (!f) throw new Error('Model file missing. Download it again in Prepare.');
      await loadModel(m, f);
      setCurrent(m.id);
    } catch (e: any) {
      setLoadErr(String(e?.message ?? e));
      await unload();
      setCurrent(null);
    } finally {
      setLoading(false);
      onModelChange();
    }
  };

  const update = (i: number, p: Partial<Turn>) => setTurns((ts) => ts.map((t, j) => (j === i ? { ...t, ...p } : t)));

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    const i = turns.length;
    setTurns((ts) => [...ts, { q, a: '', sources: [], phase: 'reading' }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = '';
    try {
      const res = await ask(q, {
        signal: ctrl.signal,
        onSources: (sources) => update(i, { sources }),
        onPrompt: (progress) => update(i, { progress }),
        onToken: (t) => {
          acc += t;
          update(i, { a: acc, phase: 'answering' });
        },
      });
      update(i, { phase: 'done', stats: res.stats });
    } catch (e: any) {
      if (ctrl.signal.aborted) update(i, { phase: 'done', a: acc + ' …(stopped)' });
      else update(i, { phase: 'error', error: String(e?.message ?? e) });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="stack">
      {/* ---- model loader ---- */}
      <section className="card compact">
        {available.length === 0 ? (
          <p>
            No AI downloaded. You can still search the library, or{' '}
            <button className="link" onClick={onGoPrepare}>
              download an AI in Prepare →
            </button>
          </p>
        ) : (
          <div className="loader">
            <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loading}>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.family})
                </option>
              ))}
            </select>
            {current === selected ? (
              <span className="badge ok">✓ AI ready</span>
            ) : (
              <button className="primary" onClick={doLoad} disabled={loading}>
                {loading ? 'Waking up the AI…' : 'Start AI'}
              </button>
            )}
          </div>
        )}
        {available.length > 0 && (
          <label className="check-item small muted">
            <input
              type="checkbox"
              checked={gpu}
              onChange={async (e) => {
                setGpuEnabled(e.target.checked);
                setGpu(e.target.checked);
                await unload(); // reload needed for the change to apply
                setCurrent(null);
                onModelChange();
              }}
            />
            Use GPU (turn off if answers are slow; weak phone GPUs are often slower than the CPU)
          </label>
        )}
        {loadErr && <p className="error small">Could not start the AI: {loadErr}</p>}
        {!current && available.length > 0 && !loading && (
          <p className="muted small">Without the AI, you still get matching library articles for every question.</p>
        )}
      </section>

      {/* ---- conversation ---- */}
      <section className="chat">
        {turns.length === 0 && (
          <div className="examples">
            <p className="muted">Try asking:</p>
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" onClick={() => send(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="q">{t.q}</div>
            <div className="a">
              {t.phase === 'reading' && current && (
                <p className="muted">
                  📖 Reading {t.sources.length} source{t.sources.length === 1 ? '' : 's'}…
                  {t.progress !== undefined ? ` ${Math.round(t.progress * 100)}%` : ''}
                </p>
              )}
              {t.a && <div className="answer">{t.a}</div>}
              {!current && t.phase !== 'error' && (
                <p className="muted small">AI not started. Here is what the offline library says:</p>
              )}
              {t.phase === 'error' && <p className="error">⚠ {t.error}</p>}
              {t.sources.length > 0 && (
                <details className="sources" open={!current}>
                  <summary>Sources ({t.sources.length})</summary>
                  {t.sources.map((s, n) => (
                    <div key={s.id} className="source">
                      <b>
                        [{n + 1}] {s.title}
                      </b>{' '}
                      <span className="muted tiny">{s.category}</span>
                      <p className="small">{s.text}</p>
                    </div>
                  ))}
                </details>
              )}
              {t.phase === 'done' && t.sources.length === 0 && !t.a && (
                <p className="muted">Nothing found in your downloaded packs. Try other words, or download more topics.</p>
              )}
              {t.stats && (
                <div className="muted tiny stats">
                  ⚡ read {t.stats.promptTokens} tokens @ {t.stats.promptPerSec.toFixed(1)}/s · wrote {t.stats.genTokens} @{' '}
                  {t.stats.genPerSec.toFixed(1)}/s · on this device, offline
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </section>

      <div className="composer">
        <input
          value={input}
          placeholder="Ask anything… (English, Tagalog keywords work too)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        {busy ? (
          <button onClick={() => abortRef.current?.abort()}>Stop</button>
        ) : (
          <button className="primary" onClick={() => send()} disabled={!input.trim()}>
            Ask
          </button>
        )}
      </div>
      <p className="disclaimer tiny muted">
        ⚕ CollapseAI is not a doctor. Use it when no professional help is available, and seek help as soon as you can.
      </p>
    </div>
  );
}
