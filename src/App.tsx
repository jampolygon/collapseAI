import { useEffect, useMemo, useState } from 'react';
import { useDownloads, useOnline } from './hooks';
import { loadKnowledge, type Pack } from './lib/knowledge';
import { loadedModel } from './lib/llm';
import Prepare from './views/Prepare';
import Survive from './views/Survive';

type Mode = 'prepare' | 'survive';

export default function App() {
  const online = useOnline();
  const downloads = useDownloads();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [modelName, setModelName] = useState<string | null>(null);

  // Rebuild the search index whenever the set of finished packs changes.
  const donePacks = useMemo(
    () => downloads.filter((d) => d.key.startsWith('pack:') && d.status === 'done').map((d) => d.key).sort().join(','),
    [downloads],
  );
  useEffect(() => {
    loadKnowledge().then(setPacks);
  }, [donePacks]);

  const hasAnything = downloads.some((d) => d.status === 'done');
  const [mode, setMode] = useState<Mode | null>(null);
  const active: Mode = mode ?? (hasAnything ? 'survive' : 'prepare');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▲</span> CollapseAI
        </div>
        <div className="pills">
          <span className={`pill ${online ? 'on' : 'off'}`}>{online ? '● Online' : '● Offline'}</span>
          <span className={`pill ${modelName ? 'on' : ''}`}>{modelName ? `AI: ${modelName}` : 'AI: not loaded'}</span>
        </div>
      </header>

      <nav className="modes">
        <button className={active === 'prepare' ? 'active' : ''} onClick={() => setMode('prepare')}>
          <b>Prepare</b>
          <small>download while you have internet</small>
        </button>
        <button className={active === 'survive' ? 'active' : ''} onClick={() => setMode('survive')}>
          <b>Survive</b>
          <small>works fully offline</small>
        </button>
      </nav>

      <main>
        {active === 'prepare' ? (
          <Prepare downloads={downloads} online={online} onGoSurvive={() => setMode('survive')} />
        ) : (
          <Survive
            downloads={downloads}
            packs={packs}
            onModelChange={() => setModelName(loadedModel()?.name ?? null)}
            onGoPrepare={() => setMode('prepare')}
          />
        )}
      </main>
    </div>
  );
}
