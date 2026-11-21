import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initObservability } from './lib/observability';
import { initLocale } from './lib/locale';

// A tab can outlive a Vercel deployment and keep importing chunks from the
// previous build. Reload once so Vite picks up the current HTML manifest.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'vite-preload-reload-at';
  const now = Date.now();
  const lastReload = Number(sessionStorage.getItem(key) ?? 0);
  if (now - lastReload > 30_000) {
    sessionStorage.setItem(key, String(now));
    window.location.reload();
    return;
  }
  const root = document.getElementById('root');
  if (!root) return;
  const panel = document.createElement('main');
  panel.className = 'page';
  const card = document.createElement('section');
  card.className = 'card col';
  const title = document.createElement('h1');
  title.textContent = 'Сайт обновился';
  const text = document.createElement('p');
  text.className = 'muted';
  text.textContent = 'Не удалось загрузить новую страницу. Нажмите кнопку, чтобы попробовать ещё раз.';
  const button = document.createElement('button');
  button.className = 'btn';
  button.textContent = 'Обновить страницу';
  button.onclick = () => window.location.reload();
  card.append(title, text, button);
  panel.append(card);
  root.replaceChildren(panel);
});

// После выпуска старая вкладка иногда запрашивает уже удалённый CSS кабинета.
// Один раз перезагружаем страницу, чтобы браузер получил свежий HTML и имена файлов.
window.addEventListener('error', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLLinkElement) || target.rel !== 'stylesheet') return;
  try {
    const path = new URL(target.href, window.location.href).pathname;
    if (!path.startsWith('/assets/')) return;
    const key = 'renvio-stale-style-reload-at';
    const previous = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - previous < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
    window.location.reload();
  } catch {
    // Private browsing can disable sessionStorage; the page still remains usable.
  }
}, true);

initObservability();
initLocale();

// Push-уведомления: service worker нужен только на защищённом происхождении.
// Регистрация после load и без блокировки рендера маркетинговой части.
const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return;
  const secure = window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!secure) return;
  void navigator.serviceWorker.register('/sw.js').catch(() => { /* SW может быть ещё не задеплоен */ });
};
if (document.readyState === 'complete') registerServiceWorker();
else window.addEventListener('load', registerServiceWorker, { once: true });

// Стили приложения записи (styles.css) подключаются только внутри Shell, админки и страницы статуса:
// их общие классы (.btn, .card, .hero, h1, body) иначе ломают вёрстку маркетингового сайта.
const Shell = lazy(() => import('./pages/Shell').then((m) => ({ default: m.Shell })));
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const ServicesPage = lazy(() => import('./pages/ServiceList').then((m) => ({ default: m.ServicesPage })));
const MyBooking = lazy(() => import('./pages/MyBooking').then((m) => ({ default: m.MyBooking })));
const WaitlistStatus = lazy(() => import('./pages/WaitlistStatus').then((m) => ({ default: m.WaitlistStatus })));
const Owner = lazy(() => import('./pages/Owner').then((m) => ({ default: m.Owner })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Install = lazy(() => import('./pages/Install').then((m) => ({ default: m.Install })));
const Legal = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Legal })));
const PlatformAdmin = lazy(() => import('./pages/PlatformAdmin').then((m) => ({ default: m.PlatformAdmin })));
const ServiceStatus = lazy(() => import('./pages/ServiceStatus').then((m) => ({ default: m.ServiceStatus })));
const Marketing = lazy(() => import('./marketing/App'));

// Единые правила кэша: данные считаются свежими 30 секунд и живут 5 минут без активных подписчиков.
// Это убирает лишние refetch при переключении вкладок, но оставляет проверку при явном запросе.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number; context?: Response })?.status
          ?? (error as { context?: Response })?.context?.status
        const message = String((error as Error)?.message ?? '')
        if (status === 401 || status === 429) return false
        if (/rate_limited|session_expired/i.test(message)) return false
        return failureCount < 1
      },
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div role="status" aria-busy="true" style={{ minHeight: '60vh' }} />}>
          <Routes>
            <Route path="/platform/admin" element={<PlatformAdmin />} />
            <Route path="/status" element={<ServiceStatus />} />
            <Route path="/s/:slug" element={<Shell />}>
              <Route index element={<Home />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="booking" element={<MyBooking />} />
              <Route path="waitlist" element={<WaitlistStatus />} />
              <Route path="waitlist/claim" element={<WaitlistStatus claimOnly />} />
              <Route path="profile" element={<Profile />} />
              <Route path="install" element={<Install />} />
              <Route path="legal/:doc" element={<Legal />} />
              <Route path="owner/*" element={<Owner />} />
            </Route>
            <Route path="/*" element={<Marketing />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
