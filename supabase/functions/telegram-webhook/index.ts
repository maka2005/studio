import { createClient } from 'npm:@supabase/supabase-js@2';
const env = (k: string) => Deno.env.get(k) ?? '';
const ok = () => new Response('ok');
async function reply(chat: number, text: string) {
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(8000) }).catch(() => undefined);
}
// Webhook бота. Развёртывается с --no-verify-jwt: Telegram не умеет JWT, поэтому проверяем секрет вебхука.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok();
  if (!env('TELEGRAM_WEBHOOK_SECRET') || req.headers.get('x-telegram-bot-api-secret-token') !== env('TELEGRAM_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 });
  const u = await req.json().catch(() => null);
  const chat = u?.message?.chat; const text = String(u?.message?.text ?? '').trim();
  if (!chat || chat.type !== 'private' || typeof chat.id !== 'number') return ok();
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  if (/^\/start\s+[0-9a-f]{16,64}$/i.test(text)) {
    const { data, error } = await admin.rpc('telegram_link_consume', { p_code: text.split(/\s+/)[1], p_chat: chat.id });
    if (error) {
      console.error('telegram_link_consume failed:', error.message);
      await reply(chat.id, 'Не удалось подключить чат. Попробуйте позже или свяжитесь со студией.');
      return ok();
    }
    if (data) {
      await reply(chat.id, `🔔 Уведомления для студии «${data}» подключены.\n\nЧтобы отключить уведомления, отправьте /stop.`);
      return ok();
    }
    const { data: customer, error: customerError } = await admin.rpc('customer_telegram_link_consume', { p_code: text.split(/\s+/)[1], p_chat: chat.id });
    if (customerError) {
      console.error('customer_telegram_link_consume failed:', customerError.message);
      await reply(chat.id, 'Не удалось подключить уведомления. Попробуйте ещё раз позже.');
      return ok();
    }
    if (customer) {
      const d = customer as { studio: string; service: string; starts_at: string; timezone: string; address: string };
      const when = new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d.starts_at));
      await reply(chat.id, `✅ Запись подключена\n\n🏁 ${d.studio}\n🧽 ${d.service}\n📅 ${when}${d.address ? `\n📍 ${d.address}` : ''}\n\nНапомним о визите за сутки и сообщим, если запись изменится. Отключить все уведомления: /stop`);
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
});
