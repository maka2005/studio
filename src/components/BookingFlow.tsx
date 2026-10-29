import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { addMinutes } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import type { Business } from '../lib/tenant';
import { createBooking, fetchServices, fetchSlots, joinWaitlist } from '../lib/api';
import { duration, money, randomToken } from '../lib/format';
import { ArrowLeft, ArrowRight } from '../lib/icons';
import { Sheet } from './Sheet';
import { LEGAL_VERSION } from '../lib/legal';
import { supabase } from '../lib/supabase';
import { saveToken } from '../lib/tokens';

const Contact = z.object({
  name: z.string().trim().min(1, 'Введите имя').max(80),
  phone: z.string().trim().regex(/^\+?[0-9\s()-]{10,18}$/, 'Проверьте номер телефона'),
  car: z.string().trim().min(2, 'Укажите автомобиль').max(60),
});
const TITLES = ['Услуга', 'Дата и время', 'Ваши данные', 'Подтверждение'];
const ERR: Record<string, string> = { slot_taken: 'Это время только что заняли. Выберите другое.', invalid_slot: 'Это время недоступно для записи.',
  past_start: 'Это время уже прошло.', consent_required: 'Нужно согласие на обработку данных.', bad_name: 'Проверьте имя.',
  bad_phone: 'Проверьте номер телефона.', bad_car: 'Проверьте автомобиль.', rate_limited: 'Слишком много попыток записи. Попробуйте позже.',
  promo_invalid: 'Промокод не действует или закончился лимит.', booking_unavailable: 'Сервис записи временно недоступен. Попробуйте позже.' };

function attributionSource(): string {
  const raw = new URLSearchParams(location.search).get('utm_source')?.toLowerCase();
  if (raw && /^[a-z0-9_-]{1,40}$/.test(raw)) return raw;
  try {
    if (document.referrer && new URL(document.referrer).origin !== location.origin) return new URL(document.referrer).hostname.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || 'referral';
  } catch { /* invalid referrer: keep direct */ }
  return 'direct';
}

