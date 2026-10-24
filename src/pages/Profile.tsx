import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import type { Business, Ctx } from '../lib/tenant';
import { Arrow, ArrowLeft, Check, User } from '../lib/icons';
import { money } from '../lib/format';
import { allTokens } from '../lib/tokens';
import './profile.css';

const STATUS: Record<string, string> = { booked: 'Подтверждена', arrived: 'Машина принята', done: 'Выполнена', cancelled: 'Отменена' };
type Row = { id: string; service_name: string; starts_at: string; ends_at: string; price_cents: number; status: string; car: string; can_cancel: boolean };
const LogoutIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" /></svg>);
const MailIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>);

export function Profile() {
  const { b } = useOutletContext<Ctx>(); const qc = useQueryClient();
  const sess = useQuery({ queryKey: ['client', 'session'], queryFn: async () => (await supabase.auth.getSession()).data.session });
  useEffect(() => { const { data } = supabase.auth.onAuthStateChange(() => { void qc.invalidateQueries({ queryKey: ['client'] }); }); return () => data.subscription.unsubscribe(); }, [qc]);
  return (<div className="page"><div className="profile-wrap">
    <Link to={`/s/${b.slug}`} className="back-link"><ArrowLeft size={18} /> На главную</Link>
    {sess.isPending ? <p className="muted">Загрузка…</p>
      : sess.data ? <><Signed b={b} email={sess.data.user.email ?? ''} confirmed={!!sess.data.user.email_confirmed_at} />
          <footer className="row between muted prof-foot"><span>{b.short_name}</span><a href={`tel:${b.phone}`}>Связаться <Arrow size={14} /></a></footer></>
      : <><SignIn slug={b.slug} /><p className="owner-link"><MailIcon />Вы владелец студии? <Link to={`/s/${b.slug}/owner`}>Открыть кабинет студии</Link></p></>}</div></div>);
}

function SignIn({ slug }: { slug: string }) {
  const [email, setEmail] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle'); const [err, setErr] = useState<string | null>(null);
  const ok = z.string().trim().email().safeParse(email).success;
  const send = async () => {
    if (!ok) return; setState('sending'); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/s/${slug}/profile` } });
    if (error) { setState('idle'); setErr(/rate|limit/i.test(error.message) ? 'Слишком много запросов. Повторите через несколько минут.' : 'Не удалось отправить ссылку. Проверьте почту и повторите.'); return; }
    setState('sent');
  };
  return (<div className="profile-card"><div className="profile-ico"><User size={26} /></div>
    <h1>Профиль клиента</h1><p className="muted">Сохраняйте новые записи в одном месте и открывайте их с любого устройства.</p>
    {state === 'sent' ? <p role="status">Мы отправили ссылку для входа на <b>{email.trim()}</b>. Откройте письмо на этом устройстве. Если его нет, проверьте «Спам».</p> : <>
      <label className="muted small" htmlFor="pe">Почта</label>
      <input id="pe" className="field" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
      <p className="muted small">Пароль не нужен. Отправим ссылку для входа.</p>
      {err && <p role="alert" className="err">{err}</p>}
      <button className="btn" disabled={!ok || state === 'sending'} onClick={() => void send()}>{state === 'sending' ? 'Отправляем…' : 'Получить ссылку'}</button></>}
  </div>);
}

function Signed({ b, email, confirmed }: { b: Business; email: string; confirmed: boolean }) {
  const qc = useQueryClient(); const claimed = useRef(false); const [sure, setSure] = useState<string | null>(null); const [claimErr, setClaimErr] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['client', 'bookings', b.slug], queryFn: async () => { const { data, error } = await supabase.rpc('my_bookings', { p_slug: b.slug }); if (error) throw error; return (data ?? []) as Row[]; } });
  useEffect(() => {   // записи, сделанные на этом устройстве до входа, привязываются к аккаунту
    if (claimed.current) return; claimed.current = true;
    const tokens = allTokens(b.slug); if (!tokens.length) return;
    void Promise.all(tokens.map((t) => supabase.rpc('claim_booking', { p_token: t }))).then((rs) => {
      const bad = rs.find((r) => r.error); if (bad?.error) setClaimErr(bad.error.message);
      void qc.invalidateQueries({ queryKey: ['client', 'bookings'] });
    });
  }, [b.slug, qc]);
  const cancel = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.rpc('cancel_my_booking', { p_booking: id }); if (error) throw error; },
    onSuccess: () => { setSure(null); void qc.invalidateQueries({ queryKey: ['client', 'bookings'] }); } });
  const logout = async () => { await supabase.auth.signOut(); qc.removeQueries({ queryKey: ['client'] }); qc.removeQueries({ queryKey: ['owner'] }); };
  const f = (s: string) => formatInTimeZone(new Date(s), b.timezone, "d MMMM 'в' HH:mm", { locale: ru });
  return (<>
    <div className="head-row"><h1>Мой профиль</h1><button className="round" aria-label="Выйти" onClick={() => void logout()}><LogoutIcon /></button></div>
    <p className="muted">{email}</p>
    <div className="card okcard"><span className="okc"><Check size={16} /></span><div><b>{confirmed ? 'Почта подтверждена' : 'Почта не подтверждена'}</b>
      <p className="muted small">{confirmed ? 'Новые записи сохранятся в этом профиле.' : 'Подтвердите почту по ссылке из письма.'}</p></div></div>
    <h2 style={{ marginTop: 28 }}>Мои записи</h2>
    {list.isPending ? <p className="muted">Загрузка…</p> : list.isError ? <p className="err">Не удалось загрузить записи. <button className="link" onClick={() => list.refetch()}>Повторить</button></p>
      : list.data.length === 0 ? <p className="muted">Здесь появятся записи, которые вы создадите после входа в профиль.</p>
      : list.data.map((r) => (<div className="bk-row" key={r.id}>
          <b>{r.service_name}</b><span>{f(r.starts_at)}</span><span className="muted small">{STATUS[r.status] ?? r.status} · {r.car} · {money(r.price_cents / 100, b.currency)}</span>
          {r.can_cancel && (sure === r.id ? <button className="btn danger mini" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{cancel.isPending ? 'Отменяем…' : 'Да, отменить'}</button>
            : <button className="btn ghost mini" onClick={() => setSure(r.id)}>Отменить запись</button>)}</div>))}
    {claimErr && <p className="err small">Не удалось привязать записи с этого устройства ({claimErr}).</p>}
    {cancel.isError && <p className="err">Не удалось отменить. Повторите позже.</p>}
  </>);
}
