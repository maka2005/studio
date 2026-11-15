import { Link } from 'react-router-dom';
import { audiences } from '../../data/content';
import { useReveal } from '../../hooks/useReveal';
import { Section, SectionHeader } from '../ui/Section';
import './HomeSections.scss';

export function Audiences() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <Section id="audience">
      <SectionHeader
        eyebrow="Для кого"
        title="Servio подходит любому сервису с записью по времени"
        description="Выберите свой тип бизнеса — покажем, как система закрывает его ежедневные задачи."
        align="center"
      />
      <div ref={ref} className="audience">
        {audiences.map((a) => (
          <article key={a.id} id={a.id} className="audience__card">
            <span className="audience__icon" aria-hidden="true">{a.icon}</span>
            <h3>{a.title}</h3>
            <p>{a.text}</p>
            <ul>
              {a.points.map((pt) => (
                <li key={pt}>{pt}</li>
              ))}
            </ul>
            <Link to={`/contact?type=demo`} className="audience__link">Посмотреть демо →</Link>
          </article>
        ))}
      </div>
    </Section>
  );
}
