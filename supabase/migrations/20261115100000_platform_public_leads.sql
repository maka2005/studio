create table if not exists public.platform_business_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  phone text not null check (char_length(phone) between 10 and 32),
  business_type text not null check (char_length(business_type) between 2 and 80),
  request_type text not null check (request_type in ('connect','demo')),
  plan text not null default '' check (char_length(plan) <= 40),
  comment text not null default '' check (char_length(comment) <= 2000),
  status text not null default 'new' check (status in ('new','contacted','converted','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.platform_business_leads enable row level security;
revoke all on public.platform_business_leads from public,anon,authenticated;
grant all on public.platform_business_leads to service_role;
create index if not exists platform_business_leads_queue_idx
  on public.platform_business_leads(status, created_at desc);
