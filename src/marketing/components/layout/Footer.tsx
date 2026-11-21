import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../../lib/locale';
import { SITE } from '../../config/site';
import { Logo } from '../../../components/BrandMark';
import './Footer.scss';

type Health = 'loading' | 'operational' | 'degraded' | 'outage' | 'unknown';

function useHealth(): Health {
  const [state, setState] = useState<Health>('loading');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const data = await r.json();
        if (alive)
          setState(
            ['operational', 'degraded', 'outage'].includes(data?.status) ? data.status : 'unknown',
          );
      } catch {
        if (alive) setState('unknown');
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return state;
}

export function Footer() {
  const health = useHealth();
  const { t } = useLocale();
  const statusText: Record<Health, string> = {
    loading: t.footerStatusLoading,
    operational: t.footerStatusOperational,
    degraded: t.footerStatusDegraded,
    outage: t.footerStatusOutage,
    unknown: t.footerStatusUnknown,
  };

  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div>
          <p className="footer__brand">
            <Logo height={16} markColor="#c2410c" />
          </p>
          <p className="footer__text">{t.footerDescription}</p>
        </div>

        <nav className="footer__nav" aria-label={t.footerNavigation}>
          <Link to="/">{t.home}</Link>
          <Link to="/features">{t.features}</Link>
          <Link to="/pricing">{t.pricing}</Link>
          <Link to="/contact">{t.contacts}</Link>
          <Link to="/privacy">{t.footerPrivacy}</Link>
        </nav>

        <div className="footer__contacts">
          <b>{t.footerForBusiness}</b>
          <span>{t.footerLead}</span>
          <Link to="/contact">{t.footerRequest}</Link>
          {SITE.contacts.phone && (
            <a href={`tel:${SITE.contacts.phone.replace(/[^+\d]/g, '')}`}>{SITE.contacts.phone}</a>
          )}
          {SITE.contacts.email && (
            <a href={`mailto:${SITE.contacts.email}`}>{SITE.contacts.email}</a>
          )}
        </div>
      </div>
      <div className="container footer__bottom">
        <span>
          © {new Date().getFullYear()} Renvio. {t.footerRights}
        </span>
        <a className="footer__status" href="/status">
          <span className={`footer__status-dot is-${health}`} aria-hidden="true" />
          {statusText[health]}
        </a>
      </div>
    </footer>
  );
}
