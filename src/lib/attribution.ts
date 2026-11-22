/**
 * Атрибуция рекламных каналов для воронки Renvio.
 *
 * UTM читается один раз на первом заходе и хранится в localStorage 30 дней:
 * внутренние переходы по сайту не должны терять источник, а cookie не нужны
 * (политика конфиденциальности маркетингового сайта их не использует).
 */

export interface Attribution {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  landingPath: string;
  capturedAt: string;
}

const KEY = 'studio-attribution';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY: Attribution = {
  source: 'direct',
  medium: '',
  campaign: '',
  content: '',
  term: '',
  landingPath: '',
  capturedAt: '',
};

const clean = (value: string | null, max = 80): string => {
  const v = (value ?? '').trim().slice(0, max);
  return /^[\w\s\u0400-\u04FF.\-/]+$/.test(v) ? v : '';
};

function read(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Attribution>;
    const capturedAt = typeof parsed.capturedAt === 'string' ? parsed.capturedAt : '';
    if (!capturedAt || Date.now() - Date.parse(capturedAt) > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { ...EMPTY, ...parsed, capturedAt };
  } catch {
    return null;
  }
}

function referrerSource(): string {
  try {
    if (!document.referrer) return 'direct';
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin) return 'direct';
    return ref.hostname.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || 'referral';
  } catch {
    return 'direct';
  }
}

/** Вызывается один раз при старте приложения, до рендера. */
export function captureAttribution(): Attribution {
  let current: Attribution | null = null;
  try {
    const q = new URLSearchParams(window.location.search);
    const values = {
      source: clean(q.get('utm_source'), 40).toLowerCase(),
      medium: clean(q.get('utm_medium')),
      campaign: clean(q.get('utm_campaign')),
      content: clean(q.get('utm_content')),
      term: clean(q.get('utm_term')),
    };
    current = read();
    const hasUtm = Object.values(values).some(Boolean);
    if (!hasUtm && current) return current;
    if (!hasUtm) {
      current = { ...EMPTY, source: referrerSource(), capturedAt: new Date().toISOString() };
    } else {
      current = {
        ...EMPTY,
        ...values,
        source: values.source || referrerSource(),
        landingPath: window.location.pathname.slice(0, 200),
        capturedAt: new Date().toISOString(),
      };
    }
    localStorage.setItem(KEY, JSON.stringify(current));
    return current;
  } catch {
    return current ?? { ...EMPTY, capturedAt: new Date().toISOString() };
  }
}

/** Текущая атрибуция для Forms/BookingFlow. */
export function getAttribution(): Attribution {
  return read() ?? { ...EMPTY, source: referrerSource(), capturedAt: new Date().toISOString() };
}

/** Только whitelisted поля, которые уходят в заявку и событие воронки. */
export function attributionPayload() {
  const { source, medium, campaign, content, term } = getAttribution();
  return { source, medium, campaign, content, term };
}
