import '../styles.css';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, loadBusiness, type Ctx } from '../lib/tenant';
import { Calendar, Grid, Home, User } from '../lib/icons';
import { BookingFlow } from '../components/BookingFlow';
import { LoadingScreen } from '../components/LoadingScreen';
import { Logo } from '../components/BrandMark';
import { TenantImage } from '../components/TenantImage';
import { fetchBookingOpen } from '../lib/api';
import { useClientMessages } from '../lib/clientLocale';
import { useLocale } from '../lib/locale';
export function Shell() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const isOwner = location.pathname.includes('/owner');
  const { locale, setLocale } = useLocale();
  const { m } = useClientMessages();
  const q = useQuery({ queryKey: ['business', slug], queryFn: () => loadBusiness(slug) });
  const bookingOpen = useQuery({ queryKey: ['booking-open', slug], queryFn: () => fetchBookingOpen(slug), staleTime: 15_000, refetchOnWindowFocus: true, enabled: !!slug });
  const [booking, setBooking] = useState<{ service?: string } | null>(null);
  const serviceConsumed = useRef(false);
  const b = q.data;
  useEffect(() => {
    if (!b) return;
    document.title = b.name; document.documentElement.style.setProperty('--accent', b.accent);
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = `/tenants/${slug}.webmanifest`; document.head.appendChild(l);
    return () => { l.remove(); };
  }, [b, slug]);
  // Ссылка вида /s/slug?service=... из Telegram/рассылки сразу открывает мастера с услугой.
  useEffect(() => {
    if (isOwner || serviceConsumed.current) return;
    const url = new URL(window.location.href);
    const service = url.searchParams.get('service');
    if (!service) return;
    serviceConsumed.current = true;
    setBooking({ service });
    url.searchParams.delete('service');
    const search = url.searchParams.toString();
    window.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
  }, [b, isOwner]);
  if (q.isPending) return <LoadingScreen />;
  if (q.isError || !b) return <p className="pad">{m.shell.notFound} <button className="link" onClick={() => q.refetch()}>{m.shell.retry}</button></p>;
  const base = `/s/${slug}`;
  // null/undefined = статус неизвестен: интерфейс записи не блокируем.
  const openState: boolean | null = bookingOpen.data ?? null;
  const ctx: Ctx = { b, openBooking: (service) => setBooking({ service }), bookingOpen: openState };
  return (<>
    <header className="top"><Link to={base} className="brand"><TenantImage src={assetUrl(slug, b.images.logo)} alt="" width={40} height={40} sizes="40px" priority />{b.short_name}</Link>
      <div className="row">
        {!isOwner && <div className="lang-switch" role="group" aria-label={m.shell.language}>
          <button type="button" aria-pressed={locale === 'ru'} onClick={() => setLocale('ru')}>RU</button>
          <span className="lang-switch__divider" aria-hidden="true" />
          <button type="button" aria-pressed={locale === 'kk'} onClick={() => setLocale('kk')}>KK</button>
        </div>}
        {b.client_profile && <Link to={`${base}/profile`} className="icon-btn" aria-label={m.shell.profile}><User /></Link>}</div></header>
    {!isOwner && openState === false && <div className="page"><section className="card col" role="status">
      <b>{m.shell.pausedTitle}</b>
      <p className="muted">{m.shell.pausedText(b.phone)}</p>
    </section></div>}
    <main className={isOwner ? 'admin-main' : undefined}><Outlet context={ctx} /></main>
    {!isOwner && <div className="page legal-links"><Link to={`${base}/legal/privacy`}>{m.shell.legalPrivacy}</Link><Link to={`${base}/legal/terms`}>{m.shell.legalTerms}</Link><Link to={`${base}/legal/consent`}>{m.shell.legalConsent}</Link><Link to={`${base}/legal/storage`}>{m.shell.legalStorage}</Link></div>}
    {!isOwner && <div className="page powered"><a href="/" target="_blank" rel="noopener" aria-label="Renvio — система онлайн-записи для сервисов"><span>{m.shell.powered}</span><Logo height={10} /></a></div>}
    {!isOwner && <nav className="tabs" aria-label={m.shell.sections}>
      <NavLink end to={base}><Home />{m.shell.navHome}</NavLink><NavLink to={`${base}/services`}><Grid />{m.shell.navServices}</NavLink><NavLink to={`${base}/booking`}><Calendar />{m.shell.navMyBooking}</NavLink></nav>
    }
    {booking && <BookingFlow b={b} initialService={booking.service} bookingOpen={openState} onClose={() => setBooking(null)} />}
  </>);
}
