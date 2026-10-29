import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Ctx } from '../lib/tenant';
import { duration, money } from '../lib/format';
import { Arrow, Car, Drop, Shield, Sparkle } from '../lib/icons';
import { useServices } from '../lib/useServices';
import { useFavorites } from '../lib/favorites';
import { ALL_SERVICES_CATEGORY, filterServices, serviceCategories } from '../lib/serviceCatalog';
const ICONS = [Drop, Car, Sparkle, Shield];
export function ServiceList({ limit }: { limit?: number }) {
  const { b, openBooking } = useOutletContext<Ctx>(); const services = useServices(b); const favorites = useFavorites(b.slug);
  const [onlyFavorites, setOnlyFavorites] = useState(false); const [search, setSearch] = useState(''); const [category, setCategory] = useState(ALL_SERVICES_CATEGORY);
  const categories = useMemo(() => serviceCategories(services), [services]);
  const matching = limit ? services : filterServices(services, search, category);
  const shown = matching.slice(0, limit).filter((s) => !onlyFavorites || favorites.has(s.name));
  return (<>
    {!limit && <>
      <label className="sr-only" htmlFor={`service-search-${b.slug}`}>Поиск услуг</label>
      <input id={`service-search-${b.slug}`} className="field catalog-search" type="search" placeholder="Найти услугу по названию" value={search} onChange={(e) => setSearch(e.target.value)} />
      {categories.length > 1 && <div className="service-category-filter" aria-label="Категории услуг">
        {[ALL_SERVICES_CATEGORY, ...categories].map((item) => <button key={item} className={`chip ${category === item ? 'sel' : ''}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>}
      <div className="row between" style={{ margin: '0 0 12px' }}><span className="muted small">{matching.length} из {services.length} услуг</span><button className="link" aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}>{onlyFavorites ? 'Показать все' : `Избранное · ${favorites.items.length}`}</button></div>
    </>}
    <div className="card list">{shown.map((s, i) => { const Icon = ICONS[i % ICONS.length]!; const saved = favorites.has(s.name); return (
      <div key={s.name} className="svc">
        <span className="sico"><Icon /></span>
        <button className="service-choice" onClick={() => openBooking(s.name)}>
          <span className="service-info"><b>{s.name}</b><span className="muted small">{s.category} · {duration(s.duration_minutes)}</span></span>
          <span className="service-price"><b>{s.price_from ? 'от ' : ''}{money(s.price, b.currency)}</b><span className="muted small">Записаться</span></span>
          <Arrow className="service-arrow" />
        </button>
        <button className={`favorite-toggle ${saved ? 'is-favorite' : ''}`} type="button" aria-label={saved ? `Убрать ${s.name} из избранного` : `Добавить ${s.name} в избранное`} aria-pressed={saved} onClick={() => favorites.toggle(s.name)}>{saved ? '♥' : '♡'}</button>
      </div>); })}
      {shown.length === 0 && <p className="muted">{onlyFavorites ? 'Под этим фильтром нет избранных услуг. Нажмите ♡ рядом с услугой, чтобы добавить её.' : !limit && (search || category !== ALL_SERVICES_CATEGORY) ? 'По этому запросу услуг нет. Измените поиск или категорию.' : 'Услуг пока нет.'}</p>}
    </div></>);
}
export function ServicesPage() {
  return <section className="page"><h2>Услуги</h2><ServiceList /></section>;
}
