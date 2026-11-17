import { withEdgeObservability } from '../_shared/observability.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCustomerMessage, buildMessage, buildOwnerTemplateMessage, escapeHtml, isDeadChat, type Kind } from './format.ts';
const env = (k: string) => Deno.env.get(k) ?? '';
type Admin = ReturnType<typeof createClient>;
type Template = { id: string; kind: string; audience: string; body: string };

async function finishJob(admin: Admin, id: string, ok: boolean, error: string | null, templateCode: string | null = null) {
  const { error: finishError } = await admin.rpc('finish_notification_job', {
    p_id: id, p_ok: ok, p_error: error, p_template_code: templateCode,
  });
  if (finishError) throw finishError;
}

/** Active per-tenant templates, keyed as "audience:kind". */
async function loadTemplates(admin: Admin, tenantId: string): Promise<Record<string, Template>> {
  const { data, error } = await admin.from('notification_templates')
    .select('id,kind,audience,body').eq('tenant_id', tenantId).eq('channel', 'telegram').eq('is_active', true);
  if (error) throw error;
  const result: Record<string, Template> = {};
  for (const t of (data ?? []) as Template[]) result[`${t.audience}:${t.kind}`] = t;
  return result;
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
Deno.serve(withEdgeObservability('notify-dispatch', async (req) => {
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const token = env('TELEGRAM_BOT_TOKEN'); if (!token) return new Response('telegram not configured', { status: 503 });
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: jobs, error } = await admin.rpc('lease_notification_jobs', { p_limit: 20 });
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0, retry = 0;
  for (const j of (jobs ?? []) as { id: string; tenant_id: string; kind: Kind; booking_id: string | null; payload?: Record<string, unknown> }[]) {
    let templateCode: string | null = null;
    try {
      const { data: t, error: tenantError } = await admin.from('tenants').select('slug,timezone,config').eq('id', j.tenant_id).maybeSingle();
      if (tenantError) throw tenantError;
      const [templatesResult, links] = await Promise.all([
        loadTemplates(admin, j.tenant_id),
        j.kind === 'booking_followup'
          ? Promise.resolve({ data: [] as { chat_id: number }[], error: null })
          : admin.from('telegram_links').select('chat_id').eq('tenant_id', j.tenant_id),
      ]);
      if (links.error) throw links.error;
      const templates = templatesResult;
      if (!t) throw new Error('tenant_missing');
      const { data: notifyOpen, error: notifyOpenError } = await admin.rpc('tenant_notifications_open', { p_tenant: j.tenant_id });
      if (notifyOpenError) throw notifyOpenError;
      if (notifyOpen !== true) {
        await admin.from('notification_jobs').update({ status: 'failed', lease_until: null, last_error: 'subscription_suspended' }).eq('id', j.id);
        retry++;
        continue;
      }
      const { data: telegramEnabled, error: featureError } = await admin.rpc('tenant_feature_enabled', { p_tenant: j.tenant_id, p_feature: 'telegram' });
      if (featureError) throw featureError;
      if (telegramEnabled !== true) {
        await admin.from('notification_jobs').update({ status: 'failed', lease_until: null, last_error: 'feature_disabled' }).eq('id', j.id);
        retry++;
        continue;
      }
      if (j.kind === 'waitlist_interest') {
        const chatLinks = (links.data ?? []) as { chat_id: number }[];
        if (!chatLinks.length) {
          await finishJob(admin, j.id, false, 'no_telegram_chat_linked');
          retry++;
          continue;
        }
        const p = j.payload ?? {};
        const text = [`<b>🕒 Новая заявка в лист ожидания</b> · ${escapeHtml(String((t.config as { name?: string }).name ?? t.slug))}`,
          `Услуга: ${escapeHtml(String(p.service ?? ''))}`, `Дата: ${escapeHtml(String(p.day ?? ''))}`,
          `Клиент: ${escapeHtml(String(p.name ?? ''))}, ${escapeHtml(String(p.phone ?? ''))}`, `Авто: ${escapeHtml(String(p.car ?? ''))}`].join('\n');
        let failure: string | null = null; let delivered = 0;
        for (const l of chatLinks) {
          const r = await send(token, l.chat_id, text, `${env('SITE_URL').replace(/\/+$/, '')}/s/${t.slug}/owner`);
          if (r.ok) delivered++;
          else if (isDeadChat(r.code, r.desc)) await admin.from('telegram_links').delete().eq('tenant_id', j.tenant_id).eq('chat_id', l.chat_id);
          else failure = `telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
        }
        if (failure === null && delivered === 0) failure = 'no_reachable_telegram_chat';
        await finishJob(admin, j.id, failure === null, failure);
        if (failure === null) sent++; else retry++;
        continue;
      }
      if (!j.booking_id) throw new Error('booking_missing');
      const { data: bk, error: bookingError } = await admin.from('bookings').select('starts_at,price_cents,customer_name,customer_phone,car,service_id,status').eq('id', j.booking_id).maybeSingle();
      if (bookingError) throw bookingError;
      if (!bk) throw new Error('booking_missing');
      if (j.kind === 'booking_reminder' && bk.status !== 'booked') {
        await finishJob(admin, j.id, true, null);
        continue;
      }
      if (j.kind === 'booking_followup' && bk.status !== 'done') {
        await finishJob(admin, j.id, true, null);
        continue;
      }
      const cfg = t.config as { name?: string; short_name?: string; currency?: string; address?: string; client_telegram_enabled?: boolean };
      const { data: clientLink, error: clientLinkError } = cfg.client_telegram_enabled && j.kind !== 'booking_created'
        ? await admin.from('booking_telegram_links').select('chat_id,repeat_consent').eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id)
          .maybeSingle()
        : { data: null, error: null };
      if (clientLinkError) throw clientLinkError;
      const chatLinks = (links.data ?? []) as { chat_id: number }[];
      if (!chatLinks.length && !clientLink) {
        await finishJob(admin, j.id, j.kind === 'booking_followup', j.kind === 'booking_followup' ? null : 'no_telegram_chat_linked');
        if (j.kind !== 'booking_followup') retry++;
        continue;
      }
      const { data: svc, error: serviceError } = await admin.from('services').select('name').eq('tenant_id', j.tenant_id).eq('id', bk.service_id).maybeSingle();
      if (serviceError) throw serviceError;
      if (j.kind === 'booking_followup' && !clientLink?.repeat_consent) {
        await finishJob(admin, j.id, true, null);
        continue;
      }
      const ownerTemplate = templates[`owner:${j.kind}`];
      const clientTemplate = templates[`client:${j.kind}`];
      if (ownerTemplate) templateCode = ownerTemplate.id;
      const messageData = {
        kind: j.kind, studio: cfg.name ?? t.slug, service: svc?.name ?? '', startsAt: bk.starts_at,
        timezone: t.timezone, customer: bk.customer_name, phone: bk.customer_phone,
        car: bk.car, priceCents: bk.price_cents, currency: cfg.currency ?? '',
      };
      const text = ownerTemplate ? buildOwnerTemplateMessage(ownerTemplate.body, messageData) : buildMessage(messageData);
      let failure: string | null = null;
      let delivered = 0;
      for (const l of chatLinks) {
        const r = await send(token, l.chat_id, text, `${env('SITE_URL').replace(/\/+$/, '')}/s/${t.slug}/owner`);
        if (r.ok) { delivered++; continue; }
        if (isDeadChat(r.code, r.desc)) {
          const { error: deleteError } = await admin.from('telegram_links').delete().eq('tenant_id', j.tenant_id).eq('chat_id', l.chat_id);
          if (deleteError) throw deleteError;
          continue;
        }
        failure = `telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
      }
      let clientDelivered = false;
      if (clientLink) {
        const { data: notifySettings, error: settingsError } = await admin.from('tenant_notification_settings').select('reminder_message,repeat_message').eq('tenant_id', j.tenant_id).maybeSingle();
        if (settingsError) throw settingsError;
        const payload = j.payload ?? {};
        const legacy = typeof payload.message === 'string' ? payload.message
          : j.kind === 'booking_followup' ? notifySettings?.repeat_message
            : j.kind === 'booking_reminder' ? notifySettings?.reminder_message : null;
        const customMessage = clientTemplate ? null : legacy;
        if (clientTemplate) templateCode = clientTemplate.id;
        const customerText = buildCustomerMessage({ kind: j.kind as Exclude<Kind, 'waitlist_interest'>,
          studio: cfg.short_name ?? cfg.name ?? t.slug, service: svc?.name ?? '', startsAt: bk.starts_at,
          timezone: t.timezone, address: cfg.address ?? '', customMessage, templateBody: clientTemplate?.body });
        const r = await send(token, clientLink.chat_id, customerText, '');
        if (r.ok) clientDelivered = true;
        else if (isDeadChat(r.code, r.desc)) {
          const { error: deleteError } = await admin.from('booking_telegram_links').delete().eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id);
          if (deleteError) throw deleteError;
        } else failure = `customer telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
      }
      if (clientDelivered && j.kind === 'booking_cancelled') {
        const { error: deleteError } = await admin.from('booking_telegram_links').delete().eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id);
        if (deleteError) throw deleteError;
      }
      delivered += Number(clientDelivered);
      if (failure === null && delivered === 0 && j.kind !== 'booking_followup') failure = 'no_reachable_telegram_chat';
      await finishJob(admin, j.id, failure === null, failure, templateCode);
      if (failure === null) sent++; else retry++;
    } catch (e) {
      try { await finishJob(admin, j.id, false, String((e as Error).message), templateCode); }
      catch (finishError) { console.error('notification job could not be finalized', j.id, String(finishError)); }
      retry++;
    }
  }
  return new Response(JSON.stringify({ sent, retry }), { headers: { 'Content-Type': 'application/json' } });
}));
