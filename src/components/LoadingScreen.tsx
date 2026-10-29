export function LoadingScreen({ label = 'Загружаем сайт…', compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`loading-screen ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
    <span className="loading-mark" aria-hidden="true"><i /><i /><i /></span>
    <b>{label}</b>
    <span className="loading-caption">Подготавливаем данные студии</span>
  </div>;
}
