import { withEdgeObservability } from '../_shared/observability.ts';
import { readTextBody, redact, safeEqual, WebhookError } from '../_shared/webhook_guard.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
const env = (k: string) => Deno.env.get(k) ?? '';
const ok = () => new Response('ok');
async function reply(chat: number, text: string) {
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(8000) }).catch(() => undefined);
}
// Webhook бота. Развёртывается с --no-verify-jwt: Telegram не умеет JWT, поэтому проверяем секрет вебхука.
Deno.serve(withEdgeObservability('telegram-webhook', async (req) => {
  if (req.method !== 'POST') return ok();
  const secret = env('TELEGRAM_WEBHOOK_SECRET');
  if (secret.length < 16 || !safeEqual(req.headers.get('x-telegram-bot-api-secret-token') || '', secret)) {
    return new Response('forbidden', { status: 403 });
  }

  let raw: string;
  try {
    raw = await readTextBody(req, 64 * 1024);
  } catch (error) {
    if (error instanceof WebhookError) return new Response('ok');
    return new Response('ok');
  }
  let u: any;
  try {
    u = JSON.parse(raw);
  } catch {
    return ok();
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const updateId = Number(u?.update_id);
  if (Number.isSafeInteger(updateId)) {
    const { data: fresh, error: ledgerError } = await admin.rpc('consume_webhook_event', {
      p_kind: 'telegram',
      p_event_id: String(updateId),
    });
    if (ledgerError) {
      console.error(JSON.stringify({ level: 'error', event: 'telegram_ledger_failed', error: redact(ledgerError.message) }));
      await admin.rpc('record_ops_alert', {
        p_source: 'telegram-webhook',
        p_level: 'error',
        p_message: 'Telegram replay ledger unavailable',
        p_details: { detail: redact(ledgerError.message, 200) },
      }).catch(() => undefined);
    } else if (fresh !== true) {
      return ok();
    }
  }

  const chat = u?.message?.chat; const text = String(u?.message?.text ?? '').trim();
  if (!chat || chat.type !== 'private' || typeof chat.id !== 'number') return ok();
  if (/^\/start\s+[0-9a-f]{16,64}$/i.test(text)) {
    const { data, error } = await admin.rpc('telegram_link_consume', { p_code: text.split(/\s+/)[1], p_chat: chat.id });
    if (error) {
      console.error('telegram_link_consume failed:', redact(error.message));
      await reply(chat.id, 'Не удалось подключить чат. Попробуйте позже или свяжитесь со студией.');
      return ok();
    }
    if (data) {
      await reply(chat.id, `🔔 Уведомления для студии «${data}» подключены.\n\nЧтобы отключить уведомления, отправьте /stop.`);
      return ok();
    }
    const { data: customer, error: customerError } = await admin.rpc('customer_telegram_link_consume', { p_code: text.split(/\s+/)[1], p_chat: chat.id });
    if (customerError) {
      console.error('customer_telegram_link_consume failed:', redact(customerError.message));
      await reply(chat.id, 'Не удалось подключить уведомления. Попробуйте ещё раз позже.');
      return ok();
    }
    if (customer) {
      const d = customer as { studio: string; service: string; starts_at: string; timezone: string; address: string; reminder_hours_before: number; repeat_consent: boolean };
      const when = new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d.starts_at));
      await reply(chat.id, `✅ Запись подключена\n\n🏁 ${d.studio}\n🧽 ${d.service}\n📅 ${when}${d.address ? `\n📍 ${d.address}` : ''}\n\nНапомним о визите за ${d.reminder_hours_before} ч. и сообщим, если запись изменится.${d.repeat_consent ? '\nТакже пришлём одно напоминание о повторном визите.' : ''}\nОтключить все уведомления: /stop`);
      return ok();
    }
    await reply(chat.id, 'Ссылка уже использована, устарела или запись больше не активна. Создайте новую ссылку на странице «Моя запись».');
  } else if (text === '/stop') {
    await admin.rpc('telegram_unlink_chat', { p_chat: chat.id });
    await reply(chat.id, 'Уведомления отключены.');
  } else {
    await reply(chat.id, 'Это бот уведомлений. Чтобы получать сообщения о записи, подключите Telegram на странице «Моя запись». Если вы владелец студии, подключите чат в кабинете студии.');
  }
  return ok();
}));
