import { trustStats } from '../../data/content';
import './HomeSections.scss';

export function TrustStrip() {
  return (
    <section className="trust" aria-label="Коротко о Servio">
      <ul className="container trust__list">
        {trustStats.map((s) => (
          <li key={s.label} className="trust__item">
            <b>{s.value}</b>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
