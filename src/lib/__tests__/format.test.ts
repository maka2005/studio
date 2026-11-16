import { afterEach, describe, expect, it, vi } from 'vitest';
import { duration, money, plural, telHref } from '../format';

describe('format helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formats duration in minutes, hours and days', () => {
    expect(duration(30)).toBe('30 мин');
    expect(duration(60)).toBe('1 ч');
    expect(duration(90)).toBe('1 ч 30 мин');
    expect(duration(1440)).toBe('1 д');
    expect(duration(1500)).toBe('1 д 1 ч');
  });

  it('normalizes phone links', () => {
    expect(telHref('+7 (777) 123-45-67')).toBe('tel:+77771234567');
  });

  it('formats money in ru-RU locale style', () => {
    expect(money(12500, '₸')).toMatch(/12\s?500\s₸/);
  });

  it('selects plural forms', () => {
    expect(plural(1, ['запись', 'записи', 'записей'])).toBe('1 запись');
    expect(plural(2, ['запись', 'записи', 'записей'])).toBe('2 записи');
    expect(plural(5, ['запись', 'записи', 'записей'])).toBe('5 записей');
  });
});
