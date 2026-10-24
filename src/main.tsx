import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles.css'
import { Shell } from './pages/Shell'
import { Home } from './pages/Home'
import { ServicesPage } from './pages/ServiceList'
import { MyBooking } from './pages/MyBooking'
import { Owner } from './pages/Owner'
import { Profile } from './pages/Profile'
import { Install } from './pages/Install'
import { Legal } from './pages/Legal'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <Navigate to={`/s/${import.meta.env.VITE_DEFAULT_SLUG ?? 'graphite'}/`} replace />
            }
          />
          <Route path="/s/:slug" element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="booking" element={<MyBooking />} />
            <Route path="profile" element={<Profile />} />
            <Route path="install" element={<Install />} />
            <Route path="owner/*" element={<Owner />} />
            <Route path="legal/:doc" element={<Legal />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
