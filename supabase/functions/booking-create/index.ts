import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return json({ error: 'bad_request' }, 400);
  const p = payload as Record<string, unknown>;
  const slug = typeof p.slug === 'string' ? p.slug : '';
  const service = typeof p.service === 'string' ? p.service : '';
  const start = typeof p.start === 'string' ? p.start : '';
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const phone = typeof p.phone === 'string' ? p.phone.trim() : '';
  const car = typeof p.car === 'string' ? p.car.trim() : '';
  const key = typeof p.key === 'string' ? p.key : '';
  const token = typeof p.token === 'string' ? p.token : '';
  const consent = typeof p.consent === 'string' ? p.consent : '';
  const promo = typeof p.promo === 'string' ? p.promo.trim().toUpperCase().slice(0, 24) : null;
  const source = typeof p.source === 'string' ? p.source.toLowerCase().slice(0, 40) : 'direct';

  if (!/^[a-z0-9-]{2,40}$/.test(slug) || !uuid.test(service) || !Number.isFinite(Date.parse(start)))
    return json({ error: 'bad_request' }, 400);
  if (name.length < 1 || name.length > 80) return json({ error: 'bad_name' }, 400);
  if (phone.length < 10 || phone.length > 18 || !/^\+?[0-9\s()-]+$/.test(phone) || phone.replace(/\D/g, '').length < 10 || phone.replace(/\D/g, '').length > 15)
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

  const { data, error } = await admin.rpc('create_booking_with_promo', {
    p_slug: slug, p_service: service, p_start: start, p_name: name, p_phone: phone,
    p_car: car, p_key: key, p_token: token, p_consent: consent, p_promo: promo, p_source: source,
  });
  if (error) {
    const message = error.message ?? '';
    const known = ['tenant_not_found', 'service_not_found', 'past_start', 'slot_taken', 'invalid_slot', 'bad_name', 'bad_phone', 'bad_car', 'consent_required', 'promo_invalid'];
    const code = known.find((item) => message.includes(item));
    if (code) return json({ error: code }, code === 'slot_taken' || code === 'invalid_slot' ? 409 : 400);
    console.error('booking create failed:', message);
    return json({ error: 'booking_unavailable' }, 503);
  }
  const booking = Array.isArray(data) ? data[0] : null;
  if (!booking) return json({ error: 'booking_unavailable' }, 503);
  const { data: pricing, error: pricingError } = await admin.from('bookings').select('price_cents,discount_cents,promo_code').eq('id', booking.booking_id).maybeSingle();
  if (pricingError) console.error('booking price lookup failed:', pricingError.message);
  return json({ booking: { ...booking, ...(pricing ?? {}) } });
});
