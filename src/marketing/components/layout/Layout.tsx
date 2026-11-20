import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useLocale } from '../../../lib/locale';
import { Header } from './Header';
import { Footer } from './Footer';

export function Layout() {
  const { pathname } = useLocation();
  const { t } = useLocale();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="marketing-site">
      <a className="skip-link" href="#main">
        {t.skipToContent}
      </a>
      <Header />
      <main id="main" className="marketing-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
