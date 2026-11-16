import { benefits } from '../../data/content';
import { Card } from '../ui/Card';
import { Section, SectionHeader } from '../ui/Section';

export function Benefits() {
  return (
    <Section tone="muted">
      <SectionHeader
        eyebrow="Преимущества"
        title="Меньше рутины — больше времени на клиентов"
        description="Renvio собирает работу сервиса в одно место: от первой записи до итогового отчёта."
      />
      <div className="grid-4">
        {benefits.map((b) => (
          <Card key={b.title}>
            <h3>{b.title}</h3>
            <p>{b.text}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
