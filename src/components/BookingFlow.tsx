import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import type { Business } from '../lib/tenant';
import { createBooking, fetchServices, fetchSlots, joinWaitlist } from '../lib/api';
import { duration, money, randomToken } from '../lib/format';
import { isFullPhone, maskPhone, PHONE_PLACEHOLDER } from '../lib/phone';
import { ArrowLeft, ArrowRight, Check, Close } from '../lib/icons';
import { Sheet } from './Sheet';
import { DateField } from './DateField';
import { LEGAL_VERSION } from '../lib/legal';
import { supabase } from '../lib/supabase';
import { saveToken, saveWaitlistToken } from '../lib/tokens';
import { CustomerTelegramOptIn } from './CustomerTelegramOptIn';
import { PushOptIn } from './PushOptIn';
import { ALL_SERVICES_CATEGORY, allServicesCategory, filterServices, serviceCategories } from '../lib/serviceCatalog';
import { extraField, isAutoBusiness } from '../lib/businessTypes';
import { getAttribution } from '../lib/attribution';
import { clientDateLocale, clientErrText, useClientMessages } from '../lib/clientLocale';

function attributionSource(): string {
  // Единая атрибуция: UTM с первого захода сохраняется в localStorage и не теряется
  // при переходах внутри сайта (старая версия читала только текущий URL).
  return getAttribution().source || 'direct';
}

