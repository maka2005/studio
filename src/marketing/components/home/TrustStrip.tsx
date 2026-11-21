import { useMarketingCopy } from '../../data/copy';
import { useTrialDays } from '../../hooks/usePlans';
import './HomeSections.scss';

export function TrustStrip() {
  const trialDays = useTrialDays();
  const copy = useMarketingCopy();
  return (
    <section className="trust" aria-label={copy.ui.trustAria}>
      <ul className="container trust__list">
        {copy.trustStats(trialDays).map((s) => (
          <li key={s.label} className="trust__item">
            <b>{s.value}</b>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
