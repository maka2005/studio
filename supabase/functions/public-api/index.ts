import { withEdgeObservability } from '../_shared/observability.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const siteOrigin = (() => { try { return new URL(Deno.env.get('SITE_URL') ?? '').origin } catch { return '' } })();
const localSupabase = (() => { try { return ['localhost','127.0.0.1'].includes(new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname) } catch { return false } })();
const allowedOrigins = new Set([siteOrigin,...(localSupabase?['http://localhost:5173','http://127.0.0.1:5173']:[])].filter(Boolean));
const cors = { ...(siteOrigin?{'Access-Control-Allow-Origin':siteOrigin}:{}), 'Vary':'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
const newToken = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const hexToken = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32,128}$/i.test(v);
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const ipOf = (r: Request) => r.headers.get('cf-connecting-ip') ?? r.headers.get('x-real-ip') ?? 'unknown';
type Admin = ReturnType<typeof createClient>;

async function addTokenToJobs(admin: Admin, bookingId: string, token: string, kinds: string[]) {
  const { data, error } = await admin.from('notification_jobs').select('id,payload')
    .eq('booking_id', bookingId).in('kind', kinds);
  if (error) throw error;
  for (const job of data ?? []) {
    const payload = job.payload && typeof job.payload === 'object' ? job.payload as Record<string, unknown> : {};
    if (payload.token === token) continue;
    const { error: updateError } = await admin.from('notification_jobs')
      .update({ payload: { ...payload, token } }).eq('id', job.id);
    if (updateError) throw updateError;
  }
}

