import type { DLItem } from '../lib/downloads';
import type { Pack } from '../lib/knowledge';
import Ask from './Ask';
import Library from './Library';
import Tools from './Tools';
import { Skeleton } from '../components/Skeleton';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { lazy, Suspense } from 'react';
import type { Theme } from '../ui/theme';

const OfflineMapPage = lazy(() => import('../features/map/OfflineMapPage'));

export type Tab = 'ask' | 'library' | 'tools' | 'map';

interface Props {
  downloads: DLItem[];
  packs: Pack[];
  tab: Tab;
  online: boolean;
  theme: Theme;
  knowledgeLoading: boolean;
  onModelChange: () => void;
  onGoPrepare: () => void;
}

export default function Survive({ downloads, packs, tab, online, theme, knowledgeLoading, onModelChange, onGoPrepare }: Props) {
  return (
    <div className={`survive-view ${tab === 'ask' ? 'ask-layout' : ''}`}>
      {!knowledgeLoading && packs.length === 0 && tab !== 'tools' && tab !== 'map' && (
        <div className="banner warn knowledge-notice">
          No knowledge downloaded yet.{' '}
          <button className="link" onClick={onGoPrepare}>
            Go to Prepare →
          </button>
        </div>
      )}

      {tab === 'ask' && <Ask downloads={downloads} onModelChange={onModelChange} onGoPrepare={onGoPrepare} />}
      {tab === 'library' && (knowledgeLoading ? <div className="page-content"><Skeleton label="Loading your knowledge library" lines={6} className="library-skeleton" /></div> : <Library packs={packs} />)}
      {tab === 'tools' && <Tools />}
      {tab === 'map' && <ErrorBoundary message="The map could not load. It may not be saved for offline use yet: open Map once while you are online, then it works offline."><Suspense fallback={<div className="page-content"><Skeleton label="Loading offline maps" lines={5} /></div>}><OfflineMapPage online={online} theme={theme} /></Suspense></ErrorBoundary>}
    </div>
  );
}
