import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { assetUrl, type Ctx } from '../lib/tenant';
import { money, plural } from '../lib/format';
import { Arrow, ArrowRight, Car, Clock, Download, Phone, Photo, Pin, Sparkle, Tag, Wrench } from '../lib/icons';
import { Reveal } from '../components/Reveal';
import { ServiceList } from './ServiceList';
import { useServices } from '../lib/useServices';
type BIP = Event & { prompt: () => Promise<void> };
export function Home() {
  const { b, openBooking, openAI } = useOutletContext<Ctx>(); const services = useServices(b);
  const img = (p: string) => `url(${assetUrl(b.slug, p)})`;
  const ranges = [...new Set(Object.values(b.hours).filter(Boolean).map((h) => `${h![0]}–${h![1]}`))];
  const minPrice = Math.min(...services.map((x) => x.price));
  const [evt, setEvt] = useState<BIP | null>(null); const [hint, setHint] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener('beforeinstallprompt', h); return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  return (<div className="page">
    <div className="hero" style={{ backgroundImage: img(b.images.hero) }}>
      <button className="glass-btn" onClick={() => openBooking()}><b>Записаться</b><Arrow /></button></div>
    <div className="namerow"><div><h1>{b.name}</h1><p className="muted">{b.description}</p></div>
      <button className="round" aria-label="Записаться" onClick={() => openBooking()}><Arrow /></button></div>
    <div className="tiles3">
      <div className="card tile"><div className="row"><Wrench /><b className="big">{services.length}</b></div><span className="muted small">{plural(services.length, ['услуга', 'услуги', 'услуг']).split(' ')[1]} в прайсе</span></div>
      <div className="card tile"><div className="row"><Photo /><b className="big">{b.resources.length}</b></div><span className="muted small">{plural(b.resources.length, ['бокс', 'бокса', 'боксов']).split(' ')[1]} в работе</span></div>
      <div className="card tile"><div className="row"><Tag /><b className="big">от {money(minPrice, b.currency)}</b></div><span className="muted small">за услугу</span></div></div>
    <div className="cols">
      <Reveal className="col-side"><h2>Запись в студию</h2>
        <div className="card promo"><Car className="car" /><h3>{b.cards.booking.title}</h3><p className="muted">{b.cards.booking.text}</p>
          <button className="btn" onClick={() => openBooking()}>Выбрать время <Arrow /></button></div>
        <div className="card col"><div className="row"><span className="ico accent"><Sparkle /></span><div><b>{b.cards.ai.title}</b><p className="muted small">{b.cards.ai.text}</p></div></div>
          <button className="btn ghost" onClick={openAI}>Подобрать услугу <Arrow size={16} /></button></div>
        <div className="card col"><div className="row"><Pin /><b>{b.address}</b></div>
          <div className="row"><Clock /><div>{ranges.length === 1 ? <b>{ranges[0]}</b> : <b>по графику</b>}<p className="muted small">по времени студии</p></div></div>
          <div className="row"><a className="btn ghost inline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`} target="_blank" rel="noreferrer">Маршрут <Arrow size={16} /></a>
            <a className="icon-btn big-btn" href={`tel:${b.phone}`} aria-label="Позвонить"><Phone /></a></div></div></Reveal>
      <Reveal className="col-main"><div className="row between"><h2>Услуги</h2><Link className="muted" to={`/s/${b.slug}/services`}>Все услуги <ArrowRight size={16} /></Link></div><ServiceList limit={4} />
        {b.gallery.length > 0 && <><h2 style={{ marginTop: 24 }}>Работы студии</h2>
          <div className="gallery">{b.gallery.map((g) => <figure key={g.image} style={{ backgroundImage: img(g.image) }}><figcaption>{g.caption}</figcaption></figure>)}</div></>}</Reveal></div>
    <Reveal><div className="card install"><div className="row"><img src={assetUrl(b.slug, b.images.logo)} alt="" width={48} height={48} /><div><b>{b.short_name}</b><p className="muted small">Приложение студии</p></div></div>
      <h2 className="xl">{b.cards.install.title}</h2><p className="muted">{b.cards.install.text}</p>
      <button className="btn" onClick={() => (evt ? void evt.prompt() : setHint(true))}><Download /> Добавить на экран <ArrowRight /></button>
      {hint && <p className="muted small">Откройте меню браузера и выберите «Добавить на главный экран» (iPhone: Safari → «Поделиться»).</p>}
      <p className="muted small">Бесплатно. Установка через браузер.</p></div></Reveal>
    <footer className="row between muted" style={{ padding: '16px 0' }}><span>{b.short_name}</span><a href={`tel:${b.phone}`}>Связаться <Arrow size={14} /></a></footer>
  </div>);
}
