import { useMarketingCopy } from '../../data/copy';
import { usePlans, useTrialDays } from '../../hooks/usePlans';
import { Button } from '../ui/Button';
import './PricingCards.scss';

interface PricingCardsProps {
  showFeatures?: boolean;
}

export function PricingCards({ showFeatures = true }: PricingCardsProps) {
  const copy = useMarketingCopy();
  const plans = usePlans();
  const trialDays = useTrialDays();
  const labels = copy.ui.pricing;

  return (
    <div className="pricing-cards">
      {plans.map((plan) => (
        <article key={plan.id} className={`plan ${plan.highlighted ? 'plan--highlighted' : ''}`}>
          <header className="plan__header">
            <h3 className="plan__name">{plan.name}</h3>
            <p className="plan__description">{copy.ui.planDescriptions[plan.id] ?? plan.description}</p>
          </header>

          <p className="plan__price">
            <span className="plan__amount">{plan.price.toLocaleString(copy.ui.numberLocale)} ₸</span>
            <span className="plan__period">{labels.perMonth}</span>
          </p>

          <ul className="plan__list plan__list--limits">
            <li>{labels.limit(labels.employees, plan.limits.employees)}</li>
            <li>{labels.limit(labels.services, plan.limits.services)}</li>
            <li>{labels.limit(labels.branches, plan.limits.branches)}</li>
            <li>{labels.limit(labels.bookings, plan.limits.bookingsPerMonth)}</li>
          </ul>

          {showFeatures && (
            <ul className="plan__list">
              {plan.included.map((id) => {
                const feature = copy.features.find((f) => f.id === id);
                return feature ? <li key={id}>{feature.title}</li> : null;
              })}
            </ul>
          )}

          <Button to={`/contact?type=connect&plan=${plan.id}`} variant={plan.highlighted ? 'primary' : 'secondary'} fullWidth>
            {labels.connect(plan.name)}
          </Button>
          <p className="plan__trial">{labels.trialSuffix(trialDays)}</p>
        </article>
      ))}
    </div>
  );
}
