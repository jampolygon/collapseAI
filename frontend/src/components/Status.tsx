export type StatusState = 'ready' | 'pending' | 'busy' | 'error';

/**
 * One system indicator. On phones the header shows only a colored dot + short label
 * (green ready / amber pending / red error); the full "label: value" stays available
 * to screen readers and as a tooltip.
 */
export function Status({ label, value, state = 'pending', loading = false, short }: { label: string; value: string; state?: StatusState; loading?: boolean; short?: string }) {
  return (
    <div className={`system-status status-${state}`} title={`${label}: ${value}`} role="status" aria-label={`${label}: ${value}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label" aria-hidden="true">
        <span className="label-long">{label}</span>
        {short && <span className="label-short">{short}</span>}
      </span>
      <span className="status-value" aria-hidden="true">
        {loading ? <span className="skeleton skeleton-inline" aria-hidden="true" /> : value}
      </span>
    </div>
  );
}
