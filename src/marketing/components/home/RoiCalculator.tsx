import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarketingCopy } from '../../data/copy';
import { usePlans } from '../../hooks/usePlans';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

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
  const copy = useMarketingCopy();
  const section = copy.sections.roi;
  const plans = usePlans();
  const [bookings, setBookings] = useState(200);
  const [check, setCheck] = useState(15000);
  const [missed, setMissed] = useState(8);
  const [noShow, setNoShow] = useState(10);

  const fmt = (n: number) => Math.round(n).toLocaleString(copy.ui.numberLocale);
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
        eyebrow={section.eyebrow}
        title={section.title}
        description={section.description}
        align="center"
      />
      <div className="roi">
        <div className="roi__form">
          <Slider label={section.sliders.bookings} suffix={section.sliders.unit} value={bookings} min={20} max={3000} step={10} onChange={setBookings} />
          <Slider label={section.sliders.check} suffix={section.sliders.currency} value={check} min={2000} max={200000} step={500} onChange={setCheck} />
          <Slider label={section.sliders.missed} suffix={section.sliders.percent} value={missed} min={0} max={40} step={1} onChange={setMissed} />
          <Slider label={section.sliders.noShow} suffix={section.sliders.percent} value={noShow} min={0} max={40} step={1} onChange={setNoShow} />
        </div>

        <div className="roi__result" aria-live="polite">
          <p className="roi__label">{section.labels.loss}</p>
          <p className="roi__big">{fmt(total)} ₸</p>
          <ul className="roi__rows">
            <li><span>{section.labels.missed}</span><b>{fmt(lossMissed)} ₸</b></li>
            <li><span>{section.labels.noShow}</span><b>{fmt(lossNoShow)} ₸</b></li>
            <li><span>{section.labels.recover}</span><b>{fmt(recovered)} ₸</b></li>
            {cheapest && <li><span>{section.labels.plan} {cheapest.name}</span><b>{fmt(price)} ₸</b></li>}
          </ul>
          <p className={`roi__verdict ${profit > 0 ? 'is-plus' : ''}`}>
            {profit > 0 ? section.labels.verdictPlus(fmt(profit)) : section.labels.verdictMinus}
          </p>
          <Link to="/contact?type=demo" className="roi__cta btn btn--primary">{copy.ui.demoLink}</Link>
          <p className="roi__note">{section.note}</p>
        </div>
      </div>
    </Section>
  );
}
