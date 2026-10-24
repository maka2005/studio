import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import type { Ctx } from '../lib/tenant';
import { cancelBooking, getBooking } from '../lib/api';
import { money } from '../lib/format';
import { saveToken } from '../lib/tokens';
import { Bell, Calendar, Check, Copy, Phone } from '../lib/icons';
const STATUS: Record<string, string> = { booked: 'Подтверждена', arrived: 'Машина принята', done: 'Работа выполнена', cancelled: 'Отменена' };

// Токен берётся из приватной ссылки (#t=...) либо из хранилища этого устройства. Фрагмент не уходит на сервер.
function readToken(slug: string): string | null {
  const m = /[#&]t=([0-9a-f]{20,})/.exec(window.location.hash);
  if (m) {
    saveToken(slug, m[1]!);
    history.replaceState(null, '', window.location.pathname);
    return m[1]!;
  }
  try { return localStorage.getItem(`booking:${slug}`); } catch { return null; }
}

export function MyBooking() {
  const { b, openBooking } = useOutletContext<Ctx>();
  const qc = useQueryClient(); const [sure, setSure] = useState(false); const [note, setNote] = useState<string | null>(null);
  const [token] = useState(() => readToken(b.slug));
  const q = useQuery({ queryKey: ['my', b.slug], queryFn: () => getBooking(token!), enabled: !!token });
  const cancel = useMutation({ mutationFn: () => cancelBooking(token!), onSuccess: () => { setSure(false); void qc.invalidateQueries({ queryKey: ['my', b.slug] }); } });
  if (!token || (q.isSuccess && !q.data)) return <section className="page"><h2>Моя запись</h2><p className="muted">На этом устройстве записей пока нет.</p><button className="btn" onClick={() => openBooking()}>Записаться</button></section>;
  if (q.isPending) return <p className="page muted">Загрузка…</p>;
  if (q.isError) return <p className="page err">Не удалось загрузить запись. <button className="link" onClick={() => q.refetch()}>Повторить</button></p>;
  const d = q.data!; const f = (s: string, p: string) => formatInTimeZone(new Date(s), b.timezone, p, { locale: ru });
  const z = (s: string) => new Date(s).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const download = (alarm: boolean) => {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//${b.slug}//ru\r\nBEGIN:VEVENT\r\nUID:${d.id}@${b.slug}\r\nDTSTAMP:${z(new Date().toISOString())}\r\nDTSTART:${z(d.starts_at)}\r\nDTEND:${z(d.ends_at)}\r\nSUMMARY:${b.name}: ${d.service_name}\r\nLOCATION:${b.address}\r\n${alarm ? 'BEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:Запись завтра\r\nEND:VALARM\r\n' : ''}END:VEVENT\r\nEND:VCALENDAR\r\n`;
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'booking.ics'; a.click(); URL.revokeObjectURL(url);
    setNote(alarm ? 'Скачан файл с напоминанием за сутки. Откройте его, чтобы добавить в календарь. Push-уведомления пока не подключены.' : 'Файл календаря скачан. Откройте его, чтобы добавить запись.');
  };
  const copy = async () => {
    const link = `${window.location.origin}/s/${b.slug}/booking#t=${token}`;
    try { await navigator.clipboard.writeText(link); setNote('Приватная ссылка скопирована. Сохраните её для доступа с другого устройства.'); }
    catch { setNote(`Не удалось скопировать автоматически. Ссылка: ${link}`); }
  };
  return (<section className="page"><h2>Моя запись</h2>
    <div className="card status"><span className="okc"><Check size={18} /></span><span className="muted small">{b.short_name}</span>
      <h3 style={{ margin: 0 }}>{STATUS[d.status] ?? d.status}</h3><b>{f(d.starts_at, "d MMMM 'в' HH:mm")}</b></div>
    <h2 style={{ fontSize: 22, marginTop: 20 }}>{d.service_name}</h2>
    <div className="kv"><span className="muted">Стоимость</span><b>{money(d.price_cents / 100, b.currency)}</b></div>
    <div className="kv"><span className="muted">Выдача, ориентир</span><b>{f(d.ends_at, "d MMMM 'в' HH:mm")}</b></div>
    <p><b>{d.car}</b></p><p className="muted">{b.address}</p>
    <a className="card contact" href={`tel:${b.phone}`}><span className="ico accent" style={{ width: 52, height: 52 }}><Phone /></span><span><b>Связаться со студией</b><br /><span className="muted small">{b.phone}</span></span></a>
    <div className="acts">
      <button className="act" onClick={() => void copy()}><span className="ico"><Copy size={16} /></span>Ссылка</button>
      <button className="act" disabled={d.status === 'cancelled'} onClick={() => download(false)}><span className="ico"><Calendar size={16} /></span>Календарь</button>
      <button className="act" disabled={d.status === 'cancelled'} onClick={() => download(true)}><span className="ico"><Bell size={16} /></span>Напомнить</button></div>
    {note && <p className="note" role="status">{note}</p>}
    {d.can_cancel && (sure ? <button className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? 'Отменяем…' : 'Да, отменить запись'}</button>
      : <button className="btn ghost" onClick={() => setSure(true)}>Отменить запись</button>)}
    {!d.can_cancel && d.status === 'booked' && <p className="muted small">Отмена доступна не позднее чем за 24 часа до начала. Позвоните в студию: {b.phone}.</p>}
    {cancel.isError && <p className="err">Не удалось отменить. Повторите позже.</p>}</section>);
}
