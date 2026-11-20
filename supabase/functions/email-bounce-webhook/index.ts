import { withEdgeObservability } from '../_shared/observability.ts';
import {
  hmacHex,
  readTextBody,
  safeEqual,
  verifyEnvelope,
  WebhookError,
  redact,
} from '../_shared/webhook_guard.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

// Provider-agnostic bounce intake. The configured secret is used for both the
// shared-secret header and the optional HMAC replay envelope. CRON_SECRET stays
// as a fallback because this project deliberately uses a single webhook secret.
Deno.serve(withEdgeObservability('email-bounce-webhook', async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // A dedicated secret is preferred. CRON_SECRET is still accepted so an
  // already-configured provider keeps working after the rotation.
  const secrets = [
    Deno.env.get('BOUNCE_WEBHOOK_SECRET') || '',
    Deno.env.get('CRON_SECRET') || '',
  ].filter((value) => value.length >= 16);
  const provided = req.headers.get('x-webhook-secret') || '';
  if (!secrets.some((candidate) => safeEqual(provided, candidate))) {
    return json({ error: 'forbidden' }, 403);
  }
  const secret = secrets[0]!;

  let raw = '';
  try {
    raw = await readTextBody(req, 64 * 1024);
  } catch (error) {
    if (error instanceof WebhookError) return json({ error: error.message }, error.status);
    return json({ error: 'bad_request' }, 400);
  }
  if (!(await verifyEnvelope(secret, req, raw))) return json({ error: 'bad_request' }, 400);

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const rawProvider = String(
    new URL(req.url).searchParams.get('provider') || payload.provider || 'unknown',
  ).slice(0, 40);
  const provider = /^[a-z0-9_-]{1,40}$/i.test(rawProvider) ? rawProvider.toLowerCase() : 'unknown';
  const alert = (message: string, details: Record<string, unknown>) =>
    admin.rpc('record_ops_alert', {
      p_source: 'email-bounce-webhook',
      p_level: 'error',
      p_message: message,
      p_details: details,
    }).catch(() => undefined);

  const ipHash = (await hmacHex(secret, req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown')).slice(0, 32);
  const rate = await admin.rpc('hit_limit', {
    p_key: `bounce:${provider}:${ipHash}`,
    p_limit: 200,
    p_window: 3600,
  });
  if (rate.data !== true) return json({ error: 'rate_limited' }, 429);

  const eventId = String(payload.event_id ?? payload.id ?? payload.message_id ?? '') ||
    (await hmacHex(secret, raw)).slice(0, 64);
  const fresh = await admin.rpc('consume_webhook_event', {
    p_kind: `bounce:${provider}`,
    p_event_id: eventId.slice(0, 256),
  });
  if (fresh.error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'bounce_ledger_failed',
      error: redact(fresh.error.message),
    }));
    await alert('Bounce replay ledger unavailable', { detail: redact(fresh.error.message, 200) });
    return json({ error: 'delivery_failed' }, 502);
  }
  if (fresh.data !== true) return json({ ok: true, duplicate: true });

  const { error } = await admin.rpc('record_email_bounce', { p_provider: provider, p_event: payload });
  if (error) {
    const message = String(error.message ?? '');
    if (message.includes('bad_recipient') || message.includes('bad_request')) return json({ error: 'bad_request' }, 400);
    console.error(JSON.stringify({ level: 'error', event: 'bounce_write_failed', error: redact(message) }));
    await alert('Bounce could not be recorded', { detail: redact(message, 200) });
    return json({ error: 'delivery_failed' }, 502);
  }
  return json({ ok: true });
}));
