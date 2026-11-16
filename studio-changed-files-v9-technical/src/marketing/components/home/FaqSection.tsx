import { faqItems } from '../../data/content';
import { useTrialDays } from '../../hooks/usePlans';
import { Section, SectionHeader } from '../ui/Section';
import './FaqSection.scss';

export function FaqSection() {
  const trialDays = useTrialDays();
  return (
    <Section>
      <SectionHeader eyebrow="FAQ" title="Частые вопросы" align="center" />
      <div className="faq">
        {faqItems(trialDays).map((item) => (
          <details key={item.question} className="faq__item">
            <summary className="faq__question">{item.question}</summary>
            <p className="faq__answer">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
