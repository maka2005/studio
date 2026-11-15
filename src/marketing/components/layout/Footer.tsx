import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../config/site';
import { BrandMark, Wordmark } from '../../../components/BrandMark';
import './Footer.scss';

type Health = 'loading' | 'operational' | 'degraded' | 'outage' | 'unknown';

const STATUS_TEXT: Record<Health, string> = {
  loading: 'Проверяем статус…',
  operational: 'Все системы работают',
  degraded: 'Есть сбой в работе сервиса',
  outage: 'Сервис временно недоступен',
  unknown: 'Статус системы',
};

function useHealth(): Health {
  const [state, setState] = useState<Health>('loading');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const data = await r.json();
        if (alive) setState(['operational', 'degraded', 'outage'].includes(data?.status) ? data.status : 'unknown');
      } catch {
        if (alive) setState('unknown');
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  return state;
}

export function Footer() {
  const health = useHealth();
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div>
          <p className="footer__brand"><BrandMark size={22} /><Wordmark height={14} /></p>
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
          <span>Оставьте заявку — команда Renvio поможет с подключением.</span>
          <Link to="/contact">Оставить заявку</Link>
          {SITE.contacts.phone && <a href={`tel:${SITE.contacts.phone.replace(/[^+\d]/g, '')}`}>{SITE.contacts.phone}</a>}
          {SITE.contacts.email && <a href={`mailto:${SITE.contacts.email}`}>{SITE.contacts.email}</a>}
        </div>
      </div>
      <div className="container footer__bottom">
        <span>© {new Date().getFullYear()} Renvio. Все права защищены.</span>
        <a className="footer__status" href="/status">
          <span className={`footer__status-dot is-${health}`} aria-hidden="true" />
          {STATUS_TEXT[health]}
        </a>
      </div>
    </footer>
  );
}
