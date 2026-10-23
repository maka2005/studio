import { useOutletContext } from 'react-router-dom';
import type { Ctx } from '../lib/tenant';
import { duration, money } from '../lib/format';
import { Arrow, Car, Drop, Shield, Sparkle } from '../lib/icons';
import { useServices } from '../lib/useServices';
const ICONS = [Drop, Car, Sparkle, Shield];
export function ServiceList({ limit }: { limit?: number }) {
  const { b, openBooking } = useOutletContext<Ctx>(); const services = useServices(b);
  return (<div className="card list">{services.slice(0, limit).map((s, i) => { const Icon = ICONS[i % ICONS.length]!; return (
    <button key={s.name} className="svc" onClick={() => openBooking(s.name)}>
      <span className="sico"><Icon /></span>
      <span style={{ flex: 1 }}><b>{s.name}</b><br /><span className="muted small">{duration(s.duration_minutes)}</span></span>
      <span className="right"><b>{s.price_from ? 'от ' : ''}{money(s.price, b.currency)}</b><br /><span className="muted small">Выбрать</span></span><Arrow /></button>); })}</div>);
}
export function ServicesPage() {
  return <section className="page"><h2>Услуги</h2><ServiceList /></section>;
}
