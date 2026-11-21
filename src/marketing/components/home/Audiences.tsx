import { Link } from 'react-router-dom';
import { useMarketingCopy } from '../../data/copy';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Audiences() {
  const copy = useMarketingCopy();
  return (
    <Section id="audience">
      <div className="home-split">
        <SectionHeader {...copy.sections.audience} />
        <div className="audience">
          {copy.audiences.map((a) => (
            <article key={a.id} id={a.id} className="audience__card">
              <span className="audience__icon" aria-hidden="true">{a.icon}</span>
              <h3>{a.title}</h3>
              <p>{a.text}</p>
              <ul>
                {a.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
              <Link to="/contact?type=demo" className="audience__link">{copy.ui.demoLink}</Link>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
