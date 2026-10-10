import { useRef, useState } from 'react';
import { ALL_MODELS, modelKey } from '../lib/catalog';
import { enqueue, removeDownload } from '../lib/downloads';
import { QUESTIONS, runBench, summary, toMarkdown, type BenchResult } from '../lib/bench';
import { fmtMB } from '../lib/device';
import { useDownloads, useLocalState } from '../hooks';
import { Icon } from '../components/Icon';

/** Tools → AI benchmark: compare models on this device with the same survival questions. */
export default function Bench({ onModelChange }: { onModelChange?: () => void }) {
  const downloads = useDownloads();
  const [results, setResults] = useLocalState<BenchResult[]>('cai.bench.results', []);
  const [picked, setPicked] = useState<string[]>([]);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const st = (id: string) => downloads.find((d) => d.key === modelKey(id));

  const run = async () => {
    setRunning(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let all = results;
    try {
      for (const id of picked) {
        const m = ALL_MODELS.find((x) => x.id === id);
        if (!m || st(id)?.status !== 'done') continue;
        const r = await runBench(m, { onProgress: setStatus, signal: ctrl.signal });
        all = [...all.filter((x) => !(x.modelId === r.modelId && x.device === r.device)), r];
        setResults(all);
        if (deleteAfter) await removeDownload(modelKey(id));
        if (ctrl.signal.aborted) break;
      }
      setStatus(ctrl.signal.aborted ? 'Stopped.' : 'Done.');
    } catch (e: any) {
      setStatus(`Stopped: ${e?.message ?? e}`);
    } finally {
      setRunning(false);
      onModelChange?.(); // the benchmark unloads the chat AI when it finishes
    }
  };

  const copy = () => navigator.clipboard?.writeText(toMarkdown(results)).then(() => setStatus('Copied results as a Markdown table.'));

  return (
    <section className="tool-section bench-tool">
      <div className="tool-heading"><Icon name="cpu" size={22} /><span className="eyebrow">Testing</span></div>
      <h3>AI benchmark</h3>
      <p className="muted small">
        Asks {QUESTIONS.length} survival questions and checks whether each answer has the key facts. Run it on each phone to pick the best AI. Takes a few minutes per model.
      </p>

      <ul className="bench-models">
        {ALL_MODELS.map((m) => {
          const d = st(m.id);
          return (
            <li key={m.id}>
              <label className="check-item">
                <input
                  type="checkbox"
                  disabled={d?.status !== 'done' || running}
                  checked={picked.includes(m.id)}
                  onChange={() => setPicked(picked.includes(m.id) ? picked.filter((p) => p !== m.id) : [...picked, m.id])}
                />
                <span>{m.name} <span className="muted tiny mono">{m.family}</span></span>
              </label>
              {d?.status === 'done' ? (
                <span className="mono tiny muted">Ready</span>
              ) : d ? (
                <span className="mono tiny muted">{d.status} {d.total ? `${Math.round((d.done / d.total) * 100)}%` : ''}</span>
              ) : (
                <button onClick={() => enqueue({ key: modelKey(m.id), label: `AI: ${m.name}`, url: m.url, sizeMB: m.sizeMB })}>Get {fmtMB(m.sizeMB)}</button>
              )}
            </li>
          );
        })}
      </ul>

      <label className="check-item">
        <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} />
        <span>Delete each model after testing (saves space)</span>
      </label>

      <div className="row-actions">
        {running ? (
          <button className="danger" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button className="primary" disabled={!picked.length} onClick={run}>Run benchmark ({picked.length})</button>
        )}
        {results.length > 0 && <button onClick={copy}>Copy results</button>}
        {results.length > 0 && !running && <button onClick={() => setResults([])}>Clear</button>}
      </div>
      {status && <p className="small muted" aria-live="polite">{status}</p>}

      {results.length > 0 && (
        <div className="bench-table">
          <table>
            <thead>
              <tr><th>Model</th><th>Facts</th><th>s/answer</th><th>tok/s</th></tr>
            </thead>
            <tbody>
              {[...results]
                .sort((a, b) => summary(b).score - summary(a).score)
                .map((r) => {
                  const s = summary(r);
                  const key = `${r.modelId}|${r.device}`;
                  return (
                    <tr key={key} onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                      <td>{r.modelName}<div className="muted tiny">{r.device}</div></td>
                      <td className="mono">{(s.score * 100).toFixed(0)}%</td>
                      <td className="mono">{s.seconds.toFixed(1)}</td>
                      <td className="mono">{s.genPerSec.toFixed(1)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {results
            .filter((r) => `${r.modelId}|${r.device}` === open)
            .flatMap((r) =>
              r.answers.map((a) => (
                <div key={a.id} className="bench-answer">
                  <b>{QUESTIONS.find((q) => q.id === a.id)?.q}</b> <span className="mono tiny">{(a.score * 100).toFixed(0)}%</span>
                  <p className="small">{a.answer || '(no answer)'}</p>
                </div>
              )),
            )}
        </div>
      )}
    </section>
  );
}
