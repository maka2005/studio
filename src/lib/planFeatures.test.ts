import { describe, expect, it } from 'vitest';
import { planFeatureLabel } from './planFeatures';

describe('planFeatureLabel', () => {
  it('показывает возможности тарифа по-русски', () => {
    expect(planFeatureLabel('telegram')).toBe('Telegram');
    expect(planFeatureLabel('export')).toBe('Выгрузка данных');
    expect(planFeatureLabel('reviews')).toBe('Отзывы');
    expect(planFeatureLabel('unknown_feature')).toBe('unknown_feature');
  });
});
