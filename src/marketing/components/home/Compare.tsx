import { compareRows } from '../../data/content';
import { useReveal } from '../../hooks/useReveal';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Compare() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <Section id="compare">
      <SectionHeader
        eyebrow="Было и стало"
        title="Чем Servio лучше тетради, таблиц и мессенджеров"
        description="Если записи ведутся «как получится», вы теряете клиентов и время каждый день."
        align="center"
      />
      <div ref={ref} className="compare" role="table" aria-label="Сравнение работы без Servio и с Servio">
        <div className="compare__head" role="row">
          <span role="columnheader">Задача</span>
          <span role="columnheader">Без системы</span>
          <span role="columnheader" className="is-after">С Servio</span>
        </div>
        {compareRows.map((r) => (
          <div key={r.topic} className="compare__row" role="row">
            <b role="rowheader">{r.topic}</b>
            <span role="cell" className="compare__before" data-label="Без системы">{r.before}</span>
            <span role="cell" className="compare__after" data-label="С Servio">{r.after}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
