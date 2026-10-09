import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A portal keeps floating icon labels outside the sidebar's clipping boundary.
export function Tooltip({ label, children, disabled = false }: { label: string; children: ReactNode; disabled?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    if (disabled || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPosition({ left: rect.right + 12, top: rect.top + rect.height / 2 });
  };
  const hide = () => setPosition(null);
  useEffect(() => {
    if (disabled) setPosition(null);
  }, [disabled]);
  useEffect(() => {
    if (!position) return;
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [position]);
  return (
    <span ref={anchor} className="tooltip-anchor" onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide} onKeyDown={event => { if (event.key === 'Escape') hide(); }}>
      {children}
      {!disabled && position && createPortal(<span role="tooltip" className="floating-label" style={position}>{label}</span>, document.body)}
    </span>
  );
}
