import { useMemo, useState } from 'react';
import { search, type Pack } from '../lib/knowledge';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';

export default function Library({ packs }: { packs: Pack[] }) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [packFilter, setPackFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const articles = useMemo(() => packs.flatMap(pack => pack.articles.map(article => ({ ...article, packId: pack.id }))), [packs]);

  const matched = useMemo(() => {
    if (!q.trim()) return articles;
    const ids = new Set(search(q, 20).map((p) => `${p.packId}/${p.articleId}`));
    return articles.filter((a) => ids.has(`${a.packId}/${a.id}`));
  }, [q, articles]);
  const categories = [...new Set(articles.map(article => article.category))].sort();
  const shown = useMemo(() => matched.filter(article => (packFilter === 'all' || article.packId === packFilter) && (categoryFilter === 'all' || article.category === categoryFilter)), [matched, packFilter, categoryFilter]);

  const open = articles.find((a) => `${a.packId}/${a.id}` === openId);
  if (open) {
    return (
      <article className="page-content article">
        <button className="link" onClick={() => setOpenId(null)}>
          <Icon name="back" size={16} />Back to library
        </button>
        <header className="article-header"><span className="eyebrow">{packs.find(pack => pack.id === open.packId)?.name} / {open.category}</span><h2>{open.title}</h2><span className="muted tiny mono">Downloaded knowledge · available without AI</span></header>
        <RichText text={open.text} />
        {open.source && <p className="muted tiny">Source: {open.source}</p>}
      </article>
    );
  }

  const byCat = new Map<string, typeof shown>();
  shown.forEach((a) => byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]));

  return (
    <div className="page-content library-page">
      <header className="page-intro"><span className="eyebrow">Library / Reference knowledge</span><h2>Survival knowledge.</h2><p>Browse practical guidance from your downloaded packs.<br />No model or network connection needed to read.</p></header>
      <div className="library-controls"><div className="search-field"><Icon name="search" size={18} /><label className="sr-only" htmlFor="library-search">Search downloaded knowledge</label><input id="library-search" className="search" placeholder="Search knowledge… try paso, flood, water" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button className="icon-button" aria-label="Clear search" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}</div><div className="library-filters"><label><span>Pack</span><select value={packFilter} onChange={event => setPackFilter(event.target.value)}><option value="all">All packs</option>{packs.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label><label><span>Category</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label></div></div>
      <p className="muted small library-count mono" role="status">
        {packs.length} pack{packs.length === 1 ? '' : 's'} · {shown.length} of {articles.length} articles
      </p>
      {[...byCat.entries()].map(([cat, list]) => (
        <section key={cat} className="article-group">
          <div className="section-heading"><h3>{cat}</h3><span className="muted tiny mono">{list.length} article{list.length === 1 ? '' : 's'}</span></div>
          {list.map((a) => (
            <button key={`${a.packId}/${a.id}`} className="article-link" onClick={() => setOpenId(`${a.packId}/${a.id}`)}>
              <Icon name="file" size={18} /><span className="article-list-title">{a.title}<small>{packs.find(pack => pack.id === a.packId)?.name} · Available offline</small><span className="article-list-meta">{a.source && <small>Source: {a.source}</small>}{a.last_verified && <small>Last verified: {a.last_verified}</small>}</span></span><Icon name="arrow" size={16} />
            </button>
          ))}
        </section>
      ))}
      {shown.length === 0 && packs.length > 0 && <div className="list-empty"><Icon name="search" size={24} /><h3>No matching articles</h3><p className="muted">Try other keywords or change the pack and category filters.</p><button onClick={() => { setQ(''); setPackFilter('all'); setCategoryFilter('all'); }}>Clear filters</button></div>}
      {packs.length === 0 && <div className="list-empty"><Icon name="book" size={24} /><h3>Your library is empty</h3><p className="muted">Download knowledge packs in Prepare to read them here.</p></div>}
    </div>
  );
}
