import { features } from '../../data/content';
import { formatLimit, usePlans, useTrialDays } from '../../hooks/usePlans';
import { trialFreeText } from '../../lib/trial';
import { Button } from '../ui/Button';
import './PricingCards.scss';

interface PricingCardsProps {
  showFeatures?: boolean;
}

export function PricingCards({ showFeatures = true }: PricingCardsProps) {
  const plans = usePlans();
  const trialDays = useTrialDays();

  return (
    <div className="pricing-cards">
      {plans.map((plan) => (
        <article key={plan.id} className={`plan ${plan.highlighted ? 'plan--highlighted' : ''}`}>
          <header className="plan__header">
            <h3 className="plan__name">{plan.name}</h3>
            <p className="plan__description">{plan.description}</p>
          </header>

          <p className="plan__price">
            <span className="plan__amount">{plan.price.toLocaleString('ru-RU')} ₸</span>
            <span className="plan__period">в месяц</span>
          </p>

          <ul className="plan__list plan__list--limits">
            <li>{formatLimit(plan.limits.employees, 'Сотрудники')}</li>
            <li>{formatLimit(plan.limits.services, 'Услуги')}</li>
            <li>{formatLimit(plan.limits.branches, 'Филиалы')}</li>
            <li>{formatLimit(plan.limits.bookingsPerMonth, 'Записей в месяц')}</li>
          </ul>

          {showFeatures && (
            <ul className="plan__list">
              {plan.included.map((id) => {
                const feature = features.find((f) => f.id === id);
                return feature ? <li key={id}>{feature.title}</li> : null;
              })}
            </ul>
          )}

          <Button to={`/contact?type=connect&plan=${plan.id}`} variant={plan.highlighted ? 'primary' : 'secondary'} fullWidth>
            Подключить {plan.name}
          </Button>
          <p className="plan__trial">{trialFreeText(trialDays)} · доступ сразу · оплата после пробного периода</p>
        </article>
      ))}
    </div>
  );
}
