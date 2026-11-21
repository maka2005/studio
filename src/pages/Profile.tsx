import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import { supabase } from '../lib/supabase';
import type { Business, Ctx } from '../lib/tenant';
import { Arrow, ArrowLeft, Check, User } from '../lib/icons';
import { money, telHref } from '../lib/format';
import { allTokens } from '../lib/tokens';
import { LEGAL_VERSION } from '../lib/legal';
import { LoadingScreen } from '../components/LoadingScreen';
import { clientDateLocale, useClientMessages } from '../lib/clientLocale';
import './profile.css';

type Row = { id: string; service_name: string; starts_at: string; ends_at: string; price_cents: number; status: string; car: string; can_cancel: boolean };
const LogoutIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" /></svg>);
const MailIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>);

function ProfileInner() {
  const { b } = useOutletContext<Ctx>(); const qc = useQueryClient(); const { m } = useClientMessages();
  const sess = useQuery({ queryKey: ['client', 'session'], queryFn: async () => (await supabase.auth.getSession()).data.session });
  useEffect(() => { const { data } = supabase.auth.onAuthStateChange(() => { void qc.invalidateQueries({ queryKey: ['client'] }); }); return () => data.subscription.unsubscribe(); }, [qc]);
  return (<div className="page"><div className="profile-wrap">
    <Link to={`/s/${b.slug}`} className="back-link"><ArrowLeft size={18} /> {m.profile.toHome}</Link>
    {sess.isPending ? <LoadingScreen label={m.profile.loadingProfile} compact />
      : sess.data ? <><Signed b={b} email={sess.data.user.email ?? ''} confirmed={!!sess.data.user.email_confirmed_at} />
          <footer className="row between muted prof-foot"><span>{b.short_name}</span><a href={telHref(b.phone)}>{m.home.contact} <Arrow size={14} /></a></footer></>
      : <><SignIn slug={b.slug} /><p className="owner-link"><MailIcon />{m.profile.ownerQuestion} <Link to={`/s/${b.slug}/owner`}>{m.profile.ownerCabinet}</Link></p></>}</div></div>);
}

