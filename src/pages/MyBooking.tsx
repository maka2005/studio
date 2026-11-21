import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import type { Business, Ctx } from '../lib/tenant';
import type { ClientMessages } from '../lib/clientLocale';
import {
  cancelBooking, getBookings, readWaitlist, submitReview,
  type MyBooking as BookingRow, type WaitlistItem,
} from '../lib/api';
import { money, telHref } from '../lib/format';
import { allTokens, allWaitlistTokens, saveToken } from '../lib/tokens';
import { Calendar, Check, Copy, Phone } from '../lib/icons';
import { CustomerTelegramOptIn } from '../components/CustomerTelegramOptIn';
import { PushOptIn } from '../components/PushOptIn';
import { ReschedulePicker } from '../components/ReschedulePicker';
import { LoadingScreen } from '../components/LoadingScreen';
import { isAutoBusiness } from '../lib/businessTypes';
import { clientDateLocale, clientErrText, useClientMessages } from '../lib/clientLocale';

// Токен берётся из приватной ссылки (#t=...) либо из хранилища этого устройства. Фрагмент не уходит на сервер.
function readToken(slug: string): string | null {
  const url = new URL(window.location.href);
  const fromHash = /t=([0-9a-zA-Z_-]{12,})/.exec(url.hash.slice(1))?.[1] ?? null;
  const token = url.searchParams.get('t') ?? fromHash;
  if (token) {
    saveToken(slug, token);
    url.searchParams.delete('t');
    url.hash = '';
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }
  return token;
}

type Tab = 'bookings' | 'waitlist';

export function MyBooking() {
  const { b, openBooking } = useOutletContext<Ctx>();
  const { locale, m } = useClientMessages();
  const qc = useQueryClient();
  const [activeToken] = useState(() => readToken(b.slug));
  const [tab, setTab] = useState<Tab>('bookings');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [action] = useState(() => new URLSearchParams(window.location.search).get('a'));
  const actionHandled = useRef(false);

  const tokens = allTokens(b.slug);
  const bookingsQ = useQuery({
    queryKey: ['my-bookings', b.slug, tokens.join(',')],
    queryFn: () => getBookings(tokens),
    enabled: tokens.length > 0,
  });
  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);

  const waitlistTokens = allWaitlistTokens(b.slug);
  const waitlistQ = useQuery({
    queryKey: ['my-waitlist', b.slug, waitlistTokens.join(',')],
    queryFn: async () => {
      const rows = await Promise.all(waitlistTokens.map(async (token) => {
        try {
          const result = await readWaitlist(token);
          return result.item ? { token, item: result.item } : null;
        } catch { return null; }
      }));
      return rows.filter((row): row is { token: string; item: WaitlistItem } => !!row);
    },
    enabled: tab === 'waitlist' && waitlistTokens.length > 0,
  });

  // Telegram-кнопки: ?a=cancel / ?a=reschedule открывают действие и чистят URL без перезагрузки.
  useEffect(() => {
    if (!action || actionHandled.current || bookingsQ.isPending) return;
    actionHandled.current = true;
    const target = bookings.find((row) => row.token === activeToken)
      ?? bookings.find((row) => row.status === 'booked')
      ?? bookings[0];
    if (target && action === 'cancel' && target.can_cancel) setConfirmId(target.id);
    if (target && action === 'reschedule' && target.can_reschedule) setRescheduleId(target.id);
    const url = new URL(window.location.href);
    url.searchParams.delete('a');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [action, bookingsQ.isPending, bookings, activeToken]);

  const dayFmt = (day: string) => formatInTimeZone(new Date(`${day}T12:00:00Z`), 'UTC', 'd MMMM yyyy', { locale: clientDateLocale(locale) });
  const showBookings = tokens.length > 0 || bookings.length > 0;

  return (
    <section className="page">
      <h2>{m.my.title}</h2>
      <div className="tabs2" role="tablist" aria-label={m.my.title}>
        <button role="tab" aria-selected={tab === 'bookings'} onClick={() => setTab('bookings')}>{m.my.tabs.bookings}</button>
        <button role="tab" aria-selected={tab === 'waitlist'} onClick={() => setTab('waitlist')}>{m.my.tabs.waitlist}</button>
      </div>

      {tab === 'bookings' && (() => {
        if (!showBookings) return <section>
          <p className="muted">{m.my.empty}</p>
          <button className="btn" onClick={() => openBooking()}>{m.my.chooseService}</button>
        </section>;
        if (bookingsQ.isPending) return <LoadingScreen label={m.my.loading} compact />;
        if (bookingsQ.isError) return <p className="err">{m.my.loadError} <button className="link" onClick={() => void bookingsQ.refetch()}>{m.common.retry}</button></p>;
        if (!bookings.length) return <><p className="muted">{m.my.empty}</p><button className="btn" onClick={() => openBooking()}>{m.my.chooseService}</button></>;
        return bookings.map((row, index) => (
          <BookingCard key={row.id} b={b} d={row} m={m} index={index} total={bookings.length}
            openBooking={openBooking}
            confirming={confirmId === row.id} rescheduling={rescheduleId === row.id}
            onConfirm={(id) => setConfirmId(id)} onReschedule={(id) => setRescheduleId(id)}
            onChanged={() => void qc.invalidateQueries({ queryKey: ['my-bookings', b.slug] })} />
        ));
      })()}

      {tab === 'waitlist' && (() => {
        if (!waitlistTokens.length) return <p className="muted">{m.my.waitlistEmpty}</p>;
        if (waitlistQ.isPending) return <LoadingScreen label={m.waitlist.loading} compact />;
        if (waitlistQ.isError) return <p className="err">{clientErrText(waitlistQ.error, m.errors)} <button className="link" onClick={() => void waitlistQ.refetch()}>{m.common.retry}</button></p>;
        if (!waitlistQ.data?.length) return <p className="muted">{m.my.waitlistEmpty}</p>;
        return waitlistQ.data.map(({ token, item }) => (
          <div className="card col" key={item.id}>
            <div className="kv"><span className="muted">{m.waitlist.serviceLabel}</span><b>{item.service_name}</b></div>
            <div className="kv"><span className="muted">{m.waitlist.dayLabel}</span><b>{dayFmt(item.preferred_day)}</b></div>
            <div className="kv"><span className="muted">{m.waitlist.statusLabel}</span><b>{(m.waitlist.statuses as Record<string, string>)[item.status] ?? item.status}</b></div>
            {item.offer && <p className="note" role="status">{m.waitlist.offerTitle}: {formatInTimeZone(new Date(item.offer.slot), b.timezone, "d MMMM 'в' HH:mm", { locale: clientDateLocale(locale) })}</p>}
            <Link className="btn ghost" to={`/s/${b.slug}/waitlist#t=${token}`}>{m.my.waitlistOpen}</Link>
          </div>
        ));
      })()}
    </section>
  );
}