export function BookingFlow({ b, initialService, onClose }: { b: Business; initialService?: string; onClose: () => void }) {
  const svcQ = useQuery({ queryKey: ['services', b.slug], queryFn: () => fetchServices(b.slug) });
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const today = formatInTimeZone(new Date(), b.timezone, 'yyyy-MM-dd');
  const [day, setDay] = useState(today);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', car: '' });
  const [promo, setPromo] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null); const [agree, setAgree] = useState(false);
  const key = useRef(crypto.randomUUID()); const token = useRef(randomToken());
  const preset = useRef(false);
  useEffect(() => {
    if (preset.current || !initialService || !svcQ.data) return;
    const s = svcQ.data.find((x) => x.id === initialService || x.name === initialService);
    if (s) { preset.current = true; setServiceId(s.id); setStep(2); }
  }, [svcQ.data, initialService]);
  const svc = svcQ.data?.find((s) => s.id === serviceId);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(new Date(`${today}T12:00:00Z`).getTime() + i * 864e5);
    return { iso: d.toISOString().slice(0, 10), wd: d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' }), n: d.getUTCDate() };
  }), [today]);
  const slotsQ = useQuery({ queryKey: ['slots', b.slug, serviceId, day], queryFn: () => fetchSlots(b.slug, serviceId!, day), enabled: !!serviceId && step === 2 });
  const fmt = (iso: string, f: string) => formatInTimeZone(new Date(iso), b.timezone, f, { locale: ru });
  const mut = useMutation({
    mutationFn: () => createBooking({ slug: b.slug, service: serviceId!, start: slot!, ...form, key: key.current, token: token.current, consent: LEGAL_VERSION, promo: promo.trim() || undefined, source: attributionSource() }),
    onSuccess: () => {
      saveToken(b.slug, token.current);   // если клиент уже вошёл, запись сразу привязывается к профилю
      void supabase.auth.getSession().then(({ data }) => { if (data.session) void supabase.rpc('claim_booking', { p_token: token.current }); });
      setStep(5);
    },
    onError: (e: Error) => {
      const code = Object.keys(ERR).find((c) => e.message.includes(c));
      setMsg(code ? ERR[code]! : 'Не удалось записаться. Проверьте соединение и повторите.');
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
  const canNext = step === 1 ? !!serviceId : step === 2 ? !!slot : step === 3 ? agree : true;

  if (step === 5 && svc && slot) return (
    <Sheet title="Запись подтверждена" onClose={onClose}>
      <div className="card col"><b>{svc.name}</b><span>{fmt(slot, "d MMMM 'в' HH:mm")}</span>{mut.data?.discount_cents ? <span className="muted"><s>{money(svc.price_cents / 100, b.currency)}</s> · скидка {money(mut.data.discount_cents / 100, b.currency)}</span> : null}<span className="muted">{money((mut.data?.price_cents ?? svc.price_cents) / 100, b.currency)}</span></div>
      <p className="muted small">Детали и отмена — в разделе «Моя запись» на этом устройстве.</p>
      <Link className="btn" to={`/s/${b.slug}/booking`} onClick={onClose}>Моя запись <ArrowRight /></Link>
    </Sheet>);

  return (
    <Sheet title={TITLES[step - 1]!} sub={`Шаг ${step} из 4`} onClose={onClose}>
      <div className="bars">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      {msg && <p role="alert" className="err">{msg}</p>}
      {step > 1 && svc && <div className="row between strong"><span>{svc.name}</span><span>{money(svc.price_cents / 100, b.currency)}</span></div>}

      {step === 1 && (svcQ.isPending ? <p className="muted">Загрузка услуг…</p> : svcQ.isError ? <p className="err">Не удалось загрузить услуги. <button className="link" onClick={() => svcQ.refetch()}>Повторить</button></p>
        : svcQ.data.length === 0 ? <p className="muted">Услуг пока нет.</p>
        : svcQ.data.map((s) => <button key={s.id} className={`card pick ${s.id === serviceId ? 'sel' : ''}`} onClick={() => setServiceId(s.id)}>
            <span><b>{s.name}</b><br /><span className="muted small">{duration(s.duration_minutes)}</span></span><b>{money(s.price_cents / 100, b.currency)}</b></button>))}

      {step === 2 && <>
        <div className="days">{days.map((d) => <button key={d.iso} className={`day ${d.iso === day ? 'sel' : ''}`} onClick={() => { setDay(d.iso); setSlot(null); }}><span>{d.wd}</span><b>{d.n}</b></button>)}</div>
        <label className="muted small" htmlFor="other-date">Другая дата</label>
        <input id="other-date" className="field" type="date" min={today} value={day} onChange={(e) => { if (e.target.value >= today) { setDay(e.target.value); setSlot(null); } }} />
        {slotsQ.isPending ? <p className="muted">Загрузка времени…</p> : slotsQ.isError ? <p className="err">Не удалось получить время. <button className="link" onClick={() => slotsQ.refetch()}>Повторить</button></p>
          : slotsQ.data.length === 0 ? <p className="muted">В этот день студия не принимает. Выберите другую дату.</p>
          : !slotsQ.data.some((s) => s.free) ? <><p className="muted">Свободного времени на эту дату нет. Оставьте заявку в лист ожидания — студия свяжется с вами, если появится окно.</p><WaitlistForm slug={b.slug} service={serviceId!} day={day} /></>
          : <div className="chips">{slotsQ.data.map((s) => <button key={s.slot} disabled={!s.free} aria-pressed={slot === s.slot}
              className={`chip ${slot === s.slot ? 'sel' : ''}`} onClick={() => setSlot(s.slot)}>{fmt(s.slot, 'HH:mm')}</button>)}</div>}
        <p className="muted small">Серые окна уже заняты. Выберите любое свободное время.</p>
        {slot && svc && <p className="muted small">Ориентир выдачи: {formatInTimeZone(addMinutes(new Date(slot), svc.duration_minutes), b.timezone, "d MMMM 'в' HH:mm", { locale: ru })}</p>}
      </>}

      {step === 3 && (['name', 'phone', 'car'] as const).map((f) => (
        <div key={f}><label className="muted small" htmlFor={f}>{{ name: 'Имя', phone: 'Телефон', car: 'Автомобиль' }[f]}</label>
          <input id={f} className="field" value={form[f]} inputMode={f === 'phone' ? 'tel' : 'text'} autoComplete={{ name: 'name', phone: 'tel', car: 'off' }[f]}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })} aria-invalid={!!errs[f]} />
          {errs[f] && <p className="err small">{errs[f]}</p>}</div>))}

      {step === 3 && (<label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span className="small">Я принимаю <a href={`/s/${b.slug}/legal/terms`} target="_blank" rel="noreferrer">Условия использования</a> и даю <a href={`/s/${b.slug}/legal/consent`} target="_blank" rel="noreferrer">согласие на обработку персональных данных</a>. С <a href={`/s/${b.slug}/legal/privacy`} target="_blank" rel="noreferrer">Политикой конфиденциальности</a> ознакомлен(а).</span></label>)}

      {step === 4 && svc && slot && <div className="card col">
        <b>{svc.name}</b><span>{fmt(slot, "d MMMM 'в' HH:mm")} · {duration(svc.duration_minutes)}</span>
        <span className="muted">{form.name}, {form.phone}</span><span className="muted">{form.car}</span><b>{money(svc.price_cents / 100, b.currency)}</b>
        <label className="muted small" htmlFor="promo-code">Промокод</label><input id="promo-code" className="field" maxLength={24} autoCapitalize="characters" placeholder="Если есть" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
        <span className="muted small">Скидка применится после проверки кода.</span></div>}

      <button className="btn" disabled={!canNext || mut.isPending} onClick={() => (step === 4 ? mut.mutate() : next())}>
        {step === 4 ? (mut.isPending ? 'Записываем…' : 'Подтвердить запись') : 'Продолжить'} <ArrowRight /></button>
      {step > 1 && <button className="back" onClick={() => setStep(step - 1)}><ArrowLeft /> Назад</button>}
    </Sheet>);
}

