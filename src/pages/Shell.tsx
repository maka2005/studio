import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, loadBusiness, type Ctx } from '../lib/tenant';
import { Calendar, Grid, Home, Sparkle, User } from '../lib/icons';
import { BookingFlow } from '../components/BookingFlow';
import { AssistantSheet } from '../components/AssistantSheet';
export function Shell() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const isOwner = location.pathname.includes('/owner');
  const q = useQuery({ queryKey: ['business', slug], queryFn: () => loadBusiness(slug) });
  const [booking, setBooking] = useState<{ service?: string } | null>(null);
  const [ai, setAi] = useState(false);
  const b = q.data;
  useEffect(() => {
    if (!b) return;
    document.title = b.name; document.documentElement.style.setProperty('--accent', b.accent);
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = `/tenants/${slug}.webmanifest`; document.head.appendChild(l);
    return () => { l.remove(); };
  }, [b, slug]);
  if (q.isPending) return <p className="pad muted">Загрузка…</p>;
  if (q.isError || !b) return <p className="pad">Студия не найдена. <button className="link" onClick={() => q.refetch()}>Повторить</button></p>;
  const base = `/s/${slug}`;
  const ctx: Ctx = { b, openBooking: (service) => setBooking({ service }), openGuide: () => setAi(true) };
  return (<>
    <header className="top"><Link to={base} className="brand"><img src={assetUrl(slug, b.images.logo)} alt="" width={40} height={40} />{b.short_name}</Link>
      {b.client_profile && <Link to={`${base}/profile`} className="icon-btn" aria-label="Профиль"><User /></Link>}</header>
    <main className={isOwner ? 'admin-main' : undefined}><Outlet context={ctx} /></main>
    {!isOwner && <div className="page legal-links"><Link to={`${base}/legal/privacy`}>Политика конфиденциальности</Link><Link to={`${base}/legal/terms`}>Условия использования</Link><Link to={`${base}/legal/consent`}>Согласие на обработку данных</Link><Link to={`${base}/legal/storage`}>Локальное хранилище</Link></div>}
    {!isOwner && <button className="fab" aria-label="Подобрать услугу бесплатно" onClick={ctx.openGuide}><Sparkle /></button>}
    {!isOwner && <nav className="tabs" aria-label="Разделы">
      <NavLink end to={base}><Home />Главная</NavLink><NavLink to={`${base}/services`}><Grid />Услуги</NavLink><NavLink to={`${base}/booking`}><Calendar />Моя запись</NavLink></nav>
    }
    {booking && <BookingFlow b={b} initialService={booking.service} onClose={() => setBooking(null)} />}
    {ai && <AssistantSheet slug={slug} currency={b.currency} onSelectService={(service) => { setAi(false); setBooking({ service }); }} onClose={() => setAi(false)} />}
  </>);
}
