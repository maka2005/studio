import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoadingScreen } from './components/LoadingScreen';
import './styles.css';
import { Shell } from './pages/Shell';
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const ServicesPage = lazy(() => import('./pages/ServiceList').then((m) => ({ default: m.ServicesPage })));
const MyBooking = lazy(() => import('./pages/MyBooking').then((m) => ({ default: m.MyBooking })));
const Owner = lazy(() => import('./pages/Owner').then((m) => ({ default: m.Owner })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Install = lazy(() => import('./pages/Install').then((m) => ({ default: m.Install })));
const Legal = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Legal })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Navigate to={`/s/${import.meta.env.VITE_DEFAULT_SLUG ?? 'graphite'}/`} replace />} />
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
