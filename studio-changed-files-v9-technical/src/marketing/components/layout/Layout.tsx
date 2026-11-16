import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';

export function Layout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="marketing-site">
      <a className="skip-link" href="#main">Перейти к содержанию</a>
      <Header />
      <main id="main" className="marketing-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
