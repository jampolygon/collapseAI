export type StatusState = 'ready' | 'pending' | 'busy' | 'error';

export function Status({ label, value, state = 'pending', loading = false }: { label: string; value: string; state?: StatusState; loading?: boolean }) {
  return <div className={`system-status status-${state}`}><span className="status-dot" aria-hidden="true" /><span className="status-label">{label}</span><span className="status-value" aria-busy={loading}>{loading ? <><span className="skeleton skeleton-inline" aria-hidden="true" /><span className="sr-only">{value}</span></> : value}</span></div>;
}
