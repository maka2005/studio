import { z } from 'zod';
import { supabase } from './supabase';
const Card = z.object({ title: z.string(), text: z.string() });
export const Business = z.object({
  slug: z.string(), name: z.string(), short_name: z.string(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  timezone: z.string(), currency: z.string(), route_url: z.string().optional(), client_profile: z.boolean().optional(), cancel_hours: z.number().optional(),
  legal: z.object({ name: z.string(), bin: z.string(), address: z.string(), email: z.string(), storage: z.string(), processors: z.string(), retention: z.string() }).partial().optional(), phone: z.string(), address: z.string(), description: z.string(),
  demo: z.boolean().optional(),
  images: z.object({ logo: z.string(), hero: z.string() }),
  gallery: z.array(z.object({ image: z.string(), caption: z.string() })),
  cards: z.object({ booking: Card, ai: Card, install: Card }),
  resources: z.array(z.string()),
  hours: z.record(z.string(), z.tuple([z.string(), z.string()]).nullable()),
  services: z.array(z.object({ name: z.string(), price: z.number(), duration_minutes: z.number(), price_from: z.boolean().optional() })),
});
export type Business = z.infer<typeof Business>;
// Runtime-источник — БД (владелец правит настройки в кабинете). Статический JSON — запасной вариант, если БД недоступна.
export async function loadBusiness(slug: string): Promise<Business> {
  try {
    const { data, error } = await supabase.from('tenants').select('config').eq('slug', slug).maybeSingle();
    if (!error && data) return Business.parse(data.config);
  } catch { /* падаем на статический конфиг */ }
  const r = await fetch(`/tenants/${slug}.json`);
  if (!r.ok) throw new Error('Студия не найдена');
  return Business.parse(await r.json());
}
export type Ctx = { b: Business; openBooking: (service?: string) => void; openAI: () => void };
export const assetUrl = (slug: string, p: string) => (/^https?:/.test(p) ? p : `/tenants/${slug}/${p}`);
