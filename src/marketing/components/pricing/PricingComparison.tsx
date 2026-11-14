import { features, plans } from '../../data/content';
import './PricingComparison.scss';

export function PricingComparison() {
  return (
    <div className="comparison">
      <table className="comparison__table">
        <caption className="visually-hidden">Сравнение тарифов Servio</caption>
        <thead>
          <tr>
            <th scope="col">Параметр</th>
            {plans.map((plan) => (
              <th scope="col" key={plan.id}>{plan.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Стоимость в месяц</th>
            {plans.map((plan) => (
              <td key={plan.id}>{plan.price.toLocaleString('ru-RU')} ₸</td>
            ))}
          </tr>
          {features.map((feature) => (
            <tr key={feature.id}>
              <th scope="row">{feature.title}</th>
              {plans.map((plan) => (
                <td key={plan.id}>
                  {plan.included.includes(feature.id) ? (
                    <span className="comparison__yes" aria-label="Включено">✓</span>
                  ) : (
                    <span className="comparison__no" aria-label="Не включено">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
