import { highlights } from '../../data/content';
import { useReveal } from '../../hooks/useReveal';
import { Button } from '../ui/Button';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Highlights() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <Section id="features" tone="muted">
      <SectionHeader
        eyebrow="Возможности"
        title="Всё, что нужно сервису — уже внутри"
        description="От первой онлайн-записи до отчёта по выручке: каждый модуль решает конкретную задачу владельца."
        align="center"
      />
      <div ref={ref} className="highlights">
        {highlights.map((h) => (
          <article key={h.title} className="highlights__item">
            <span className="highlights__icon" aria-hidden="true">{h.icon}</span>
            <h3>{h.title}</h3>
            <p>{h.text}</p>
          </article>
        ))}
      </div>
      <div className="highlights__more">
        <Button variant="secondary" to="/features">Все возможности подробно</Button>
      </div>
    </Section>
  );
}
