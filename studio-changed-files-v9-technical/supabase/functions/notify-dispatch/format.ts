export type Kind = 'booking_created' | 'booking_cancelled' | 'booking_reminder' | 'booking_followup' | 'waitlist_interest';
export type Data = { kind: Kind; studio: string; service: string; startsAt: string; timezone: string; customer: string; phone: string; car: string; priceCents: number; currency: string };
export type ClientData = { kind: Exclude<Kind, 'waitlist_interest'>; studio: string; service: string; startsAt: string; timezone: string; address: string; customMessage?: string | null };
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Все значения из базы экранируются: имя клиента не должно ломать разметку сообщения.
export function buildMessage(d: Data): string {
  const when = new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d.startsAt));
  const title = d.kind === 'booking_created' ? '🆕 Новая запись' : d.kind === 'booking_cancelled' ? '❌ Запись отменена' : '⏰ Напоминание о записи';
  const price = `${(d.priceCents / 100).toLocaleString('ru-RU')} ${d.currency}`;
  return [`<b>${title}</b>`, `<b>${escapeHtml(d.studio)}</b>`, '',
    `🧽 <b>Услуга:</b> ${escapeHtml(d.service)}`, `📅 <b>Когда:</b> ${escapeHtml(when)}`,
    `👤 <b>Клиент:</b> ${escapeHtml(d.customer)}`, `📞 <b>Телефон:</b> ${escapeHtml(d.phone)}`,
    `🚘 <b>Автомобиль:</b> ${escapeHtml(d.car)}`, `💳 <b>Стоимость:</b> ${escapeHtml(price)}`].join('\n');
}
export function buildCustomerMessage(d: ClientData): string {
  const when = new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d.startsAt));
  const heading = d.kind === 'booking_cancelled' ? '❌ Запись отменена'
    : d.kind === 'booking_followup' ? '✨ Пора запланировать следующий визит'
      : d.kind === 'booking_reminder' ? '⏰ Скоро ваш визит' : '✅ Вы записаны';
  const note = d.kind === 'booking_cancelled' ? 'Если хотите выбрать другое время, откройте сайт студии.'
    : d.kind === 'booking_followup' ? 'Будем рады видеть вас снова! Напишите студии, чтобы подобрать удобное время.'
      : d.kind === 'booking_reminder' ? 'Ждём вас в студии. До встречи!'
        : 'Напомним о визите в выбранное студией время и сообщим, если запись изменится.';
  const message = d.customMessage?.trim()
    ? escapeHtml(d.customMessage).replaceAll('{studio}', escapeHtml(d.studio)).replaceAll('{service}', escapeHtml(d.service))
      .replaceAll('{date}', escapeHtml(when)).replaceAll('{time}', escapeHtml(new Intl.DateTimeFormat('ru-RU', { timeZone: d.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(d.startsAt))))
      .replaceAll('{address}', escapeHtml(d.address))
    : escapeHtml(note);
  return [`<b>${heading}</b>`, `<b>${escapeHtml(d.studio)}</b>`, '',
    `🧽 <b>Услуга:</b> ${escapeHtml(d.service)}`, `📅 <b>Дата и время:</b> ${escapeHtml(when)}`,
    ...(d.address ? [`📍 <b>Адрес:</b> ${escapeHtml(d.address)}`] : []), '', message].join('\n');
}
// Ошибки Telegram, после которых повторять бессмысленно: бот заблокирован или чата нет.
export const isDeadChat = (code: number | undefined, desc: string) => code === 403 || (code === 400 && /chat not found|user is deactivated/i.test(desc));
