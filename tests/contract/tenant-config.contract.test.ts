import { describe, expect, it } from 'vitest';
import { Business } from '../../src/lib/tenant';

const base = {
  slug: 'demo-studio',
  name: 'Demo Studio',
  short_name: 'Demo',
  accent: '#112233',
  timezone: 'Asia/Almaty',
  currency: 'KZT',
  phone: '+7 (700) 000-00-00',
  address: 'Алматы, ул. Пример 1',
  description: 'Тестовая студия',
};

describe('Business config contract', () => {
  it('accepts minimal valid tenant config and applies defaults', () => {
    const parsed = Business.parse(base);
    expect(parsed.hours).toEqual({});
    expect(parsed.breaks).toEqual({});
    expect(parsed.services).toEqual([]);
    expect(parsed.cards.booking.title).toBeTruthy();
  });

  it('accepts schedule management fields added for exceptions/buffers/policies', () => {
    const parsed = Business.parse({
      ...base,
      buffer_minutes: 15,
      slot_minutes: 30,
      cancel_hours: 24,
      reschedule_hours: 12,
      client_reschedule_enabled: true,
      breaks: { mon: [['13:00', '14:00']] },
      hours: { mon: ['09:00', '18:00'], sun: null },
    });
    expect(parsed.buffer_minutes).toBe(15);
    expect(parsed.slot_minutes).toBe(30);
    expect(parsed.breaks.mon).toEqual([['13:00', '14:00']]);
  });

  it('rejects invalid accent color', () => {
    expect(() => Business.parse({ ...base, accent: 'red' })).toThrow();
  });
});
