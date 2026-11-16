import type { Feature } from '../../data/content';
import { ScreenshotFrame } from '../ui/ScreenshotFrame';
import './FeatureDetail.scss';

interface FeatureDetailProps {
  feature: Feature;
  index: number;
}

export function FeatureDetail({ feature, index }: FeatureDetailProps) {
  const reversed = index % 2 === 1;

  return (
    <article className={`feature-detail ${reversed ? 'feature-detail--reversed' : ''}`}>
      <div className="feature-detail__text">
        <span className="feature-detail__number">{String(index + 1).padStart(2, '0')}</span>
        <h2 className="feature-detail__title">{feature.title}</h2>
        <p className="feature-detail__desc">{feature.description}</p>
      </div>
      <div className="feature-detail__visual">
        <ScreenshotFrame label={`Скриншот: ${feature.title.toLowerCase()}`} />
      </div>
    </article>
  );
}
