import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { fetchSlots, rescheduleBooking, type RescheduleResult } from '../lib/api';
import type { Business } from '../lib/tenant';
import { clientDateLocale, clientErrText, useClientMessages } from '../lib/clientLocale';

export function ReschedulePicker({ b, token, serviceId, serviceName, currentStart, rescheduleHours, onDone, onClose }: {
  b: Business; token: string; serviceId: string; serviceName: string; currentStart: string; rescheduleHours: number;
  onDone: (result: RescheduleResult) => void; onClose: () => void;
}) {
  const { locale, m } = useClientMessages();
  const today = formatInTimeZone(new Date(), b.timezone, 'yyyy-MM-dd');
  const initialDay = formatInTimeZone(new Date(currentStart), b.timezone, 'yyyy-MM-dd');
  const [day, setDay] = useState(initialDay < today ? today : initialDay);
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(new Date(`${today}T12:00:00Z`).getTime() + i * 864e5);
    return { iso: d.toISOString().slice(0, 10), wd: d.toLocaleDateString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { weekday: 'short', timeZone: 'UTC' }), n: d.getUTCDate() };
  }), [today, locale]);
  const slotsQ = useQuery({ queryKey: ['slots', b.slug, serviceId, day], queryFn: () => fetchSlots(b.slug, serviceId, day) });
  const mut = useMutation({
    mutationFn: () => rescheduleBooking(token, slot!),
    onSuccess: (result) => onDone(result),
    onError: (e: Error) => { setError(clientErrText(e, m.errors)); setSlot(null); void slotsQ.refetch(); },
  });
  const fmt = (iso: string, pattern: string) => formatInTimeZone(new Date(iso), b.timezone, pattern, { locale: clientDateLocale(locale) });

  return (
    <div className="card col">
      <b>{m.reschedule.title}</b>
      <span className="muted small">{serviceName} · {m.reschedule.current}: {fmt(currentStart, "d MMMM 'в' HH:mm")}</span>
      {rescheduleHours > 0 && <p className="muted small">{m.reschedule.hint(rescheduleHours)}</p>}
      <div className="days">
        {days.map((d) => (
          <button key={d.iso} className={`day ${d.iso === day ? 'sel' : ''}`} onClick={() => { setDay(d.iso); setSlot(null); setError(null); }}>
            <span>{d.wd}</span><b>{d.n}</b>
          </button>
        ))}
      </div>
      <label className="muted small" htmlFor="reschedule-date">{m.reschedule.dateLabel}</label>
      <input id="reschedule-date" className="field" type="date" min={today} value={day} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setSlot(null); setError(null); } }} />
      <span className="muted small">{m.reschedule.slotsLabel}</span>
      {slotsQ.isPending ? <p className="muted">{m.reschedule.loading}</p>
        : slotsQ.isError ? <p className="err">{m.reschedule.slotsError} <button className="link" onClick={() => void slotsQ.refetch()}>{m.common.retry}</button></p>
        : slotsQ.data.length === 0 || !slotsQ.data.some((s) => s.free) ? <p className="muted">{m.reschedule.noSlots}</p>
        : <div className="chips">{slotsQ.data.map((s) => (
            <button key={s.slot} disabled={!s.free} aria-pressed={slot === s.slot} className={`chip ${slot === s.slot ? 'sel' : ''}`} onClick={() => { setSlot(s.slot); setError(null); }}>
              {fmt(s.slot, 'HH:mm')}
            </button>
          ))}</div>}
      {error && <p className="err small" role="alert">{error}</p>}
      <div className="row">
        <button className="btn" disabled={!slot || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? m.reschedule.confirming : m.reschedule.confirm}</button>
        <button className="btn ghost" onClick={onClose}>{m.reschedule.cancel}</button>
      </div>
    </div>
  );
}
