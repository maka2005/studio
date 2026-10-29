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
      await reply(chat.id, 'Не удалось подключить чат из-за ошибки сервера. Проверьте миграции Supabase и попробуйте ещё раз.');
      return ok();
    }
    await reply(chat.id, data ? `Готово! Уведомления о записях «${data}» подключены. Отключить: /stop` : 'Код недействителен или истёк. Создайте новый в кабинете студии.');
  } else if (text === '/stop') {
    await admin.rpc('telegram_unlink_chat', { p_chat: chat.id });
    await reply(chat.id, 'Уведомления отключены.');
  } else {
    await reply(chat.id, 'Это бот уведомлений студии. Чтобы подключить его, откройте кабинет студии, вкладка «Уведомления», кнопка «Подключить Telegram».');
  }
  return ok();
});
