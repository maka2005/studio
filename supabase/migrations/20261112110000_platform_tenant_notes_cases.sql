create table if not exists public.platform_tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 3000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_tenant_notes_tenant_created_idx
  on public.platform_tenant_notes (tenant_id, created_at desc);

create table if not exists public.platform_tenant_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  subject text not null check (char_length(subject) between 3 and 200),
  category text not null check (category in ('support','billing','technical','other')),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_by_email text not null,
  updated_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_tenant_cases_tenant_updated_idx
  on public.platform_tenant_cases (tenant_id, updated_at desc);

create table if not exists public.platform_tenant_case_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  case_id uuid not null references public.platform_tenant_cases(id) on delete restrict,
  event_type text not null check (event_type in ('created','updated','message')),
  message text check (message is null or char_length(message) <= 3000),
  status text not null check (status in ('open','in_progress','resolved')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_tenant_case_events_tenant_case_created_idx
  on public.platform_tenant_case_events (tenant_id, case_id, created_at desc);

alter table public.platform_tenant_notes enable row level security;
alter table public.platform_tenant_cases enable row level security;
alter table public.platform_tenant_case_events enable row level security;

revoke all on public.platform_tenant_notes, public.platform_tenant_cases, public.platform_tenant_case_events from public, anon, authenticated;
grant all on public.platform_tenant_notes, public.platform_tenant_cases, public.platform_tenant_case_events to service_role;
