import { useMarketingCopy } from '../../data/copy';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Compare() {
  const copy = useMarketingCopy();
  const section = copy.sections.compare;
  return (
    <Section id="compare">
      <div className="home-split">
        <SectionHeader {...section} />
        <div className="compare" role="table" aria-label={section.tableLabel}>
          <div className="compare__head" role="row">
            <span role="columnheader">{section.topic}</span>
            <span role="columnheader">{section.before}</span>
            <span role="columnheader" className="is-after">{section.after}</span>
          </div>
          {copy.compareRows.map((r) => (
            <div key={r.topic} className="compare__row" role="row">
              <b role="rowheader">{r.topic}</b>
              <span role="cell" className="compare__before" data-label={section.before}>{r.before}</span>
              <span role="cell" className="compare__after" data-label={section.after}>{r.after}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
