import { useEffect, useRef, type ReactNode } from 'react';
import { Close } from '../lib/icons';
export function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus(); document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; prev?.focus(); };
  }, []);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="grab" />
        <div className="sheet-head"><div><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>
          <button className="icon-btn" aria-label="Закрыть" onClick={onClose}><Close /></button></div>
        {children}
      </div>
    </div>);
}
