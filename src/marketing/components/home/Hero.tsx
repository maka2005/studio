import { useLocale } from '../../../lib/locale';
import { Button } from '../ui/Button';
import { heroChips } from '../../data/content';
import { useTrialDays } from '../../hooks/usePlans';
import { WorkOrder } from './WorkOrder';
import './Hero.scss';

export function Hero() {
  const trialDays = useTrialDays();
  const { t } = useLocale();
  return (
    <section className="hero">
      <div className="container hero__inner">
        <div className="hero__content">
          <p className="hero__eyebrow">{t.heroEyebrow}</p>
          <h1 className="hero__title">
            {t.heroTitle} {t.heroTitleAccent}
          </h1>
          <p className="hero__lead">{t.heroSubtitle}</p>

          <div className="hero__actions">
            <Button to="/contact">{t.connect}</Button>
            <Button variant="secondary" to="/contact?type=demo">
              {t.tryDemo}
            </Button>
          </div>

          <ul className="hero__chips">
            {heroChips(trialDays).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="hero__visual">
          <WorkOrder />
        </div>
      </div>
    </section>
  );
}
