import { useMarketingCopy } from '../../data/copy';
import { Button } from '../ui/Button';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Highlights() {
  const copy = useMarketingCopy();
  return (
    <Section id="features" tone="muted">
      <div className="home-split">
        <SectionHeader {...copy.sections.highlights} />
        <div>
          <div className="highlights">
            {copy.highlights.map((h) => (
              <article key={h.title} className="highlights__item">
                <span className="highlights__icon" aria-hidden="true">{h.icon}</span>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </article>
            ))}
          </div>
          <div className="highlights__more">
            <Button variant="secondary" to="/features">{copy.sections.highlights.more}</Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
