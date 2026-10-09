import { useMemo, useState } from 'react';
import { allArticles, search, type Pack } from '../lib/knowledge';

export default function Library({ packs }: { packs: Pack[] }) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const articles = useMemo(() => allArticles(), [packs]);

  const shown = useMemo(() => {
    if (!q.trim()) return articles;
    const ids = new Set(search(q, 20).map((p) => `${p.packId}/${p.articleId}`));
    return articles.filter((a) => ids.has(`${a.packId}/${a.id}`));
  }, [q, articles]);

  const open = articles.find((a) => `${a.packId}/${a.id}` === openId);
  if (open) {
    return (
      <section className="card article">
        <button className="link" onClick={() => setOpenId(null)}>
          ← Back
        </button>
        <h2>{open.title}</h2>
        <div className="muted small">{open.category}</div>
        {open.text.split(/\n\s*\n/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {open.source && <p className="muted tiny">Source: {open.source}</p>}
      </section>
    );
  }

  const byCat = new Map<string, typeof shown>();
  shown.forEach((a) => byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]));

  return (
    <div className="stack">
      <input className="search" placeholder="Search the offline library… (e.g. paso, flood, water)" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="muted small">
        {packs.length} pack{packs.length === 1 ? '' : 's'} · {articles.length} articles · works without the AI
      </p>
      {[...byCat.entries()].map(([cat, list]) => (
        <section key={cat} className="card compact">
          <h3>{cat}</h3>
          {list.map((a) => (
            <button key={`${a.packId}/${a.id}`} className="article-link" onClick={() => setOpenId(`${a.packId}/${a.id}`)}>
              {a.title}
            </button>
          ))}
        </section>
      ))}
      {shown.length === 0 && packs.length > 0 && <p className="muted">No articles match.</p>}
    </div>
  );
}
