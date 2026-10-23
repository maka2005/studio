import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { z } from 'zod';
import { addDays, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { supabase } from '../lib/supabase';
import { errText, fetchServices, fetchSlots, owner, type OwnerBooking } from '../lib/api';
import { duration, money } from '../lib/format';
import type { Business, Ctx } from '../lib/tenant';
import { Sheet } from '../components/Sheet';
import { AssistantSheet } from '../components/AssistantSheet';

const TABS = ['Записи', 'Услуги', 'Студия', 'Помощник'] as const;
const STATUS: Record<string, string> = { booked: 'Записан', arrived: 'Принята', done: 'Готова', cancelled: 'Отменена' };

export function Owner() {
  const { b } = useOutletContext<Ctx>(); const qc = useQueryClient();
  const sess = useQuery({ queryKey: ['owner', 'session'], queryFn: async () => (await supabase.auth.getSession()).data.session });
  useEffect(() => { const { data } = supabase.auth.onAuthStateChange(() => { void qc.invalidateQueries({ queryKey: ['owner'] }); }); return () => data.subscription.unsubscribe(); }, [qc]);
  const logout = async () => { await supabase.auth.signOut(); qc.removeQueries({ queryKey: ['owner'] }); };   // приватный кэш очищается при выходе
  if (sess.isPending) return <p className="pad muted">Загрузка…</p>;
  if (!sess.data) return <Login />;
  return <Cabinet b={b} onLogout={logout} />;
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setErr(null); const { error } = await supabase.auth.signInWithPassword({ email, password }); setBusy(false); if (error) setErr('Неверная почта или пароль.'); };
  return (<section className="pad"><h2>Кабинет владельца</h2>
    <label className="muted small" htmlFor="em">Почта</label><input id="em" className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
    <label className="muted small" htmlFor="pw">Пароль</label><input id="pw" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
    {err && <p role="alert" className="err">{err}</p>}
    <button className="btn" disabled={busy || !email || !password} onClick={() => void submit()}>{busy ? 'Входим…' : 'Войти'}</button></section>);
}

function Cabinet({ b, onLogout }: { b: Business; onLogout: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Записи'); const [ai, setAi] = useState(false);
  const me = useQuery({ queryKey: ['owner', 'me', b.slug], queryFn: () => owner.me(b.slug) });
  if (me.isPending) return <p className="pad muted">Проверяем доступ…</p>;
  if (me.isError) return <p className="pad err">Не удалось проверить доступ. <button className="link" onClick={() => me.refetch()}>Повторить</button></p>;
  if (!me.data) return <section className="pad"><h2>Нет доступа</h2><p className="muted">Эта учётная запись не привязана к студии.</p><button className="btn ghost" onClick={onLogout}>Выйти</button></section>;
  return (<section className="pad"><div className="row between"><h2>Кабинет</h2><button className="link" onClick={onLogout}>Выйти</button></div>
    <div className="tabs2" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => (t === 'Помощник' ? setAi(true) : setTab(t))}>{t}</button>)}</div>
    {tab === 'Записи' && <Bookings b={b} />}{tab === 'Услуги' && <Services b={b} />}{tab === 'Студия' && <Settings b={b} />}
    {ai && <AssistantSheet slug={b.slug} scope="owner" onClose={() => setAi(false)} />}</section>);
}

const today = (b: Business) => formatInTimeZone(new Date(), b.timezone, 'yyyy-MM-dd');
const fmtT = (b: Business, s: string, p: string) => formatInTimeZone(new Date(s), b.timezone, p, { locale: ru });

