-- Apply only after the web frontend invokes booking-create. The RPC remains
-- private so the rate-limited Edge Function is the only public entry point.
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, text, text)
to service_role;

drop trigger if exists bookings_rate on public.bookings;
revoke all on function public.booking_rate() from public, anon, authenticated;
