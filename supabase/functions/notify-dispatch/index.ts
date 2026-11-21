import { withEdgeObservability } from '../_shared/observability.ts';
import { redact, safeEqual } from '../_shared/webhook_guard.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import {
  buildCustomerMessage, buildMessage, buildOwnerTemplateMessage, buildWaitlistOfferMessage,
  escapeHtml, isDeadChat, type Kind,
} from './format.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const siteUrl = () => env('SITE_URL').replace(/\/+$/, '');
type Admin = ReturnType<typeof createClient>;
type Template = { id: string; kind: string; audience: string; body: string };
type Button = { text: string; url: string };
type Job = {
  id: string; tenant_id: string; kind: Kind; booking_id: string | null;
  payload?: Record<string, unknown>;
};
type PushSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

const sha = async (s: string) => [...new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
)].map((x) => x.toString(16).padStart(2, '0')).join('');

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

async function send(token: string, chat: number, text: string, url: string, buttons: Button[] = []) {
  let cabinetUrl: string | undefined;
  try {
    const site = new URL(url);
    if (site.protocol === 'https:') cabinetUrl = site.toString();
  } catch { /* still send the notification without a button when SITE_URL is missing */ }
  const inline = buttons.length ? buttons : cabinetUrl ? [{ text: 'Открыть кабинет', url: cabinetUrl }] : [];
  const keyboard: Button[][] = [];
  for (let i = 0; i < inline.length; i += 2) keyboard.push(inline.slice(i, i + 2));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok === true, code: j.error_code as number | undefined, desc: String(j.description ?? '') };
}

function clientButtons(kind: Kind, slug: string, payload: Record<string, unknown>, serviceId: string): Button[] {
  const base = `${siteUrl()}/s/${slug}`;
  const token = typeof payload.token === 'string' ? payload.token : '';
  const service = serviceId || (typeof payload.service_id === 'string' ? payload.service_id : '');
  if (kind === 'waitlist_offer') {
    const offer = typeof payload.offer_token === 'string' ? payload.offer_token : '';
    const out: Button[] = [];
    if (offer) out.push({ text: 'Занять время', url: `${base}/waitlist/claim#o=${offer}` });
    if (token) out.push({ text: 'Моя заявка', url: `${base}/waitlist#t=${token}` });
    return out;
  }
  if (kind === 'booking_cancelled' || kind === 'booking_followup') {
    return service ? [{ text: 'Записаться снова', url: `${base}?service=${service}` }] : [];
  }
  if (!token) return [];
  const out: Button[] = [
    { text: 'Открыть запись', url: `${base}/booking#t=${token}` },
    { text: 'Перенести', url: `${base}/booking?a=reschedule#t=${token}` },
    { text: 'Отменить', url: `${base}/booking?a=cancel#t=${token}` },
  ];
  if (service) out.push({ text: 'Повторить', url: `${base}?service=${service}` });
  return out;
}

/**
 * Reminder/follow-up jobs are scheduled without a raw token. The original
 * booking_created job keeps it, so recover it before building client links.
 */
async function resolveJobToken(admin: Admin, j: Job, payload: Record<string, unknown>): Promise<void> {
  if (typeof payload.token === 'string' && payload.token) return;
  if (j.kind === 'waitlist_offer') {
    const waitlistId = payload.waitlist_id;
    if (typeof waitlistId !== 'string') return;
    const { data } = await admin.from('notification_jobs')
      .select('payload').eq('tenant_id', j.tenant_id).eq('kind', 'waitlist_interest')
      .eq('dedupe_key', `waitlist:${waitlistId}`).maybeSingle();
    const token = (data?.payload as Record<string, unknown> | null)?.token;
    if (typeof token === 'string' && token) payload.token = token;
    return;
  }
  if (!j.booking_id) return;
  const { data } = await admin.from('notification_jobs')
    .select('payload').eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id)
    .eq('kind', 'booking_created').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const token = (data?.payload as Record<string, unknown> | null)?.token;
  if (typeof token === 'string' && token) payload.token = token;
}

