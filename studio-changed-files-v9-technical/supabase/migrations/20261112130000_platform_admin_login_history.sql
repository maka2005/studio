create table if not exists public.platform_admin_login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  ip_address inet,
  user_agent text,
  signed_in_at timestamptz not null default now()
);
create index if not exists platform_admin_login_events_user_time_idx
  on public.platform_admin_login_events(user_id,signed_in_at desc);
alter table public.platform_admin_login_events enable row level security;
revoke all on public.platform_admin_login_events from public,anon,authenticated;
grant all on public.platform_admin_login_events to service_role;
