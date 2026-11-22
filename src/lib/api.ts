import { supabase } from './supabase';
import { ownerRequest } from './ownerSession';
export type Svc = { id: string; name: string; category: string; price_cents: number; duration_minutes: number; active: boolean };
export type Slot = { slot: string; free: boolean };
export type MyBooking = { id: string; tenant_slug: string; service_name: string; service_id: string; starts_at: string; ends_at: string;
  price_cents: number; status: string; customer_name: string; car: string; can_cancel: boolean; reviewed: boolean;
  can_reschedule: boolean; cancel_hours: number; reschedule_hours: number; token: string };
export type CreatedBooking = { booking_id: string; starts_at: string; ends_at: string; price_cents: number; discount_cents: number; promo_code: string | null };
export async function fetchServices(slug: string, includeInactive = false): Promise<Svc[]> {
  if (includeInactive) return ownerRequest<Svc[]>('services', { slug, includeInactive: true });
  let query = supabase.from('services').select('id,name,category,price_cents,duration_minutes,active,tenants!inner(slug)').eq('tenants.slug', slug);
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query.order('price_cents');
  if (error) throw error;
  return (data ?? []) as unknown as Svc[];
}
export async function fetchSlots(slug: string, service: string, day: string): Promise<Slot[]> {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'slots', slug, service, day } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return (data?.slots ?? []) as Slot[];
}
// Открыта ли онлайн-запись (подписка организации). null = статус неизвестен: UI не блокируем,
// окончательное решение всё равно принимает сервер (booking-create / get_slots).
export async function fetchBookingOpen(slug: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'booking_status', slug } });
    if (error || data?.error) return null;
    return data?.open === false ? false : true;
  } catch {
    return null;
  }
}
/** Вызов публичного API с единой распаковкой ошибок (503 и `{ error }` приходят одинаково). */
async function publicApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('public-api', { body });
  if (error) {
    const response = (error as { context?: Response }).context;
    const parsed = await response?.clone().json().catch(() => null);
    const code = parsed?.error ?? (error as Error).message;
    throw new Error(String(code || 'request_failed'));
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}
export type RescheduleResult = { ok?: boolean; starts_at: string; ends_at: string };
export type WaitlistOffer = { slot: string; expires_at: string; offer_token: string };
export type WaitlistItem = { id: string; service_name: string; service_id: string | null; preferred_day: string;
  status: string; created_at: string; offer: WaitlistOffer | null };
