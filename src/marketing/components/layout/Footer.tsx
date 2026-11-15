import { Link } from 'react-router-dom';
import { SITE } from '../../config/site';
import './Footer.scss';

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div>
          <p className="footer__brand">Servio</p>
          <p className="footer__text">
            Облачная система управления автосервисами и сервисными предприятиями в Казахстане.
          </p>
        </div>

        <nav className="footer__nav" aria-label="Навигация в подвале">
          <Link to="/">Главная</Link>
          <Link to="/features">Возможности</Link>
          <Link to="/pricing">Тарифы</Link>
          <Link to="/contact">Контакты</Link>
          <Link to="/privacy">Политика конфиденциальности</Link>
        </nav>

        <div className="footer__contacts">
          <b>Для автосервисов и СТО</b>
          <span>Оставьте заявку — команда Servio поможет с подключением.</span>
          <Link to="/contact">Оставить заявку</Link>
          {SITE.contacts.phone && <a href={`tel:${SITE.contacts.phone.replace(/[^+\d]/g, '')}`}>{SITE.contacts.phone}</a>}
          {SITE.contacts.email && <a href={`mailto:${SITE.contacts.email}`}>{SITE.contacts.email}</a>}
        </div>
      </div>
      <div className="container footer__bottom">
        © {new Date().getFullYear()} Servio. Все права защищены.
      </div>
    </footer>
  );
}
