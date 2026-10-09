export function Skeleton({ label, lines = 3, className = '' }: { label: string; lines?: number; className?: string }) {
  return (
    <div className={`skeleton-group ${className}`} role="status" aria-busy="true">
      <span className="skeleton-caption muted small">{label}</span>
      <div className="skeleton-lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => <span key={index} className="skeleton skeleton-line" style={{ width: `${[100, 86, 62][index % 3]}%` }} />)}
      </div>
    </div>
  );
}