export type WaitlistRead = { item: WaitlistItem | null };
export type WaitlistClaim = { booking: { token: string; booking_id: string; starts_at: string; ends_at: string; service_id: string } };
export type PushKind = 'booking' | 'waitlist';
export async function rescheduleBooking(token: string, start: string): Promise<RescheduleResult> {
  return publicApi<RescheduleResult>({ action: 'booking_reschedule', token, start });
}
export async function readWaitlist(token: string): Promise<WaitlistRead> {
  return publicApi<WaitlistRead>({ action: 'waitlist_read', token });
}
export async function cancelWaitlist(token: string): Promise<void> {
  await publicApi<{ ok?: boolean }>({ action: 'waitlist_cancel', token });
}
export async function claimWaitlistOffer(offerToken: string): Promise<WaitlistClaim> {
  return publicApi<WaitlistClaim>({ action: 'waitlist_claim', offerToken });
}
export async function subscribePush(token: string, kind: PushKind, subscription: PushSubscriptionJSON): Promise<void> {
  await publicApi<{ ok?: boolean }>({ action: 'push_subscribe', token, kind, subscription });
}
export async function createBooking(a: { slug: string; service?: string; services?: string[]; start: string; name: string; phone: string; car: string; key: string; token: string; consent: string; promo?: string; source?: string }): Promise<CreatedBooking[]> {
  const { data, error } = await supabase.functions.invoke('booking-create', { body: a });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = await context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  const rows = data?.bookings ?? (data?.booking ? [data.booking] : []);
  return rows as CreatedBooking[];
}
export async function getBookings(tokens: string[]): Promise<MyBooking[]> {
  if (!tokens.length) return [];
  const data = await publicApi<{ bookings?: MyBooking[] }>({ action: 'bookings_read', tokens });
  return data.bookings ?? [];
}
export async function getBooking(token: string): Promise<Omit<MyBooking, 'token'> | null> {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'booking_read', token } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return (data?.booking ?? null) as MyBooking | null;
}
export async function cancelBooking(token: string) {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'booking_cancel', token } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
}
export async function joinWaitlist(a: { slug: string; service: string; day: string; name: string; phone: string; car: string; consent: string }): Promise<string> {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'waitlist', ...a } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return typeof data?.token === 'string' ? data.token : '';
}
export async function submitReview(token: string, rating: number, comment: string) {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'review', token, rating, comment } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
}
export async function createCustomerTelegramLink(token: string, repeatConsent = false): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'customer_telegram_link', token, repeatConsent } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return typeof data?.code === 'string' ? data.code : null;
}
export async function getCustomerTelegramStatus(token: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('public-api', { body: { action: 'customer_telegram_status', token } });
  if (error) {
    const body = await (error as { context?: Response }).context?.clone().json().catch(() => null);
    if (body?.error) throw new Error(String(body.error));
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data?.connected === true;
}

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  if (fn !== 'published_reviews') return ownerRequest<T>('rpc', { fn, args });
  let result = await supabase.rpc(fn, args);
  const invalidJwt=(error:unknown)=>{const e=error as {code?:string;status?:number;message?:string}|null;return e?.status===401||e?.code==='PGRST301'||/jwt|unauthorized/i.test(e?.message??'')};
  if (invalidJwt(result.error)) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.data.session) {
      result = await supabase.rpc(fn, args);
      if(invalidJwt(result.error)){await supabase.auth.signOut();throw new Error('session_expired')}
    }
    else { await supabase.auth.signOut(); throw new Error('session_expired'); }
  }
  if (result.error) throw result.error;
  return result.data as T;
};
const invokeOwnerTeam = async (body:Record<string,unknown>) => {
  try { return { data: await ownerRequest('team', body), error: null }; }
  catch (error) { return { data: null, error: { context: new Response(JSON.stringify({error: error instanceof Error ? error.message : 'request_failed'}), {status: Number((error as {status?:number})?.status)||500}) } }; }
};
export type OwnerBooking = { id: string; service_id: string; service_name: string; starts_at: string; ends_at: string; status: string; customer_name: string;
  customer_phone: string; car: string; price_cents: number; paid_cents: number; resource_name: string };
