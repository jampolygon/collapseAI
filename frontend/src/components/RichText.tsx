import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>);
}

// A deliberately small, text-only renderer for local answers and articles.
// React escapes everything; generated HTML and executable links are never interpreted.
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h3 key={i}>{inline(line.replace(/^#{1,6}\s+/, ''))}</h3>);
      i++; continue;
    }
    const ordered = /^\s*\d+[.)]\s+/.test(line);
    const listPattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
    if (listPattern.test(line)) {
      const key = i;
      const start = ordered ? Number(line.match(/\d+/)?.[0] ?? 1) : undefined;
      const entries: ReactNode[] = [];
      while (i < lines.length && listPattern.test(lines[i])) {
        entries.push(<li key={i}>{inline(lines[i].replace(listPattern, ''))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key} start={start}>{entries}</ol> : <ul key={key}>{entries}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const key = i;
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key}>{inline(quote.join('\n'))}</blockquote>);
      continue;
    }
    const key = i;
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i])) paragraph.push(lines[i++]);
    const content = paragraph.join('\n');
    blocks.push(<p key={key} className={/^(warning|caution|do not|do NOT|important):/i.test(content) ? 'text-warning' : undefined}>{inline(content)}</p>);
  }
  return <div className="rich-text">{blocks}</div>;
}
