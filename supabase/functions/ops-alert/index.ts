import { withEdgeObservability } from '../_shared/observability.ts';
import { readTextBody, redact, safeEqual, WebhookError } from '../_shared/webhook_guard.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const env = (key: string) => Deno.env.get(key) || '';

// Internal alert sink. Accepts alerts from our own functions and optionally
// forwards them to an external webhook when ALERT_WEBHOOK_URL is configured.
Deno.serve(withEdgeObservability('ops-alert', async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = env('PLATFORM_PROXY_SECRET') || env('CRON_SECRET');
  const provided = req.headers.get('x-alert-secret') || '';
  if (secret.length < 16 || !safeEqual(provided, secret)) {
    return json({ error: 'forbidden' }, 403);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(await readTextBody(req, 16 * 1024));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof WebhookError) return json({ error: error.message }, error.status);
    return json({ error: 'bad_request' }, 400);
  }

  const source = String(body?.source ?? '').slice(0, 80);
  const level = String(body?.level ?? 'error') === 'warn' ? 'warn' : 'error';
  const message = redact(body?.message ?? '', 500);
  if (!source || !message) return json({ error: 'bad_request' }, 400);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: id, error } = await admin.rpc('record_ops_alert', {
    p_source: source,
    p_level: level,
    p_message: message,
    p_details: body?.details && typeof body.details === 'object' ? body.details : {},
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', event: 'ops_alert_failed', error: redact(error.message) }));
    return json({ error: 'delivery_failed' }, 502);
  }

  const hook = env('ALERT_WEBHOOK_URL');
  if (/^https:\/\//i.test(hook)) {
    fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, source, level, message }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }

  return new Response(null, { status: 204 });
}));
