import { Badge, State, Table, fmtDate, kzt, useLoad, type Row, type Tab } from './shared';

/* ----------------------------------------------------------------------------------- дашборд */
export function Dashboard({ onOpen, onNavigate }: { onOpen: (id: string) => void; onNavigate: (tab: Tab) => void }) {
  const { data: d, err, loading, reload } = useLoad<Row>('dashboard');
  if (!d) return <><State err={err} loading={loading} />{err && <button className="pf-action-secondary pf-retry" onClick={() => void reload()}>Повторить загрузку</button>}</>;
  const months: Row[] = d.new_by_month ?? []; const max = Math.max(1, ...months.map((m) => Number(m.count)));
  const revenueMonths: Row[] = d.revenue_by_month ?? []; const maxRevenue = Math.max(1, ...revenueMonths.map((m) => Number(m.amount_kzt)));
  const cards: [string, string | number, string][] = [
    ['Доход за месяц', kzt(d.mrr_kzt), 'Регулярные платежи по подпискам'],
    ['Доход за год', kzt(d.arr_kzt), 'Расчёт по текущим подпискам'],
    ['Отмены за месяц', `${Number(d.churn_rate_pct ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, `Организаций отменили подписку: ${d.churned_this_month ?? 0}`],
    ['Выбрали тариф после пробного', `${Number(d.trial_conversion_pct ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`, 'Доля организаций, которые продолжили работу'],
    ['В среднем на организацию', kzt(d.arpu_kzt), 'Средний ежемесячный платёж'],
    ['Выручка за месяц', kzt(d.revenue_month_kzt), 'Подтверждённые платежи'],
  ];
  return (<>
    <div className="pf-dashboard-heading">
      <div><span className="pf-kicker">ОБЗОР ПЛАТФОРМЫ</span><h2>Рабочий день начинается здесь</h2><p className="muted">Все важные данные об организациях, оплате и обращениях собраны на одной странице.</p></div>
      <div className="pf-dashboard-actions"><button className="pf-action-secondary" onClick={() => void reload()} disabled={loading}>{loading ? 'Обновляем…' : '↻ Обновить'}</button><button className="pf-action-primary" onClick={() => onNavigate('Новая организация')}>＋ Новая организация</button></div>
    </div>
    <div className="pf-cards">{cards.map(([k, v, hint], index) => <div className={`card pf-metric pf-metric-${index}`} key={k}><span className="muted small">{k}</span><b className="big">{v}</b><span className="pf-metric-hint">{hint}</span></div>)}</div>
    <section className="card pf-panel"><div className="pf-panel-heading"><div><span className="pf-kicker">ВЫРУЧКА</span><h2>Платежи по месяцам</h2></div><span className="muted small">Последние 12 месяцев · ₸</span></div>
      {revenueMonths.length === 0 ? <p className="muted">Подтверждённых платежей пока нет.</p> : <div className="pf-revenue-chart" role="img" aria-label="Выручка по месяцам за последние 12 месяцев">{revenueMonths.map((m) => <div className="pf-revenue-column" key={m.month} title={`${m.month}: ${kzt(Number(m.amount_kzt))}`}><span>{kzt(Number(m.amount_kzt))}</span><i style={{ height: `${Math.max(3, Number(m.amount_kzt) / maxRevenue * 100)}%` }} /><small>{m.month}</small></div>)}</div>}</section>
    <section className="card pf-panel"><div className="pf-panel-heading"><div><span className="pf-kicker">ТРЕБУЮТ ВНИМАНИЯ</span><h2>Истекают за 7 дней</h2></div><button className="pf-link" onClick={() => onNavigate('Подписки')}>Все подписки <span aria-hidden="true">→</span></button></div>
      {(d.expiring ?? []).length === 0 ? <p className="muted">Нет.</p> : (
        <Table head={['Организация', 'Тариф', 'Статус', 'Окончание']}>{(d.expiring as Row[]).map((r) => (
          <tr key={r.tenant_id}><td><button className="pf-link" onClick={() => onOpen(r.tenant_id)}>{r.name ?? r.slug}</button></td><td>{r.plan}</td><td><Badge phase={r.phase} /></td><td>{fmtDate(r.ends_at)}</td></tr>))}</Table>)}</section>
    <section className="card pf-panel"><div className="pf-panel-heading"><div><span className="pf-kicker">РОСТ</span><h2>Новые организации по месяцам</h2></div><button className="pf-link" onClick={() => onNavigate('Организации')}>Список организаций <span aria-hidden="true">→</span></button></div>
      {months.length === 0 ? <p className="muted">Нет данных.</p> : months.map((m) => (
        <div className="pf-bar" key={m.month}><span>{m.month}</span><i style={{ width: `${(Number(m.count) / max) * 100}%` }} /><b>{m.count}</b></div>))}</section>
  </>);
}