function Bookings({ b }: { b: Business }) {
  const qc = useQueryClient(); const [mode, setMode] = useState<'day' | 'week'>('day'); const [day, setDay] = useState(today(b));
  const [sel, setSel] = useState<OwnerBooking | null>(null); const [add, setAdd] = useState(false); const [block, setBlock] = useState(false);
  const to = mode === 'day' ? day : format(addDays(new Date(`${day}T12:00:00`), 6), 'yyyy-MM-dd');
  const list = useQuery({ queryKey: ['owner', 'bookings', b.slug, day, to], queryFn: () => owner.bookings(b.slug, day, to) });
  const stats = useQuery({ queryKey: ['owner', 'stats', b.slug, day, to], queryFn: () => owner.stats(b.slug, day, to) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['owner'] });
  return (<>
    <div className="row wrap"><button className={`chip mini ${mode === 'day' ? 'sel' : ''}`} onClick={() => setMode('day')}>День</button>
      <button className={`chip mini ${mode === 'week' ? 'sel' : ''}`} onClick={() => setMode('week')}>Неделя</button>
      <input aria-label="Дата" className="field" style={{ flex: 1 }} type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
    {stats.data && <div className="stats">
      <div className="card"><span className="muted small">Заезды</span><b>{stats.data.visits}</b></div>
      <div className="card"><span className="muted small">Завершено</span><b>{stats.data.done}</b></div>
      <div className="card"><span className="muted small">Получено</span><b>{money(Number(stats.data.received_cents) / 100, b.currency)}</b></div>
      <div className="card"><span className="muted small">Ожидаемая стоимость записей</span><b>{money(Number(stats.data.expected_cents) / 100, b.currency)}</b></div></div>}
    {stats.isError && <p className="err small">Статистика недоступна.</p>}
    <div className="row wrap"><button className="btn mini" onClick={() => setAdd(true)}>+ Запись</button><button className="btn ghost mini" onClick={() => setBlock(true)}>Заблокировать пост</button></div>
    <div style={{ height: 12 }} />
    {list.isPending ? <p className="muted">Загрузка…</p> : list.isError ? <p className="err">Не удалось загрузить записи. <button className="link" onClick={() => list.refetch()}>Повторить</button></p>
      : list.data.length === 0 ? <p className="muted">Записей на этот период нет.</p>
      : list.data.map((x) => <button key={x.id} className="card bk" onClick={() => setSel(x)}>
          <span className="row between"><b>{fmtT(b, x.starts_at, "d MMM, HH:mm")}</b><span className="pill">{STATUS[x.status] ?? x.status}</span></span>
          <span>{x.service_name} · {x.resource_name}</span><span className="muted small">{x.car} · {x.customer_name} · {x.customer_phone}</span>
          <span className="muted small">{money(x.price_cents / 100, b.currency)} · оплачено {money(x.paid_cents / 100, b.currency)}</span></button>)}
    {sel && <Actions b={b} bk={sel} onClose={() => setSel(null)} onDone={refresh} />}
    {add && <AddBooking b={b} onClose={() => setAdd(false)} onDone={refresh} />}
    {block && <BlockPost b={b} onClose={() => setBlock(false)} onDone={refresh} />}</>);
}

function useAct(onDone: () => void, close?: () => void) {
  const [msg, setMsg] = useState<string | null>(null);
  const m = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { setMsg(null); onDone(); close?.(); }, onError: (e) => setMsg(errText(e)) });
  return { run: (f: () => Promise<unknown>) => m.mutate(f), busy: m.isPending, msg };
}
const Err = ({ m }: { m: string | null }) => (m ? <p role="alert" className="err">{m}</p> : null);

function SlotPicker({ b, service, onPick, picked }: { b: Business; service: string | null; onPick: (s: string) => void; picked: string | null }) {
  const [day, setDay] = useState(today(b));
  const q = useQuery({ queryKey: ['slots', b.slug, service, day], queryFn: () => fetchSlots(b.slug, service!, day), enabled: !!service });
  return (<><input aria-label="Дата" className="field" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
    {!service ? <p className="muted small">Выберите услугу.</p> : q.isPending ? <p className="muted">Загрузка…</p> : q.isError ? <p className="err">Не удалось получить время.</p>
      : q.data.length === 0 ? <p className="muted">В этот день приёма нет.</p>
      : <div className="chips">{q.data.map((s) => <button key={s.slot} disabled={!s.free} className={`chip ${picked === s.slot ? 'sel' : ''}`} onClick={() => onPick(s.slot)}>{fmtT(b, s.slot, 'HH:mm')}</button>)}</div>}</>);
}

