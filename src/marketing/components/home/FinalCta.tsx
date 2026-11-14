import { Button } from '../ui/Button';
import './FinalCta.scss';

export function FinalCta() {
  return (
    <section className="final-cta">
      <div className="container final-cta__inner">
        <h2 className="final-cta__title">Готовы навести порядок в записях и расписании?</h2>
        <p className="final-cta__text">
          Расскажите о вашем сервисе — покажем систему и поможем подключиться.
        </p>
        <div className="final-cta__actions">
          <Button variant="secondary" to="/contact?type=demo">Попробовать демо</Button>
          <Button to="/contact">Подключить Servio</Button>
        </div>
      </div>
    </section>
  );
}