/** Token hashes that a browser could have used to register a push subscription. */
async function pushSubjects(admin: Admin, j: Job): Promise<string[]> {
  const out: string[] = [];
  const token = j.payload?.token;
  if (typeof token === 'string' && token) out.push(await sha(token));
  if (j.booking_id) {
    const { data } = await admin.from('bookings').select('token_hash').eq('id', j.booking_id).maybeSingle();
    if (data?.token_hash) out.push(String(data.token_hash));
  }
  if (j.kind === 'waitlist_offer') {
    const waitlistId = j.payload?.waitlist_id;
    if (typeof waitlistId === 'string') {
      const { data } = await admin.from('waitlist').select('token_hash').eq('id', waitlistId).maybeSingle();
      if (data?.token_hash) out.push(String(data.token_hash));
    }
    const offer = j.payload?.offer_token;
    if (typeof offer === 'string' && offer) out.push(await sha(offer));
  }
  return [...new Set(out.filter(Boolean))];
}

/** Web Push is optional: missing VAPID keys or a provider error never blocks Telegram. */
async function sendPush(admin: Admin, j: Job, title: string, body: string, url: string): Promise<number> {
  const publicKey = env('VAPID_PUBLIC_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  const subject = env('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return 0;
  const hashes = await pushSubjects(admin, j);
  if (!hashes.length) return 0;
  const { data, error } = await admin.from('push_subscriptions')
    .select('id,endpoint,p256dh,auth').eq('tenant_id', j.tenant_id).in('subject_hash', hashes);
  if (error) throw error;
  const subscriptions = (data ?? []) as PushSubscription[];
  if (!subscriptions.length) return 0;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const message = JSON.stringify({ title, body, url, icon: `${siteUrl()}/favicon.ico` });
  let delivered = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, message);
      delivered++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('web push failed:', redact(String((e as Error).message)));
      }
    }
  }
  return delivered;
}

