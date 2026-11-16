import { steps } from '../../data/content';
import { Section, SectionHeader } from '../ui/Section';
import './HowItWorks.scss';

export function HowItWorks() {
  return (
    <Section id="how" tone="muted">
      <SectionHeader
        eyebrow="Как это работает"
        title="От заявки до первой онлайн-записи"
        description="Подключение не требует сложной подготовки: мы проходим путь вместе с вами."
      />
      <ol className="steps grid-4">
        {steps.map((step, index) => (
          <li key={step.title} className="step">
            <span className="step__number">{index + 1}</span>
            <h3 className="step__title">{step.title}</h3>
            <p className="step__text">{step.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
