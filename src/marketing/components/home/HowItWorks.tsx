import { useMarketingCopy } from '../../data/copy';
import { Section } from '../ui/Section';
import './HowItWorks.scss';

export function HowItWorks() {
  const copy = useMarketingCopy();
  const section = copy.sections.how;
  return (
    <Section id="how" tone="muted">
      <div className="how">
        <div className="how__intro">
          <p className="how__eyebrow">{section.eyebrow}</p>
          <h2 className="how__title">{section.title}</h2>
          <p className="how__text">{section.description}</p>
        </div>

        <ol className="how__steps">
          {copy.steps.map((step, index) => (
            <li key={step.title} className="how__step">
              <span className="how__number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="how__step-title">{step.title}</h3>
                <p className="how__step-text">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
