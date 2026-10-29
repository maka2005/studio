import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
const ipOf = (r: Request) => r.headers.get('cf-connecting-ip') ?? r.headers.get('x-real-ip') ?? 'unknown';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
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
    if (p.action === 'slots') {
      const slug = typeof p.slug === 'string' ? p.slug : '';
      const service = typeof p.service === 'string' ? p.service : '';
      const day = typeof p.day === 'string' ? p.day : '';
      if (!/^[a-z0-9-]{2,40}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(service) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'bad_request' }, 400);
      if (!await rate('slots', ip, 120, 3600)) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('get_slots', { p_slug: slug, p_service: service, p_day: day });
      if (error) throw error;
      return json({ slots: data ?? [] });
    }
    if (p.action === 'booking_read' || p.action === 'booking_cancel') {
      const token = typeof p.token === 'string' ? p.token : '';
      if (!/^[a-f0-9]{32,128}$/i.test(token)) return json({ error: 'not_found' }, 404);
      const scope = p.action;
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate(scope, ip, scope === 'booking_read' ? 60 : 10, 3600),
        rate(scope, `token:${await sha(token)}`, scope === 'booking_read' ? 15 : 3, 3600),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      if (scope === 'booking_read') {
        const { data, error } = await admin.rpc('get_booking', { p_token: token });
        if (error) throw error;
        return json({ booking: (data ?? [])[0] ?? null });
      }
      const { data, error } = await admin.rpc('cancel_booking', { p_token: token });
      if (error) return json({ error: error.message.includes('too_late') ? 'too_late' : 'not_found' }, 400);
      return json({ ok: data === true });
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
      const { data: tenant, error: tenantError } = await admin.from('tenants').select('timezone').eq('slug', slug).maybeSingle();
      if (tenantError) throw tenantError;
      if (!tenant) return json({ error: 'not_found' }, 404);
      const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      if (day < localToday || day > new Date(Date.parse(`${localToday}T12:00:00Z`) + 60 * 864e5).toISOString().slice(0,10)) return json({ error: 'bad_date' }, 400);
      if (!await rate('waitlist', `phone:${slug}:${digits}`, 2, 86400)) return json({ error: 'rate_limited' }, 429);
      const normalizedPhone = `+${digits}`;
      const { error: submitError } = await admin.rpc('submit_waitlist', { p_slug: slug, p_service: service, p_day: day, p_name: name, p_phone: normalizedPhone, p_car: car, p_consent: consent });
      if (submitError?.code === '23505') return json({ error: 'already_waiting' }, 409);
      if (submitError) throw submitError;
      return json({ ok: true });
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
      if (error?.message.includes('review_unavailable')) return json({ error: 'review_unavailable' }, 400);
      if (error?.message.includes('bad_review')) return json({ error: 'bad_review' }, 400);
      if (error) throw error;
      return json({ ok: true });
    }
    if (p.action === 'customer_telegram_link') {
      const token = typeof p.token === 'string' ? p.token : '';
      if (!/^[a-f0-9]{32,128}$/i.test(token)) return json({ error: 'not_found' }, 404);
      const [ipAllowed, tokenAllowed] = await Promise.all([
        rate('customer_telegram', ip, 20, 3600),
        rate('customer_telegram', `token:${await sha(token)}`, 5, 86400),
      ]);
      if (!ipAllowed || !tokenAllowed) return json({ error: 'rate_limited' }, 429);
      const { data, error } = await admin.rpc('customer_telegram_code', { p_token: token, p_consent_version: 'telegram_booking_v1' });
      if (error?.message.includes('booking_unavailable')) return json({ error: 'booking_unavailable' }, 400);
      if (error?.message.includes('feature_disabled')) return json({ error: 'feature_disabled' }, 403);
      if (error?.message.includes('bad_request')) return json({ error: 'bad_request' }, 400);
      if (error) throw error;
      return json({ code: data ?? null });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('public api error:', (e as Error).message);
    if ((e as Error).message === 'rate_service_unavailable') return json({ error: 'temporarily_unavailable' }, 503);
    return json({ error: 'temporarily_unavailable' }, 503);
  }
});