Deno.serve(withEdgeObservability('public-api', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const origin=req.headers.get('origin'); if(origin&&!allowedOrigins.has(origin)) return json({error:'forbidden'},403);
  const p = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!p || typeof p.action !== 'string') return json({ error: 'bad_request' }, 400);
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const ip = ipOf(req);
  const rate = async (scope: string, key: string, limit: number, window: number) => {
    const { data, error } = await admin.rpc('consume_public_rate', { p_scope: scope, p_key: key, p_limit: limit, p_window: window });
    if (error) throw new Error('rate_service_unavailable');
    return data === true;
  };
  try {
    if (p.action === 'booking_status') {
      const slug = typeof p.slug === 'string' ? p.slug : '';
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) return json({ error: 'bad_request' }, 400);
      if (!await rate('slots', ip, 120, 3600)) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('tenant_booking_open', { p_slug: slug });
      if (error) throw error;
      return json({ open: data === true });
    }
    if (p.action === 'slots') {
      const slug = typeof p.slug === 'string' ? p.slug : '';
      const service = typeof p.service === 'string' ? p.service : '';
      const day = typeof p.day === 'string' ? p.day : '';
      if (!/^[a-z0-9-]{2,40}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(service) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'bad_request' }, 400);
      if (!await rate('slots', ip, 120, 3600)) return json({ error: 'rate_limited' }, 429);
      { const open = await admin.rpc('tenant_booking_open', { p_slug: slug }); if (open.error) throw open.error; if (open.data !== true) return json({ error: 'booking_closed' }, 403); }
      const { data, error } = await admin.rpc('get_slots', { p_slug: slug, p_service: service, p_day: day });
      if (error) throw error;
      return json({ slots: data ?? [] });
    }
    if (p.action === 'booking_read') {
      const token = p.token;
      if (!hexToken(token)) return json({ error: 'not_found' }, 404);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('booking_read', ip, 60, 3600),
        rate('booking_read', `token:${await sha(token)}`, 15, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('get_booking', { p_token: token });
      if (error) throw error;
      return json({ booking: (data ?? [])[0] ?? null });
    }
    if (p.action === 'bookings_read') {
      // One visit may have several bookings sharing one token, and a device may
      // keep several tokens. Return every row the caller is entitled to see.
      const tokens = Array.isArray(p.tokens)
        ? [...new Set(p.tokens.filter(hexToken))].slice(0, 20) : [];
      if (!tokens.length) return json({ error: 'not_found' }, 404);
      const fingerprint = await sha([...tokens].sort().join(':'));
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('bookings_read', ip, 40, 3600),
        rate('bookings_read', `tokens:${fingerprint}`, 20, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const all: Record<string, unknown>[] = [];
      for (const token of tokens) {
        if (!await rate('bookings_read', `token:${await sha(token)}`, 20, 3600))
          return json({ error: 'rate_limited' }, 429);
        const { data, error } = await admin.rpc('get_booking', { p_token: token });
        if (error) throw error;
        for (const row of data ?? []) all.push({ ...(row as Record<string, unknown>), token });
      }
      const seen = new Set<string>();
      const bookings = all
        .filter((row) => {
          const id = String(row.id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .sort((a, z) => Date.parse(String(a.starts_at)) - Date.parse(String(z.starts_at)));
      return json({ bookings });
    }
    if (p.action === 'booking_cancel') {
      const token = p.token;
      if (!hexToken(token)) return json({ error: 'not_found' }, 404);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('booking_cancel', ip, 10, 3600),
        rate('booking_cancel', `token:${await sha(token)}`, 3, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const current = await admin.rpc('get_booking', { p_token: token });
      if (current.error) throw current.error;
      const bookingId = (current.data ?? [])[0]?.id as string | undefined;
      const { data, error } = await admin.rpc('cancel_booking', { p_token: token });
      if (error) return json({ error: error.message.includes('too_late') ? 'too_late' : 'not_found' }, 400);
      if (bookingId) await addTokenToJobs(admin, bookingId, token, ['booking_cancelled']);
      return json({ ok: data === true });
    }
    if (p.action === 'booking_reschedule') {
      const token = p.token;
      const start = p.start;
      if (!hexToken(token) || !isoDate(start)) return json({ error: 'bad_request' }, 400);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('booking_reschedule', ip, 20, 3600),
        rate('booking_reschedule', `token:${await sha(token)}`, 10, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('reschedule_booking', { p_token: token, p_start: start });
      if (error) {
        const code = ['past_start','too_late','feature_disabled','invalid_slot','slot_taken','not_found']
          .find((item) => error.message.includes(item));
        if (code) return json({ error: code }, code === 'feature_disabled' ? 403 : code === 'not_found' ? 404 : 400);
        throw error;
      }
      const row = (data ?? [])[0] ?? null;
      return json({ ok: true, booking: row, ...(row ?? {}) });
    }
    if (p.action === 'waitlist') {
      const slug = typeof p.slug === 'string' ? p.slug : '';
      const service = typeof p.service === 'string' ? p.service : '';
      const day = typeof p.day === 'string' ? p.day : '';
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const phone = typeof p.phone === 'string' ? p.phone : '';
      const digits = phone.replace(/\D/g, '');
      const car = typeof p.car === 'string' ? p.car.trim() : '';
      const consent = typeof p.consent === 'string' ? p.consent.trim() : '';
      if (!/^[a-z0-9-]{2,40}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(service) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || name.length < 1 || name.length > 80 || digits.length < 10 || digits.length > 15 || car.length < 2 || car.length > 60 || !consent || consent.length > 40 || new Date(`${day}T12:00:00Z`).toISOString().slice(0,10)!==day) return json({ error: 'bad_request' }, 400);
      if (!await rate('waitlist', ip, 10, 86400)) return json({ error: 'rate_limited' }, 429);
      { const open = await admin.rpc('tenant_booking_open', { p_slug: slug }); if (open.error) throw open.error; if (open.data !== true) return json({ error: 'booking_closed' }, 403); }
      const { data: tenant, error: tenantError } = await admin.from('tenants').select('timezone').eq('slug', slug).maybeSingle();
      if (tenantError) throw tenantError;
      if (!tenant) return json({ error: 'not_found' }, 404);
      const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      if (day < localToday || day > new Date(Date.parse(`${localToday}T12:00:00Z`) + 60 * 864e5).toISOString().slice(0,10)) return json({ error: 'bad_date' }, 400);
      if (!await rate('waitlist', `phone:${slug}:${digits}`, 2, 86400)) return json({ error: 'rate_limited' }, 429);
      const normalizedPhone = `+${digits}`;
      const token = newToken();
      const { data: waitlistId, error: submitError } = await admin.rpc('submit_waitlist', {
        p_slug: slug, p_service: service, p_day: day, p_name: name,
        p_phone: normalizedPhone, p_car: car, p_consent: consent, p_token: token,
      });
      if (submitError?.code === '23505') return json({ error: 'already_waiting' }, 409);
      if (submitError) throw submitError;
      return json({ ok: true, token, id: waitlistId ?? null });
    }
    if (p.action === 'waitlist_read' || p.action === 'waitlist_cancel') {
      const token = p.token;
      if (!hexToken(token)) return json({ error: 'not_found' }, 404);
      const isRead = p.action === 'waitlist_read';
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate(p.action, ip, isRead ? 60 : 10, 3600),
        rate(p.action, `token:${await sha(token)}`, isRead ? 30 : 5, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc(p.action, { p_token: token });
      if (error) throw error;
      if (!isRead) return json({ ok: data === true });
      const raw = (data ?? [])[0] ?? null;
      const item = raw ? {
        ...raw,
        offer: raw.offer_token && raw.offer_expires_at ? {
          slot: raw.offer_slot, expires_at: raw.offer_expires_at, offer_token: raw.offer_token,
        } : null,
      } : null;
      return json({ item, waitlist: item });
    }
    if (p.action === 'waitlist_claim') {
      const offerToken = p.token ?? p.offerToken;
      if (!hexToken(offerToken)) return json({ error: 'not_found' }, 404);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('waitlist_claim', ip, 20, 3600),
        rate('waitlist_claim', `offer:${await sha(offerToken)}`, 10, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('waitlist_claim', { p_offer_token: offerToken });
      if (error) {
        if (error.message.includes('not_found')) return json({ error: 'not_found' }, 404);
        if (error.message.includes('offer_unavailable')) return json({ error: 'offer_unavailable' }, 410);
        if (error.message.includes('slot_taken') || error.message.includes('invalid_slot')) return json({ error: 'slot_taken' }, 409);
        throw error;
      }
      const row = (data ?? [])[0] ?? null;
      return json({ ok: true, booking: row, ...(row ?? {}) });
    }
    if (p.action === 'push_subscribe') {
      const token = p.token;
      // Accept both the flat form and a browser PushSubscriptionJSON object.
      const sub = p.subscription && typeof p.subscription === 'object'
        ? p.subscription as Record<string, unknown> : null;
      const keys = sub?.keys && typeof sub.keys === 'object'
        ? sub.keys as Record<string, unknown> : null;
      const endpoint = typeof p.endpoint === 'string' ? p.endpoint : sub?.endpoint;
      const p256dh = typeof p.p256dh === 'string' ? p.p256dh : keys?.p256dh;
      const auth = typeof p.auth === 'string' ? p.auth : keys?.auth;
      if (!hexToken(token)) return json({ error: 'not_found' }, 404);
      if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string'
        || !p256dh || !auth || p256dh.length > 512 || auth.length > 512 || endpoint.length > 2048) {
        return json({ error: 'bad_request' }, 400);
      }
      try {
        const u = new URL(endpoint);
        if (u.protocol !== 'https:') return json({ error: 'bad_request' }, 400);
      } catch { return json({ error: 'bad_request' }, 400); }
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('push_subscribe', ip, 30, 3600),
        rate('push_subscribe', `token:${await sha(token)}`, 10, 86400),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const booking = await admin.rpc('get_booking', { p_token: token });
      if (booking.error) throw booking.error;
      let tenantId: string | undefined;
      const bookingRow = (booking.data ?? [])[0];
      if (bookingRow) {
        const tenant = await admin.from('tenants').select('id').eq('slug', bookingRow.tenant_slug).maybeSingle();
        if (tenant.error) throw tenant.error;
        tenantId = tenant.data?.id;
      } else {
        const waitlist = await admin.rpc('waitlist_read', { p_token: token });
        if (waitlist.error) throw waitlist.error;
        const serviceId = (waitlist.data ?? [])[0]?.service_id;
        if (serviceId) {
          const service = await admin.from('services').select('tenant_id').eq('id', serviceId).maybeSingle();
          if (service.error) throw service.error;
          tenantId = service.data?.tenant_id;
        }
      }
      if (!tenantId) return json({ error: 'not_found' }, 404);
      const { data: subscription, error: subscriptionError } = await admin.from('push_subscriptions')
        .upsert({
          tenant_id: tenantId, subject_hash: await sha(token), endpoint, p256dh, auth,
        }, { onConflict: 'endpoint,subject_hash' })
        .select('id').maybeSingle();
      if (subscriptionError) throw subscriptionError;
      return json({ ok: true, id: subscription?.id ?? null });
    }
    if (p.action === 'review') {
      const token = typeof p.token === 'string' ? p.token : '';
      const rating = Number(p.rating);
      const comment = typeof p.comment === 'string' ? p.comment.trim() : '';
      if (!/^[a-f0-9]{32,128}$/i.test(token) || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1000) return json({ error: 'bad_review' }, 400);
      // Allow a few retries for transient failures and correcting accidental submissions;
      // the unique booking constraint still guarantees that only one review is saved.
      const [ipAllowed, tokenAllowed] = await Promise.all([rate('review', ip, 12, 3600), rate('review', `token:${await sha(token)}`, 10, 86400)]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { error } = await admin.rpc('submit_booking_review', { p_token: token, p_rating: rating, p_comment: comment });
      if (error?.code === '23505' || error?.message.includes('duplicate')) return json({ error: 'already_reviewed' }, 409);
      if (error?.message.includes('feature_disabled')) return json({ error: 'feature_disabled' }, 403);
      if (error?.message.includes('review_unavailable')) return json({ error: 'review_unavailable' }, 400);
      if (error?.message.includes('bad_review')) return json({ error: 'bad_review' }, 400);
      if (error) throw error;
      return json({ ok: true });
    }
    if (p.action === 'customer_telegram_link') {
      const token = typeof p.token === 'string' ? p.token : '';
      const repeatConsent = p.repeatConsent === true;
      if (!/^[a-f0-9]{32,128}$/i.test(token)) return json({ error: 'not_found' }, 404);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('customer_telegram', ip, 20, 3600),
        rate('customer_telegram', `token:${await sha(token)}`, 5, 86400),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('customer_telegram_code', { p_token: token, p_consent_version: 'telegram_booking_v1', p_repeat_consent: repeatConsent });
      if (error?.message.includes('booking_unavailable')) return json({ error: 'booking_unavailable' }, 400);
      if (error?.message.includes('feature_disabled')) return json({ error: 'feature_disabled' }, 403);
      if (error?.message.includes('bad_request')) return json({ error: 'bad_request' }, 400);
      if (error) throw error;
      return json({ code: data ?? null });
    }
    if (p.action === 'customer_telegram_status') {
      const token = typeof p.token === 'string' ? p.token : '';
      if (!/^[a-f0-9]{32,128}$/i.test(token)) return json({ error: 'not_found' }, 404);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('customer_telegram_status', ip, 120, 3600),
        rate('customer_telegram_status', `token:${await sha(token)}`, 120, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('customer_telegram_status', { p_token: token });
      if (error) throw error;
      return json({ connected: data === true });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('public api error:', (e as Error).message);
    if ((e as Error).message === 'rate_service_unavailable') return json({ error: 'temporarily_unavailable' }, 503);
    return json({ error: 'temporarily_unavailable' }, 503);
  }
}));
