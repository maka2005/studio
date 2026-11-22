import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, Route } from '@playwright/test';

/** All external traffic of the booking funnel is stubbed: no real Supabase writes. */
export const SLUG = 'graphite';
export const TIME_ZONE = 'Asia/Aqtobe';
export const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
export const SECOND_SERVICE_ID = '22222222-2222-4222-8222-222222222222';
export const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
export const SECOND_BOOKING_ID = '55555555-5555-4555-8555-555555555555';
export const WAITLIST_ID = '44444444-4444-4444-8444-444444444444';
export const BOOKING_TOKEN = 'c'.repeat(32);
export const WAITLIST_TOKEN = 'a'.repeat(32);
export const OFFER_TOKEN = 'b'.repeat(32);
export const ARCHIVED_TOKEN = 'd'.repeat(32);
const DONE_BOOKING_ID = '66666666-6666-4666-8666-666666666666';
const CANCELLED_BOOKING_ID = '77777777-7777-4777-8777-777777777777';

type MockService = {
  id: string;
  name: string;
  category: string;
  price_cents: number;
  duration_minutes: number;
  active: boolean;
};

const SERVICE: MockService = {
  id: SERVICE_ID,
  name: 'Тестовая услуга',
  category: 'Мойка',
  price_cents: 5000,
  duration_minutes: 60,
  active: true,
};

const SECOND_SERVICE: MockService = {
  id: SECOND_SERVICE_ID,
  name: 'Вторая услуга',
  category: 'Детейлинг',
  price_cents: 3000,
  duration_minutes: 30,
  active: true,
};

const SERVICES: Record<string, MockService> = {
  [SERVICE_ID]: SERVICE,
  [SECOND_SERVICE_ID]: SECOND_SERVICE,
};

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-max-age': '600',
};

type JsonObject = Record<string, unknown>;

type MockOptions = {
  /** false — показать лист ожидания вместо свободных слотов. */
  freeSlots?: boolean;
  /** true — добавить прошедшую и отменённую записи для проверки архива. */
  history?: boolean;
  /** true — вернувшийся клиент, Telegram уже подключён на прежней записи. */
  telegramConnected?: boolean;
};

type MockHandle = {
  day: string;
  firstSlot: string;
  secondSlot: string;
};

const readBody = (route: Route): JsonObject => {
  try {
    const raw = route.request().postData() ?? '';
    return raw ? (JSON.parse(raw) as JsonObject) : {};
  } catch {
    return {};
  }
};

const respondJson = (route: Route, payload: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  });

const respondPreflight = (route: Route) => route.fulfill({ status: 204, headers: CORS_HEADERS });

const addMinutes = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

const partsInZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

