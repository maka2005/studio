import { useMarketingCopy } from '../../data/copy';
import { useTrialDays } from '../../hooks/usePlans';
import { Section, SectionHeader } from '../ui/Section';
import './FaqSection.scss';

export function FaqSection() {
  const trialDays = useTrialDays();
  const copy = useMarketingCopy();
  return (
    <Section>
      <SectionHeader {...copy.sections.faq} align="center" />
      <div className="faq">
        {copy.faqItems(trialDays).map((item) => (
          <details key={item.question} className="faq__item">
            <summary className="faq__question">{item.question}</summary>
            <p className="faq__answer">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
