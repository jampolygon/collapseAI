import { useEffect, useMemo, useState } from 'react';
import { KITS, MODELS, PACKS, modelKey, packKey } from '../lib/catalog';
import { recommendModel, fmtBytes, fmtMB } from '../lib/device';
import { enqueue, importFile, pause, removeDownload, resume, type DLItem } from '../lib/downloads';
import { useDevice, useLocalState } from '../hooks';

const TIPS = [
  'Use Wi-Fi if you can. Big downloads can eat your mobile data.',
  'Keep the screen on and the charger plugged in while downloading.',
  'If the signal drops, the download continues where it stopped. Nothing is lost.',
  'Download now, while internet still works. In a disaster, the network is the first thing to go.',
  'Once downloaded, everything works in airplane mode. Try it!',
  'Smaller AI = faster answers. You can always download a smarter one later.',
  'Pick only the topics you need to save space. You can add more anytime.',
];

interface Props {
  downloads: DLItem[];
  online: boolean;
  onGoSurvive: () => void;
}

export default function Prepare({ downloads, online, onGoSurvive }: Props) {
  const device = useDevice();
  const rec = device ? recommendModel(device) : null;
  const [modelId, setModelId] = useLocalState<string | null>('cai.prep.model', null);
  const chosenModel = modelId ?? rec?.model.id ?? null;
  const [kitId, setKitId] = useLocalState<string>('cai.prep.kit', 'essentials');
  const [packIds, setPackIds] = useLocalState<string[]>('cai.prep.packs', KITS[0].packs);
  const [tip, setTip] = useState(0);
  const [showAllModels, setShowAllModels] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(t);
  }, []);

  const byKey = useMemo(() => new Map(downloads.map((d) => [d.key, d])), [downloads]);

  const chooseKit = (id: string) => {
    setKitId(id);
    const kit = KITS.find((k) => k.id === id);
    if (kit) setPackIds(kit.packs);
  };
  const togglePack = (id: string) => {
    setKitId('custom');
    setPackIds(packIds.includes(id) ? packIds.filter((p) => p !== id) : [...packIds, id]);
  };

  const model = MODELS.find((m) => m.id === chosenModel);
  // "pending" = not on the device and not already in the download queue
  const isPending = (key: string) => {
    const st = byKey.get(key)?.status;
    return !st || st === 'error' || st === 'paused';
  };
  const modelDone = !model || !isPending(modelKey(model.id));
  const packsToGet = PACKS.filter((p) => packIds.includes(p.id) && isPending(packKey(p.id)));
  const totalMB = (model && !modelDone ? model.sizeMB : 0) + packsToGet.reduce((s, p) => s + p.sizeMB, 0);
  const nothingToDo = modelDone && packsToGet.length === 0;
  const busy = downloads.some((d) => d.status === 'downloading' || d.status === 'queued');

  const downloadAll = () => {
    // small packs first, so the Library works within seconds
    for (const p of packsToGet) enqueue({ key: packKey(p.id), label: `${p.icon} ${p.name}`, url: p.url, sizeMB: p.sizeMB });
    if (model && !modelDone) enqueue({ key: modelKey(model.id), label: `AI: ${model.name}`, url: model.url, sizeMB: model.sizeMB });
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Match a known model by file name, otherwise store under its own name.
    const match = MODELS.find((m) => m.url.endsWith('/' + f.name));
    await importFile(modelKey(match?.id ?? f.name), `AI: ${match?.name ?? f.name} (imported)`, f);
    if (match) setModelId(match.id);
  };

  const visibleModels = showAllModels ? MODELS : MODELS.filter((m) => m.id === chosenModel || m.id === rec?.model.id);
  const active = downloads.filter((d) => d.status !== 'done');
  const finished = downloads.filter((d) => d.status === 'done');

  return (
    <div className="stack">
      {!online && (
        <div className="banner warn">You are offline. Downloads will start automatically when internet comes back.</div>
      )}

      {/* ---------- Device ---------- */}
      <section className="card">
        <h2>Your device</h2>
        {device ? (
          <div className="specs">
            <span>{device.mobile ? '📱 Phone' : '💻 Computer'}</span>
            <span>🧠 {device.ramKnown ? `${device.ramGB}${device.ramGB >= 8 ? '+' : ''} GB memory` : 'memory unknown'}</span>
            <span>⚙️ {device.cores} CPU cores</span>
            <span>{device.webgpu ? '🎮 GPU available' : '🎮 no GPU boost'}</span>
            <span>💾 {fmtMB(device.freeStorageMB)} free for the app</span>
          </div>
        ) : (
          <p className="muted">Checking your device…</p>
        )}
      </section>

      {/* ---------- Step 1: model ---------- */}
      <section className="card">
        <h2>
          <span className="step">1</span> Choose your AI
        </h2>
        {rec && (
          <p className="muted">
            We recommend <b>{rec.model.name}</b>. {rec.reason}
          </p>
        )}
        <div className="grid">
          {visibleModels.map((m) => {
            const dl = byKey.get(modelKey(m.id));
            return (
              <label key={m.id} className={`option ${chosenModel === m.id ? 'selected' : ''}`}>
                <input type="radio" name="model" checked={chosenModel === m.id} onChange={() => setModelId(m.id)} />
                <div className="option-head">
                  <b>{m.name}</b>
                  {rec?.model.id === m.id && <span className="badge">Recommended</span>}
                  {dl?.status === 'done' && <span className="badge ok">Downloaded</span>}
                </div>
                <div className="muted small">
                  {fmtMB(m.sizeMB)} · {m.speed}
                </div>
                <p className="small">{m.blurb}</p>
                <div className="muted tiny">{m.family}</div>
              </label>
            );
          })}
        </div>
        <button className="link" onClick={() => setShowAllModels(!showAllModels)}>
          {showAllModels ? 'Show only recommended' : `Show all ${MODELS.length} AI models`}
        </button>
      </section>

      {/* ---------- Step 2: knowledge ---------- */}
      <section className="card">
        <h2>
          <span className="step">2</span> Choose your knowledge
        </h2>
        <div className="kits">
          {KITS.map((k) => (
            <button key={k.id} className={`kit ${kitId === k.id ? 'selected' : ''}`} onClick={() => chooseKit(k.id)}>
              <b>{k.name}</b>
              <small>{k.blurb}</small>
            </button>
          ))}
          <button className={`kit ${kitId === 'custom' ? 'selected' : ''}`} onClick={() => setKitId('custom')}>
            <b>Custom</b>
            <small>Pick only the topics you need.</small>
          </button>
        </div>
        <div className="packs">
          {PACKS.map((p) => {
            const dl = byKey.get(packKey(p.id));
            return (
              <label key={p.id} className={`pack ${packIds.includes(p.id) ? 'selected' : ''}`}>
                <input type="checkbox" checked={packIds.includes(p.id)} onChange={() => togglePack(p.id)} />
                <span className="pack-icon">{p.icon}</span>
                <span className="pack-body">
                  <b>{p.name}</b> <span className="muted small">{fmtMB(p.sizeMB)}</span>
                  {dl?.status === 'done' && <span className="badge ok">Downloaded</span>}
                  <br />
                  <span className="small muted">{p.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ---------- Step 3: download ---------- */}
      <section className="card">
        <h2>
          <span className="step">3</span> Download
        </h2>
        <button className="primary big" disabled={nothingToDo} onClick={downloadAll}>
          {nothingToDo ? (busy ? 'Downloading… you can keep using the app' : '✓ Everything selected is downloaded') : `Download selected · ${fmtMB(totalMB)}`}
        </button>
        <p className="tip">💡 {TIPS[tip]}</p>

        {active.length > 0 && (
          <div className="dl-list">
            {active.map((d) => (
              <DownloadRow key={d.key} d={d} />
            ))}
          </div>
        )}

        {finished.length > 0 && (
          <>
            <h3>On this device</h3>
            <div className="dl-list">
              {finished.map((d) => (
                <DownloadRow key={d.key} d={d} />
              ))}
            </div>
            <button className="primary" onClick={onGoSurvive}>
              Go to Survive mode →
            </button>
          </>
        )}

        <details className="advanced">
          <summary>No internet? Import a model file from SD card / USB / a friend</summary>
          <p className="small muted">Choose a .gguf file you already have. It is copied into the app and works offline.</p>
          <input type="file" accept=".gguf" onChange={onImport} />
        </details>
      </section>
    </div>
  );
}

function DownloadRow({ d }: { d: DLItem }) {
  const pct = d.total ? Math.min(100, (d.done / d.total) * 100) : 0;
  const eta = d.speed && d.total ? Math.round((d.total - d.done) / d.speed) : null;
  return (
    <div className="dl-row">
      <div className="dl-top">
        <b>{d.label}</b>
        <span className="muted small">
          {d.status === 'done' ? fmtBytes(d.total) : `${fmtBytes(d.done)} / ${d.total ? fmtBytes(d.total) : '?'}`}
        </span>
      </div>
      {d.status !== 'done' && (
        <div className="bar">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="dl-bottom">
        <span className={`small status-${d.status}`}>
          {d.status === 'downloading' && `${pct.toFixed(0)}% · ${fmtBytes(d.speed ?? 0)}/s${eta !== null ? ` · ~${fmtEta(eta)} left` : ''}`}
          {d.status === 'queued' && 'Waiting…'}
          {d.status === 'paused' && 'Paused'}
          {d.status === 'error' && (d.error ?? 'Error')}
          {d.status === 'done' && '✓ Ready offline'}
        </span>
        <span className="row-actions">
          {d.status === 'downloading' && <button onClick={() => pause(d.key)}>Pause</button>}
          {(d.status === 'paused' || d.status === 'error') && <button onClick={() => resume(d.key)}>Resume</button>}
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete ${d.label} from this device?`)) removeDownload(d.key);
            }}
          >
            {d.status === 'done' ? 'Delete' : 'Cancel'}
          </button>
        </span>
      </div>
    </div>
  );
}

function fmtEta(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
