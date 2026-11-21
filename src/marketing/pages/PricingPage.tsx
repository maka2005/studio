import { useMarketingCopy } from '../data/copy';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { PricingCards } from '../components/pricing/PricingCards';
import { PricingComparison } from '../components/pricing/PricingComparison';
import { FinalCta } from '../components/home/FinalCta';
import { Section, SectionHeader } from '../components/ui/Section';

export function PricingPage() {
  const copy = useMarketingCopy();
  useDocumentMeta(copy.seo.pricing);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>{copy.sections.pricingIntro.title}</h1>
          <p>{copy.sections.pricingIntro.text}</p>
        </div>
      </header>

      <Section>
        <PricingCards />
      </Section>

      <Section tone="muted">
        <SectionHeader {...copy.sections.pricingCompare} align="center" />
        <PricingComparison />
      </Section>

      <FinalCta />
    </>
  );
}
