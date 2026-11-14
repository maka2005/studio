import { faq } from '../../data/content';
import { Section, SectionHeader } from '../ui/Section';
import './FaqSection.scss';

export function FaqSection() {
  return (
    <Section>
      <SectionHeader eyebrow="FAQ" title="Частые вопросы" align="center" />
      <div className="faq">
        {faq.map((item) => (
          <details key={item.question} className="faq__item">
            <summary className="faq__question">{item.question}</summary>
            <p className="faq__answer">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
