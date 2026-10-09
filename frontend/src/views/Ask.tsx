import { useEffect, useRef, useState } from 'react';
import { MODELS, modelKey } from '../lib/catalog';
import { getFile, type DLItem } from '../lib/downloads';
import { gpuEnabled, loadModel, loadedModel, setGpuEnabled, unload, type ChatStats } from '../lib/llm';
import { ask } from '../lib/ask';
import type { Passage } from '../lib/knowledge';
import { Icon } from '../components/Icon';
import { Status } from '../components/Status';
import { RichText } from '../components/RichText';
import { Skeleton } from '../components/Skeleton';

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
  'How do I make water safe to drink?',
  'What should I do during an earthquake?',
  'What belongs in a 72-hour go-bag?',
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!selected && available[0]) setSelected(available[0].id);
  }, [available.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' });
  }, [turns]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  }, [input]);

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
    <div className="ask-screen">
      {/* ---- model loader ---- */}
      <section className="model-controls" aria-label="Local model controls">
        {available.length === 0 ? (
          <div className="model-missing"><Icon name="cpu" size={18} /><p>No model downloaded. Ask to search your knowledge, or <button className="link" onClick={onGoPrepare}>prepare a local model <Icon name="arrow" size={14} /></button></p></div>
        ) : (
          <div className="loader">
            <Icon name="cpu" size={18} />
            <select aria-label="Downloaded AI model" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loading}>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.family})
                </option>
              ))}
            </select>
            {current === selected ? (
              <Status label="Model" value="Loaded" state="ready" />
            ) : (
              <button className="primary" onClick={doLoad} disabled={loading}>
                {loading ? <><span className="loading-dot" />Loading model…</> : 'Start AI'}
              </button>
            )}
          </div>
        )}
        {available.length > 0 && (
          <label className="gpu-control small muted">
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
            Use GPU <span className="gpu-help">— turn off if answers are slower</span>
          </label>
        )}
        {loadErr && <p className="error small" role="alert"><Icon name="info" size={16} />Could not start the AI: {loadErr}</p>}
        {loading && <Skeleton label="Initializing the local model" lines={2} className="model-skeleton" />}
        {!current && available.length > 0 && !loading && (
          <p className="muted small">Without the AI, you still get matching library articles for every question.</p>
        )}
      </section>

      {/* ---- conversation ---- */}
      <section className={`chat ${turns.length === 0 ? 'chat-empty' : ''}`} aria-label="Conversation">
        {turns.length === 0 && (
          <div className="examples">
            <span className="empty-state-label"><Icon name="ask" size={20} />CollapseAI</span>
            <h2>What do you need<br />help with?</h2>
            <p className="muted empty-description">Local answers from your downloaded survival knowledge.<br />The library works even without an AI model.</p>
            <div className="suggestions">{EXAMPLES.map((example, index) => <button key={example} className="suggestion" onClick={() => send(example)}><Icon name={(['aid', 'water', 'storm', 'bag'] as const)[index]} size={18} /><span>{example}</span><Icon name="arrow" size={16} /></button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <article key={i} className="turn" aria-label={`Question ${i + 1}`}>
            <div className="q">{t.q}</div>
            <div className="a">
              <div className="assistant-label"><Icon name="mountain" size={16} /><span>CollapseAI</span><span className="mono muted">{current ? 'Local response' : 'Knowledge search'}</span></div>
              {t.phase === 'reading' && current && (
                <div className="response-loading">
                <p className="muted generation-state" role="status">
                  Preparing context · {t.sources.length} reference{t.sources.length === 1 ? '' : 's'}
                  {t.progress !== undefined ? ` ${Math.round(t.progress * 100)}%` : ''}
                </p>
                <Skeleton label="Waiting for the first response" lines={3} className="response-skeleton" />
                </div>
              )}
              {t.phase === 'answering' && busy && i === turns.length - 1 && <p className="generation-state muted small" role="status"><span className="loading-dot" />Generating on this device</p>}
              {t.a && <div className="answer"><RichText text={t.a} /></div>}
              {!current && t.phase !== 'error' && (
                <p className="muted small">AI not started. Here is what the offline library says:</p>
              )}
              {t.phase === 'error' && <p className="error" role="alert"><Icon name="info" size={16} />{t.error}</p>}
              {t.sources.length > 0 && (
                <details className="sources" open={!current}>
                  <summary>Retrieved references <span className="mono">{t.sources.length}</span></summary>
                  {t.sources.map((s) => (
                    <div key={s.id} className="source">
                      <div className="source-heading"><Icon name="book" size={16} /><span className="muted tiny">{s.category}</span><span>/</span><strong>{s.title}</strong></div>
                      <RichText text={s.text} />
                      {s.source && <p className="source-attribution muted tiny">Source: {s.source}</p>}
                    </div>
                  ))}
                </details>
              )}
              {t.phase === 'done' && t.sources.length === 0 && !t.a && (
                <p className="muted">Nothing found in your downloaded packs. Try other words, or download more topics.</p>
              )}
              {t.stats && (
                <div className="muted tiny stats mono">
                  Read {t.stats.promptTokens} tokens @ {t.stats.promptPerSec.toFixed(1)}/s · wrote {t.stats.genTokens} @{' '}
                  {t.stats.genPerSec.toFixed(1)}/s · on this device, offline
                </div>
              )}
            </div>
          </article>
        ))}
        <div ref={endRef} />
      </section>

      <div className="composer-area">
      <div className="composer">
        <label className="sr-only" htmlFor="question">Your question</label>
        <textarea
          id="question"
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Ask a survival question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
        />
        {busy ? (
          <button className="stop-button" onClick={() => abortRef.current?.abort()} aria-label="Stop generating"><span aria-hidden="true" />Stop</button>
        ) : (
          <button className="primary send-button" aria-label="Send question" title="Send question" onClick={() => send()} disabled={!input.trim()}>
            <Icon name="send" />
          </button>
        )}
      </div>
      <div className="composer-hints"><span>English &amp; Tagalog keywords</span><span>Enter to send <span aria-hidden="true">·</span> Shift + Enter for a new line</span></div>
      <p className="disclaimer tiny muted">
        CollapseAI is not a doctor. Seek professional help as soon as you can.
      </p>
      </div>
    </div>
  );
}
