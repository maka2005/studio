import { Link } from 'react-router-dom';
import { useMarketingCopy } from '../../data/copy';
import { PricingCards } from '../pricing/PricingCards';
import { Section, SectionHeader } from '../ui/Section';
import './PricingPreview.scss';

export function PricingPreview() {
  const copy = useMarketingCopy();
  const section = copy.sections.pricing;
  return (
    <Section id="pricing" tone="muted">
      <SectionHeader
        eyebrow={section.eyebrow}
        title={section.title}
        description={section.description}
        align="center"
      />
      <PricingCards showFeatures={false} />
      <p className="pricing-preview__more">
        <Link to="/pricing">{section.more}</Link>
      </p>
    </Section>
  );
}