function Actions({ b, bk, onClose, onDone }: { b: Business; bk: OwnerBooking; onClose: () => void; onDone: () => void }) {
  const a = useAct(onDone, onClose); const [amount, setAmount] = useState(''); const [move, setMove] = useState(false); const [slot, setSlot] = useState<string | null>(null);
  const svc = useQuery({ queryKey: ['owner', 'svc', b.slug], queryFn: () => fetchServices(b.slug) });
  const sid = svc.data?.find((s) => s.name === bk.service_name)?.id ?? null;
  const cents = Math.round(Number(amount.replace(',', '.')) * 100); const okAmt = Number.isFinite(cents) && cents > 0;
  return (<Sheet title={bk.service_name} sub={`${fmtT(b, bk.starts_at, "d MMMM, HH:mm")} · ${bk.car}`} onClose={onClose}><Err m={a.msg} />
    <p className="muted small">{bk.customer_name}, <a href={`tel:${bk.customer_phone}`}>{bk.customer_phone}</a><br />{money(bk.price_cents / 100, b.currency)} · оплачено {money(bk.paid_cents / 100, b.currency)}</p>
    <div className="row wrap">{bk.status === 'booked' && <button className="btn mini" disabled={a.busy} onClick={() => a.run(() => owner.setStatus(bk.id, 'arrived'))}>Машина принята</button>}
      {(bk.status === 'booked' || bk.status === 'arrived') && <button className="btn mini" disabled={a.busy} onClick={() => a.run(() => owner.setStatus(bk.id, 'done'))}>Готова</button>}</div>
    <label className="muted small" htmlFor="amt">Сумма оплаты или возврата, {b.currency}</label><input id="amt" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
    <div className="row wrap"><button className="btn ghost mini" disabled={a.busy || !okAmt} onClick={() => a.run(() => owner.payment(bk.id, cents, 'payment'))}>Внести оплату</button>
      <button className="btn ghost mini" disabled={a.busy || !okAmt} onClick={() => a.run(() => owner.payment(bk.id, cents, 'refund'))}>Вернуть</button></div>
    {bk.status === 'booked' && <>
      <button className="btn ghost" onClick={() => setMove(!move)}>Перенести</button>
      {move && <><SlotPicker b={b} service={sid} picked={slot} onPick={setSlot} />
        <button className="btn" disabled={!slot || a.busy} onClick={() => a.run(() => owner.reschedule(bk.id, slot!))}>Перенести на выбранное время</button></>}
      <button className="btn danger" disabled={a.busy} onClick={() => { if (window.confirm('Отменить запись?')) a.run(() => owner.cancel(bk.id)); }}>Отменить запись</button></>}
  </Sheet>);
}

