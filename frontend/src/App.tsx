import { useEffect, useMemo, useRef, useState } from 'react';
import { useDownloads, useLocalState, useOnline } from './hooks';
import { loadKnowledge, type Pack } from './lib/knowledge';
import { loadedModel } from './lib/llm';
import Prepare from './views/Prepare';
import Survive, { type Tab } from './views/Survive';
import { Icon, type IconName } from './components/Icon';
import { Status } from './components/Status';
import { useTheme, useMobile, type Theme } from './ui/theme';
import { useSystemSnapshot } from './ui/system';
import { Tooltip } from './components/Tooltip';

type Mode = 'prepare' | 'survive';

export default function App() {
  const online = useOnline();
  const downloads = useDownloads();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [modelName, setModelName] = useState<string | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);

  // Rebuild the search index whenever the set of finished packs changes.
  const donePacks = useMemo(
    () => downloads.filter((d) => d.key.startsWith('pack:') && d.status === 'done').map((d) => d.key).sort().join(','),
    [downloads],
  );
  useEffect(() => {
    setKnowledgeLoading(true);
    loadKnowledge().then(setPacks).finally(() => setKnowledgeLoading(false));
  }, [donePacks]);

  const hasAnything = downloads.some((d) => d.status === 'done');
  const [mode, setMode] = useState<Mode | null>(null);
  const active: Mode = mode ?? (hasAnything ? 'survive' : 'prepare');
  const [tab, setTab] = useState<Tab>('ask');
  const [collapsed, setCollapsed] = useLocalState('cai.sidebar.collapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const mobile = useMobile();
  const system = useSystemSnapshot(downloads);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const screen = active === 'prepare' ? 'prepare' : tab;
  const navigation: { id: 'prepare' | Tab; label: string; icon: IconName }[] = [
    { id: 'ask', label: 'Ask', icon: 'ask' },
    { id: 'prepare', label: 'Prepare', icon: 'download' },
    { id: 'library', label: 'Library', icon: 'book' },
    { id: 'tools', label: 'Tools', icon: 'tools' },
    { id: 'map', label: 'Map', icon: 'compass' },
  ];
  const navigate = (id: 'prepare' | Tab) => {
    if (id === 'prepare') setMode('prepare');
    else { setTab(id); setMode('survive'); }
    setDrawerOpen(false);
  };

  // Drawer focus and Escape behavior are UI-only; underlying screen lifetimes stay unchanged.
  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    const previous = menuRef.current ?? document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawerOpen(false); }
      if (event.key === 'Tab' && sidebar) {
        const elements = Array.from(sidebar.querySelectorAll<HTMLElement>('button, select, a[href]')).filter(el => !el.hasAttribute('disabled'));
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [mobile, drawerOpen]);

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''} ${drawerOpen ? 'drawer-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {mobile && drawerOpen && <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} tabIndex={-1} />}
      <aside id="app-navigation" ref={sidebarRef} className="sidebar" inert={mobile && !drawerOpen} role={mobile && drawerOpen ? 'dialog' : undefined} aria-modal={mobile && drawerOpen ? true : undefined} aria-label="Main navigation">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3 19 12 4l9 15H3Z" stroke="currentColor" strokeWidth="1.6" /><path d="M8 19 12 12l4 7" stroke="currentColor" strokeWidth="1.6" /></svg></span>
          <div className="brand-copy"><strong>CollapseAI</strong><span>Offline survival system</span></div>
          {mobile && <button className="icon-button drawer-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><Icon name="close" /></button>}
        </div>
        <nav aria-label="Screens" className="sidebar-nav">
          <span className="nav-caption">Workspace</span>
          {navigation.map(item => <Tooltip key={item.id} label={item.label} disabled={!collapsed || mobile}><button className={`nav-item ${screen === item.id ? 'active' : ''}`} aria-current={screen === item.id ? 'page' : undefined} aria-label={item.label} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span className="nav-label">{item.label}</span>{screen === item.id && <span className="nav-active-marker" aria-hidden="true" />}</button></Tooltip>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note"><Icon name="cpu" size={18} /><div><span>Local processing</span><small>Models run on this device.</small></div></div>
          <Tooltip label="Appearance" disabled={!collapsed || mobile}><label className="theme-control"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} /><span className="sr-only">Appearance</span><select aria-label="Appearance" value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="light">Light theme</option><option value="dark">Dark theme</option></select></label></Tooltip>
          {!mobile && <Tooltip label="Expand sidebar" disabled={!collapsed}><button className="sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><Icon name="panel" size={18} /><span>Collapse sidebar</span></button></Tooltip>}
        </div>
      </aside>

      <div className="workspace" inert={mobile && drawerOpen}>
        <header className="workspace-header">
          <div className="workspace-title">{mobile && <button ref={menuRef} className="icon-button" aria-label="Open navigation" aria-controls="app-navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Icon name="menu" /></button>}<h1>{navigation.find(item => item.id === screen)?.label}</h1><span className="header-divider" /><span className="workspace-subtitle">{screen === 'ask' ? 'Local assistance' : screen === 'prepare' ? 'System setup' : screen === 'library' ? 'Downloaded knowledge' : screen === 'map' ? 'Offline maps' : 'Field utilities'}</span></div>
          <div className="header-statuses" aria-label="System status"><Status label="Local AI" value={modelName ?? 'Not loaded'} state={modelName ? 'ready' : 'pending'} /><Status label="Knowledge" value={knowledgeLoading ? 'Loading' : packs.length ? `${packs.length} loaded` : 'Missing'} state={knowledgeLoading ? 'busy' : packs.length ? 'ready' : 'pending'} loading={knowledgeLoading} /><Status label="Network" value={online ? 'Online' : 'Offline'} state={online ? 'ready' : 'pending'} /></div>
        </header>
        <main id="main-content" tabIndex={-1} className={`main-content screen-${screen}`}>
        {active === 'prepare' ? (
          <Prepare downloads={downloads} online={online} system={system} modelName={modelName} onGoSurvive={() => navigate('ask')} />
        ) : (
          <Survive
            downloads={downloads}
            packs={packs}
            tab={tab}
            online={online}
            theme={theme}
            knowledgeLoading={knowledgeLoading}
            onModelChange={() => setModelName(loadedModel()?.name ?? null)}
            onGoPrepare={() => setMode('prepare')}
          />
        )}
        </main>
      </div>
    </div>
  );
}
