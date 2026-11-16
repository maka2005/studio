import { useQuery } from '@tanstack/react-query';
import { fetchServices } from './api';
import type { Business } from './tenant';
export type ShownService = { name: string; category: string; price: number; duration_minutes: number; price_from: boolean };
// Цены и длительность — из БД (их правит владелец); config.services — запасной вариант и пометки «от».
export function useServices(b: Business): ShownService[] {
  const q = useQuery({ queryKey: ['services', b.slug], queryFn: () => fetchServices(b.slug) });
  const flags = new Map(b.services.map((s) => [s.name, !!s.price_from]));
  if (q.data && q.data.length) return q.data.map((s) => ({ name: s.name, category: s.category, price: s.price_cents / 100, duration_minutes: s.duration_minutes, price_from: flags.get(s.name) ?? false }));
  return b.services.map((s) => ({ name: s.name, category: s.category ?? 'Другое', price: s.price, duration_minutes: s.duration_minutes, price_from: !!s.price_from }));
}
