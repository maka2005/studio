import { useMemo } from 'react';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { usePlans, useTrialDays } from '../hooks/usePlans';
import { homeBreadcrumbs, seo } from '../data/content';
import { breadcrumbLd, faqLd, organizationLd, softwareLd, websiteLd } from '../seo/schema';
import { Hero } from '../components/home/Hero';
import { TrustStrip } from '../components/home/TrustStrip';
import { Audiences } from '../components/home/Audiences';
import { Highlights } from '../components/home/Highlights';
import { Compare } from '../components/home/Compare';
import { HowItWorks } from '../components/home/HowItWorks';
import { RoiCalculator } from '../components/home/RoiCalculator';
import { PricingPreview } from '../components/home/PricingPreview';
import { FaqSection } from '../components/home/FaqSection';
import { FinalCta } from '../components/home/FinalCta';

export function HomePage() {
  const plans = usePlans();
  const trialDays = useTrialDays();
  const jsonLd = useMemo(
    () => [
      organizationLd(),
      websiteLd(),
      softwareLd(plans.map((p) => ({ name: p.name, price: p.price }))),
      faqLd(trialDays),
      breadcrumbLd(homeBreadcrumbs),
    ],
    [plans, trialDays],
  );

  useDocumentMeta({ ...seo.home, jsonLd });

  return (
    <>
      <Hero />
      <TrustStrip />
      <Audiences />
      <Highlights />
      <Compare />
      <HowItWorks />
      <RoiCalculator />
      <PricingPreview />
      <FaqSection />
      <FinalCta />
    </>
  );
}
