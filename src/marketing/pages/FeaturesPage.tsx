import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { features, seo } from '../data/content';
import { FeatureDetail } from '../components/features/FeatureDetail';
import { FinalCta } from '../components/home/FinalCta';
import { Section } from '../components/ui/Section';

export function FeaturesPage() {
  useDocumentMeta(seo.features);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>Возможности Servio</h1>
          <p>Десять модулей для управления записями, расписанием, сотрудниками и аналитикой в одной системе.</p>
        </div>
      </header>

      <Section>
        {features.map((feature, index) => (
          <FeatureDetail key={feature.id} feature={feature} index={index} />
        ))}
      </Section>

      <FinalCta />
    </>
  );
}
