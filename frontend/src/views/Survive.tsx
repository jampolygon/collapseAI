import { useState } from 'react';
import type { DLItem } from '../lib/downloads';
import type { Pack } from '../lib/knowledge';
import Ask from './Ask';
import Library from './Library';
import Tools from './Tools';

type Tab = 'ask' | 'library' | 'tools';

interface Props {
  downloads: DLItem[];
  packs: Pack[];
  onModelChange: () => void;
  onGoPrepare: () => void;
}

export default function Survive({ downloads, packs, onModelChange, onGoPrepare }: Props) {
  const [tab, setTab] = useState<Tab>('ask');
  return (
    <div className="stack">
      <div className="tabs">
        <button className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}>
          💬 Ask AI
        </button>
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
          📚 Library
        </button>
        <button className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>
          🧰 Tools
        </button>
      </div>

      {packs.length === 0 && tab !== 'tools' && (
        <div className="banner warn">
          No knowledge downloaded yet.{' '}
          <button className="link" onClick={onGoPrepare}>
            Go to Prepare →
          </button>
        </div>
      )}

      {tab === 'ask' && <Ask downloads={downloads} onModelChange={onModelChange} onGoPrepare={onGoPrepare} />}
      {tab === 'library' && <Library packs={packs} />}
      {tab === 'tools' && <Tools />}
    </div>
  );
}
