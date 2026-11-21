import { describe, expect, it } from 'vitest';
import { PHONE_PLACEHOLDER, isFullPhone, maskPhone, phoneDigitsCount } from '../phone';

describe('phone helpers', () => {
  it('formats national digits into +7 mask', () => {
    expect(maskPhone('7771234567')).toBe('+7 (777) 123-45-67');
    expect(maskPhone('87771234567')).toBe('+7 (777) 123-45-67');
  });

  it('returns empty mask for empty input', () => {
    expect(maskPhone('')).toBe('');
  });

  it('removes last digit on backspace when separators change', () => {
    const prev = '+7 (777) 123-45-67';
    expect(maskPhone('+7 (777) 123-45-6', prev)).toBe('+7 (777) 123-45-6');
  });

  it('validates full phone numbers', () => {
    expect(isFullPhone(PHONE_PLACEHOLDER)).toBe(true);
    // Международный формат: допускаем от 10 до 15 цифр.
    expect(isFullPhone('+7 (777) 123-45-6')).toBe(true);
    expect(phoneDigitsCount('+7 (777) 123-45-67')).toBe(11);
  });
});
