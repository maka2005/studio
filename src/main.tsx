import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoadingScreen } from './components/LoadingScreen';
import './styles.css';
import { Shell } from './pages/Shell';

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

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const ServicesPage = lazy(() => import('./pages/ServiceList').then((m) => ({ default: m.ServicesPage })));
const MyBooking = lazy(() => import('./pages/MyBooking').then((m) => ({ default: m.MyBooking })));
const Owner = lazy(() => import('./pages/Owner').then((m) => ({ default: m.Owner })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Install = lazy(() => import('./pages/Install').then((m) => ({ default: m.Install })));
const Legal = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Legal })));
const PlatformAdmin = lazy(() => import('./pages/PlatformAdmin').then((m) => ({ default: m.PlatformAdmin })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient({
      defaultOptions: {
        queries: {
          retry: (failureCount, error) => {
            const status = (error as { status?: number; context?: Response })?.status
              ?? (error as { context?: Response })?.context?.status
            const message = String((error as Error)?.message ?? '')
            if (status === 401 || status === 429) return false
            if (/rate_limited|session_expired/i.test(message)) return false
            return failureCount < 1
          },
        },
      },
    })}>
      <BrowserRouter>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Navigate to={`/s/${import.meta.env.VITE_DEFAULT_SLUG ?? 'graphite'}/`} replace />} />
            <Route path="/platform/admin" element={<PlatformAdmin />} />
            <Route path="/s/:slug" element={<Shell />}>
              <Route index element={<Home />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="booking" element={<MyBooking />} />
              <Route path="profile" element={<Profile />} />
              <Route path="install" element={<Install />} />
              <Route path="legal/:doc" element={<Legal />} />
              <Route path="owner/*" element={<Owner />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
