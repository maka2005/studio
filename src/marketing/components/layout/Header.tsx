import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Button } from '../ui/Button';
import './Header.scss';

const navItems = [
  { to: '/features', label: 'Возможности' },
  { to: '/pricing', label: 'Тарифы' },
  { to: '/contact', label: 'Контакты' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  return (
    <header className="header">
      <div className="container header__inner">
        <Link to="/" className="header__logo" aria-label="Servio — на главную" onClick={closeMenu}>
          Servio
        </Link>

        <nav
          id="main-nav"
          className={`header__nav ${open ? 'header__nav--open' : ''}`}
          aria-label="Основная навигация"
        >
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="header__link" onClick={closeMenu}>
              {item.label}
            </NavLink>
          ))}
          <div className="header__actions">
            <Button variant="secondary" to="/contact?type=demo">Попробовать демо</Button>
            <Button to="/contact">Подключить Servio</Button>
          </div>
        </nav>

        <button
          type="button"
          className="header__burger"
          aria-expanded={open}
          aria-controls="main-nav"
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
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
