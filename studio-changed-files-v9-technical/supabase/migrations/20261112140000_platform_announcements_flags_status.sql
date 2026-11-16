create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check(char_length(title) between 3 and 180),
  body text not null check(char_length(body) between 1 and 5000),
  audience text not null check(audience in ('all','selected')),
  tenant_ids uuid[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(audience='all' or cardinality(tenant_ids)>0),
  check(ends_at is null or ends_at>starts_at)
);
create index if not exists platform_announcements_active_idx on public.platform_announcements(is_active,starts_at desc);

create table if not exists public.platform_tenant_feature_flags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flag_key text not null check(flag_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  enabled boolean not null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key(tenant_id,flag_key)
);

create table if not exists public.platform_service_status (
  id integer primary key default 1 check(id=1),
  status text not null check(status in ('operational','degraded','outage','maintenance')),
  message text not null default '' check(char_length(message)<=2000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_service_status(id,status,message) values(1,'operational','Все системы работают штатно.')
  on conflict(id) do nothing;

alter table public.platform_announcements enable row level security;
alter table public.platform_tenant_feature_flags enable row level security;
alter table public.platform_service_status enable row level security;
revoke all on public.platform_announcements,public.platform_tenant_feature_flags,public.platform_service_status from public,anon,authenticated;
grant all on public.platform_announcements,public.platform_tenant_feature_flags,public.platform_service_status to service_role;
grant select on public.platform_service_status to anon,authenticated;
create policy platform_service_status_public_read on public.platform_service_status for select to anon,authenticated using(true);

create or replace function public.owner_platform_announcements(p_slug text)
returns setof public.platform_announcements language plpgsql stable security definer set search_path=public as $$
declare tenant uuid;
begin
  select t.id into tenant from public.tenants t join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=auth.uid();
  if tenant is null then raise exception 'forbidden'; end if;
  return query select a.* from public.platform_announcements a
    where a.is_active and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now())
      and (a.audience='all' or tenant=any(a.tenant_ids)) order by a.created_at desc limit 100;
end $$;
create or replace function public.owner_platform_feature_flags(p_slug text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare tenant uuid;
begin
  select t.id into tenant from public.tenants t join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=auth.uid();
  if tenant is null then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_object_agg(flag_key,enabled) from public.platform_tenant_feature_flags where tenant_id=tenant),'{}'::jsonb);
end $$;
revoke all on function public.owner_platform_announcements(text),public.owner_platform_feature_flags(text) from public,anon;
grant execute on function public.owner_platform_announcements(text),public.owner_platform_feature_flags(text) to authenticated;
