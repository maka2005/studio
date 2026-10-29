import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildMessage, isDeadChat, type Kind } from './format.ts';
const env = (k: string) => Deno.env.get(k) ?? '';

async function finishJob(admin: ReturnType<typeof createClient>, id: string, ok: boolean, error: string | null) {
  const { error: finishError } = await admin.rpc('finish_notification_job', { p_id: id, p_ok: ok, p_error: error });
  if (finishError) throw finishError;
}

async function send(token: string, chat: number, text: string, url: string) {
  let cabinetUrl: string | undefined;
  try {
    const site = new URL(url);
    if (site.protocol === 'https:') cabinetUrl = site.toString();
  } catch { /* still send the notification without a button when SITE_URL is missing */ }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(cabinetUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть кабинет', url: cabinetUrl }]] } } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok === true, code: j.error_code as number | undefined, desc: String(j.description ?? '') };
}

// Вызывается по расписанию (Supabase Cron). Секрет в заголовке не даёт запускать функцию посторонним.
Deno.serve(async (req) => {
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const token = env('TELEGRAM_BOT_TOKEN'); if (!token) return new Response('telegram not configured', { status: 503 });
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: jobs, error } = await admin.rpc('lease_notification_jobs', { p_limit: 20 });
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0, retry = 0;
  for (const j of (jobs ?? []) as { id: string; tenant_id: string; kind: Kind; booking_id: string }[]) {
    try {
      const { data: bk, error: bookingError } = await admin.from('bookings').select('starts_at,price_cents,customer_name,customer_phone,car,service_id').eq('id', j.booking_id).maybeSingle();
      if (bookingError) throw bookingError;
      const { data: t, error: tenantError } = await admin.from('tenants').select('slug,timezone,config').eq('id', j.tenant_id).maybeSingle();
      if (tenantError) throw tenantError;
      const { data: links, error: linksError } = await admin.from('telegram_links').select('chat_id').eq('tenant_id', j.tenant_id);
      if (linksError) throw linksError;
      if (!bk) throw new Error('booking_missing');
      if (!t) throw new Error('tenant_missing');
      if (!links?.length) {
        await finishJob(admin, j.id, false, 'no_telegram_chat_linked');
        retry++;
        continue;
      }
      const { data: svc, error: serviceError } = await admin.from('services').select('name').eq('tenant_id', j.tenant_id).eq('id', bk.service_id).maybeSingle();
      if (serviceError) throw serviceError;
      const cfg = t.config as { name?: string; currency?: string };
      const text = buildMessage({ kind: j.kind, studio: cfg.name ?? t.slug, service: svc?.name ?? '', startsAt: bk.starts_at, timezone: t.timezone,
        customer: bk.customer_name, phone: bk.customer_phone, car: bk.car, priceCents: bk.price_cents, currency: cfg.currency ?? '' });
      let failure: string | null = null;
      let delivered = 0;
      for (const l of links as { chat_id: number }[]) {
        const r = await send(token, l.chat_id, text, `${env('SITE_URL').replace(/\/+$/, '')}/s/${t.slug}/owner`);
        if (r.ok) { delivered++; continue; }
        if (isDeadChat(r.code, r.desc)) {
          const { error: deleteError } = await admin.from('telegram_links').delete().eq('tenant_id', j.tenant_id).eq('chat_id', l.chat_id);
          if (deleteError) throw deleteError;
          continue;
        }
        failure = `telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
      }
      if (failure === null && delivered === 0) failure = 'no_reachable_telegram_chat';
      await finishJob(admin, j.id, failure === null, failure);
      if (failure === null) sent++; else retry++;
    } catch (e) {
      try { await finishJob(admin, j.id, false, String((e as Error).message)); }
      catch (finishError) { console.error('notification job could not be finalized', j.id, String(finishError)); }
      retry++;
    }
  }
  return new Response(JSON.stringify({ sent, retry }), { headers: { 'Content-Type': 'application/json' } });
});
