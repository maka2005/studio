import { compareRows } from '../../data/content';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Compare() {
  return (
    <Section id="compare">
      <div className="home-split">
        <SectionHeader
          eyebrow="Было и стало"
          title="Чем Renvio лучше тетради, таблиц и мессенджеров"
          description="Если записи ведутся «как получится», вы теряете клиентов и время каждый день."
        />
        <div className="compare" role="table" aria-label="Сравнение работы без Renvio и с Renvio">
          <div className="compare__head" role="row">
            <span role="columnheader">Задача</span>
            <span role="columnheader">Без системы</span>
            <span role="columnheader" className="is-after">С Renvio</span>
          </div>
          {compareRows.map((r) => (
            <div key={r.topic} className="compare__row" role="row">
              <b role="rowheader">{r.topic}</b>
              <span role="cell" className="compare__before" data-label="Без системы">{r.before}</span>
              <span role="cell" className="compare__after" data-label="С Renvio">{r.after}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
