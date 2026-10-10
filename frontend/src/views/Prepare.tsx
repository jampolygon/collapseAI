import { useEffect, useMemo, useState } from 'react';
import { KITS, MODELS, PACKS, modelKey, packKey } from '../lib/catalog';
import { recommendModel, fmtBytes, fmtMB } from '../lib/device';
import { enqueue, importFile, pause, removeDownload, resume, type DLItem } from '../lib/downloads';
import { useDevice, useLocalState } from '../hooks';
import { Icon, packIcon, plainLabel } from '../components/Icon';
import { Status, type StatusState } from '../components/Status';
import { cacheLabel, type SystemSnapshot } from '../ui/system';
import { Skeleton } from '../components/Skeleton';
import { InstallCard } from '../components/Install';

const TIPS = [
  'Use Wi-Fi if you can. Big downloads can eat your mobile data.',
  'Keep the screen on and the charger plugged in while downloading.',
  'If the signal drops, resume the download. Completed parts stay on this device.',
  'Download now, while internet still works. In a disaster, the network is the first thing to go.',
  'After downloading, check the app cache and test a reload in airplane mode.',
  'Smaller AI = faster answers. You can always download a smarter one later.',
  'Pick only the topics you need to save space. You can add more anytime.',
];

interface Props {
  downloads: DLItem[];
  online: boolean;
  onGoSurvive: () => void;
  system: SystemSnapshot;
  modelName: string | null;
}

