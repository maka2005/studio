import type { ReactNode } from 'react';
import './Section.scss';

interface SectionProps {
  id?: string;
  tone?: 'default' | 'muted';
  children: ReactNode;
}

export function Section({ id, tone = 'default', children }: SectionProps) {
  return (
    <section id={id} className={`section section--${tone}`}>
      <div className="container">{children}</div>
    </section>
  );
}

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  titleTag?: 'h2' | 'h3';
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'left',
  titleTag: Title = 'h2',
}: SectionHeaderProps) {
  return (
    <header className={`section-header section-header--${align}`}>
      {eyebrow && <p className="section-header__eyebrow">{eyebrow}</p>}
      <Title className="section-header__title">{title}</Title>
      {description && <p className="section-header__desc">{description}</p>}
    </header>
  );
}
