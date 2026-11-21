import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import type { Ctx } from '../lib/tenant';
import { cancelWaitlist, claimWaitlistOffer, readWaitlist, type WaitlistClaim } from '../lib/api';
import { saveToken, saveWaitlistToken } from '../lib/tokens';
import { LoadingScreen } from '../components/LoadingScreen';
import { PushOptIn } from '../components/PushOptIn';
import { clientDateLocale, clientErrText, useClientMessages } from '../lib/clientLocale';

function hashValue(key: string): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get(key);
}

/** /s/:slug/waitlist#t=... — статус заявки; /s/:slug/waitlist/claim#o=... — мгновенный claim по ссылке из уведомления. */
export function WaitlistStatus({ claimOnly = false }: { claimOnly?: boolean }) {
  const { b } = useOutletContext<Ctx>();
  const { locale, m } = useClientMessages();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const token = claimOnly ? null : hashValue('t');
  const offerToken = claimOnly ? hashValue('o') : null;
  const [claimResult, setClaimResult] = useState<WaitlistClaim | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const claimed = useRef(false);
  // Фиксируем токен заявки при монтировании: при переходе к записи хеш #t=
  // меняется на токен записи, а этот компонент может ещё раз отрендериться.
  const initialToken = useRef(token);
  const q = useQuery({ queryKey: ['waitlist', b.slug, token], queryFn: () => readWaitlist(token!), enabled: !!token && !claimOnly });
  const claim = useMutation({
    mutationFn: (offer: string) => claimWaitlistOffer(offer),
    onSuccess: (data) => {
      saveToken(b.slug, data.booking.token);
      void qc.invalidateQueries({ queryKey: ['my', b.slug] });
      setClaimError(null);
      if (claimOnly) setClaimResult(data);
      else navigate(`/s/${b.slug}/booking#t=${data.booking.token}`);
    },
    onError: (e: Error) => setClaimError(clientErrText(e, m.errors)),
  });
  const cancel = useMutation({
    mutationFn: () => cancelWaitlist(token!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['waitlist', b.slug, token] }),
  });
  useEffect(() => {
    if (!claimOnly || !offerToken || claimed.current) return;
    claimed.current = true;
    claim.mutate(offerToken);
  }, [claimOnly, offerToken, claim]);
  // A private #t= link must make the request reachable from "Моя запись" later.
  useEffect(() => {
    const saved = initialToken.current;
    if (!claimOnly && saved && window.location.pathname.endsWith('/waitlist')) {
      saveWaitlistToken(b.slug, saved);
    }
  }, [b.slug, claimOnly]);
  const fmt = (iso: string, pattern: string) => formatInTimeZone(new Date(iso), b.timezone, pattern, { locale: clientDateLocale(locale) });
  const dayFmt = (day: string) => formatInTimeZone(new Date(`${day}T12:00:00Z`), 'UTC', 'd MMMM yyyy', { locale: clientDateLocale(locale) });

  if (claimOnly) return (<section className="page"><h2>{m.waitlist.claimTitle}</h2>
    {!offerToken ? <p className="err">{m.errors.bad_offer}</p>
      : claim.isPending ? <LoadingScreen label={m.waitlist.claiming} compact />
      : claimError ? <p className="err" role="alert">{claimError}</p>
      : claimResult ? <><p className="note" role="status">{m.waitlist.claimSuccessTitle}</p>
          <div className="card col"><b>{fmt(claimResult.booking.starts_at, "d MMMM 'в' HH:mm")}</b><span className="muted small">{m.waitlist.claimedNote}</span>
            <Link className="btn" to={`/s/${b.slug}/booking#t=${claimResult.booking.token}`}>{m.waitlist.openBooking}</Link></div></>
      : null}
    <Link className="btn ghost" to={`/s/${b.slug}`}>{m.waitlist.backHome}</Link></section>);

  if (!token) return <section className="page"><h2>{m.waitlist.title}</h2><p className="muted">{m.waitlist.noToken}</p></section>;
  if (q.isPending) return <LoadingScreen label={m.waitlist.loading} compact />;
  if (q.isError) return <p className="page err">{clientErrText(q.error, m.errors)} <button className="link" onClick={() => void q.refetch()}>{m.common.retry}</button></p>;
  const item = q.data?.item;
  if (!item) return <section className="page"><h2>{m.waitlist.title}</h2><p className="muted">{m.waitlist.notFound}</p></section>;

  return (<section className="page"><h2>{m.waitlist.title}</h2>
    <div className="card col">
      <div className="kv"><span className="muted">{m.waitlist.serviceLabel}</span><b>{item.service_name}</b></div>
      <div className="kv"><span className="muted">{m.waitlist.dayLabel}</span><b>{dayFmt(item.preferred_day)}</b></div>
      <div className="kv"><span className="muted">{m.waitlist.createdLabel}</span><b>{fmt(item.created_at, 'd MMMM yyyy, HH:mm')}</b></div>
      <div className="kv"><span className="muted">{m.waitlist.statusLabel}</span><b>{(m.waitlist.statuses as Record<string, string>)[item.status] ?? item.status}</b></div>
    </div>
    {item.offer && <div className="card col" role="status">
      <b>{m.waitlist.offerTitle}</b><p className="muted small">{m.waitlist.offerText}</p>
      <b>{fmt(item.offer.slot, "d MMMM 'в' HH:mm")}</b>
      <span className="muted small">{m.waitlist.expires} {fmt(item.offer.expires_at, 'd MMMM, HH:mm')}</span>
      {claimError && <p className="err small" role="alert">{claimError}</p>}
      <button className="btn" disabled={claim.isPending} onClick={() => claim.mutate(item.offer!.offer_token)}>{claim.isPending ? m.waitlist.claiming : m.waitlist.claim}</button>
    </div>}
    <PushOptIn token={token} kind="waitlist" />
    {item.status !== 'closed' && item.status !== 'claimed' && <>
      {cancel.isSuccess ? <p className="note" role="status">{m.waitlist.cancelledNote}</p>
        : <button className="btn ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? m.waitlist.cancelling : m.waitlist.cancel}</button>}
      {cancel.isError && <p className="err small" role="alert">{clientErrText(cancel.error, m.errors) === m.errors.default ? m.waitlist.cancelError : clientErrText(cancel.error, m.errors)}</p>}
    </>}
  </section>);
}