export default function Prepare({ downloads, online, onGoSurvive, system, modelName }: Props) {
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
  const selectedPacksDone = packIds.filter(id => byKey.get(packKey(id))?.status === 'done').length;
  const selectedModelDownload = model ? byKey.get(modelKey(model.id)) : undefined;
  const selectedFinished = !!model && selectedModelDownload?.status === 'done' && selectedPacksDone === packIds.length;
  const cacheState = (value: SystemSnapshot['appCache']): StatusState => value === 'cached' ? 'ready' : value === 'checking' ? 'busy' : value === 'error' ? 'error' : 'pending';

  return (
    <div className="page-content prepare-page">
      <InstallCard />
      <header className="page-intro"><span className="eyebrow">Prepare / System setup</span><h2>Set up for offline use.</h2><p>Download your model and knowledge while you have a connection.<br />Keep track of what is stored, cached, and actually loaded.</p></header>
      {!online && (
        <div className="banner warn" role="status"><Icon name="info" size={18} /><span className="banner-label">Offline</span><span>Connection errors will retry when the network returns. Paused downloads need Resume.</span></div>
      )}
      <div className="setup-layout"><div className="setup-sections">
      {/* ---------- Device ---------- */}
      <section className="setup-section device-section">
        <div className="section-heading"><h3>Your device</h3><span className="muted tiny mono">Detected capabilities</span></div>
        {device ? (
          <div className="specs">
            <span><Icon name="monitor" size={16} />{device.mobile ? 'Phone' : 'Computer'}</span>
            <span>{device.ramKnown ? `${device.ramGB}${device.ramGB >= 8 ? '+' : ''} GB memory` : 'Memory unknown'}</span>
            <span>{device.cores} CPU cores</span>
            <span>{device.webgpu ? 'GPU available' : 'No GPU boost'}</span>
            <span>{fmtMB(device.freeStorageMB)} available storage estimate</span>
          </div>
        ) : (
          <Skeleton label="Checking your device…" lines={3} className="device-skeleton" />
        )}
      </section>

      {/* ---------- Step 1: model ---------- */}
      <section className="setup-section">
        <div className="section-heading"><h3>Local model</h3><span className="muted tiny">One model runs at a time</span></div>
        {rec && (
          <p className="muted">
            We recommend <b>{rec.model.name}</b>. {rec.reason}
          </p>
        )}
        <div className="grid">
          {!device && visibleModels.length === 0 && <Skeleton label="Finding a suitable model…" lines={3} className="model-choice-skeleton" />}
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
                <div className="muted small mono">
                  {fmtMB(m.sizeMB)} · {m.speed}
                </div>
                <p className="small">{m.blurb}</p>
                <div className="muted tiny mono">{m.family}</div>
              </label>
            );
          })}
        </div>
        <button className="link" onClick={() => setShowAllModels(!showAllModels)}>
          {showAllModels ? 'Show only recommended' : `Show all ${MODELS.length} AI models`}
        </button>
      </section>

      {/* ---------- Step 2: knowledge ---------- */}
      <section className="setup-section">
        <div className="section-heading"><h3>Knowledge packs</h3><span className="muted tiny">Choose a kit or select topics</span></div>
        <div className="kits">
          {KITS.map((k) => (
            <button key={k.id} aria-pressed={kitId === k.id} className={`kit ${kitId === k.id ? 'selected' : ''}`} onClick={() => chooseKit(k.id)}>
              <b>{k.name}</b>
              <small>{k.blurb}</small>
            </button>
          ))}
          <button aria-pressed={kitId === 'custom'} className={`kit ${kitId === 'custom' ? 'selected' : ''}`} onClick={() => setKitId('custom')}>
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
                <span className="pack-icon"><Icon name={packIcon(p.id)} size={19} /></span>
                <span className="pack-body">
                  <b>{p.name}</b> <span className="muted tiny mono">{dl?.status === 'done' ? fmtBytes(dl.total) : `~${fmtMB(p.sizeMB)} planned`}</span>
                  {dl?.status === 'done' && <span className="badge ok">Downloaded</span>}
                  <br />
                  <span className="small muted">{p.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="muted tiny">Catalog estimates reflect planned pack sizes. Current demo packs are smaller; downloaded sizes are shown after completion.</p>
      </section>

      {/* ---------- Step 3: download ---------- */}
      <section className="setup-section download-section">
        <div className="section-heading"><h3>Downloads</h3></div>
        <button className="primary big" disabled={nothingToDo} onClick={downloadAll}>
          <Icon name={selectedFinished ? 'check' : 'download'} size={18} />{nothingToDo ? (selectedFinished ? 'Selected files downloaded' : busy ? 'Downloads in progress' : 'Checking selected files') : `Download selected · ~${fmtMB(totalMB)}`}
        </button>
        <p className="tip"><Icon name="info" size={16} />{TIPS[tip]}</p>

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
              Go to Ask <Icon name="arrow" size={16} />
            </button>
          </>
        )}

        <details className="advanced">
          <summary>No internet? Import a model file from SD card / USB / a friend</summary>
          <p className="small muted">Choose a .gguf file you already have. It is copied into the app and works offline.</p>
          <label className="import-label">GGUF model file<input type="file" accept=".gguf" onChange={onImport} /></label>
        </details>
      </section>
      </div>
      <aside className="setup-overview" aria-label="Device readiness">
        <span className="eyebrow">On this device</span><h3>System status</h3>
        <div className="readiness-list">
          <Status label="App shell" value={cacheLabel(system.appCache)} state={cacheState(system.appCache)} loading={system.appCache === 'checking'} />
          <Status label="Knowledge" value={packIds.length ? `${selectedPacksDone}/${packIds.length} selected` : 'None selected'} state={packIds.length > 0 && selectedPacksDone === packIds.length ? 'ready' : 'pending'} />
          <Status label="Model file" value={selectedModelDownload?.status === 'done' ? 'Downloaded' : selectedModelDownload?.status === 'downloading' || selectedModelDownload?.status === 'queued' ? 'Downloading' : selectedModelDownload?.status === 'error' ? 'Download error' : selectedModelDownload?.status === 'paused' ? 'Paused' : 'Missing'} state={selectedModelDownload?.status === 'done' ? 'ready' : selectedModelDownload?.status === 'error' ? 'error' : selectedModelDownload?.status === 'downloading' || selectedModelDownload?.status === 'queued' ? 'busy' : 'pending'} />
          <Status label="Local AI" value={modelName ? `${modelName} loaded` : 'Not loaded'} state={modelName ? 'ready' : 'pending'} />
          <Status label="AI engine" value={modelName ? 'Initialized' : system.engineCache === 'cached' ? 'Cached · idle' : cacheLabel(system.engineCache)} state={modelName ? 'ready' : cacheState(system.engineCache)} loading={!modelName && system.engineCache === 'checking'} />
          <Status label="Network" value={online ? 'Online' : 'Offline'} state={online ? 'ready' : 'pending'} />
        </div>
        {system.cacheError && <p className="error small" role="alert">Cache check failed: {system.cacheError}</p>}
        <p className="muted tiny cache-note">{system.appCache === 'development' ? 'Development mode does not install the app cache. Use a production preview to check caching.' : 'Cached files and downloaded files are separate. Test a reload in airplane mode before relying on offline access.'}</p>
        <div className="storage-overview"><div className="section-heading"><span className="small">Browser storage</span><Icon name="monitor" size={16} /></div>{system.storage ? <><div className="storage-amount mono">{fmtBytes(system.storage.usage)}<span> used</span></div><div className="bar" role="progressbar" aria-label="Browser storage used" aria-valuenow={Math.round(system.storage.usage)} aria-valuemin={0} aria-valuemax={Math.max(1, Math.round(system.storage.quota))}><div style={{ width: `${Math.min(100, system.storage.quota ? system.storage.usage / system.storage.quota * 100 : 0)}%` }} /></div><p className="muted tiny mono">of {fmtBytes(system.storage.quota)} estimated quota</p></> : system.appCache === 'checking' ? <Skeleton label="Checking storage…" lines={2} /> : <p className="muted small">Storage estimate unavailable</p>}<p className="muted tiny">Includes this site's stored data and cache. Browser estimates may be rounded.</p></div>
      </aside></div>
    </div>
  );
}

function DownloadRow({ d }: { d: DLItem }) {
  const pct = d.total ? Math.min(100, (d.done / d.total) * 100) : 0;
  const eta = d.speed && d.total ? Math.round((d.total - d.done) / d.speed) : null;
  return (
    <div className="dl-row">
      <div className="dl-top">
        <b>{plainLabel(d.label)}</b>
        <span className="muted small mono">
          {d.status === 'done' ? fmtBytes(d.total) : `${fmtBytes(d.done)} / ${d.total ? fmtBytes(d.total) : '?'}`}
        </span>
      </div>
      {d.status !== 'done' && (
        <div className="bar" role="progressbar" aria-label={`${plainLabel(d.label)} download progress`} aria-valuenow={d.total ? Math.round(pct) : undefined} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="dl-bottom">
        <span className={`small mono status-${d.status}`} role={d.status === 'error' ? 'alert' : undefined}>
          {d.status === 'downloading' && `${pct.toFixed(0)}% · ${fmtBytes(d.speed ?? 0)}/s${eta !== null ? ` · ~${fmtEta(eta)} left` : ''}`}
          {d.status === 'queued' && 'Waiting…'}
          {d.status === 'paused' && 'Paused'}
          {d.status === 'error' && (d.error ?? 'Error')}
          {d.status === 'done' && <><Icon name="check" size={14} />Downloaded</>}
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