export type OwnerStats = { visits: number; done: number; booked: number; received_cents: number; expected_cents: number };
export type OwnerRepeatStats = { completed_visits: number; unique_clients: number; returning_clients: number; returning_visits: number; average_check_cents: number };
export type OwnerNotificationSettings = { reminder_hours_before: number; repeat_after_days: number; reminder_message: string | null; repeat_message: string | null };
export type OwnerAuditEvent = { id: number; created_at: string; entity: string; entity_id: string | null; action: string; details: Record<string, unknown>; actor_email: string | null };
export type OwnerBillingNotification = { id: string; event_type: string; payload: Record<string, unknown>; created_at: string; is_read: boolean };
/** Keyset page returned by the new *_page RPCs. Pass next_cursor back unchanged. */
export type CursorPage<T> = { items: T[]; has_more: boolean; next_cursor: Record<string, string> | null };
/** Walks keyed pages until the server says there are no more. Used where the UI still needs the full list (reports, calendar). */
async function collectCursorPages<T>(load: (cursor: Record<string, string> | null) => Promise<CursorPage<T>>, maxPages = 200): Promise<T[]> {
  const all: T[] = []; let cursor: Record<string, string> | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await load(cursor); all.push(...page.items);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return all;
}
export type DailyMetric = { day: string; visits: number; done: number; booked: number; received_cents: number; expected_cents: number; updated_at: string };
export type OwnerPlanUsage = { plan_code:string; limits:Record<string,number|null>; features:Record<string,boolean>; override:{limits:Record<string,number|null>;features:Record<string,boolean>;reason:string|null;updated_at:string|null}; usage:Record<string,number|string|null> };
export type OwnerNotificationStatus = { pending: number; failed: number; last_sent_at: string | null };
export type NotificationTemplate = { id: string | null; kind: string; audience: 'client' | 'owner'; channel: string; subject: string | null; body: string | null; is_active: boolean; source: 'default' | 'template'; updated_at: string | null };
export type NotificationJob = { id: string; kind: string; channel: string; status: 'pending' | 'sent' | 'failed'; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; bounced_at: string | null; bounce_type: string | null; template_code: string | null; booking_id: string | null };
export type NotificationBounce = { id: string; channel: string; recipient: string; bounce_type: 'soft' | 'hard' | 'complaint'; provider: string; created_at: string };
export type NotificationJobPage = { rows: NotificationJob[]; count: number };
export type NotificationBouncePage = { rows: NotificationBounce[]; count: number };
export type OwnerSubscription = { state: 'open' | 'grace' | 'closed'; phase: string; plan_code?: string; plan_name?: string; price_kzt?: number; price_period_months?: number; starts_at?: string | null; ends_at?: string | null; grace_ends_at?: string | null; days_left?: number | null };
export type OwnerBillingDocument = { id: string; document_type: 'invoice' | 'act'; number: string; issue_date: string; service_from: string; service_to: string; amount_kzt: number; currency: string; description: string; esf_number: string | null; esf_status: string; status: string; created_at: string };
export type OwnerPayment = { id: string; amount_kzt: number; method: string; status: string; received_at: string; period_start: string; period_end: string; note: string | null; refund_reason: string | null; created_at: string; plan_code: string | null; period_months: number | null };
export type AvailablePlan = { code: string; name: string; price_kzt: number; period_months: number; description: string | null };
export type ManualPaymentRequest = { id: string; status: string; amount_kzt: number; period_start: string; period_end: string; replayed?: boolean };
export const owner = {
  platformAnnouncements:(slug:string)=>rpc<{id:string;title:string;body:string;starts_at:string;ends_at:string|null}[]>('owner_platform_announcements',{p_slug:slug}),
  platformFeatureFlags:(slug:string)=>rpc<Record<string,boolean>>('owner_platform_feature_flags',{p_slug:slug}),
  me: (slug: string) => rpc<boolean>('owner_me', { p_slug: slug }),
  subscription: (slug: string) => rpc<OwnerSubscription>('owner_subscription', { p_slug: slug }),
  planUsage: (slug:string) => rpc<OwnerPlanUsage>('owner_plan_usage',{p_slug:slug}),
  archiveStatus: (slug:string) => rpc<{archived:boolean;archived_at:string|null;deletion_requested_at:string|null}>('owner_archive_status',{p_slug:slug}),
  pendingPriceChanges: (slug: string) => rpc<{ id:string; old_price_kzt:number; old_period_months:number; new_price_kzt:number; new_period_months:number; effective_at:string; created_at:string; is_read:boolean }[]>('owner_pending_price_change', { p_slug: slug }),
  markPriceChangesRead: (slug:string,ids:string[]) => rpc<void>('owner_mark_price_changes_read',{p_slug:slug,p_ids:ids}),
  billingNotifications: (slug:string,limit=50,offset=0) => rpc<OwnerBillingNotification[]>('owner_billing_notifications',{p_slug:slug,p_limit:limit,p_offset:offset}),
  markBillingNotificationsRead: (slug:string,ids:string[]) => rpc<void>('owner_mark_billing_notifications_read',{p_slug:slug,p_ids:ids}),
  respondPriceChange: (slug:string,id:string,accept:boolean) => rpc<void>('owner_respond_price_change', { p_slug:slug,p_id:id,p_accept:accept }),
  billingDocuments: (slug: string) => rpc<OwnerBillingDocument[]>('owner_billing_documents', { p_slug: slug }),
  payments: (slug: string) => rpc<OwnerPayment[]>('owner_payments', { p_slug: slug }),
  availablePlans: () => rpc<AvailablePlan[]>('owner_available_plans', {}),
  requestManualPayment: (slug: string, planCode: string, months: number, idempotencyKey: string, note?: string) =>
    rpc<ManualPaymentRequest>('owner_request_manual_payment', {
      p_slug: slug, p_plan_code: planCode, p_months: months,
      p_idempotency_key: idempotencyKey, p_note: note ?? null,
    }),
  access: (slug: string) => rpc<'owner'|'manager'|'staff'|null>('owner_access', { p_slug: slug }),
  bookings: (slug: string, from: string, to: string) => rpc<OwnerBooking[]>('owner_bookings', { p_slug: slug, p_from: from, p_to: to }),
  staffBookings: (slug: string, from: string, to: string) => rpc<OwnerBooking[]>('staff_bookings', { p_slug: slug, p_from: from, p_to: to }),
  stats: async (slug: string, from: string, to: string) => (await rpc<OwnerStats[]>('owner_stats', { p_slug: slug, p_from: from, p_to: to }))[0]!,
  repeatStats: async (slug: string, from: string, to: string) => (await rpc<OwnerRepeatStats[]>('owner_repeat_stats', { p_slug: slug, p_from: from, p_to: to }))[0]!,
  auditHistory: (slug: string, limit: number, offset: number) => rpc<OwnerAuditEvent[]>('owner_audit_history', { p_slug: slug, p_limit: limit, p_offset: offset }),
  // Keyset pagination (preferred for growing lists). Requires the performance migration.
  bookingsPage: (slug: string, from: string, to: string, limit = 50, cursor: Record<string, string> | null = null) =>
    rpc<CursorPage<OwnerBooking>>('owner_bookings_page', { p_slug: slug, p_from: from, p_to: to, p_limit: limit, p_cursor: cursor }),
  /** Same data as bookings(), but streamed through the indexed keyset RPC and sorted back to ascending order. */
  bookingsAll: (slug: string, from: string, to: string) =>
    collectCursorPages<OwnerBooking>((cursor) =>
      rpc<CursorPage<OwnerBooking>>('owner_bookings_page', { p_slug: slug, p_from: from, p_to: to, p_limit: 200, p_cursor: cursor })
    ).then((rows) => rows.sort((a, z) => Date.parse(a.starts_at) - Date.parse(z.starts_at) || a.id.localeCompare(z.id))),
  auditHistoryPage: (slug: string, limit = 50, cursor: Record<string, string> | null = null) =>
    rpc<CursorPage<OwnerAuditEvent>>('owner_audit_history_page', { p_slug: slug, p_limit: limit, p_cursor: cursor }),
  billingNotificationsPage: (slug: string, limit = 50, cursor: Record<string, string> | null = null) =>
    rpc<CursorPage<OwnerBillingNotification>>('owner_billing_notifications_page', { p_slug: slug, p_limit: limit, p_cursor: cursor }),
  reviewsPage: (slug: string, limit = 50, cursor: Record<string, string> | null = null) =>
    rpc<CursorPage<{ id: string; booking_id: string; rating: number; comment: string; published: boolean; created_at: string; customer_name: string; service_name: string }>>('owner_reviews_page', { p_slug: slug, p_limit: limit, p_cursor: cursor }),
  waitlistPage: (slug: string, limit = 50, cursor: Record<string, string> | null = null) =>
    rpc<CursorPage<{ id: string; service_name: string; preferred_day: string; customer_name: string; customer_phone: string; car: string; status: string; created_at: string }>>('owner_waitlist_page', { p_slug: slug, p_limit: limit, p_cursor: cursor }),
  dailyMetrics: (slug: string, from: string, to: string) =>
    rpc<DailyMetric[]>('owner_daily_metrics', { p_slug: slug, p_from: from, p_to: to }),
  setStatus: (id: string, status: 'arrived' | 'done') => rpc<void>('owner_set_status', { p_booking: id, p_status: status }),
  staffSetStatus: (id: string, status: 'arrived' | 'done') => rpc<void>('staff_set_status', { p_booking: id, p_status: status }),
  team: async (slug: string, action: 'list'|'create'|'set_role'|'remove', args: Record<string,unknown> = {}) => {
    const { data, error } = await invokeOwnerTeam({ slug, action, ...args });
    if (error) { const context=(error as {context?:Response}).context;const body=await context?.clone().json().catch(()=>null);throw new Error(context?.status===429?'rate_limited':body?.error??'team_request_failed'); }
    if (data?.error) throw new Error(String(data.error)); return data as {members:{user_id:string;email:string;role:'manager'|'staff';resource_id:string|null;resource_name:string|null}[];ok?:boolean;created?:boolean;temporary_password?:string|null};
  },
  teamAction: async (slug:string,action:'reset_password'|'enroll_recovery'|'recover',args:Record<string,unknown>={})=>{
    if(action==='recover') return ownerRequest<{ok:boolean;temporary_password?:string;recovery_key?:string|null}>('recover',{slug,action,...args});
    const {data,error}=await invokeOwnerTeam({slug,action,...args});
    if(error){const context=(error as {context?:Response}).context;const body=await context?.clone().json().catch(()=>null);throw new Error(context?.status===429?'rate_limited':body?.error??'recovery_failed')}
    if(data?.error)throw new Error(String(data.error));return data as {ok:boolean;temporary_password?:string;recovery_key?:string|null}
  },
  cancel: (id: string) => rpc<void>('owner_cancel', { p_booking: id }),
  erase: (id: string) => rpc<void>('owner_erase_customer', { p_booking: id }),
  reschedule: (id: string, start: string) => rpc<boolean>('owner_reschedule', { p_booking: id, p_start: start }),
  create: (slug: string, a: { service: string; start: string; name: string; phone: string; car: string }) =>
    rpc<string>('owner_create_booking', { p_slug: slug, p_service: a.service, p_start: a.start, p_name: a.name, p_phone: a.phone, p_car: a.car }),
  block: (slug: string, resource: string, start: string, end: string) => rpc<string>('owner_block', { p_slug: slug, p_resource: resource, p_start: start, p_end: end }),
  payment: (id: string, cents: number, kind: 'payment' | 'refund') => rpc<void>('owner_add_payment', { p_booking: id, p_amount: cents, p_kind: kind }),
  upsertService: (slug: string, s: { id: string | null; name: string; category: string; cents: number; minutes: number; active: boolean }) =>
    rpc<string>('owner_upsert_service', { p_slug: slug, p_id: s.id, p_name: s.name, p_category: s.category, p_price_cents: s.cents, p_duration: s.minutes, p_active: s.active }),
  deleteService: (slug: string, id: string) => rpc<void>('owner_delete_service', { p_slug: slug, p_id: id }),
  upsertResource: (slug: string, id: string | null, name: string) => rpc<string>('owner_upsert_resource', { p_slug: slug, p_id: id, p_name: name }),
  deleteResource: (slug: string, id: string) => rpc<void>('owner_delete_resource', { p_slug: slug, p_id: id }),
  notificationSettings: async (slug: string) => (await rpc<OwnerNotificationSettings[]>('owner_notification_settings', { p_slug: slug }))[0]!,
  updateNotificationSettings: (slug: string, s: OwnerNotificationSettings) => rpc<void>('owner_update_notification_settings', { p_slug: slug, p_reminder_hours: s.reminder_hours_before, p_repeat_days: s.repeat_after_days, p_reminder_message: s.reminder_message, p_repeat_message: s.repeat_message }),
  updateConfig: (slug: string, patch: Record<string, unknown>) => rpc<void>('owner_update_config', { p_slug: slug, p_patch: patch }),
  updateScheduleSettings: (slug: string, patch: Record<string, unknown>) => rpc<void>('owner_update_schedule_settings', { p_slug: slug, p_patch: patch }),
  scheduleExceptions: (slug: string) => rpc<{ id: string; date_from: string; date_to: string; is_closed: boolean; hours: [string, string] | null; note: string }[]>('owner_schedule_exceptions', { p_slug: slug }),
  upsertScheduleException: (slug: string, e: { id?: string | null; date_from: string; date_to: string; is_closed: boolean; hours: [string, string] | null; note?: string }) =>
    rpc<string>('owner_upsert_schedule_exception', { p_slug: slug, p_id: e.id ?? null, p_date_from: e.date_from, p_date_to: e.date_to, p_is_closed: e.is_closed, p_hours: e.hours, p_note: e.note ?? '' }),
  deleteScheduleException: (slug: string, id: string) => rpc<void>('owner_delete_schedule_exception', { p_slug: slug, p_id: id }),
  unblock: (id: string) => rpc<void>('owner_unblock', { p_id: id }),
  updateLegal: (slug: string, legal: Record<string, unknown>) => rpc<void>('owner_update_legal', { p_slug: slug, p_legal: legal }),
  telegramCode: (slug: string) => rpc<string>('owner_telegram_code', { p_slug: slug }),
  telegramLinks: (slug: string) => rpc<{ id: string; created_at: string }[]>('owner_telegram_links', { p_slug: slug }),
  notificationStatus: async (slug: string) => (await rpc<OwnerNotificationStatus[]>('owner_notification_status', { p_slug: slug }))[0]!,
  telegramUnlink: (id: string) => rpc<void>('owner_telegram_unlink', { p_id: id }),
  notificationTemplates: (slug: string) => rpc<NotificationTemplate[]>('owner_notification_templates', { p_slug: slug }),
  upsertNotificationTemplate: (slug: string, t: { kind: string; audience: 'client' | 'owner'; body: string; active: boolean }) =>
    rpc<string | null>('owner_upsert_notification_template', { p_slug: slug, p_kind: t.kind, p_audience: t.audience, p_body: t.body, p_active: t.active }),
  notificationJobs: (slug: string, status = 'all', kind = 'all', limit = 50, offset = 0) =>
    rpc<NotificationJobPage>('owner_notification_jobs', { p_slug: slug, p_status: status, p_kind: kind, p_limit: limit, p_offset: offset }),
  notificationRetry: (slug: string, jobId: string) => rpc<void>('owner_notification_retry', { p_slug: slug, p_job_id: jobId }),
  notificationBounces: (slug: string, limit = 50, offset = 0) =>
    rpc<NotificationBouncePage>('owner_notification_bounces', { p_slug: slug, p_limit: limit, p_offset: offset }),
  resources: async (slug: string) => {
    return ownerRequest<{ id: string; name: string }[]>('resources', { slug });
  },
  waitlist: (slug: string) => rpc<{ id: string; service_name: string; preferred_day: string; customer_name: string; customer_phone: string; car: string; status: string; created_at: string }[]>('owner_waitlist', { p_slug: slug }),
  waitlistStatus: (id: string, status: 'waiting' | 'contacted' | 'closed') => rpc<void>('owner_waitlist_status', { p_id: id, p_status: status }),
  promos: (slug: string) => rpc<{ id: string; code: string; discount_kind: 'percent' | 'fixed'; discount_value: number; usage_limit: number | null; used_count: number; active: boolean }[]>('owner_promo_codes', { p_slug: slug }),
  upsertPromo: (slug: string, p: { id?: string; code: string; kind: 'percent' | 'fixed'; value: number; limit: number | null; active: boolean }) => rpc<string>('owner_upsert_promo', { p_slug: slug, p_id: p.id ?? null, p_code: p.code, p_kind: p.kind, p_value: p.value, p_limit: p.limit, p_starts: null, p_ends: null, p_active: p.active }),
  deletePromo: (slug: string, id: string) => rpc<void>('owner_delete_promo', { p_slug: slug, p_id: id }),
  reviews: (slug: string) => rpc<{ id: string; rating: number; comment: string; published: boolean; created_at: string; customer_name: string; service_name: string }[]>('owner_reviews', { p_slug: slug }),
  publishReview: (id: string, published: boolean) => rpc<void>('owner_publish_review', { p_id: id, p_published: published }),
  sourceStats: (slug: string, from: string, to: string) => rpc<{ source: string; visits: number; received_cents: number }[]>('owner_source_stats', { p_slug: slug, p_from: from, p_to: to }),
  publicReviews: (slug: string) => rpc<{ rating: number; comment: string; created_at: string }[]>('published_reviews', { p_slug: slug }),
};
const MSG: [string, string][] = [['slot_taken', 'Это время занято.'], ['exclusion', 'Это время занято.'], ['invalid_slot', 'На это время приём не ведётся.'],
  ['past_start', 'Это время уже прошло.'], ['refund_exceeds', 'Возврат больше полученной суммы.'], ['bad_transition', 'Это действие недоступно для текущего статуса.'],
  ['forbidden', 'Нет прав для этого действия.'], ['rate_limited', 'Слишком много запросов. Попробуйте позже.'], ['bad_amount', 'Проверьте сумму.'],
  ['bad_name', 'Проверьте имя клиента.'], ['bad_phone', 'Проверьте номер телефона.'], ['bad_car', 'Укажите автомобиль.'],
  ['bad_config', 'Проверьте введённые настройки.'], ['bad_url', 'Ссылка должна начинаться с https://'],
  ['bad_range', 'Неверный диапазон дат.'], ['bad_hours', 'Неверное время работы.'], ['not_found', 'Запись не найдена.'],
  ['consent_required', 'Нужно согласие на обработку данных.'], ['feature_disabled', 'Эта функция не входит в ваш тариф. Обратитесь к администратору платформы.'], ['plan_limit_employees', 'Достигнут лимит сотрудников по тарифу. Измените тариф или обратитесь в поддержку.'], ['plan_limit_services', 'Достигнут лимит услуг по тарифу. Измените тариф или обратитесь в поддержку.'], ['plan_limit_bookings_per_month', 'Достигнут лимит записей на этот месяц. Измените тариф или обратитесь в поддержку.'], ['service_in_use', 'Услуга уже используется в записи или заявке. Снимите отметку «Показывается клиентам», чтобы скрыть её.'], ['resource_in_use', 'У этого рабочего ресурса уже есть записи или блокировки. Его нельзя удалить, пока они с ним связаны.'], ['duplicate_resource', 'У этого рабочего ресурса уже есть записи или блокировки. Его нельзя удалить, пока они с ним связаны.'], ['bad_notification_settings', 'Проверьте время напоминания, период повторного визита и длину текста.'], ['bad_template', 'Проверьте текст шаблона: допустимы подстановки {studio}, {service}, {date}, {time}, {address}, {customer}, {phone}, {car}, {price}, длина — до 2000 символов.'],
  ['too_late', 'Слишком поздно: это время уже нельзя изменить.'], ['already_waiting', 'Вы уже оставили заявку на эту услугу в этот день.'],
  ['bad_date', 'Проверьте выбранную дату.'], ['offer_expired', 'Предложение уже истекло. Заявка остаётся в листе ожидания.'],
  ['bad_offer', 'Ссылка на предложение недействительна.'], ['bad_request', 'Проверьте введённые данные.'],
  ['temporarily_unavailable', 'Сервис временно недоступен. Попробуйте позже.'], ['booking_unavailable', 'Сервис записи временно недоступен. Попробуйте позже.'], ['booking_closed', 'Онлайн-запись временно недоступна.'],
  ['promo_invalid', 'Промокод не действует или закончился лимит.']];
export const errText = (e: unknown) => { const m = String((e as Error)?.message ?? e); return MSG.find(([k]) => m.includes(k))?.[1] ?? 'Не удалось выполнить действие. Повторите.'; };