function SignIn({ slug }: { slug: string }) {
  const { m } = useClientMessages();
  const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState(false); const [sending, setSending] = useState(false); const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [wait, setWait] = useState(0); const [agree, setAgree] = useState(false);
  const ok = z.string().trim().email().safeParse(email).success;
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const send = async () => {
    if (!ok || !agree || wait > 0 || sending) return; setSending(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/s/${slug}/profile`, data: { consent_version: LEGAL_VERSION, consent_at: new Date().toISOString() } } });
    setSending(false);
    if (error) { setErr(/rate|limit/i.test(error.message) ? m.profile.errorRate : m.profile.errorSend); return; }
    setSent(true); setWait(60); setCode('');
  };
  const verify = async () => {
    if (!/^\d{6,10}$/.test(code.trim()) || verifying) return; setVerifying(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setVerifying(false);
    if (error) setErr(m.profile.errorCode);
  };
  return (<div className="profile-card"><div className="profile-ico"><User size={26} /></div>
    <h1>{m.profile.title}</h1><p className="muted">{m.profile.subtitle}</p>
    {sent ? <>
      <p role="status">{m.profile.sent(email.trim())}</p>
      <label className="muted small" htmlFor="pc">{m.profile.codeLabel}</label>
      <input id="pc" className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }} />
      {err && <p role="alert" className="err">{err}</p>}
      <button className="btn" disabled={!/^\d{6,10}$/.test(code) || verifying} onClick={() => void verify()}>{verifying ? m.profile.checking : m.profile.verify}</button>
      <button className="btn ghost" disabled={wait > 0 || sending} onClick={() => void send()}>{wait > 0 ? m.profile.resendIn(wait) : m.profile.resend}</button>
      <button className="link" style={{ marginTop: 12 }} onClick={() => { setSent(false); setErr(null); }}>{m.profile.changeEmail}</button></> : <>
      <label className="muted small" htmlFor="pe">{m.profile.emailLabel}</label>
      <input id="pe" className="field" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
      <p className="muted small">{m.profile.noPassword}</p>
      <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span className="small">{m.profile.agreeBefore}<a href={`/s/${slug}/legal/terms`} target="_blank" rel="noreferrer">{m.common.terms}</a>{m.profile.agreeAnd}<a href={`/s/${slug}/legal/consent`} target="_blank" rel="noreferrer">{m.common.consent}</a>{m.profile.agreeAfter}</span></label>
      {err && <p role="alert" className="err">{err}</p>}
      <button className="btn" disabled={!ok || !agree || sending} onClick={() => void send()}>{sending ? m.profile.sending : m.profile.continueEmail}</button></>}
  </div>);
}

function Signed({ b, email, confirmed }: { b: Business; email: string; confirmed: boolean }) {
  const qc = useQueryClient(); const claimed = useRef(false); const [sure, setSure] = useState<string | null>(null); const [claimErr, setClaimErr] = useState<string | null>(null);
  const { locale, m } = useClientMessages();
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
  const f = (s: string) => formatInTimeZone(new Date(s), b.timezone, "d MMMM 'в' HH:mm", { locale: clientDateLocale(locale) });
  return (<>
    <div className="head-row"><h1>{m.profile.myProfile}</h1><button className="round" aria-label={m.profile.logout} onClick={() => void logout()}><LogoutIcon /></button></div>
    <p className="muted">{email}</p>
    <div className="card okcard"><span className="okc"><Check size={16} /></span><div><b>{confirmed ? m.profile.emailConfirmed : m.profile.emailNotConfirmed}</b>
      <p className="muted small">{confirmed ? m.profile.confirmedHint : m.profile.unconfirmedHint}</p></div></div>
    <h2 style={{ marginTop: 28 }}>{m.profile.myBookings}</h2>
    {list.isPending ? <LoadingScreen label={m.profile.loadingBookings} compact /> : list.isError ? <p className="err">{m.profile.loadError} <button className="link" onClick={() => list.refetch()}>{m.common.retry}</button></p>
      : list.data.length === 0 ? <p className="muted">{m.profile.emptyBookings}</p>
      : list.data.map((r) => (<div className="bk-row" key={r.id}>
          <b>{r.service_name}</b><span>{f(r.starts_at)}</span><span className="muted small">{(m.profile.statuses as Record<string, string>)[r.status] ?? r.status} · {r.car} · {money(r.price_cents / 100, b.currency)}</span>
          {r.can_cancel && (sure === r.id ? <button className="btn danger mini" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{cancel.isPending ? m.my.cancelling : m.profile.cancelConfirm}</button>
            : <button className="btn ghost mini" onClick={() => setSure(r.id)}>{m.my.cancel}</button>)}</div>))}
    {claimErr && <p className="err small">{m.profile.claimError(claimErr)}</p>}
    {cancel.isError && <p className="err">{m.profile.errorCancel}</p>}
  </>);
}

export function Profile() {
  const { b } = useOutletContext<Ctx>();
  const { m } = useClientMessages();
  if (b.client_profile) return <ProfileInner />;
  return (<div className="page"><div className="profile-wrap">
    <Link to={`/s/${b.slug}`} className="back-link"><ArrowLeft size={18} /> {m.profile.toHome}</Link>
    <div className="profile-card"><div className="profile-ico"><User size={26} /></div>
      <h1>{m.profile.disabledTitle}</h1><p className="muted">{m.profile.disabledText}</p>
      <Link className="btn" to={`/s/${b.slug}/booking`}>{m.common.myBooking}</Link></div>
    <p className="owner-link">{m.profile.ownerQuestion} <Link to={`/s/${b.slug}/owner`}>{m.profile.ownerCabinet}</Link></p></div></div>);
}
