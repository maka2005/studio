import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlans } from '../../hooks/usePlans';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

interface SliderProps {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function Slider({ label, suffix, value, min, max, step, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className="roi__field">
      <label htmlFor={id}>{label}</label>
      <div className="roi__control">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="roi__input">
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={label}
            onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          />
          <em>{suffix}</em>
        </span>
      </div>
    </div>
  );
}

/** Прикидка потерь от пропущенных звонков и неявок. Это оценка по данным пользователя, а не обещание результата. */
export function RoiCalculator() {
  const plans = usePlans();
  const [bookings, setBookings] = useState(200);
  const [check, setCheck] = useState(15000);
  const [missed, setMissed] = useState(8);
  const [noShow, setNoShow] = useState(10);

  const lossMissed = bookings * (missed / 100) * check;
  const lossNoShow = bookings * (noShow / 100) * check;
  const total = lossMissed + lossNoShow;
  const recovered = total * 0.3; // осторожное допущение: возвращается 30% потерь
  const cheapest = [...plans].sort((a, b) => a.price - b.price)[0];
  const price = cheapest?.price ?? 0;
  const profit = recovered - price;

  return (
    <Section id="calculator">
      <SectionHeader
        eyebrow="Калькулятор"
        title="Сколько вы теряете на пропущенных звонках и неявках"
        description="Укажите данные вашего сервиса — прикинем, что может вернуть онлайн-запись с напоминаниями."
        align="center"
      />
      <div className="roi">
        <div className="roi__form">
          <Slider label="Записей в месяц" suffix="шт." value={bookings} min={20} max={3000} step={10} onChange={setBookings} />
          <Slider label="Средний чек" suffix="₸" value={check} min={2000} max={200000} step={500} onChange={setCheck} />
          <Slider label="Клиенты, до которых не дозвонились или не ответили" suffix="%" value={missed} min={0} max={40} step={1} onChange={setMissed} />
          <Slider label="Неявки на записи" suffix="%" value={noShow} min={0} max={40} step={1} onChange={setNoShow} />
        </div>

        <div className="roi__result" aria-live="polite">
          <p className="roi__label">Потери в месяц по вашим данным</p>
          <p className="roi__big">{fmt(total)} ₸</p>
          <ul className="roi__rows">
            <li><span>Не дозвонились / потеряли заявку</span><b>{fmt(lossMissed)} ₸</b></li>
            <li><span>Неявки</span><b>{fmt(lossNoShow)} ₸</b></li>
            <li><span>Вернуть удастся (оценка 30%)</span><b>{fmt(recovered)} ₸</b></li>
            {cheapest && <li><span>Тариф {cheapest.name} в месяц</span><b>{fmt(price)} ₸</b></li>}
          </ul>
          <p className={`roi__verdict ${profit > 0 ? 'is-plus' : ''}`}>
            {profit > 0
              ? `Потенциальный плюс: около ${fmt(profit)} ₸ в месяц после оплаты тарифа.`
              : 'При таких данных выгода зависит от других факторов — обсудим на демо.'}
          </p>
          <Link to="/contact?type=demo" className="roi__cta btn btn--primary">Обсудить на демо</Link>
          <p className="roi__note">Это ориентировочная оценка по введённым вами данным, а не гарантия результата.</p>
        </div>
      </div>
    </Section>
  );
}
