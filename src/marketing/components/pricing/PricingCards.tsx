import { features, plans } from '../../data/content';
import { Button } from '../ui/Button';
import './PricingCards.scss';

interface PricingCardsProps {
  showFeatures?: boolean;
}

export function PricingCards({ showFeatures = true }: PricingCardsProps) {
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

          {showFeatures && (
            <ul className="plan__list">
              {plan.included.map((id) => {
                const feature = features.find((f) => f.id === id);
                return feature ? <li key={id}>{feature.title}</li> : null;
              })}
            </ul>
          )}

          <Button
            to={`/contact?plan=${plan.id}`}
            variant={plan.highlighted ? 'primary' : 'secondary'}
            fullWidth
          >
            Подключить {plan.name}
          </Button>
        </article>
      ))}
    </div>
  );
}
