import { useEffect, useMemo, useState } from 'react';
import { useClientMessages } from '../lib/clientLocale';
import { ArrowLeft, ArrowRight } from '../lib/icons';

const DAY_MS = 86_400_000;
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const monthOf = (iso: string) => iso.slice(0, 7);

/** Calendar inside the sheet: no native date input and no system popup. */
export function DateField({ id, label, value, min, onChange }: {
  id: string; label: string; value: string; min: string; onChange: (iso: string) => void;
}) {
  const { locale, m } = useClientMessages();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(value));
  const intlLocale = locale === 'kk' ? 'kk-KZ' : 'ru-RU';

  useEffect(() => { if (open) setView(monthOf(value)); }, [open, value]);

  const grid = useMemo(() => {
    const year = Number(view.slice(0, 4));
    const month = Number(view.slice(5, 7));
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7; // Monday first
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const start = new Date(first.getTime() - offset * DAY_MS);
    const weekdays = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS)
      .toLocaleDateString(intlLocale, { weekday: 'short', timeZone: 'UTC' }));
    const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => {
      const date = new Date(start.getTime() + i * DAY_MS);
      return {
        iso: toIso(date), n: date.getUTCDate(), out: date.getUTCMonth() !== month - 1,
        label: date.toLocaleDateString(intlLocale, { day: 'numeric', month: 'long', timeZone: 'UTC' }),
      };
    });
    return { weekdays, cells };
  }, [view, intlLocale]);

  const format = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale, { ...options, timeZone: 'UTC' });
  const shiftMonth = (delta: number) => {
    const year = Number(view.slice(0, 4));
    const month = Number(view.slice(5, 7));
    setView(monthOf(toIso(new Date(Date.UTC(year, month - 1 + delta, 1)))));
  };
  const pick = (iso: string) => { onChange(iso); setView(monthOf(iso)); setOpen(false); };

  return <div className="date-field">
    <span className="muted small">{label}</span>
    <button id={id} type="button" className="date-field__trigger" aria-label={label}
      aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => setOpen(!open)}>
      <span className="date-field__value">{format(value, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      <ArrowRight size={18} className={`date-field__chev ${open ? 'open' : ''}`} />
    </button>
    {open && <div id={`${id}-calendar`} className="date-field__pop">
      <div className="date-field__head">
        <button type="button" className="date-field__nav" aria-label={m.booking.prevMonth}
          disabled={view <= monthOf(min)} onClick={() => shiftMonth(-1)}><ArrowLeft size={18} /></button>
        <b>{format(`${view}-01`, { month: 'long', year: 'numeric' })}</b>
        <button type="button" className="date-field__nav" aria-label={m.booking.nextMonth}
          onClick={() => shiftMonth(1)}><ArrowRight size={18} /></button>
      </div>
      <div className="date-field__week" aria-hidden="true">
        {grid.weekdays.map((wd, i) => <span key={i}>{wd}</span>)}
      </div>
      <div className="date-field__grid">
        {grid.cells.map((cell) => <button key={cell.iso} type="button" aria-label={cell.label}
          aria-pressed={cell.iso === value} disabled={cell.iso < min}
          className={`date-field__day ${cell.iso === value ? 'sel' : ''} ${cell.out ? 'out' : ''}`}
          onClick={() => pick(cell.iso)}>{cell.n}</button>)}
      </div>
    </div>}
  </div>;
}
