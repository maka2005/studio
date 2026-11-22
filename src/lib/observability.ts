import { installCsrfFetchGuard } from './csrf';
import { attributionPayload } from './attribution';

export type FunnelEventName =
  | 'demo_start'
  | 'lead_submit'
  | 'connect'
  | 'payment_request'
  | 'payment_confirm'
  | 'first_booking';

const SESSION_KEY = 'studio-funnel-session';
const lastSent = new Map<string, number>();

export function getFunnelSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

/**
 * Событие воронки пишется в наш бэкенд — без зависимости от GA/блокировщиков и cookie.
 * GA/Яндекс намеренно не вызываются: политика сайта обещает не использовать
 * рекламные и аналитические cookie, а ключи аналитики сейчас не заданы.
 */
export function trackEvent(name: FunnelEventName, props: Record<string, string | number | boolean> = {}) {
  try {
    const key = `${name}:${Object.values(props).join(':')}`;
    const now = Date.now();
    if (now - (lastSent.get(key) ?? 0) < 3000) return;
    lastSent.set(key, now);
    void fetch('/api/platform?action=event', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, props, sessionId: getFunnelSessionId(), attribution: attributionPayload() }),
    }).catch(() => { /* аналитика не должна ломать форму */ });
  } catch {
    // Аналитика не должна ломать пользовательский сценарий.
  }
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    ym?: (...args: unknown[]) => void;
    Sentry?: { init: (opts: Record<string, unknown>) => void };
  }
}

function loadScript(src: string, attrs: Record<string, string> = {}) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

export function initObservability() {
  // Часть страниц отправляет POST в /api/owner и /api/platform напрямую: общий guard добавляет
  // x-csrf-token один раз на старте приложения, чтобы не держать токен в каждом обработчике.
  try {
    installCsrfFetchGuard();
  } catch {
    // Защита не должна ломать запуск приложения.
  }
  try {
    const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
    const ymId = import.meta.env.VITE_YANDEX_METRIKA_ID as string | undefined;
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

    if (gaId) {
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag(...args: unknown[]) { window.dataLayer!.push(args); };
      window.gtag('js', new Date());
      window.gtag('config', gaId, { anonymize_ip: true });
    }

    if (ymId) {
      // Yandex Metrika tag (minimal)
      (function(m: any,e: Document,t: string,r: string,i: string){
        m[i]=m[i]||function(...args: unknown[]){(m[i].a=m[i].a||[]).push(args)};
        m[i].l=1*Date.now();
        const k=e.createElement(t) as HTMLScriptElement, a=e.getElementsByTagName(t)[0];
        k.async=true; k.src=r; a?.parentNode?.insertBefore(k,a);
      })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
      window.ym?.(Number(ymId), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
    }

    if (sentryDsn) {
      loadScript('https://browser.sentry-cdn.com/8.45.1/bundle.tracing.replay.min.js', { crossorigin: 'anonymous' });
      const start = () => {
        if (window.Sentry) {
          window.Sentry.init({
            dsn: sentryDsn,
            environment: import.meta.env.MODE,
            tracesSampleRate: 0.1,
            replaysSessionSampleRate: 0,
            replaysOnErrorSampleRate: 0.1,
          });
        } else {
          setTimeout(start, 300);
        }
      };
      start();
    }
  } catch {
    // observability must never break app startup
  }
}
