create table public.platform_impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users on delete restrict,
  tenant_id uuid not null references public.tenants on delete restrict,
  reason text not null check (length(reason) between 5 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > started_at)
);
create index platform_impersonation_active_idx on public.platform_impersonation_sessions(actor_id, expires_at desc)
  where ended_at is null;
alter table public.platform_impersonation_sessions enable row level security;
revoke all on public.platform_impersonation_sessions from public, anon, authenticated;