/** Calendar day inside the tenant timezone, e.g. 2026-11-21. */
export const dayInZone = (date = new Date(), timeZone = TIME_ZONE) => {
  const parts = partsInZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(
    2,
    '0',
  )}`;
};

/** ISO instant for a wall-clock time in the tenant timezone. */
export const isoInZone = (day: string, hhmm: string, timeZone = TIME_ZONE) => {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0, 0);
  const local = partsInZone(new Date(wall), timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return new Date(wall - (asUtc - wall)).toISOString();
};

/**
 * Registers request stubs for one page. Must be called before page.goto().
 * Tenant config deliberately falls back to the static /tenants/graphite.json.
 */
export async function mockBookingFunnelApi(
  page: Page,
  { freeSlots = true, history = false, telegramConnected = false }: MockOptions = {},
): Promise<MockHandle> {
  // Мок должен оставаться в будущем: прошедшие записи теперь уходят в архив.
  const today = dayInZone();
  const day =
    Date.parse(isoInZone(today, '10:00')) > Date.now() + 60_000
      ? today
      : dayInZone(new Date(Date.now() + 24 * 60 * 60_000));
  const firstSlot = isoInZone(day, '10:00');
  const secondSlot = isoInZone(day, '11:00');
  const state = {
    start: firstSlot,
    cancelled: false,
    waitlistClaimed: false,
    serviceIds: [SERVICE_ID] as string[],
  };

  /** Bookings of one visit, chained in the order the client selected services. */
  const visitRows = () => {
    let cursor = state.start;
    return state.serviceIds.map((id, index) => {
      const service = SERVICES[id] ?? SERVICE;
      const starts_at = cursor;
      const ends_at = addMinutes(starts_at, service.duration_minutes);
      cursor = ends_at;
      return {
        id: index === 0 ? BOOKING_ID : SECOND_BOOKING_ID,
        booking_id: index === 0 ? BOOKING_ID : SECOND_BOOKING_ID,
        tenant_slug: SLUG,
        service_name: service.name,
        service_id: id,
        starts_at,
        ends_at,
        price_cents: service.price_cents,
        status: state.cancelled ? 'cancelled' : 'booked',
        customer_name: 'Тест',
        customer_phone: '+77771234567',
        car: 'Toyota Camry',
        can_cancel: true,
        can_reschedule: true,
        cancel_hours: 24,
        reschedule_hours: 2,
        reviewed: false,
        token: BOOKING_TOKEN,
      };
    });
  };

  /** Older visits of the same device: a completed one and a cancelled one. */
  const archivedRows = () => {
    const doneStart = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const cancelledStart = addMinutes(new Date().toISOString(), 24 * 60);
    const base = {
      tenant_slug: SLUG,
      customer_name: 'Тест',
      customer_phone: '+77771234567',
      car: 'Toyota Camry',
      can_cancel: false,
      can_reschedule: false,
      cancel_hours: 24,
      reschedule_hours: 2,
      reviewed: false,
      token: ARCHIVED_TOKEN,
    };
    return [
      {
        ...base,
        id: DONE_BOOKING_ID,
        booking_id: DONE_BOOKING_ID,
        service_name: 'Прошлая услуга',
        service_id: SECOND_SERVICE_ID,
        starts_at: doneStart,
        ends_at: addMinutes(doneStart, 30),
        price_cents: SECOND_SERVICE.price_cents,
        status: 'done',
      },
      {
        ...base,
        id: CANCELLED_BOOKING_ID,
        booking_id: CANCELLED_BOOKING_ID,
        service_name: 'Отменённая услуга',
        service_id: SERVICE_ID,
        starts_at: cancelledStart,
        ends_at: addMinutes(cancelledStart, 60),
        price_cents: SERVICE.price_cents,
        status: 'cancelled',
      },
    ];
  };

  if (history) {
    await page.addInitScript(
      ([slug, token]) => {
        try {
          const key = `bookings:${slug}`;
          const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
          const list = Array.isArray(parsed)
            ? parsed.filter((x): x is string => typeof x === 'string')
            : [];
          if (!list.includes(token)) list.push(token);
          localStorage.setItem(key, JSON.stringify(list));
        } catch {
          /* localStorage может быть недоступен */
        }
      },
      [SLUG, ARCHIVED_TOKEN],
    );
  }

  const booking = () => visitRows()[0]!;

  const waitlistItem = () => ({
    id: WAITLIST_ID,
    service_name: SERVICE.name,
    service_id: SERVICE_ID,
    preferred_day: day,
    status: state.waitlistClaimed ? 'claimed' : 'offered',
    created_at: new Date().toISOString(),
    offer: state.waitlistClaimed
      ? null
      : {
          slot: firstSlot,
          expires_at: addMinutes(new Date().toISOString(), 24 * 60),
          offer_token: OFFER_TOKEN,
        },
  });

  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return respondPreflight(route);
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/tenants')) {
      if (!telegramConnected) {
        // data:null makes loadBusiness() use /tenants/graphite.json.
        return respondJson(route, null);
      }
      const config = JSON.parse(
        readFileSync(resolve(process.cwd(), 'tenants/graphite/business.json'), 'utf8'),
      ) as JsonObject;
      config.client_telegram_enabled = true;
      return respondJson(route, { config });
    }
    if (url.pathname.endsWith('/services')) return respondJson(route, [SERVICE, SECOND_SERVICE]);
    return respondJson(route, []);
  });

  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return respondPreflight(route);
    return respondJson(route, {});
  });

  await page.route('**/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return respondPreflight(route);
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/booking-create')) {
      const body = readBody(route);
      const start = typeof body.start === 'string' ? body.start : firstSlot;
      const requested = Array.isArray(body.services)
        ? body.services.filter(
            (item): item is string => typeof item === 'string' && !!SERVICES[item],
          )
        : typeof body.service === 'string'
          ? [body.service]
          : [];
      state.serviceIds = requested.length ? requested.slice(0, 3) : [SERVICE_ID];
      state.start = start;
      state.cancelled = false;
      const rows = visitRows().map((row) => ({
        booking_id: row.booking_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        price_cents: row.price_cents,
        discount_cents: 0,
        promo_code: null,
      }));
      return respondJson(route, { booking: rows[0], bookings: rows });
    }
    if (!url.pathname.endsWith('/public-api')) return respondJson(route, { ok: true });

    const body = readBody(route);
    switch (body.action) {
      case 'booking_status':
        return respondJson(route, { open: true });
      case 'slots':
        return respondJson(route, {
          slots: freeSlots
            ? [
                { slot: firstSlot, free: true },
                { slot: secondSlot, free: true },
              ]
            : [{ slot: firstSlot, free: false }],
        });
      case 'booking_read':
        return respondJson(route, { booking: booking() });
      case 'bookings_read':
        return respondJson(route, {
          bookings: history ? [...visitRows(), ...archivedRows()] : visitRows(),
        });
      case 'booking_reschedule': {
        const start = typeof body.start === 'string' ? body.start : secondSlot;
        state.start = start;
        const result = { ok: true, starts_at: start, ends_at: addMinutes(start, 60) };
        return respondJson(route, { ...result, booking: { ...booking(), ...result } });
      }
      case 'booking_cancel':
        state.cancelled = true;
        return respondJson(route, { ok: true });
      case 'waitlist':
        return respondJson(route, { ok: true, token: WAITLIST_TOKEN, id: WAITLIST_ID });
      case 'waitlist_read': {
        const item = waitlistItem();
        return respondJson(route, { item, waitlist: item });
      }
      case 'waitlist_cancel':
        return respondJson(route, { ok: true });
      case 'waitlist_claim':
        state.start = firstSlot;
        state.cancelled = false;
        state.waitlistClaimed = true;
        return respondJson(route, {
          ok: true,
          booking: {
            token: BOOKING_TOKEN,
            booking_id: BOOKING_ID,
            starts_at: firstSlot,
            ends_at: addMinutes(firstSlot, 60),
            service_id: SERVICE_ID,
          },
        });
      case 'push_subscribe':
        return respondJson(route, { ok: true });
      case 'customer_telegram_status':
        return respondJson(route, { connected: telegramConnected });
      case 'customer_telegram_link':
        return respondJson(route, { code: null });
      default:
        return respondJson(route, { ok: true });
    }
  });

  // Optional owner RPC used by the public home page for reviews; preview has no API route.
  await page.route(/\/api\/owner\?action=published_reviews/, (route) => respondJson(route, []));

  return { day, firstSlot, secondSlot };
}
