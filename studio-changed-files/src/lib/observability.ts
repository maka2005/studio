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
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
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
