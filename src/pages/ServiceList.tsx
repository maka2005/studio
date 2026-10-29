import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Ctx } from '../lib/tenant';
import { duration, money } from '../lib/format';
import { Arrow, Car, Drop, Shield, Sparkle } from '../lib/icons';
import { useServices } from '../lib/useServices';
import { useFavorites } from '../lib/favorites';
const ICONS = [Drop, Car, Sparkle, Shield];
export function ServiceList({ limit }: { limit?: number }) {
  const { b, openBooking } = useOutletContext<Ctx>(); const services = useServices(b); const favorites = useFavorites(b.slug);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const shown = services.slice(0, limit).filter((s) => !onlyFavorites || favorites.has(s.name));
  return (<>
    {!limit && <div className="row between" style={{ margin: '0 0 12px' }}><span className="muted small">{services.length} {services.length === 1 ? 'услуга' : services.length >= 2 && services.length <= 4 ? 'услуги' : 'услуг'}</span><button className="link" aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}>{onlyFavorites ? 'Показать все' : `Избранное · ${favorites.items.length}`}</button></div>}
    <div className="card list">{shown.map((s, i) => { const Icon = ICONS[i % ICONS.length]!; const saved = favorites.has(s.name); return (
      <div key={s.name} className="svc">
        <span className="sico"><Icon /></span>
        <button className="service-choice" onClick={() => openBooking(s.name)}>
          <span className="service-info"><b>{s.name}</b><span className="muted small">{duration(s.duration_minutes)}</span></span>
          <span className="service-price"><b>{s.price_from ? 'от ' : ''}{money(s.price, b.currency)}</b><span className="muted small">Записаться</span></span>
          <Arrow className="service-arrow" />
        </button>
        <button className={`favorite-toggle ${saved ? 'is-favorite' : ''}`} type="button" aria-label={saved ? `Убрать ${s.name} из избранного` : `Добавить ${s.name} в избранное`} aria-pressed={saved} onClick={() => favorites.toggle(s.name)}>{saved ? '♥' : '♡'}</button>
      </div>); })}
      {shown.length === 0 && <p className="muted">Здесь пока ничего нет. Нажмите ♡ у понравившейся услуги, чтобы сохранить её.</p>}
    </div></>);
}
export function ServicesPage() {
  return <section className="page"><h2>Услуги</h2><ServiceList /></section>;
}
