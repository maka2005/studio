import { supabase } from './supabase';
export type Svc = { id: string; name: string; price_cents: number; duration_minutes: number };
export type Slot = { slot: string; free: boolean };
export type MyBooking = { id: string; tenant_slug: string; service_name: string; starts_at: string; ends_at: string;
  price_cents: number; status: string; customer_name: string; car: string; can_cancel: boolean };
export async function fetchServices(slug: string): Promise<Svc[]> {
  const { data, error } = await supabase.from('services').select('id,name,price_cents,duration_minutes,tenants!inner(slug)')
    .eq('tenants.slug', slug).eq('active', true).order('price_cents');
  if (error) throw error;
  return (data ?? []) as unknown as Svc[];
}
export async function fetchSlots(slug: string, service: string, day: string): Promise<Slot[]> {
  const { data, error } = await supabase.rpc('get_slots', { p_slug: slug, p_service: service, p_day: day });
  if (error) throw error;
  return (data ?? []) as Slot[];
}
export async function createBooking(a: { slug: string; service: string; start: string; name: string; phone: string; car: string; key: string; token: string; consent: string }) {
  const { data, error } = await supabase.functions.invoke('booking-create', { body: a });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = await context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data?.booking as { booking_id: string; starts_at: string; ends_at: string };
}
export async function getBooking(token: string): Promise<MyBooking | null> {
  const { data, error } = await supabase.rpc('get_booking', { p_token: token });
  if (error) throw error;
  return ((data ?? []) as MyBooking[])[0] ?? null;
}
export async function cancelBooking(token: string) {
  const { error } = await supabase.rpc('cancel_booking', { p_token: token });
  if (error) throw error;
}

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data as T; };
export type OwnerBooking = { id: string; service_id: string; service_name: string; starts_at: string; ends_at: string; status: string; customer_name: string;
  customer_phone: string; car: string; price_cents: number; paid_cents: number; resource_name: string };
export type OwnerStats = { visits: number; done: number; booked: number; received_cents: number; expected_cents: number };
export type OwnerNotificationStatus = { pending: number; failed: number; last_sent_at: string | null };
export const owner = {
  me: (slug: string) => rpc<boolean>('owner_me', { p_slug: slug }),
  bookings: (slug: string, from: string, to: string) => rpc<OwnerBooking[]>('owner_bookings', { p_slug: slug, p_from: from, p_to: to }),
  stats: async (slug: string, from: string, to: string) => (await rpc<OwnerStats[]>('owner_stats', { p_slug: slug, p_from: from, p_to: to }))[0]!,
  setStatus: (id: string, status: 'arrived' | 'done') => rpc<void>('owner_set_status', { p_booking: id, p_status: status }),
  cancel: (id: string) => rpc<void>('owner_cancel', { p_booking: id }),
  erase: (id: string) => rpc<void>('owner_erase_customer', { p_booking: id }),
  reschedule: (id: string, start: string) => rpc<boolean>('owner_reschedule', { p_booking: id, p_start: start }),
  create: (slug: string, a: { service: string; start: string; name: string; phone: string; car: string }) =>
    rpc<string>('owner_create_booking', { p_slug: slug, p_service: a.service, p_start: a.start, p_name: a.name, p_phone: a.phone, p_car: a.car }),
  block: (slug: string, resource: string, start: string, end: string) => rpc<string>('owner_block', { p_slug: slug, p_resource: resource, p_start: start, p_end: end }),
  payment: (id: string, cents: number, kind: 'payment' | 'refund') => rpc<void>('owner_add_payment', { p_booking: id, p_amount: cents, p_kind: kind }),
  upsertService: (slug: string, s: { id: string | null; name: string; cents: number; minutes: number; active: boolean }) =>
    rpc<string>('owner_upsert_service', { p_slug: slug, p_id: s.id, p_name: s.name, p_price_cents: s.cents, p_duration: s.minutes, p_active: s.active }),
  updateConfig: (slug: string, patch: Record<string, unknown>) => rpc<void>('owner_update_config', { p_slug: slug, p_patch: patch }),
  updateLegal: (slug: string, legal: Record<string, unknown>) => rpc<void>('owner_update_legal', { p_slug: slug, p_legal: legal }),
  telegramCode: (slug: string) => rpc<string>('owner_telegram_code', { p_slug: slug }),
  telegramLinks: (slug: string) => rpc<{ id: string; created_at: string }[]>('owner_telegram_links', { p_slug: slug }),
  notificationStatus: async (slug: string) => (await rpc<OwnerNotificationStatus[]>('owner_notification_status', { p_slug: slug }))[0]!,
  telegramUnlink: (id: string) => rpc<void>('owner_telegram_unlink', { p_id: id }),
  resources: async (slug: string) => {
    const { data, error } = await supabase.from('resources').select('id,name,tenants!inner(slug)').eq('tenants.slug', slug); if (error) throw error;
    return (data ?? []) as unknown as { id: string; name: string }[];
  },
};
const MSG: [string, string][] = [['slot_taken', 'Это время занято.'], ['exclusion', 'Это время занято.'], ['invalid_slot', 'На это время приём не ведётся.'],
  ['past_start', 'Это время уже прошло.'], ['refund_exceeds', 'Возврат больше полученной суммы.'], ['bad_transition', 'Это действие недоступно для текущего статуса.'],
  ['forbidden', 'Нет прав для этого действия.'], ['rate_limited', 'Слишком много запросов. Попробуйте позже.'], ['bad_amount', 'Проверьте сумму.'],
  ['bad_name', 'Проверьте имя клиента.'], ['bad_phone', 'Проверьте номер телефона.'], ['bad_car', 'Укажите автомобиль.'],
  ['bad_config', 'Проверьте введённые настройки.'], ['bad_url', 'Ссылка должна начинаться с https://'],
  ['consent_required', 'Нужно согласие на обработку данных.']];
export const errText = (e: unknown) => { const m = String((e as Error)?.message ?? e); return MSG.find(([k]) => m.includes(k))?.[1] ?? 'Не удалось выполнить действие. Повторите.'; };
