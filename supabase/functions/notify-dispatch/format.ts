export type Kind = 'booking_created' | 'booking_cancelled' | 'booking_reminder' | 'booking_followup' | 'waitlist_interest' | 'booking_rescheduled' | 'waitlist_offer';
export type Data = { kind: Kind; studio: string; service: string; startsAt: string; timezone: string; customer: string; phone: string; car: string; priceCents: number; currency: string };
export type ClientData = {
  kind: Exclude<Kind, 'waitlist_interest'>;
  studio: string; service: string; startsAt: string; timezone: string; address: string;
  customMessage?: string | null; templateBody?: string | null;
};
export type WaitlistOfferData = {
  studio: string; service: string; slot: string; timezone: string;
  offerToken: string; slug?: string; token?: string;
};
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ALLOWED = ['studio', 'service', 'date', 'time', 'address', 'customer', 'phone', 'car', 'price'] as const;
type Placeholder = (typeof ALLOWED)[number];
export type TemplateVars = Record<Placeholder, string>;
const PLACEHOLDER_RE = new RegExp(`\\{(${ALLOWED.join('|')})\\}`, 'g');

/** Renders a saved template. Values are escaped, so customer text cannot inject markup. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return escapeHtml(body).replace(PLACEHOLDER_RE,
    (_match, key: Placeholder) => escapeHtml(vars[key] ?? ''));
}

const whenOf = (startsAt: string, timezone: string) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
}).format(new Date(startsAt));
const timeOf = (startsAt: string, timezone: string) => new Intl.DateTimeFormat('ru-RU', {
  timeZone: timezone, hour: '2-digit', minute: '2-digit',
}).format(new Date(startsAt));

export function templateVars(d: {
  studio: string; service: string; startsAt: string; timezone: string; address?: string;
  customer?: string; phone?: string; car?: string; priceCents?: number; currency?: string;
}): TemplateVars {
  return {
    studio: d.studio, service: d.service, date: whenOf(d.startsAt, d.timezone),
    time: timeOf(d.startsAt, d.timezone), address: d.address ?? '',
    customer: d.customer ?? '', phone: d.phone ?? '', car: d.car ?? '',
    price: `${((d.priceCents ?? 0) / 100).toLocaleString('ru-RU')} ${d.currency ?? ''}`.trim(),
  };
}

// Все значения из базы экранируются: имя клиента не должно ломать разметку сообщения.
export function buildMessage(d: Data): string {
  const when = whenOf(d.startsAt, d.timezone);
  const title = d.kind === 'booking_created' ? '🆕 Новая запись'
    : d.kind === 'booking_cancelled' ? '❌ Запись отменена'
      : d.kind === 'booking_rescheduled' ? '🔄 Запись перенесена'
        : d.kind === 'waitlist_offer' ? '🎉 Освободилось время'
          : '⏰ Напоминание о записи';
  const price = `${(d.priceCents / 100).toLocaleString('ru-RU')} ${d.currency}`;
  return [`<b>${title}</b>`, `<b>${escapeHtml(d.studio)}</b>`, '',
    `🧽 <b>Услуга:</b> ${escapeHtml(d.service)}`, `📅 <b>Когда:</b> ${escapeHtml(when)}`,
    `👤 <b>Клиент:</b> ${escapeHtml(d.customer)}`, `📞 <b>Телефон:</b> ${escapeHtml(d.phone)}`,
    `🚘 <b>Автомобиль:</b> ${escapeHtml(d.car)}`, `💳 <b>Стоимость:</b> ${escapeHtml(price)}`].join('\n');
}

/** Owner-facing message rendered from a tenant template instead of the built-in text. */
export function buildOwnerTemplateMessage(body: string, d: Data): string {
  return renderTemplate(body, templateVars(d));
}

export function buildCustomerMessage(d: ClientData): string {
  const when = whenOf(d.startsAt, d.timezone);
  const heading = d.kind === 'booking_cancelled' ? '❌ Запись отменена'
    : d.kind === 'booking_followup' ? '✨ Пора запланировать следующий визит'
      : d.kind === 'booking_rescheduled' ? '🔄 Время вашей записи изменилось'
        : d.kind === 'booking_reminder' ? '⏰ Скоро ваш визит'
          : d.kind === 'waitlist_offer' ? '🎉 Освободилось время'
            : '✅ Вы записаны';
  const note = d.kind === 'booking_cancelled' ? 'Если хотите выбрать другое время, откройте сайт студии.'
    : d.kind === 'booking_followup' ? 'Будем рады видеть вас снова! Напишите студии, чтобы подобрать удобное время.'
      : d.kind === 'booking_rescheduled' ? 'Мы перенесли вашу запись. Новое время указано выше — сверьте его в кабинете.'
        : d.kind === 'booking_reminder' ? 'Ждём вас в студии. До встречи!'
          : d.kind === 'waitlist_offer' ? 'Нажмите «Занять время», чтобы подтвердить запись.'
            : 'Напомним о визите в выбранное студией время и сообщим, если запись изменится.';
  const vars = templateVars({ studio: d.studio, service: d.service, startsAt: d.startsAt, timezone: d.timezone, address: d.address });
  const message = d.templateBody?.trim() ? renderTemplate(d.templateBody, vars)
    : d.customMessage?.trim() ? renderTemplate(d.customMessage, vars)
      : escapeHtml(note);
  return [`<b>${heading}</b>`, `<b>${escapeHtml(d.studio)}</b>`, '',
    `🧽 <b>Услуга:</b> ${escapeHtml(d.service)}`, `📅 <b>Дата и время:</b> ${escapeHtml(when)}`,
    ...(d.address ? [`📍 <b>Адрес:</b> ${escapeHtml(d.address)}`] : []), '', message].join('\n');
}

/** Client message for a waitlist slot that just became available. */
export function buildWaitlistOfferMessage(d: WaitlistOfferData): string {
  const when = whenOf(d.slot, d.timezone);
  return [
    '<b>🎉 Освободилось время</b>', `<b>${escapeHtml(d.studio)}</b>`, '',
    `🧽 <b>Услуга:</b> ${escapeHtml(d.service)}`,
    `📅 <b>Дата и время:</b> ${escapeHtml(when)}`, '',
    'Нажмите «Занять время», чтобы забрать этот слот. Предложение действует 2 часа.',
  ].join('\n');
}

// Ошибки Telegram, после которых повторять бессмысленно: бот заблокирован или чата нет.
export const isDeadChat = (code: number | undefined, desc: string) => code === 403 || (code === 400 && /chat not found|user is deactivated/i.test(desc));
