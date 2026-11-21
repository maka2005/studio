import { useLocale } from '../../../lib/locale';
import './WorkOrder.scss';

/** Единственный смелый элемент первой страницы: цеховой наряд-заказ. */
export function WorkOrder() {
  const { t } = useLocale();

  return (
    <div className="work-order">
      <div className="work-order__head">
        <span className="work-order__title">{t.ticket.title}</span>
        <span className="work-order__number">
          {t.ticket.numberLabel} {t.ticket.number}
        </span>
      </div>

      <dl className="work-order__rows">
        {t.ticket.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="work-order__tear" aria-hidden="true" />
      <div className="work-order__barcode" aria-hidden="true" />
      <span className="work-order__stamp">{t.ticket.status}</span>
    </div>
  );
}
