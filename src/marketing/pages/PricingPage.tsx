import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { seo } from '../data/content';
import { PricingCards } from '../components/pricing/PricingCards';
import { PricingComparison } from '../components/pricing/PricingComparison';
import { FinalCta } from '../components/home/FinalCta';
import { Section, SectionHeader } from '../components/ui/Section';

export function PricingPage() {
  useDocumentMeta(seo.pricing);

  return (
    <>
      <header className="page-intro">
        <div className="container">
          <h1>Тарифы Renvio</h1>
          <p>Прозрачная стоимость подписки. Все цены указаны в тенге за месяц.</p>
        </div>
      </header>

      <Section>
        <PricingCards />
      </Section>

      <Section tone="muted">
        <SectionHeader
          eyebrow="Сравнение"
          title="START и PRO — сравнение тарифов"
          description="Сравните стоимость и состав возможностей, чтобы выбрать подходящий тариф."
          align="center"
        />
        <PricingComparison />
      </Section>

      <FinalCta />
    </>
  );
}
