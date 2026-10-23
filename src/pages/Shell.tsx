import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, loadBusiness, type Ctx } from '../lib/tenant';
import { Calendar, Grid, Home, Sparkle, User } from '../lib/icons';
import { BookingFlow } from '../components/BookingFlow';
import { AssistantSheet } from '../components/AssistantSheet';
export function Shell() {
  const { slug = '' } = useParams();
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
  const ctx: Ctx = { b, openBooking: (service) => setBooking({ service }), openAI: () => setAi(true) };
  return (<>
    <header className="top"><Link to={base} className="brand"><img src={assetUrl(slug, b.images.logo)} alt="" width={40} height={40} />{b.short_name}</Link>
      <Link to={`${base}/profile`} className="icon-btn" aria-label="Профиль"><User /></Link></header>
    <main><Outlet context={ctx} /></main>
    <button className="fab" aria-label="Помощник" onClick={ctx.openAI}><Sparkle /></button>
    <nav className="tabs" aria-label="Разделы">
      <NavLink end to={base}><Home />Главная</NavLink><NavLink to={`${base}/services`}><Grid />Услуги</NavLink><NavLink to={`${base}/booking`}><Calendar />Моя запись</NavLink></nav>
    {booking && <BookingFlow b={b} initialService={booking.service} onClose={() => setBooking(null)} />}
    {ai && <AssistantSheet slug={slug} onClose={() => setAi(false)} />}
  </>);
}
