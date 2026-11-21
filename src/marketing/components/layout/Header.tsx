import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useLocale } from '../../../lib/locale';
import { Button } from '../ui/Button';
import { BRAND_MARK_COLOR, Logo } from '../../../components/BrandMark';
import './Header.scss';

const navItems = [
  { to: '/', key: 'home' as const, end: true },
  { to: '/features', key: 'features' as const },
  { to: '/pricing', key: 'pricing' as const },
  { to: '/contact', key: 'contacts' as const },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const { locale, setLocale, t } = useLocale();
  const closeMenu = () => setOpen(false);

  return (
    <header className="header">
      <div className="container header__inner">
        <Link to="/" className="header__logo" aria-label={`Renvio — ${t.home}`} onClick={closeMenu}>
          <Logo height={18} markColor={BRAND_MARK_COLOR} />
        </Link>

        <nav
          id="main-nav"
          className={`header__nav ${open ? 'header__nav--open' : ''}`}
          aria-label={t.mainNavigation}
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="header__link"
              onClick={closeMenu}
            >
              {t[item.key]}
            </NavLink>
          ))}
          <div className="header__actions">
            <div className="header__locale" role="group" aria-label={t.language}>
              {(['ru', 'kk'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`header__locale-btn ${locale === code ? 'is-active' : ''}`}
                  aria-pressed={locale === code}
                  onClick={() => setLocale(code)}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <Button variant="secondary" to="/contact?type=demo">
              {t.tryDemo}
            </Button>
            <Button to="/contact">{t.connect}</Button>
          </div>
        </nav>

        <button
          type="button"
          className="header__burger"
          aria-expanded={open}
          aria-controls="main-nav"
          aria-label={open ? t.closeMenu : t.openMenu}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
