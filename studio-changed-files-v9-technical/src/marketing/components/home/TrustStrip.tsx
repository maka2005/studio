import { trustStats } from '../../data/content';
import { useTrialDays } from '../../hooks/usePlans';
import './HomeSections.scss';

export function TrustStrip() {
  const trialDays = useTrialDays();
  return (
    <section className="trust" aria-label="Коротко о Renvio">
      <ul className="container trust__list">
        {trustStats(trialDays).map((s) => (
          <li key={s.label} className="trust__item">
            <b>{s.value}</b>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
