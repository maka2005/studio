import { useMarketingCopy } from '../../data/copy';
import { Button } from '../ui/Button';
import { Section, SectionHeader } from '../ui/Section';
import './CasesSection.scss';

export function CasesSection() {
  const { eyebrow, title, description, badge, items, note, cta } = useMarketingCopy().ui.cases;

  return (
    <Section id="cases" tone="muted">
      <SectionHeader eyebrow={eyebrow} title={title} description={description} align="center" />
      <div className="cases__grid">
        {items.map((item) => (
          <article className="case-card" key={item.tag}>
            <span className="case-card__badge">{badge}</span>
            <p className="case-card__tag">{item.tag}</p>
            <h3 className="case-card__title">{item.title}</h3>
            <p className="case-card__text">{item.text}</p>
          </article>
        ))}
      </div>
      <p className="cases__note">{note}</p>
      <div className="cases__cta">
        <Button to="/contact?type=connect">{cta}</Button>
      </div>
    </Section>
  );
}
