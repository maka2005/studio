import { Link } from 'react-router-dom';
import { PricingCards } from '../pricing/PricingCards';
import { Section, SectionHeader } from '../ui/Section';
import './PricingPreview.scss';

export function PricingPreview() {
  return (
    <Section id="pricing" tone="muted">
      <SectionHeader
        eyebrow="Тарифы"
        title="Понятная стоимость без скрытых платежей"
        description="Два тарифа в месяц. Выберите подходящий и подключите Servio."
        align="center"
      />
      <PricingCards showFeatures={false} />
      <p className="pricing-preview__more">
        <Link to="/pricing">Сравнить тарифы подробно →</Link>
      </p>
    </Section>
  );
}