export function BookingFlow({ b, initialService, bookingOpen, onClose }: {
  b: Business; initialService?: string; bookingOpen?: boolean | null; onClose: () => void;
}) {
  const { locale, m } = useClientMessages();
  const isAuto = isAutoBusiness(b.business_type);
  const field = isAuto
    ? { label: m.field.autoLabel, placeholder: m.field.autoPlaceholder, error: m.field.autoError, empty: extraField(b.business_type).empty }
    : { label: m.field.otherLabel, placeholder: m.field.otherPlaceholder, error: m.field.otherError, empty: extraField(b.business_type).empty };
  const Contact = z.object({
    name: z.string().trim().min(1, m.booking.nameError).max(80),
    phone: z.string().trim().refine(isFullPhone, m.booking.phoneError),
    car: isAuto ? z.string().trim().min(2, field.error).max(60) : z.string().trim().max(60),
  });
  const svcQ = useQuery({ queryKey: ['services', b.slug], queryFn: () => fetchServices(b.slug) });
  const [step, setStep] = useState(1);
  // Several services are booked as one visit: the backend schedules them back-to-back.
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [serviceCategory, setServiceCategory] = useState(ALL_SERVICES_CATEGORY);
  const today = formatInTimeZone(new Date(), b.timezone, 'yyyy-MM-dd');
  const [day, setDay] = useState(today);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', car: '' });
  const [promo, setPromo] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null); const [agree, setAgree] = useState(false);
  const key = useRef(crypto.randomUUID()); const token = useRef(randomToken());
  const preset = useRef(false);
  const servicesUnavailable = svcQ.isError;
  // При ошибке загрузки показываем услуги из конфигурации, но запрещаем ложную запись.
  const services: { id: string; name: string; category: string; price_cents: number; duration_minutes: number }[] = servicesUnavailable
    ? b.services.map((s, i) => ({ id: `config:${i}`, name: s.name, category: s.category ?? m.common.other, price_cents: Math.round(s.price * 100), duration_minutes: s.duration_minutes }))
    : svcQ.data ?? [];
  useEffect(() => {
    if (preset.current || !initialService || servicesUnavailable || !svcQ.data) return;
    const s = svcQ.data.find((x) => x.id === initialService || x.name === initialService);
    if (s) { preset.current = true; setServiceIds([s.id]); setStep(2); }
  }, [svcQ.data, servicesUnavailable, initialService]);
  const chosen = serviceIds.map((id) => services.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const totalCents = chosen.reduce((sum, s) => sum + s.price_cents, 0);
  const toggleService = (id: string) => setServiceIds((prev) =>
    prev.includes(id) ? prev.filter((item) => item !== id)
      : prev.length >= 3 ? prev : [...prev, id]);
  // Preview of the sequential plan; the database applies the real tenant buffer.
  const plan = (() => {
    if (!slot) return [] as { service: NonNullable<(typeof services)[number]>; start: string; end: string }[];
    let cursor = Date.parse(slot);
    const bufferMs = (b.buffer_minutes ?? 0) * 60_000;
    return chosen.map((service) => {
      const start = new Date(cursor).toISOString();
      cursor += service.duration_minutes * 60_000;
      const end = new Date(cursor).toISOString();
      cursor += bufferMs;
      return { service, start, end };
    });
  })();
  const svcCategories = serviceCategories(services, locale);
  const filteredServices = filterServices(services, serviceSearch, serviceCategory, locale);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(new Date(`${today}T12:00:00Z`).getTime() + i * 864e5);
    return { iso: d.toISOString().slice(0, 10), wd: d.toLocaleDateString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { weekday: 'short', timeZone: 'UTC' }), n: d.getUTCDate() };
  }), [today, locale]);
  const slotsQ = useQuery({ queryKey: ['slots', b.slug, serviceIds[0], day], queryFn: () => fetchSlots(b.slug, serviceIds[0]!, day), enabled: !!serviceIds[0] && step === 2 && !servicesUnavailable });
  const fmt = (iso: string, f: string) => formatInTimeZone(new Date(iso), b.timezone, f, { locale: clientDateLocale(locale) });
  const mut = useMutation({
    mutationFn: () => createBooking({ slug: b.slug, service: serviceIds[0], services: serviceIds, start: slot!, ...form, car: isAuto ? form.car : form.car.trim() || field.empty, key: key.current, token: token.current, consent: LEGAL_VERSION, promo: promo.trim() || undefined, source: attributionSource() }),
    onSuccess: () => {
      saveToken(b.slug, token.current);   // если клиент уже вошёл, запись сразу привязывается к профилю
      void supabase.auth.getSession().then(({ data }) => { if (data.session) void supabase.rpc('claim_booking', { p_token: token.current }); });
      setStep(5);
    },
    onError: (e: Error) => {
      const code = Object.keys(m.errors).find((c) => e.message.includes(c));
      setMsg(code === 'bad_car' ? field.error : clientErrText(e, m.errors));
      if (code) { setSlot(null); setStep(2); void slotsQ.refetch(); }
    },
  });
  const next = () => {
    setMsg(null);
    if (step === 3) {
      const r = Contact.safeParse(form);
      if (!r.success) { setErrs(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]))); return; }
      setErrs({}); setForm(r.data);
    }
    setStep(step + 1);
  };
  const canNext = step === 1 ? chosen.length > 0 && !servicesUnavailable : step === 2 ? !!slot : step === 3 ? agree : true;

  if (step === 5 && chosen.length && slot) return (
    <Sheet title={m.booking.successTitle} onClose={onClose}>
      <div className="card col">
        {plan.map((p, i) => <div className="kv" key={`${p.service.id}-${i}`}><span>{p.service.name}</span><b>{fmt(p.start, "d MMMM 'в' HH:mm")}</b></div>)}
        {!!mut.data?.some((row) => row.discount_cents > 0) && <span className="muted"><s>{money(totalCents / 100, b.currency)}</s> · {m.booking.discount} {money(mut.data.reduce((sum, row) => sum + row.discount_cents, 0) / 100, b.currency)}</span>}
        <b>{money((mut.data?.reduce((sum, row) => sum + row.price_cents, 0) ?? totalCents) / 100, b.currency)}</b>
      </div>
      <p className="muted small">{m.booking.successNote}</p>
      {b.client_telegram_enabled && <CustomerTelegramOptIn slug={b.slug} token={token.current} />}
      <PushOptIn token={token.current} kind="booking" />
      <Link className="btn" to={`/s/${b.slug}/booking`} onClick={onClose}>{m.booking.successLink} <ArrowRight /></Link>
    </Sheet>);

  if (bookingOpen === false) return (
    <Sheet title={m.booking.closedTitle} onClose={onClose}>
      <div className="card col"><p>{m.booking.closedText(b.phone)}</p></div>
      <button className="btn ghost" onClick={onClose}>{m.common.close}</button>
    </Sheet>);

  return (
    <Sheet title={m.booking.titles[step - 1]!} sub={m.booking.step(step)} onClose={onClose}>
      <div className="bars">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      {msg && <p role="alert" className="err">{msg}</p>}
      {step > 1 && chosen.length > 0 && <div className="card col">
        <span className="muted small">{m.booking.selected(chosen.length)}</span>
        {chosen.map((item) => <div className="row between" key={item.id}><span>{item.name}</span><span>{money(item.price_cents / 100, b.currency)}</span></div>)}
      </div>}

      {step === 1 && (svcQ.isPending ? <p className="muted">{m.common.loading}</p> : <>
        {servicesUnavailable && <p className="err small" role="status">{m.booking.fallbackNote} <button className="link" onClick={() => void svcQ.refetch()}>{m.common.retry}</button></p>}
        {services.length === 0 ? <p className="muted">{m.booking.noServices}</p> : <>
          <label className="sr-only" htmlFor={`booking-service-search-${b.slug}`}>{m.booking.searchLabel}</label>
          <input id={`booking-service-search-${b.slug}`} className="field" type="search" placeholder={m.booking.searchPlaceholder} value={serviceSearch} onChange={(e) => { setServiceSearch(e.target.value); setServiceIds([]); }} />
          {svcCategories.length > 1 && <div className="service-category-filter" aria-label={m.booking.categoriesLabel}>
            {[allServicesCategory(locale), ...svcCategories].map((item) => <button key={item} className={`chip ${serviceCategory === item || (item === allServicesCategory(locale) && serviceCategory === ALL_SERVICES_CATEGORY) ? 'sel' : ''}`} aria-pressed={serviceCategory === item} onClick={() => setServiceCategory(item)}>{item}</button>)}
          </div>}
          <p className="muted small">{m.booking.selectHint}</p>
          {chosen.length > 0 && <div className="selection-bar">
            <span className="selection-bar__count"><Check size={15} />{m.booking.selected(chosen.length)}</span>
            <button type="button" className="clear-selection" onClick={() => setServiceIds([])}><Close size={14} />{m.booking.clearSelection}</button>
          </div>}
          {filteredServices.length === 0 ? <p className="muted">{m.booking.notFound}</p> : filteredServices.map((s) => <button key={s.id} disabled={servicesUnavailable} aria-pressed={serviceIds.includes(s.id)} className={`card pick ${serviceIds.includes(s.id) ? 'sel' : ''}`} onClick={() => toggleService(s.id)}>
            <span><b>{s.name}</b><br /><span className="muted small">{s.category} · {duration(s.duration_minutes)}</span></span><b>{money(s.price_cents / 100, b.currency)}</b></button>)}
        </>}
      </>)}

      {step === 2 && <>
        <div className="days">{days.map((d) => <button key={d.iso} className={`day ${d.iso === day ? 'sel' : ''}`} onClick={() => { setDay(d.iso); setSlot(null); }}><span>{d.wd}</span><b>{d.n}</b></button>)}</div>
        <DateField id="other-date" label={m.booking.otherDate} value={day} min={today} onChange={(next) => { setDay(next); setSlot(null); }} />
        {slotsQ.isPending ? <p className="muted">{m.booking.loadSlots}</p> : slotsQ.isError ? <p className="err">{m.booking.slotsError} <button className="link" onClick={() => slotsQ.refetch()}>{m.common.retry}</button></p>
          : slotsQ.data.length === 0 ? <p className="muted">{m.booking.noSlots}</p>
          : !slotsQ.data.some((s) => s.free) ? <><p className="muted">{m.booking.noFree}</p><WaitlistForm slug={b.slug} service={serviceIds[0]!} day={day} isAuto={isAuto} onClose={onClose} /></>
          : <div className="chips">{slotsQ.data.map((s) => <button key={s.slot} disabled={!s.free} aria-pressed={slot === s.slot}
              className={`chip ${slot === s.slot ? 'sel' : ''}`} onClick={() => setSlot(s.slot)}>{fmt(s.slot, 'HH:mm')}</button>)}</div>}
        <p className="muted small">{m.booking.chooseFree}</p>
        {plan.length > 0 && <div className="card col">
          <span className="muted small">{m.booking.visitPlan}</span>
          {plan.map((p, i) => <div className="kv" key={`${p.service.id}-${i}`}><span>{p.service.name}</span><b>{fmt(p.start, "d MMMM 'в' HH:mm")} — {fmt(p.end, 'HH:mm')}</b></div>)}
        </div>}
      </>}

      {step === 3 && (['name', 'phone', 'car'] as const).map((f) => (
        <div key={f}><label className="muted small" htmlFor={f}>{{ name: m.booking.nameLabel, phone: m.booking.phoneLabel, car: field.label }[f]}</label>
          <input id={f} className="field" value={form[f]} type={f === 'phone' ? 'tel' : 'text'} inputMode={f === 'phone' ? 'tel' : 'text'} autoComplete={{ name: 'name', phone: 'tel', car: 'off' }[f]}
            placeholder={f === 'phone' ? PHONE_PLACEHOLDER : f === 'car' ? field.placeholder : undefined} maxLength={f === 'phone' ? 24 : f === 'car' ? 60 : undefined}
            onChange={(e) => setForm({ ...form, [f]: f === 'phone' ? maskPhone(e.target.value, form.phone) : e.target.value })} aria-invalid={!!errs[f]} />
          {errs[f] && <p className="err small">{errs[f]}</p>}</div>))}

      {step === 3 && (<label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span className="small">{m.booking.consentBefore}<a href={`/s/${b.slug}/legal/terms`} target="_blank" rel="noreferrer">{m.common.terms}</a>{m.booking.consentAnd}<a href={`/s/${b.slug}/legal/consent`} target="_blank" rel="noreferrer">{m.common.consent}</a>{m.booking.consentPrivacyLead}<a href={`/s/${b.slug}/legal/privacy`} target="_blank" rel="noreferrer">{m.common.privacy}</a>{m.booking.consentAfter}</span></label>)}

      {step === 4 && chosen.length > 0 && slot && <div className="card col">
        {plan.map((p, i) => <div className="booking-review-row" key={`${p.service.id}-${i}`}><b>{p.service.name}</b><span className="muted small">{fmt(p.start, "d MMMM 'в' HH:mm")} · {duration(p.service.duration_minutes)}</span></div>)}
        <span className="muted">{form.name}, {form.phone}</span>{isAuto || form.car.trim() ? <span className="muted">{isAuto ? form.car : `${m.booking.wishLabel}: ${form.car.trim()}`}</span> : null}<b>{money(totalCents / 100, b.currency)}</b>
        <label className="muted small" htmlFor="promo-code">{m.booking.promoLabel}</label><input id="promo-code" className="field" maxLength={24} autoCapitalize="characters" placeholder={m.booking.promoPlaceholder} value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
        <span className="muted small">{m.booking.promoHint}</span></div>}

      <button className="btn" disabled={!canNext || mut.isPending} onClick={() => (step === 4 ? mut.mutate() : next())}>
        {step === 4 ? (mut.isPending ? m.booking.confirming : m.booking.confirm) : step === 3 ? m.booking.check : m.common.next} <ArrowRight /></button>
      {step > 1 && <button className="back" onClick={() => setStep(step - 1)}><ArrowLeft /> {m.booking.back}</button>}
    </Sheet>);
}

