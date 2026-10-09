import { useEffect, useRef, useState } from 'react';
import { ALL_MODELS, modelKey } from '../lib/catalog';
import { getFile, type DLItem } from '../lib/downloads';
import { gpuEnabled, loadModel, loadedModel, setGpuEnabled, unload, type ChatStats } from '../lib/llm';
import { ask, GENERAL_NOTE, type HistoryTurn } from '../lib/ask';
import { deleteChat, getChat, getCurrentChatId, listChats, newChatId, saveChat, setCurrentChatId, type Chat } from '../lib/chats';
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
  kind?: 'answer' | 'smalltalk' | 'no-info' | 'general';
  progress?: number;
  error?: string;
}

// The conversation lives outside the component, so switching to Library and back keeps it.
// Finished conversations are also saved to the device (lib/chats.ts) and survive app restarts.
let savedTurns: Turn[] = [];
let savedChatId: string | null = null;
const fromSaved = (chat: Chat | null): Turn[] => (chat?.turns ?? []).map((t) => ({ ...t, phase: t.error ? 'error' : 'done' }));
const finishRunning = (t: Turn): Turn =>
  t.phase === 'reading' || t.phase === 'answering' ? { ...t, phase: 'done', a: t.a ? `${t.a} …(stopped)` : t.a } : t;

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
  const available = ALL_MODELS.filter((m) => downloads.some((d) => d.key === modelKey(m.id) && d.status === 'done'));
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
  const [notice, setNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState(loadedModel()?.id ?? null);
  const [gpu, setGpu] = useState(gpuEnabled());
  const [chatId, setChatId] = useState<string>(() => savedChatId ?? getCurrentChatId() ?? newChatId());
  const [turns, setTurns] = useState<Turn[]>(() => (savedChatId ? savedTurns : fromSaved(getChat(getCurrentChatId()))));
  const [chats, setChats] = useState<Chat[]>(listChats);
  const [showHistory, setShowHistory] = useState(false);
  const stickToBottom = useRef(true); // auto-scroll only while the reader is already at the bottom
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Leaving the screen stops any answer that is still being written, so it cannot run in the background.
  useEffect(() => () => {
    abortRef.current?.abort();
    savedTurns = turnsRef.current.map(finishRunning);
    savedChatId = chatIdRef.current;
  }, []);

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  // Save finished conversations to the device (never half-written answers).
  useEffect(() => {
    if (busy) return;
    const done = turns.filter((t) => t.phase === 'done' || t.phase === 'error');
    if (!done.length) return;
    saveChat(chatId, done.map(({ q, a, sources, stats, kind, error }) => ({ q, a, sources, stats, kind, error })));
    setCurrentChatId(chatId);
  }, [turns, busy, chatId]);

  useEffect(() => {
    const refresh = () => setChats(listChats());
    window.addEventListener('cai-chats', refresh);
    return () => window.removeEventListener('cai-chats', refresh);
  }, []);

  // Let the reader scroll up while an answer is being written: stop following once they leave the bottom.
  useEffect(() => {
    // The conversation box scrolls on its own in the Ask layout; the page scrolls in others. Watch both.
    const scrollers = [endRef.current?.closest('.chat'), endRef.current?.closest('.main-content')].filter(Boolean) as HTMLElement[];
    const onScroll = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (el.scrollHeight <= el.clientHeight + 5) return; // this one isn't the scrolling element
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    // Smooth scrolling reports position late, so a new word could yank the view back down mid-gesture.
    // Any touch or upward wheel stops following immediately; reaching the bottom again resumes it.
    const release = (e: Event) => {
      if (e.type === 'wheel' && (e as WheelEvent).deltaY > 0) return;
      stickToBottom.current = false;
    };
    scrollers.forEach((el) => {
      el.addEventListener('scroll', onScroll, { passive: true });
      el.addEventListener('wheel', release, { passive: true });
      el.addEventListener('touchstart', release, { passive: true });
    });
    return () => scrollers.forEach((el) => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', release);
      el.removeEventListener('touchstart', release);
    });
  }, []);

  const openChat = (id: string | null) => {
    if (busy) return;
    const next = id ?? newChatId();
    setChatId(next);
    setTurns(fromSaved(getChat(id)));
    setCurrentChatId(id);
    setShowHistory(false);
    stickToBottom.current = true;
  };

  useEffect(() => {
    if (!selected && available[0]) setSelected(available[0].id);
  }, [available.length]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    endRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [turns]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  }, [input]);

  const doLoad = async () => {
    const m = ALL_MODELS.find((x) => x.id === selected);
    if (!m) return;
    setLoading(true);
    setLoadErr(null);
    setNotice(null);
    try {
      const f = await getFile(modelKey(m.id));
      if (!f) throw new Error('Model file missing. Download it again in Prepare.');
      const { fellBackToCpu } = await loadModel(m, f);
      setCurrent(m.id);
      if (fellBackToCpu) {
        setGpu(false);
        setNotice('The GPU gave unreadable output on this phone, so the AI switched to the CPU automatically.');
      }
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
    stickToBottom.current = true; // a new question always brings the answer into view
    const i = turns.length;
    // the last finished exchanges, so "what about kids?" can be understood
    const history: HistoryTurn[] = turns
      .filter((t) => t.phase === 'done' && t.a)
      .map((t) => ({ q: t.q, a: t.a, hadSources: t.sources.length > 0 && t.kind === 'answer' }));
    setTurns((ts) => [...ts, { q, a: '', sources: [], phase: 'reading' }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = '';
    try {
      const res = await ask(q, {
        signal: ctrl.signal,
        history,
        onSources: (sources) => update(i, { sources }),
        onPrompt: (progress) => update(i, { progress }),
        onToken: (t) => {
          acc += t;
          update(i, { a: acc, phase: 'answering' });
        },
      });
      update(i, { phase: 'done', stats: res.stats, kind: res.kind });
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
            <select aria-label="Downloaded AI model" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loading || busy}>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.family})
                </option>
              ))}
            </select>
            {current === selected ? (
              <Status label="Model" value="Loaded" state="ready" />
            ) : (
              <button className="primary" onClick={doLoad} disabled={loading || busy}>
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
              disabled={loading || busy}
              onChange={async (e) => {
                setGpuEnabled(e.target.checked);
                setGpu(e.target.checked);
                await unload(); // reload needed for the change to apply
                setCurrent(null);
                onModelChange();
              }}
            />
            Use GPU <span className="gpu-help">(off = CPU. Faster on laptops with a good GPU; turn off if answers are slow or garbled)</span>
          </label>
        )}
        {notice && <p className="muted small" role="status"><Icon name="info" size={16} />{notice}</p>}
        {loadErr && <p className="error small" role="alert"><Icon name="info" size={16} />Could not start the AI: {loadErr}</p>}
        {loading && <Skeleton label="Initializing the local model" lines={2} className="model-skeleton" />}
        {!current && available.length > 0 && !loading && (
          <p className="muted small">Without the AI, you still get matching library articles for every question.</p>
        )}
      </section>

      {/* ---- saved chats ---- */}
      <section className="chat-bar" aria-label="Chat history">
        <button onClick={() => openChat(null)} disabled={busy || turns.length === 0}><Icon name="ask" size={16} />New chat</button>
        <button onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} disabled={busy || chats.length === 0}>
          <Icon name="book" size={16} />History <span className="mono tiny">{chats.length}</span>
        </button>
      </section>
      {showHistory && (
        <ul className="chat-history" aria-label="Saved chats">
          {chats.map((c) => (
            <li key={c.id} className={c.id === chatId ? 'active' : ''}>
              <button className="chat-open" onClick={() => openChat(c.id)}>
                <span>{c.title}</span>
                <span className="muted tiny mono">{new Date(c.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {c.turns.length}</span>
              </button>
              <button className="icon-button" aria-label={`Delete chat: ${c.title}`} onClick={() => { if (confirm('Delete this chat?')) { deleteChat(c.id); if (c.id === chatId) openChat(null); } }}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      )}

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
              {t.kind === 'general' && t.a && <p className="general-note muted small"><Icon name="info" size={14} />{GENERAL_NOTE}</p>}
              {t.a && <div className="answer"><RichText text={t.a} /></div>}
              {!current && t.phase !== 'error' && t.kind === 'answer' && t.sources.length > 0 && (
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
