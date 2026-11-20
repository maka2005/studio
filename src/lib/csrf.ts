export type CsrfScope = 'owner' | 'platform';

// Должно совпадать с именами cookie в api/owner.js и api/platform.js.
const COOKIE_NAMES: Record<CsrfScope, string> = import.meta.env.PROD
  ? { owner: '__Host-studio_owner_csrf', platform: '__Host-platform_csrf' }
  : { owner: 'studio_owner_csrf', platform: 'platform_csrf' };
const MAX_AGE = 60 * 60 * 24 * 30;

export function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const item = part.trim();
    if (!item.startsWith(prefix)) continue;
    const value = item.slice(prefix.length);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

const randomToken = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // randomUUID доступен только в secure context; http://localhost — исключение, но fallback нужен для старых браузеров.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Возвращает double-submit токен из cookie. Если его ещё нет (первый логин, публичная форма
 * или истёкшая cookie), создаём его на клиенте — сервер всё равно сверяет заголовок с cookie.
 * `__Host-` в проде запрещает подмену cookie с поддомена; в dev префикс не нужен (http).
 */
export function getCsrfToken(scope: CsrfScope): string {
  const name = COOKIE_NAMES[scope];
  const existing = readCookie(name);
  if (existing) return existing;
  const token = randomToken();
  const secure = import.meta.env.PROD ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(token)}; Path=/; SameSite=Strict${secure}; Max-Age=${MAX_AGE}`;
  return readCookie(name) || token;
}

/** Заголовки для POST на /api/owner и /api/platform. */
export function csrfHeaders(scope: CsrfScope, headers?: HeadersInit): HeadersInit {
  const result = new Headers(headers);
  if (!result.has('x-csrf-token')) result.set('x-csrf-token', getCsrfToken(scope));
  return result;
}

export function csrfFetch(scope: CsrfScope, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const baseHeaders = init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
  return fetch(input, { ...init, headers: csrfHeaders(scope, baseHeaders) });
}

const apiScope = (url: string): CsrfScope | null => {
  const path = /^https?:\/\//i.test(url) ? new URL(url).pathname : url.split(/[?#]/, 1)[0];
  if (/^\/api\/owner(?:[/?]|$)/.test(path ?? '')) return 'owner';
  if (/^\/api\/platform(?:[/?]|$)/.test(path ?? '')) return 'platform';
  return null;
};

let guardInstalled = false;

/**
 * Страницы, которые шлют POST в API напрямую, не обязаны помнить про токен: guard ставит его
 * на все state-changing запросы к нашим API. Ставится один раз при старте приложения.
 */
export function installCsrfFetchGuard(): void {
  if (guardInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  guardInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const scope = apiScope(url);
    const method = String(init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!scope || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return originalFetch(input, init);
    }
    const requestHeaders = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
    const headers = new Headers(requestHeaders);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', getCsrfToken(scope));
    return originalFetch(input, { ...init, headers });
  }) as typeof fetch;
}
