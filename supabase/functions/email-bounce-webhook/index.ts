import { withEdgeObservability } from '../_shared/observability.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

// Provider-agnostic bounce intake. Configure the same secret on the mail
// provider's webhook and in BOUNCE_WEBHOOK_SECRET (CRON_SECRET is a fallback).
Deno.serve(withEdgeObservability('email-bounce-webhook', async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('BOUNCE_WEBHOOK_SECRET') || Deno.env.get('CRON_SECRET') || '';
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'forbidden' }, 403);

  let payload: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'bad_request' }, 400);
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const provider = String(new URL(req.url).searchParams.get('provider') || payload.provider || 'unknown').slice(0, 40);
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { error } = await admin.rpc('record_email_bounce', { p_provider: provider, p_event: payload });
  if (error) {
    const message = String(error.message ?? '');
    if (message.includes('bad_recipient') || message.includes('bad_request')) return json({ error: 'bad_request' }, 400);
    return json({ error: 'delivery_failed' }, 502);
  }
  return json({ ok: true });
}));
