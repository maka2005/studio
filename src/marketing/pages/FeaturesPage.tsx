import { useMarketingCopy } from '../data/copy';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { FeatureDetail } from '../components/features/FeatureDetail';
import { FinalCta } from '../components/home/FinalCta';
import { Section } from '../components/ui/Section';

export function FeaturesPage() {
  const copy = useMarketingCopy();
  useDocumentMeta(copy.seo.features);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>{copy.sections.featuresIntro.title}</h1>
          <p>{copy.sections.featuresIntro.text}</p>
        </div>
      </header>

      <Section>
        {copy.features.map((feature, index) => (
          <FeatureDetail key={feature.id} feature={feature} index={index} />
        ))}
      </Section>

      <FinalCta />
    </>
  );
}
