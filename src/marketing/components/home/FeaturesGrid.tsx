import { features } from '../../data/content';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Section, SectionHeader } from '../ui/Section';
import './FeaturesGrid.scss';

export function FeaturesGrid() {
  return (
    <Section id="features">
      <SectionHeader
        eyebrow="Возможности"
        title="Всё для управления сервисом в одной системе"
        description="От онлайн-записи до аналитики — каждый модуль решает конкретную задачу владельца бизнеса."
      />
      <div className="grid-3">
        {features.map((f) => (
          <Card key={f.id}>
            <h3>{f.title}</h3>
            <p>{f.description}</p>
          </Card>
        ))}
      </div>
      <div className="features-grid__more">
        <Button variant="secondary" to="/features">Подробнее о возможностях</Button>
      </div>
    </Section>
  );
}
