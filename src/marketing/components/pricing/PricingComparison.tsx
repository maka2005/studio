import { features } from '../../data/content';
import { usePlans } from '../../hooks/usePlans';
import './PricingComparison.scss';

export function PricingComparison() {
  const plans = usePlans();
  const fmt = (v: number | null) => (v === null ? 'Без ограничений' : v.toLocaleString('ru-RU'));
  const limitRows = [
    { label: 'Сотрудники', pick: (l: (typeof plans)[number]['limits']) => l.employees },
    { label: 'Услуги', pick: (l: (typeof plans)[number]['limits']) => l.services },
    { label: 'Филиалы', pick: (l: (typeof plans)[number]['limits']) => l.branches },
    { label: 'Записей в месяц', pick: (l: (typeof plans)[number]['limits']) => l.bookingsPerMonth },
  ];
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
          {limitRows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {plans.map((plan) => (
                <td key={plan.id}>{fmt(row.pick(plan.limits))}</td>
              ))}
            </tr>
          ))}
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
