import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { seo } from '../data/content';
import { Hero } from '../components/home/Hero';
import { Benefits } from '../components/home/Benefits';
import { FeaturesGrid } from '../components/home/FeaturesGrid';
import { HowItWorks } from '../components/home/HowItWorks';
import { PricingPreview } from '../components/home/PricingPreview';
import { FaqSection } from '../components/home/FaqSection';
import { FinalCta } from '../components/home/FinalCta';

export function HomePage() {
  useDocumentMeta(seo.home);

  return (
    <>
      <Hero />
      <Benefits />
      <FeaturesGrid />
      <HowItWorks />
      <PricingPreview />
      <FaqSection />
      <FinalCta />
    </>
  );
}