function BookingCard({ b, d, m, index, total, openBooking, confirming, rescheduling, onConfirm, onReschedule, onChanged }: {
  b: Business; d: BookingRow; m: ClientMessages; index: number; total: number;
  openBooking: (service?: string) => void; confirming: boolean; rescheduling: boolean;
  onConfirm: (id: string | null) => void; onReschedule: (id: string | null) => void; onChanged: () => void;
}) {
  const { locale } = useClientMessages();
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewSaved, setReviewSaved] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const isAuto = isAutoBusiness(b.business_type);
  // All bookings of a visit share one token: cancel/reschedule act on the visit.
  // Show the controls once, on the first service, to avoid duplicate actions.
  const visitActions = total === 1 || index === 0;
  const f = (s: string, p: string) => formatInTimeZone(new Date(s), b.timezone, p, { locale: clientDateLocale(locale) });
  const z = (s: string) => new Date(s).toISOString().replace(/[-:]|\.\d{3}/g, '');

  const cancel = useMutation({
    mutationFn: () => cancelBooking(d.token),
    onSuccess: () => { onConfirm(null); setNote(null); onChanged(); void qc.invalidateQueries({ queryKey: ['my-bookings', b.slug] }); },
  });
  const review = useMutation({
    mutationFn: () => submitReview(d.token, rating, reviewText),
    onSuccess: () => { setReviewSaved(true); setReviewError(null); onChanged(); },
    onError: (e: Error) => {
      const code = Object.keys(m.errors).find((c) => e.message.includes(c));
      setReviewError(code ? m.errors[code]! : clientErrText(e, m.errors));
    },
  });

  const download = () => {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//${b.slug}//ru\r\nBEGIN:VEVENT\r\nUID:${d.id}@${b.slug}\r\nDTSTAMP:${z(new Date().toISOString())}\r\nDTSTART:${z(d.starts_at)}\r\nDTEND:${z(d.ends_at)}\r\nSUMMARY:${b.name}: ${d.service_name}\r\nLOCATION:${b.address}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'booking.ics'; a.click(); URL.revokeObjectURL(url);
    setNote(m.my.calendarNote);
  };
  const copy = async () => {
    const link = `${window.location.origin}/s/${b.slug}/booking#t=${d.token}`;
    try { await navigator.clipboard.writeText(link); setNote(m.my.linkCopied); }
    catch { setNote(m.my.linkFailed(link)); }
  };

  return (
    <div className="card status">
      {total > 1 && <span className="muted small">{m.my.visit} {index + 1} / {total}</span>}
      <span className="okc"><Check size={18} /></span>
      <span className="muted small">{b.short_name}</span>
      <h3 style={{ margin: 0 }}>{(m.my.status as Record<string, string>)[d.status] ?? d.status}</h3>
      <b>{f(d.starts_at, "d MMMM 'в' HH:mm")}</b>
      <h2 style={{ fontSize: 22, marginTop: 20 }}>{d.service_name}</h2>
      <div className="kv"><span className="muted">{m.my.cost}</span><b>{money(d.price_cents / 100, b.currency)}</b></div>
      <div className="kv"><span className="muted">{isAuto ? m.my.readyAuto : m.my.readyOther}</span><b>{f(d.ends_at, "d MMMM 'в' HH:mm")}</b></div>
      {isAuto || (d.car && d.car !== 'Без пожеланий') ? <p><b>{d.car}</b></p> : null}
      <p className="muted">{b.address}</p>

      {b.client_telegram_enabled && d.status === 'booked' && new Date(d.starts_at).getTime() > Date.now()
        && <CustomerTelegramOptIn slug={b.slug} token={d.token} />}
      <a className="card contact" href={telHref(b.phone)}>
        <span className="ico accent" style={{ width: 52, height: 52 }}><Phone /></span>
        <span><b>{m.my.contact}</b><br /><span className="muted small">{b.phone}</span></span>
      </a>
      <div className="acts">
        <button className="act" onClick={() => void copy()}><span className="ico"><Copy size={16} /></span>{m.my.link}</button>
        <button className="act" disabled={d.status === 'cancelled'} onClick={download}><span className="ico"><Calendar size={16} /></span>{m.my.calendar}</button>
        {d.status === 'booked' && new Date(d.starts_at).getTime() > Date.now()
          && <PushOptIn token={d.token} kind="booking" compact />}
      </div>
      {note && <p className="note" role="status">{note}</p>}

      {(d.status === 'done' || d.status === 'cancelled') && <button className="btn ghost" onClick={() => openBooking(d.service_id)}>{m.my.bookAgain}</button>}
      {d.status === 'done' && new Date(d.starts_at).getTime() > Date.now() && <p className="muted small">{m.my.reviewLater}</p>}
      {d.status === 'done' && new Date(d.starts_at).getTime() <= Date.now() && !d.reviewed && !reviewSaved && <div className="card col">
        <b>{m.my.reviewTitle}</b>
        <div className="row" role="group" aria-label={m.my.reviewTitle}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={rating === n} aria-label={m.my.ratingAria(n)} className="chip" onClick={() => setRating(n)}>{n} ★</button>)}
        </div>
        <textarea className="field" aria-label={m.my.reviewPlaceholder} maxLength={1000} rows={3} placeholder={m.my.reviewPlaceholder} value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
        {reviewError && <p className="err small" role="alert">{reviewError}</p>}
        <button className="btn" disabled={rating === 0 || review.isPending} onClick={() => review.mutate()}>{review.isPending ? m.my.reviewSending : m.my.reviewSubmit}</button>
      </div>}
      {(d.reviewed || reviewSaved) && <p className="note" role="status">{m.my.thanks}</p>}

      {visitActions && d.can_reschedule && !rescheduling && <button className="btn ghost" onClick={() => onReschedule(d.id)}>{total > 1 ? m.my.rescheduleVisit : m.my.reschedule}</button>}
      {rescheduling && <ReschedulePicker b={b} token={d.token} serviceId={d.service_id} serviceName={d.service_name}
        currentStart={d.starts_at} rescheduleHours={d.reschedule_hours ?? 0}
        onClose={() => onReschedule(null)}
        onDone={() => {
          onReschedule(null); setNote(m.reschedule.success); onChanged();
          void qc.invalidateQueries({ queryKey: ['my-bookings', b.slug] });
        }} />}
      {visitActions && d.can_cancel && (confirming
        ? <button className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? m.my.cancelling : m.my.cancelConfirm}</button>
        : <button className="btn ghost" onClick={() => onConfirm(d.id)}>{total > 1 ? m.my.cancelVisit : m.my.cancel}</button>)}
      {visitActions && !d.can_cancel && d.status === 'booked' && <p className="muted small">{m.my.cancelHint(d.cancel_hours ?? 24, b.phone)}</p>}
      {visitActions && !d.can_reschedule && d.status === 'booked' && d.reschedule_hours > 0 && <p className="muted small">{m.my.rescheduleHint(d.reschedule_hours)}</p>}
      {cancel.isError && <p className="err">{m.my.cancelError}</p>}
    </div>
  );
}
