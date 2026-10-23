import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { Shell } from './pages/Shell';
import { Home } from './pages/Home';
import { ServicesPage } from './pages/ServiceList';
import { MyBooking } from './pages/MyBooking';
import { Owner } from './pages/Owner';
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={new QueryClient()}><BrowserRouter>
    <Routes><Route path="/s/:slug" element={<Shell />}>
      <Route index element={<Home />} /><Route path="services" element={<ServicesPage />} /><Route path="booking" element={<MyBooking />} />
      <Route path="owner/*" element={<Owner />} /></Route></Routes>
  </BrowserRouter></QueryClientProvider></StrictMode>);
