import { useLocale } from '../../../lib/locale';
import './WorkOrder.scss';

/** Единственный смелый элемент первой страницы: цеховой наряд-заказ. */
export function WorkOrder() {
  const { t } = useLocale();

  return (
    <div className="work-order">
      <div className="work-order__head">
        <span className="work-order__title">{t.ticketTitle}</span>
        <span className="work-order__number">{t.ticketNumberLabel} RNV-0427</span>
      </div>

      <dl className="work-order__rows">
        <div>
          <dt>{t.ticketClientLabel}</dt>
          <dd>{t.ticketClient}</dd>
        </div>
        <div>
          <dt>{t.ticketTimeLabel}</dt>
          <dd>{t.ticketTime}</dd>
        </div>
        <div>
          <dt>{t.ticketServiceLabel}</dt>
          <dd>{t.ticketService}</dd>
        </div>
      </dl>

      <div className="work-order__tear" aria-hidden="true" />
      <div className="work-order__barcode" aria-hidden="true" />
      <span className="work-order__stamp">{t.ticketStatus}</span>
    </div>
  );
}
