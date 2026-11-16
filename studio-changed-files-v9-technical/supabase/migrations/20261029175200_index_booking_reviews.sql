create index if not exists booking_reviews_tenant_booking_idx
  on public.booking_reviews(tenant_id, booking_id);
