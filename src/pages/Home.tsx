import { Link, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, type Ctx } from '../lib/tenant';
import { isAutoBusiness } from '../lib/businessTypes';
import { owner } from '../lib/api';
import { money, telHref } from '../lib/format';
import { Arrow, ArrowRight, Calendar, Car, Clock, Download, Grid, Phone, Photo, Pin, Tag, Wrench } from '../lib/icons';
import { Reveal } from '../components/Reveal';
import { TenantImage } from '../components/TenantImage';
import { ServiceList } from './ServiceList';
import { useServices } from '../lib/useServices';
import { useClientMessages } from '../lib/clientLocale';
import '../lib/install';   // ловит событие установки с самого запуска
export function Home() {
  const { b, openBooking } = useOutletContext<Ctx>(); const services = useServices(b);
  const { m } = useClientMessages();
  const isAuto = isAutoBusiness(b.business_type);
  const reviews = useQuery({ queryKey: ['public-reviews', b.slug], queryFn: () => owner.publicReviews(b.slug), staleTime: 5 * 60_000 });
  const img = (p: string) => `url(${assetUrl(b.slug, p)})`;
  const ranges = [...new Set(Object.values(b.hours).filter(Boolean).map((h) => `${h![0]}–${h![1]}`))];
  // «Маршрут» открывает 2ГИС: по ссылке владельца, а без неё по поиску адреса.
  const routeHref = b.route_url && /^https:\/\//.test(b.route_url) ? b.route_url : `https://2gis.ru/search/${encodeURIComponent(b.address)}`;
  const minPrice = services.length ? Math.min(...services.map((x) => x.price)) : null;
  return (<div className="page">
    <div className="hero" style={{ backgroundImage: img(b.images.hero) }}>
      <button className="glass-btn" onClick={() => openBooking()}><b>{m.home.book}</b><Arrow /></button></div>
    <div className="namerow"><div><h1>{b.name}</h1><p className="muted">{b.description}</p></div>
      <button className="round" aria-label={m.home.book} onClick={() => openBooking()}><Arrow /></button></div>
    <div className="tiles3">
      <div className="card tile"><div className="row"><Wrench /><b className="big">{services.length}</b></div><span className="muted small">{m.home.serviceCount(services.length)}</span></div>
      <div className="card tile"><div className="row"><Photo /><b className="big">{b.resources.length}</b></div><span className="muted small">{isAuto ? m.home.resourceCountAuto(b.resources.length) : m.home.resourceCountOther(b.resources.length)}</span></div>
      <div className="card tile"><div className="row"><Tag /><b className="big">{minPrice === null ? '—' : `${m.common.from}${money(minPrice, b.currency)}`}</b></div><span className="muted small">{minPrice === null ? m.home.noServicesYet : m.home.startingPrice}</span></div></div>
    <div className="cols">
      <Reveal className="col-side"><h2>{m.home.bookOnline}</h2>
        <div className="card promo">{isAuto ? <Car className="car" /> : <Calendar className="car" />}<h3>{b.cards.booking.title}</h3><p className="muted">{b.cards.booking.text}</p>
          <button className="btn" onClick={() => openBooking()}>{m.home.chooseDateTime} <Arrow /></button></div>
        <div className="card col"><div className="row"><span className="ico accent"><Grid /></span><div><b>{b.cards.catalog.title}</b><p className="muted small">{b.cards.catalog.text}</p></div></div>
          <Link className="btn ghost" to={`/s/${b.slug}/services`}>{m.home.catalog} <Arrow size={16} /></Link></div>
        <div className="card col"><div className="row"><Pin /><b>{b.address}</b></div>
          <div className="row"><Clock /><div>{ranges.length === 1 ? <b>{ranges[0]}</b> : <b>{m.home.schedule}</b>}<p className="muted small">{m.home.hours}</p></div></div>
          <div className="row"><a className="btn ghost inline" href={routeHref} target="_blank" rel="noreferrer">{m.home.route} <Arrow size={16} /></a>
            <a className="icon-btn big-btn" href={telHref(b.phone)} aria-label={m.home.contact}><Phone /></a></div></div></Reveal>
      <Reveal className="col-main"><div className="row between"><h2>{m.home.servicesTitle}</h2><Link className="muted" to={`/s/${b.slug}/services`}>{m.home.allServices} <ArrowRight size={16} /></Link></div><ServiceList limit={4} />
        {!!reviews.data?.length && <><h2 style={{ marginTop: 24 }}>{m.home.reviewsTitle}</h2><div className="review-list">{reviews.data.map((r,i)=><article className="card col" key={`${r.created_at}-${i}`}><span aria-label={m.home.ratingAria(r.rating)}>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span>{r.comment&&<p>{r.comment}</p>}<span className="muted small">{m.home.clientReview}</span></article>)}</div></>}
        {b.gallery.length > 0 && <><h2 style={{ marginTop: 24 }}>{m.home.galleryTitle}</h2>
          <div className="gallery">{b.gallery.map((g) => <figure key={g.image}><div className="shot" style={{ backgroundImage: img(g.image) }} /><figcaption>{g.caption}</figcaption></figure>)}</div></>}</Reveal></div>
    <Reveal className="install-block"><div className="card install"><div className="row"><TenantImage src={assetUrl(b.slug, b.images.logo)} alt="" width={48} height={48} sizes="48px" /><div><b>{b.short_name}</b><p className="muted small">{m.home.appTitle}</p></div></div>
      <h2 className="xl">{b.cards.install.title}</h2><p className="muted">{b.cards.install.text}</p>
      <Link className="btn" to={`/s/${b.slug}/install`}><Download /> {m.home.install} <ArrowRight /></Link>
      <p className="muted small">{m.home.installFree}</p></div></Reveal>
    <footer className="row between muted" style={{ padding: '16px 0' }}><span>{b.short_name} · <Link to={`/s/${b.slug}/owner`}>{m.home.ownerLogin}</Link></span><a href={telHref(b.phone)}>{m.home.contact} <Arrow size={14} /></a></footer>
  </div>);
}
