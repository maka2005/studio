import { Link, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, type Ctx } from '../lib/tenant';
import { owner } from '../lib/api';
import { money, plural, telHref } from '../lib/format';
import { Arrow, ArrowRight, Car, Clock, Download, Phone, Photo, Pin, Sparkle, Tag, Wrench } from '../lib/icons';
import { Reveal } from '../components/Reveal';
import { ServiceList } from './ServiceList';
import { useServices } from '../lib/useServices';
import '../lib/install';   // ловит событие установки с самого запуска
export function Home() {
  const { b, openBooking, openGuide } = useOutletContext<Ctx>(); const services = useServices(b);
  const reviews = useQuery({ queryKey: ['public-reviews', b.slug], queryFn: () => owner.publicReviews(b.slug), staleTime: 5 * 60_000 });
  const img = (p: string) => `url(${assetUrl(b.slug, p)})`;
  const ranges = [...new Set(Object.values(b.hours).filter(Boolean).map((h) => `${h![0]}–${h![1]}`))];
  // «Маршрут» открывает 2ГИС: по ссылке владельца, а без неё по поиску адреса.
  const routeHref = b.route_url && /^https:\/\//.test(b.route_url) ? b.route_url : `https://2gis.ru/search/${encodeURIComponent(b.address)}`;
  const minPrice = Math.min(...services.map((x) => x.price));
  return (<div className="page">
    <div className="hero" style={{ backgroundImage: img(b.images.hero) }}>
      <button className="glass-btn" onClick={() => openBooking()}><b>Записаться</b><Arrow /></button></div>
    <div className="namerow"><div><h1>{b.name}</h1><p className="muted">{b.description}</p></div>
      <button className="round" aria-label="Записаться" onClick={() => openBooking()}><Arrow /></button></div>
    <div className="tiles3">
      <div className="card tile"><div className="row"><Wrench /><b className="big">{services.length}</b></div><span className="muted small">{plural(services.length, ['услуга', 'услуги', 'услуг']).split(' ')[1]} на выбор</span></div>
      <div className="card tile"><div className="row"><Photo /><b className="big">{b.resources.length}</b></div><span className="muted small">{plural(b.resources.length, ['пост', 'поста', 'постов']).split(' ')[1]} для работы</span></div>
      <div className="card tile"><div className="row"><Tag /><b className="big">от {money(minPrice, b.currency)}</b></div><span className="muted small">начальная цена</span></div></div>
    <div className="cols">
      <Reveal className="col-side"><h2>Запишитесь онлайн</h2>
        <div className="card promo"><Car className="car" /><h3>{b.cards.booking.title}</h3><p className="muted">{b.cards.booking.text}</p>
          <button className="btn" onClick={() => openBooking()}>Выбрать дату и время <Arrow /></button></div>
        <div className="card col"><div className="row"><span className="ico accent"><Sparkle /></span><div><b>Не знаете, что выбрать?</b><p className="muted small">Расскажите, что хотите сделать с автомобилем, — покажем подходящие услуги.</p></div></div>
          <button className="btn ghost" onClick={openGuide}>Подобрать услугу <Arrow size={16} /></button></div>
        <div className="card col"><div className="row"><Pin /><b>{b.address}</b></div>
          <div className="row"><Clock /><div>{ranges.length === 1 ? <b>{ranges[0]}</b> : <b>По графику студии</b>}<p className="muted small">часы работы</p></div></div>
          <div className="row"><a className="btn ghost inline" href={routeHref} target="_blank" rel="noreferrer">Маршрут <Arrow size={16} /></a>
            <a className="icon-btn big-btn" href={telHref(b.phone)} aria-label="Позвонить"><Phone /></a></div></div></Reveal>
      <Reveal className="col-main"><div className="row between"><h2>Услуги</h2><Link className="muted" to={`/s/${b.slug}/services`}>Все услуги <ArrowRight size={16} /></Link></div><ServiceList limit={4} />
        {!!reviews.data?.length && <><h2 style={{ marginTop: 24 }}>Отзывы клиентов</h2><div className="review-list">{reviews.data.map((r,i)=><article className="card col" key={`${r.created_at}-${i}`}><span aria-label={`Оценка ${r.rating} из 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span>{r.comment&&<p>{r.comment}</p>}<span className="muted small">Клиент студии</span></article>)}</div></>}
        {b.gallery.length > 0 && <><h2 style={{ marginTop: 24 }}>Работы студии</h2>
          <div className="gallery">{b.gallery.map((g) => <figure key={g.image}><div className="shot" style={{ backgroundImage: img(g.image) }} /><figcaption>{g.caption}</figcaption></figure>)}</div></>}</Reveal></div>
    <Reveal className="install-block"><div className="card install"><div className="row"><img src={assetUrl(b.slug, b.images.logo)} alt="" width={48} height={48} /><div><b>{b.short_name}</b><p className="muted small">Приложение студии</p></div></div>
      <h2 className="xl">{b.cards.install.title}</h2><p className="muted">{b.cards.install.text}</p>
      <Link className="btn" to={`/s/${b.slug}/install`}><Download /> Добавить на экран <ArrowRight /></Link>
      <p className="muted small">Бесплатно — установите через браузер.</p></div></Reveal>
    <footer className="row between muted" style={{ padding: '16px 0' }}><span>{b.short_name} · <Link to={`/s/${b.slug}/owner`}>Вход для студии</Link></span><a href={telHref(b.phone)}>Связаться <Arrow size={14} /></a></footer>
  </div>);
}
