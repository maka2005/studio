import { Button } from '../ui/Button';
import { ScreenshotFrame } from '../ui/ScreenshotFrame';
import './Hero.scss';

const highlights = ['Онлайн-запись клиентов', 'Расписание в одном окне', 'Аналитика и отчёты'];

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero__inner">
        <div className="hero__content">
          <p className="hero__eyebrow">Для СТО и сервисных бизнесов Казахстана</p>
          <h1 className="hero__title">
            Записи, расписание и аналитика вашего сервиса — в одной системе
          </h1>
          <p className="hero__lead">
            Servio помогает владельцам СТО, детейлинг-студий, автомоек и шиномонтажных мастерских
            принимать онлайн-запись, управлять услугами и сотрудниками и видеть, как идёт бизнес.
          </p>

          <div className="hero__actions">
            <Button variant="secondary" to="/contact?type=demo">Попробовать демо</Button>
            <Button to="/contact">Подключить Servio</Button>
          </div>

          <ul className="hero__points">
            {highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="hero__visual">
          <ScreenshotFrame label="Главный экран Servio: календарь записей" ratio="4 / 3" />
        </div>
      </div>
    </section>
  );
}
