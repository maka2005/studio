import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './Button.scss';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  children: ReactNode;
  variant?: Variant;
  to?: string;
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  fullWidth?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  to,
  href,
  onClick,
  type = 'button',
  fullWidth = false,
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, fullWidth && 'btn--full'].filter(Boolean).join(' ');

  if (to) {
    return <Link to={to} className={classes}>{children}</Link>;
  }
  if (href) {
    const isExternal = href.startsWith('http');
    return (
      <a
        href={href}
        className={classes}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button type={type} className={classes} onClick={onClick}>
      {children}
    </button>
  );
}
