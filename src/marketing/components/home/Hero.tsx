import { Button } from '../ui/Button';
import { heroChips } from '../../data/content';
import { ProductPreview } from './ProductPreview';
import './Hero.scss';

export function Hero() {
  return (
    <section className="hero">
      <div className="hero__glow" aria-hidden="true" />
      <div className="container hero__inner">
        <div className="hero__content">
          <p className="hero__eyebrow">Для СТО, детейлинга, автомоек и шиномонтажа в Казахстане</p>
          <h1 className="hero__title">
            Онлайн-запись и управление автосервисом <span>в одной системе</span>
          </h1>
          <p className="hero__lead">
            Renvio принимает записи клиентов 24/7, собирает расписание сотрудников, напоминает клиентам в Telegram
            и показывает аналитику — вместо звонков, тетрадей и разрозненных таблиц.
          </p>

          <div className="hero__actions">
            <Button to="/contact">Подключить Renvio</Button>
            <Button variant="secondary" to="/contact?type=demo">Попробовать демо</Button>
          </div>

          <ul className="hero__chips">
            {heroChips.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="hero__visual">
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}