function WaitlistForm({ slug, service, day, isAuto, onClose }: { slug: string; service: string; day: string; isAuto: boolean; onClose: () => void }) {
  const { m } = useClientMessages();
  const field = extraField(isAuto ? 'autoservice' : 'barbershop');
  const [form, setForm] = useState({ name: '', phone: '', car: '' });
  const [agree, setAgree] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [doneToken, setDoneToken] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => joinWaitlist({ slug, service, day, ...form, car: isAuto ? form.car : form.car.trim() || field.empty, consent: LEGAL_VERSION }),
    onSuccess: (token) => { saveWaitlistToken(slug, token); setDoneToken(token); setMessage(null); },
    onError: (e: Error) => setMessage(clientErrText(e, m.errors)),
  });
  if (doneToken !== null) return (
    <div className="card col">
      <p className="note" role="status">{m.waitlistForm.success}</p>
      {doneToken && <Link className="btn ghost" to={`/s/${slug}/waitlist#t=${doneToken}`} onClick={onClose}>{m.waitlistForm.myRequest} <ArrowRight /></Link>}
      {doneToken && <PushOptIn token={doneToken} kind="waitlist" />}
    </div>);
  return <div className="card col"><b>{m.waitlistForm.title}</b>
    <input className="field" aria-label={m.waitlistForm.nameLabel} placeholder={m.waitlistForm.namePlaceholder} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
    <input className="field" aria-label={m.waitlistForm.phoneLabel} placeholder={PHONE_PLACEHOLDER} type="tel" maxLength={24} autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value, form.phone) })} />
    <input className="field" aria-label={isAuto ? m.waitlistForm.carAutoLabel : m.waitlistForm.carOtherLabel} placeholder={field.placeholder} maxLength={60} value={form.car} onChange={(e) => setForm({ ...form, car: e.target.value })} />
    <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span className="small">{m.waitlistForm.consent} <a href={`/s/${slug}/legal/privacy`} target="_blank" rel="noreferrer">{m.common.privacy}</a></span></label>
    {message && <p className="err small" role="alert">{message}</p>}
    {!isFullPhone(form.phone) && form.phone.length > 0 && <p className="muted small">{m.booking.phoneError}</p>}
    <button className="btn" disabled={mut.isPending || !agree || !form.name.trim() || !isFullPhone(form.phone) || (isAuto && !form.car.trim())} onClick={() => mut.mutate()}>{mut.isPending ? m.waitlistForm.sending : m.waitlistForm.submit}</button>
  </div>;
}
