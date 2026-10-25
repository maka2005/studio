export type Kind = 'booking_created' | 'booking_cancelled';
export type Data = { kind: Kind; studio: string; service: string; startsAt: string; timezone: string; customer: string; phone: string; car: string; priceCents: number; currency: string };
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Все значения из базы экранируются: имя клиента не должно ломать разметку сообщения.
export function buildMessage(d: Data): string {
  const when = new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d.startsAt));
  const title = d.kind === 'booking_created' ? '🆕 Новая запись' : '❌ Клиент отменил запись';
  const price = `${(d.priceCents / 100).toLocaleString('ru-RU')} ${d.currency}`;
  return [`<b>${title}</b> · ${escapeHtml(d.studio)}`, `Услуга: ${escapeHtml(d.service)}`, `Когда: ${when}`,
    `Клиент: ${escapeHtml(d.customer)}, ${escapeHtml(d.phone)}`, `Авто: ${escapeHtml(d.car)}`, `Сумма: ${escapeHtml(price)}`].join('\n');
}
// Ошибки Telegram, после которых повторять бессмысленно: бот заблокирован или чата нет.
export const isDeadChat = (code: number | undefined, desc: string) => code === 403 || (code === 400 && /chat not found|user is deactivated/i.test(desc));