const Contact = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().regex(/^\+?[0-9\s()-]{10,18}$/), car: z.string().trim().min(2).max(60) });
function AddBooking({ b, onClose, onDone }: { b: Business; onClose: () => void; onDone: () => void }) {
  const a = useAct(onDone, onClose); const svc = useQuery({ queryKey: ['owner', 'svc', b.slug], queryFn: () => fetchServices(b.slug) });
  const [service, setService] = useState<string | null>(null); const [slot, setSlot] = useState<string | null>(null); const [f, setF] = useState({ name: '', phone: '', car: '' });
  const v = Contact.safeParse(f);
  return (<Sheet title="Новая запись" onClose={onClose}><Err m={a.msg} />
    <label className="muted small" htmlFor="sv">Услуга</label>
    <select id="sv" className="field" value={service ?? ''} onChange={(e) => { setService(e.target.value || null); setSlot(null); }}><option value="">Выберите…</option>{svc.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <SlotPicker b={b} service={service} picked={slot} onPick={setSlot} />
    {(['name', 'phone', 'car'] as const).map((k) => <input key={k} className="field" placeholder={{ name: 'Имя', phone: 'Телефон', car: 'Автомобиль' }[k]} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}
    <button className="btn" disabled={!service || !slot || !v.success || a.busy} onClick={() => a.run(() => owner.create(b.slug, { service: service!, start: slot!, ...f }))}>Создать запись</button></Sheet>);
}

function BlockPost({ b, onClose, onDone }: { b: Business; onClose: () => void; onDone: () => void }) {
  const a = useAct(onDone, onClose); const res = useQuery({ queryKey: ['owner', 'res', b.slug], queryFn: () => owner.resources(b.slug) });
  const [r, setR] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const ok = r && from && to && fromZonedTime(to, b.timezone) > fromZonedTime(from, b.timezone);
  return (<Sheet title="Блокировка поста" sub="Время указывается по часовому поясу студии" onClose={onClose}><Err m={a.msg} />
    <select aria-label="Пост" className="field" value={r} onChange={(e) => setR(e.target.value)}><option value="">Пост…</option>{res.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <label className="muted small" htmlFor="bf">С</label><input id="bf" className="field" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
    <label className="muted small" htmlFor="bt">До</label><input id="bt" className="field" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
    <button className="btn" disabled={!ok || a.busy} onClick={() => a.run(() => owner.block(b.slug, r, fromZonedTime(from, b.timezone).toISOString(), fromZonedTime(to, b.timezone).toISOString()))}>Заблокировать</button></Sheet>);
}

function ServiceRow({ b, s, onSaved }: { b: Business; s: { id: string | null; name: string; price_cents: number; duration_minutes: number; active?: boolean }; onSaved: () => void }) {
  const a = useAct(onSaved); const [name, setName] = useState(s.name); const [price, setPrice] = useState(String(s.price_cents / 100)); const [min, setMin] = useState(String(s.duration_minutes)); const [active, setActive] = useState(s.active ?? true);
  const minutes = Number(min); const cents = Math.round(Number(price.replace(',', '.')) * 100); const ok = name.trim() && Number.isFinite(cents) && cents >= 0 && Number.isInteger(minutes) && minutes > 0;
  return (<div className="card col"><Err m={a.msg} />
    <input aria-label="Название" className="field" value={name} onChange={(e) => setName(e.target.value)} />
    <div className="row"><div style={{ flex: 1 }}><label className="muted small">Цена, {b.currency}</label><input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      <div style={{ flex: 1 }}><label className="muted small">Минут ({ok ? duration(minutes) : '—'})</label><input className="field" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></div></div>
    <label className="row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Показывать клиентам</label>
    <button className="btn mini" disabled={!ok || a.busy} onClick={() => a.run(() => owner.upsertService(b.slug, { id: s.id, name, cents, minutes, active }))}>Сохранить</button></div>);
}
function Services({ b }: { b: Business }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['services', b.slug], queryFn: () => fetchServices(b.slug) }); const [n, setN] = useState(0);
  const saved = () => { void qc.invalidateQueries({ queryKey: ['services', b.slug] }); };
  return (<>{q.isPending ? <p className="muted">Загрузка…</p> : q.isError ? <p className="err">Не удалось загрузить услуги.</p>
    : q.data.map((s) => <ServiceRow key={s.id + s.name} b={b} s={s} onSaved={saved} />)}
    <h3>Новая услуга</h3><ServiceRow key={n} b={b} s={{ id: null, name: '', price_cents: 0, duration_minutes: 60 }} onSaved={() => { saved(); setN(n + 1); }} />
    <p className="muted small">Изменение цены не затрагивает уже созданные записи.</p></>);
}

const DAYS: [string, string][] = [['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс']];
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
function Settings({ b }: { b: Business }) {
  const qc = useQueryClient(); const [msg, setMsg] = useState<string | null>(null); const [ok, setOk] = useState(false);
  const [f, setF] = useState({ phone: b.phone, address: b.address, description: b.description, cards: b.cards, hours: b.hours });
  const m = useMutation({ mutationFn: () => owner.updateConfig(b.slug, f), onSuccess: () => { setMsg(null); setOk(true); void qc.invalidateQueries({ queryKey: ['business', b.slug] }); }, onError: (e) => { setOk(false); setMsg(errText(e)); } });
  const save = () => {
    for (const [, h] of Object.entries(f.hours)) if (h && (!Time.safeParse(h[0]).success || !Time.safeParse(h[1]).success || h[0] >= h[1])) { setOk(false); setMsg('Проверьте часы работы: начало раньше конца, формат ЧЧ:ММ.'); return; }
    if (!f.phone.trim() || !f.address.trim()) { setOk(false); setMsg('Телефон и адрес обязательны.'); return; }
    m.mutate();
  };
  const card = (k: 'booking' | 'ai' | 'install', label: string): ReactNode => (<div className="card col"><b>{label}</b>
    <input aria-label={`${label}: заголовок`} className="field" value={f.cards[k].title} onChange={(e) => setF({ ...f, cards: { ...f.cards, [k]: { ...f.cards[k], title: e.target.value } } })} />
    <textarea aria-label={`${label}: текст`} className="field" rows={2} value={f.cards[k].text} onChange={(e) => setF({ ...f, cards: { ...f.cards, [k]: { ...f.cards[k], text: e.target.value } } })} /></div>);
  return (<><Err m={msg} />{ok && <p className="muted" role="status">Сохранено.</p>}
    <label className="muted small" htmlFor="ph">Телефон</label><input id="ph" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
    <label className="muted small" htmlFor="ad">Адрес</label><input id="ad" className="field" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
    <label className="muted small" htmlFor="ds">Описание</label><textarea id="ds" className="field" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
    <h3>Часы работы</h3>
    {DAYS.map(([k, l]) => { const h = f.hours[k] ?? null; const set = (v: [string, string] | null) => setF({ ...f, hours: { ...f.hours, [k]: v } });
      return <div className="row wrap" key={k}><b style={{ width: 28 }}>{l}</b><label className="row small"><input type="checkbox" checked={!h} onChange={(e) => set(e.target.checked ? null : ['09:00', '17:00'])} />выходной</label>
        {h && <><input aria-label={`${l} с`} className="field" style={{ width: 100 }} value={h[0]} onChange={(e) => set([e.target.value, h[1]])} /><input aria-label={`${l} до`} className="field" style={{ width: 100 }} value={h[1]} onChange={(e) => set([h[0], e.target.value])} /></>}</div>; })}
    <h3>Карточки на главной</h3>{card('booking', 'Запись')}{card('ai', 'ИИ')}{card('install', 'Установка')}
    <button className="btn" disabled={m.isPending} onClick={save}>{m.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
    <p className="muted small">Логотип, главное фото и фотографии работ пока меняются только в папке tenants/ и повторной публикацией.</p></>);
}
