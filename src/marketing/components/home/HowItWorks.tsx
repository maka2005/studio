import { steps } from '../../data/content';
import { Section } from '../ui/Section';
import './HowItWorks.scss';

export function HowItWorks() {
  return (
    <Section id="how" tone="muted">
      <div className="how">
        <div className="how__intro">
          <p className="how__eyebrow">Как это работает</p>
          <h2 className="how__title">От заявки до первой онлайн-записи</h2>
          <p className="how__text">
            Подключение не требует сложной подготовки: мы проходим путь вместе с вами.
          </p>
        </div>

        <ol className="how__steps">
          {steps.map((step, index) => (
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
