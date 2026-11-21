import { withEdgeObservability } from '../_shared/observability.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const siteOrigin = (() => { try { return new URL(Deno.env.get('SITE_URL') ?? '').origin } catch { return '' } })();
const localSupabase = (() => { try { return ['localhost','127.0.0.1'].includes(new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname) } catch { return false } })();
const allowedOrigins = new Set([siteOrigin,...(localSupabase?['http://localhost:5173','http://127.0.0.1:5173']:[])].filter(Boolean));
const cors = {
  ...(siteOrigin?{'Access-Control-Allow-Origin':siteOrigin}:{}),
  'Vary':'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(withEdgeObservability('booking-create', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const origin=req.headers.get('origin'); if(origin&&!allowedOrigins.has(origin)) return json({error:'forbidden'},403);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return json({ error: 'bad_request' }, 400);
  const p = payload as Record<string, unknown>;
  const slug = typeof p.slug === 'string' ? p.slug : '';
  const service = typeof p.service === 'string' ? p.service : '';
  // One visit can contain several services, scheduled back-to-back by the database.
  // The singular `service` field stays for older clients.
  const services = Array.isArray(p.services)
    ? p.services.filter((item): item is string => typeof item === 'string').slice(0, 3)
    : [];
  const start = typeof p.start === 'string' ? p.start : '';
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const phone = typeof p.phone === 'string' ? p.phone.trim() : '';
  const car = typeof p.car === 'string' ? p.car.trim() : '';
  const key = typeof p.key === 'string' ? p.key : '';
  const token = typeof p.token === 'string' ? p.token : '';
  const consent = typeof p.consent === 'string' ? p.consent : '';
  const promo = typeof p.promo === 'string' ? p.promo.trim().toUpperCase().slice(0, 24) : null;
  const source = typeof p.source === 'string' ? p.source.toLowerCase().slice(0, 40) : 'direct';

  const visitServices = services.length ? services : (service ? [service] : []);
  if (!/^[a-z0-9-]{2,40}$/.test(slug) || visitServices.length < 1 || visitServices.length > 3
    || visitServices.some((item) => !uuid.test(item)) || !Number.isFinite(Date.parse(start)))
    return json({ error: 'bad_request' }, 400);
  if (name.length < 1 || name.length > 80) return json({ error: 'bad_name' }, 400);
  if (phone.length < 10 || phone.length > 24 || !/^\+?[0-9\s()-]+$/.test(phone) || phone.replace(/\D/g, '').length < 10 || phone.replace(/\D/g, '').length > 15)
    return json({ error: 'bad_phone' }, 400);
  if (car.length < 2 || car.length > 60) return json({ error: 'bad_car' }, 400);
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key) || !/^[a-f0-9]{32,128}$/i.test(token)) return json({ error: 'bad_request' }, 400);
  if (!consent.trim() || consent.length > 40) return json({ error: 'consent_required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '';
  const { data: allowed, error: limitError } = await admin.rpc('consume_booking_rate', {
    p_slug: slug, p_phone: phone, p_key: key, p_ip: ip,
  });
  if (limitError) {
    console.error('booking rate check failed:', limitError.message);
    return json({ error: 'booking_unavailable' }, 503);
  }
  if (!allowed) return json({ error: 'rate_limited' }, 429);

  const { data: bookingOpen, error: openError } = await admin.rpc('tenant_booking_open', { p_slug: slug });
  if (openError) { console.error('subscription check failed:', openError.message); return json({ error: 'booking_unavailable' }, 503); }
  if (bookingOpen !== true) return json({ error: 'booking_closed' }, 403);

  const createArgs = {
    p_slug: slug, p_start: start, p_name: name, p_phone: phone, p_car: car,
    p_key: key, p_token: token, p_consent: consent, p_promo: promo, p_source: source,
  };
  const { data, error } = visitServices.length > 1
    ? await admin.rpc('create_booking_batch', { ...createArgs, p_services: visitServices })
    : await admin.rpc('create_booking_with_promo', { ...createArgs, p_service: visitServices[0] });
  if (error) {
    const message = error.message ?? '';
    const known = ['tenant_not_found', 'service_not_found', 'past_start', 'slot_taken', 'invalid_slot', 'bad_name', 'bad_phone', 'bad_car', 'consent_required', 'promo_invalid', 'booking_closed', 'plan_limit_bookings_per_month'];
    const code = known.find((item) => message.includes(item));
    if (code) return json({ error: code }, code === 'slot_taken' || code === 'invalid_slot' || code.startsWith('plan_limit_') ? 409 : code === 'booking_closed' ? 403 : 400);
    console.error('booking create failed:', message);
    return json({ error: 'booking_unavailable' }, 503);
  }
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const first = rows[0];
  if (!first) return json({ error: 'booking_unavailable' }, 503);
  const ids = rows.map((row) => String(row.booking_id)).filter(Boolean);
  // Keep the raw client token on every queued job so Telegram buttons link to
  // the right booking. Best effort: notification failures never fail creation.
  try {
    const { data: jobs, error: jobsError } = await admin.from('notification_jobs')
      .select('id,payload').in('booking_id', ids).eq('kind', 'booking_created');
    if (jobsError) throw jobsError;
    for (const job of jobs ?? []) {
      const payload = job.payload && typeof job.payload === 'object' ? job.payload as Record<string, unknown> : {};
      if (payload.token === token) continue;
      const { error: updateError } = await admin.from('notification_jobs')
        .update({ payload: { ...payload, token } }).eq('id', job.id);
      if (updateError) throw updateError;
    }
  } catch (e) {
    console.error('booking job payload update failed:', (e as Error).message);
  }
  const { data: pricing, error: pricingError } = await admin.from('bookings')
    .select('id,price_cents,discount_cents,promo_code').in('id', ids);
  if (pricingError) console.error('booking price lookup failed:', pricingError.message);
  const priceById = new Map((pricing ?? []).map((row) => [String(row.id), row]));
  const bookings = rows.map((row) => {
    const price = priceById.get(String(row.booking_id));
    return { ...row, price_cents: price?.price_cents ?? row.price_cents,
      discount_cents: price?.discount_cents ?? 0, promo_code: price?.promo_code ?? null };
  });
  // `booking` stays for older clients; `bookings` is the full visit.
  return json({ booking: bookings[0], bookings });
}));