// Вызывается по расписанию (Supabase Cron). Секрет в заголовке не даёт запускать функцию посторонним.
Deno.serve(withEdgeObservability('notify-dispatch', async (req) => {
  const cronSecret = env('CRON_SECRET');
  if (cronSecret.length < 16 || !safeEqual(req.headers.get('x-cron-secret') || '', cronSecret)) return new Response('forbidden', { status: 403 });
  const botToken = env('TELEGRAM_BOT_TOKEN');
  if (!botToken && !env('VAPID_PUBLIC_KEY')) return new Response('not configured', { status: 503 });
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: jobs, error } = await admin.rpc('lease_notification_jobs', { p_limit: 20 });
  if (error) {
    console.error(JSON.stringify({ level: 'error', event: 'notify_lease_failed', error: redact(error.message) }));
    return new Response('internal_error', { status: 500 });
  }
  let sent = 0, retry = 0;
  for (const j of (jobs ?? []) as Job[]) {
    let templateCode: string | null = null;
    try {
      const { data: t, error: tenantError } = await admin.from('tenants')
        .select('slug,timezone,config').eq('id', j.tenant_id).maybeSingle();
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
      const canTelegram = telegramEnabled === true && !!botToken;
      const chatLinks = (links.data ?? []) as { chat_id: number }[];
      const payload = j.payload ?? {};
      j.payload = payload;
      await resolveJobToken(admin, j, payload);
      const cfg = t.config as {
        name?: string; short_name?: string; currency?: string; address?: string; client_telegram_enabled?: boolean;
      };
      const studio = cfg.name ?? t.slug;
      const clientStudio = cfg.short_name ?? studio;

      if (j.kind === 'waitlist_offer') {
        const serviceName = String(payload.service ?? '');
        const slot = typeof payload.slot === 'string' ? payload.slot : new Date().toISOString();
        const offerToken = typeof payload.offer_token === 'string' ? payload.offer_token : '';
        const ownerText = [
          `<b>🎉 Освободилось время из листа ожидания</b> · ${escapeHtml(studio)}`,
          `Услуга: ${escapeHtml(serviceName)}`,
          `Дата: ${escapeHtml(String(payload.day ?? ''))}`,
          `Слот: ${escapeHtml(slot)}`,
        ].join('\n');
        let failure: string | null = null;
        let delivered = 0;
        if (canTelegram) {
          for (const l of chatLinks) {
            const r = await send(botToken, l.chat_id, ownerText, `${siteUrl()}/s/${t.slug}/owner`);
            if (r.ok) delivered++;
            else if (isDeadChat(r.code, r.desc)) {
              await admin.from('telegram_links').delete().eq('tenant_id', j.tenant_id).eq('chat_id', l.chat_id);
            } else failure = `telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
          }
        }
        if (j.booking_id) {
          const { data: clientLink, error: linkError } = canTelegram && cfg.client_telegram_enabled
            ? await admin.from('booking_telegram_links').select('chat_id')
              .eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id).maybeSingle()
            : { data: null, error: null };
          if (linkError) throw linkError;
          if (clientLink) {
            const customerText = buildWaitlistOfferMessage({
              studio: clientStudio, service: serviceName, slot, timezone: t.timezone,
              offerToken, slug: t.slug, token: typeof payload.token === 'string' ? payload.token : undefined,
            });
            const r = await send(botToken, clientLink.chat_id, customerText, '',
              clientButtons('waitlist_offer', t.slug, payload, ''));
            if (r.ok) delivered++;
            else if (!isDeadChat(r.code, r.desc)) failure = `customer telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
          }
        }
        try {
          delivered += await sendPush(admin, j, 'Освободилось время', `${serviceName} - ${slot}`,
            `${siteUrl()}/s/${t.slug}/waitlist/claim#o=${offerToken}`);
        } catch (e) {
          console.error('waitlist push failed:', redact(String((e as Error).message)));
        }
        if (failure === null && delivered === 0) failure = 'no_reachable_channel';
        await finishJob(admin, j.id, failure === null, failure, templateCode);
        if (failure === null) sent++; else retry++;
        continue;
      }

      if (j.kind === 'waitlist_interest') {
        const ownerText = [
          `<b>🕒 Новая заявка в лист ожидания</b> · ${escapeHtml(studio)}`,
          `Услуга: ${escapeHtml(String(payload.service ?? ''))}`, `Дата: ${escapeHtml(String(payload.day ?? ''))}`,
          `Клиент: ${escapeHtml(String(payload.name ?? ''))}, ${escapeHtml(String(payload.phone ?? ''))}`,
          `Авто: ${escapeHtml(String(payload.car ?? ''))}`,
        ].join('\n');
        let failure: string | null = null;
        let delivered = 0;
        if (canTelegram) {
          for (const l of chatLinks) {
            const r = await send(botToken, l.chat_id, ownerText, `${siteUrl()}/s/${t.slug}/owner`);
            if (r.ok) delivered++;
            else if (isDeadChat(r.code, r.desc)) await admin.from('telegram_links').delete().eq('tenant_id', j.tenant_id).eq('chat_id', l.chat_id);
            else failure = `telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
          }
        }
        if (failure === null && delivered === 0) failure = 'no_reachable_channel';
        await finishJob(admin, j.id, failure === null, failure);
        if (failure === null) sent++; else retry++;
        continue;
      }

      if (!j.booking_id) throw new Error('booking_missing');
      const { data: bk, error: bookingError } = await admin.from('bookings')
        .select('starts_at,price_cents,customer_name,customer_phone,car,service_id,status')
        .eq('id', j.booking_id).maybeSingle();
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
      const { data: clientLink, error: clientLinkError } = canTelegram && cfg.client_telegram_enabled
        ? await admin.from('booking_telegram_links').select('chat_id,repeat_consent')
          .eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id).maybeSingle()
        : { data: null, error: null };
      if (clientLinkError) throw clientLinkError;
      const { data: svc, error: serviceError } = await admin.from('services')
        .select('name').eq('tenant_id', j.tenant_id).eq('id', bk.service_id).maybeSingle();
      if (serviceError) throw serviceError;
      if (j.kind === 'booking_followup' && !clientLink?.repeat_consent) {
        await finishJob(admin, j.id, true, null);
        continue;
      }
      const ownerTemplate = templates[`owner:${j.kind}`];
      const clientTemplate = templates[`client:${j.kind}`];
      if (ownerTemplate) templateCode = ownerTemplate.id;
      const messageData = {
        kind: j.kind, studio, service: svc?.name ?? '', startsAt: bk.starts_at,
        timezone: t.timezone, customer: bk.customer_name, phone: bk.customer_phone,
        car: bk.car, priceCents: bk.price_cents, currency: cfg.currency ?? '',
      };
      const text = ownerTemplate ? buildOwnerTemplateMessage(ownerTemplate.body, messageData) : buildMessage(messageData);
      let failure: string | null = null;
      let delivered = 0;
      for (const l of chatLinks) {
        if (!canTelegram) break;
        const r = await send(botToken, l.chat_id, text, `${siteUrl()}/s/${t.slug}/owner`);
        if (r.ok) { delivered++; continue; }
        if (isDeadChat(r.code, r.desc)) {
          const { error: deleteError } = await admin.from('telegram_links').delete()
            .eq('tenant_id', j.tenant_id).eq('chat_id', l.chat_id);
          if (deleteError) throw deleteError;
          continue;
        }
        failure = `telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
      }
      let clientDelivered = false;
      if (clientLink) {
        const { data: notifySettings, error: settingsError } = await admin.from('tenant_notification_settings')
          .select('reminder_message,repeat_message').eq('tenant_id', j.tenant_id).maybeSingle();
        if (settingsError) throw settingsError;
        const legacy = typeof payload.message === 'string' ? payload.message
          : j.kind === 'booking_followup' ? notifySettings?.repeat_message
            : j.kind === 'booking_reminder' ? notifySettings?.reminder_message : null;
        const customMessage = clientTemplate ? null : legacy;
        if (clientTemplate) templateCode = clientTemplate.id;
        const customerText = buildCustomerMessage({
          kind: j.kind as Exclude<Kind, 'waitlist_interest'>,
          studio: clientStudio, service: svc?.name ?? '', startsAt: bk.starts_at,
          timezone: t.timezone, address: cfg.address ?? '', customMessage, templateBody: clientTemplate?.body,
        });
        const r = await send(botToken, clientLink.chat_id, customerText, '',
          clientButtons(j.kind, t.slug, payload, bk.service_id));
        if (r.ok) clientDelivered = true;
        else if (isDeadChat(r.code, r.desc)) {
          const { error: deleteError } = await admin.from('booking_telegram_links').delete()
            .eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id);
          if (deleteError) throw deleteError;
        } else failure = `customer telegram ${r.code ?? ''} ${r.desc}`.slice(0, 200);
      }
      if (['booking_created','booking_reminder','booking_cancelled','booking_rescheduled','booking_followup'].includes(j.kind)) {
        try {
          const when = new Intl.DateTimeFormat('ru-RU', {
            timeZone: t.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          }).format(new Date(bk.starts_at));
          const token = typeof payload.token === 'string' ? payload.token : '';
          delivered += await sendPush(admin, j,
            j.kind === 'booking_cancelled' ? 'Запись отменена' : j.kind === 'booking_rescheduled' ? 'Запись перенесена' : 'Напоминание о записи',
            `${svc?.name ?? ''} - ${when}`, `${siteUrl()}/s/${t.slug}/booking#t=${token}`);
        } catch (e) {
          console.error('booking push failed:', redact(String((e as Error).message)));
        }
      }
      if (clientDelivered && j.kind === 'booking_cancelled') {
        const { error: deleteError } = await admin.from('booking_telegram_links').delete()
          .eq('tenant_id', j.tenant_id).eq('booking_id', j.booking_id);
        if (deleteError) throw deleteError;
      }
      delivered += Number(clientDelivered);
      if (failure === null && delivered === 0 && j.kind !== 'booking_followup') failure = 'no_reachable_channel';
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