function WaitlistForm({ slug, service, day }: { slug: string; service: string; day: string }) {
  const [form, setForm] = useState({ name: '', phone: '', car: '' });
  const [agree, setAgree] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const m = useMutation({ mutationFn: () => joinWaitlist({ slug, service, day, ...form, consent: LEGAL_VERSION }), onSuccess: () => { setDone(true); setMessage(null); }, onError: (e: Error) => {
    const code = ['already_waiting', 'rate_limited', 'bad_date'].find((x) => e.message.includes(x));
    setMessage(code === 'already_waiting' ? 'Вы уже оставили заявку на эту услугу в этот день.' : code === 'rate_limited' ? 'Слишком много заявок. Попробуйте позже.' : 'Не удалось отправить заявку. Проверьте данные и повторите.');
  } });
  if (done) return <p className="note" role="status">Заявка добавлена. Студия свяжется с вами, если освободится время.</p>;
  return <div className="card col"><b>Лист ожидания</b>
    <input className="field" aria-label="Имя для листа ожидания" placeholder="Ваше имя" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
    <input className="field" aria-label="Телефон для листа ожидания" placeholder="Телефон" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
    <input className="field" aria-label="Автомобиль для листа ожидания" placeholder="Автомобиль" maxLength={60} value={form.car} onChange={(e) => setForm({ ...form, car: e.target.value })} />
    <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span className="small">Разрешаю студии связаться со мной и согласен(на) на обработку данных. <a href={`/s/${slug}/legal/privacy`} target="_blank" rel="noreferrer">Политика конфиденциальности</a></span></label>
    {message && <p className="err small" role="alert">{message}</p>}
    <button className="btn" disabled={m.isPending || !agree || !form.name.trim() || !form.phone.trim() || !form.car.trim()} onClick={() => m.mutate()}>{m.isPending ? 'Отправляем…' : 'Оставить заявку'}</button>
  </div>;
}
