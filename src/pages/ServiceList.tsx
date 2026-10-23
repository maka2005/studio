import { useOutletContext } from 'react-router-dom';
import type { Ctx } from '../lib/tenant';
import { duration, money } from '../lib/format';
import { Arrow } from '../lib/icons';
import { useServices } from '../lib/useServices';
export function ServiceList({ limit }: { limit?: number }) {
  const { b, openBooking } = useOutletContext<Ctx>(); const services = useServices(b);
  return (<div className="card list">{services.slice(0, limit).map((s) => (
    <button key={s.name} className="svc" onClick={() => openBooking(s.name)}>
      <span><b>{s.name}</b><br /><span className="muted small">{duration(s.duration_minutes)}</span></span>
      <span className="right"><b>{s.price_from ? 'от ' : ''}{money(s.price, b.currency)}</b><br /><span className="muted small">Выбрать</span></span><Arrow /></button>))}</div>);
}
export function ServicesPage() {
  return <section className="pad"><h2>Услуги</h2><ServiceList /></section>;
}
