import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import type { Ctx } from '../lib/tenant';
import { cancelBooking, getBooking } from '../lib/api';
import { money } from '../lib/format';
const STATUS: Record<string, string> = { booked: 'Запись подтверждена', arrived: 'Машина принята', done: 'Работа выполнена', cancelled: 'Запись отменена' };
export function MyBooking() {
  const { b, openBooking } = useOutletContext<Ctx>();
  const qc = useQueryClient(); const [sure, setSure] = useState(false);
  let token: string | null = null; try { token = localStorage.getItem(`booking:${b.slug}`); } catch { /* недоступно */ }
  const q = useQuery({ queryKey: ['my', b.slug], queryFn: () => getBooking(token!), enabled: !!token });
  const cancel = useMutation({ mutationFn: () => cancelBooking(token!), onSuccess: () => { setSure(false); void qc.invalidateQueries({ queryKey: ['my', b.slug] }); } });
  if (!token || (q.isSuccess && !q.data)) return <section className="pad"><h2>Моя запись</h2><p className="muted">На этом устройстве записей пока нет.</p><button className="btn" onClick={() => openBooking()}>Записаться</button></section>;
  if (q.isPending) return <p className="pad muted">Загрузка…</p>;
  if (q.isError) return <p className="pad err">Не удалось загрузить запись. <button className="link" onClick={() => q.refetch()}>Повторить</button></p>;
  const d = q.data!; const f = (s: string, p: string) => formatInTimeZone(new Date(s), b.timezone, p, { locale: ru });
  const z = (s: string) => new Date(s).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${d.id}@${b.slug}\r\nDTSTAMP:${z(new Date().toISOString())}\r\nDTSTART:${z(d.starts_at)}\r\nDTEND:${z(d.ends_at)}\r\nSUMMARY:${b.name}: ${d.service_name}\r\nLOCATION:${b.address}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  return (<section className="pad"><h2>Моя запись</h2>
    <div className="card col"><b>{STATUS[d.status] ?? d.status}</b><span>{d.service_name}</span><span>{f(d.starts_at, "d MMMM 'в' HH:mm")}</span>
      <span className="muted">{d.car} · {money(d.price_cents / 100, b.currency)}</span></div>
    {d.status !== 'cancelled' && <a className="btn ghost" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="booking.ics">Добавить в календарь</a>}
    {d.can_cancel && (sure ? <button className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? 'Отменяем…' : 'Да, отменить запись'}</button>
      : <button className="btn ghost" onClick={() => setSure(true)}>Отменить запись</button>)}
    {!d.can_cancel && d.status === 'booked' && <p className="muted small">Отмена доступна не позднее чем за 24 часа до начала. Позвоните в студию: {b.phone}.</p>}
    {cancel.isError && <p className="err">Не удалось отменить. Повторите позже.</p>}</section>);
}
