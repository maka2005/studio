import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Ctx } from '../lib/tenant';
import { duration, money } from '../lib/format';
import { Arrow, Car, Drop, Shield, Sparkle } from '../lib/icons';
import { useServices } from '../lib/useServices';
import { useFavorites } from '../lib/favorites';
import { allServicesCategory, filterServices, serviceCategories } from '../lib/serviceCatalog';
import { useClientMessages } from '../lib/clientLocale';
const ICONS = [Drop, Car, Sparkle, Shield];
export function ServiceList({ limit }: { limit?: number }) {
  const { b, openBooking, bookingOpen } = useOutletContext<Ctx>();
  const { locale, m } = useClientMessages();
  const services = useServices(b); const favorites = useFavorites(b.slug);
  const [onlyFavorites, setOnlyFavorites] = useState(false); const [search, setSearch] = useState(''); const [category, setCategory] = useState(allServicesCategory(locale));
  useEffect(() => { setCategory(allServicesCategory(locale)); setSearch(''); }, [locale]);
  const categories = useMemo(() => serviceCategories(services, locale), [services, locale]);
  const matching = limit ? services : filterServices(services, search, category, locale);
  const shown = matching.slice(0, limit).filter((s) => !onlyFavorites || favorites.has(s.name));
  return (<>
    {!limit && <>
      {bookingOpen === false && <p className="note" role="status">{m.services.pausedNote}</p>}
      <label className="sr-only" htmlFor={`service-search-${b.slug}`}>{m.services.searchLabel}</label>
      <input id={`service-search-${b.slug}`} className="field catalog-search" type="search" placeholder={m.services.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      {categories.length > 1 && <div className="service-category-filter" aria-label={m.services.categoriesLabel}>
        {[allServicesCategory(locale), ...categories].map((item) => <button key={item} className={`chip ${category === item ? 'sel' : ''}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>}
      <div className="catalog-toolbar"><span className="muted small">{m.services.count(shown.length, matching.length)}</span><button className={`favorites-filter ${onlyFavorites ? 'active' : ''}`} aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}><span aria-hidden="true">♡</span>{m.services.favorites}<span className="favorites-count">{favorites.items.length}</span></button></div>
    </>}
    <div className="card list">{shown.map((s, i) => { const Icon = ICONS[i % ICONS.length]!; const saved = favorites.has(s.name); return (
      <div key={s.name} className="svc">
        <span className="sico"><Icon /></span>
        <button className="service-choice" onClick={() => openBooking(s.name)}>
          <span className="service-info"><b>{s.name}</b><span className="muted small">{s.category} · {duration(s.duration_minutes)}</span></span>
          <span className="service-price"><b>{s.price_from ? m.common.from : ''}{money(s.price, b.currency)}</b><span className="muted small">{m.services.book}</span></span>
          <Arrow className="service-arrow" />
        </button>
        <button className={`favorite-toggle ${saved ? 'is-favorite' : ''}`} type="button" aria-label={saved ? m.services.removeFavorite(s.name) : m.services.addFavorite(s.name)} aria-pressed={saved} onClick={() => favorites.toggle(s.name)}><span aria-hidden="true">{saved ? '♥' : '♡'}</span></button>
      </div>); })}
      {shown.length === 0 && <p className="muted">{onlyFavorites ? m.services.noFavorites : !limit && (search || category !== allServicesCategory(locale)) ? m.services.noResults : m.services.empty}</p>}
    </div></>);
}
export function ServicesPage() {
  const { m } = useClientMessages();
  return <section className="page"><h2>{m.services.pageTitle}</h2><ServiceList /></section>;
}
