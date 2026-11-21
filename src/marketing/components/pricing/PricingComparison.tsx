import { useMarketingCopy } from '../../data/copy';
import { usePlans } from '../../hooks/usePlans';
import './PricingComparison.scss';

export function PricingComparison() {
  const copy = useMarketingCopy();
  const labels = copy.ui.pricing;
  const plans = usePlans();
  const fmt = (v: number | null) => (v === null ? labels.unlimited : v.toLocaleString(copy.ui.numberLocale));
  const limitRows = [
    { label: labels.employees, pick: (l: (typeof plans)[number]['limits']) => l.employees },
    { label: labels.services, pick: (l: (typeof plans)[number]['limits']) => l.services },
    { label: labels.branches, pick: (l: (typeof plans)[number]['limits']) => l.branches },
    { label: labels.bookings, pick: (l: (typeof plans)[number]['limits']) => l.bookingsPerMonth },
  ];
  return (
    <div className="comparison">
      <table className="comparison__table">
        <caption className="visually-hidden">{labels.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.whatCompare}</th>
            {plans.map((plan) => (
              <th scope="col" key={plan.id}>{plan.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{labels.priceMonth}</th>
            {plans.map((plan) => (
              <td key={plan.id}>{plan.price.toLocaleString(copy.ui.numberLocale)} ₸</td>
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
          {copy.features.map((feature) => (
            <tr key={feature.id}>
              <th scope="row">{feature.title}</th>
              {plans.map((plan) => (
                <td key={plan.id}>
                  {plan.included.includes(feature.id) ? (
                    <span className="comparison__yes" aria-label={labels.included}>✓</span>
                  ) : (
                    <span className="comparison__no" aria-label={labels.notIncluded}>—</span>
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
