-- Schedule management: exceptions/holidays, breaks in config, buffer/cancel/reschedule policy controls.

create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  is_closed boolean not null default true,
  hours jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint schedule_exceptions_range_chk check (date_to >= date_from),
  constraint schedule_exceptions_hours_chk check (
    (is_closed and hours is null) or
    (not is_closed and jsonb_typeof(hours) = 'array' and jsonb_array_length(hours) = 2)
  )
);

create index if not exists schedule_exceptions_tenant_range_idx
  on public.schedule_exceptions(tenant_id, date_from, date_to);

alter table public.schedule_exceptions enable row level security;
revoke all on public.schedule_exceptions from public, anon, authenticated;

drop policy if exists schedule_exceptions_owner_select on public.schedule_exceptions;
create policy schedule_exceptions_owner_select on public.schedule_exceptions
  for select to authenticated using (public.is_member(tenant_id));

-- Resolve effective hours for a specific date: exception overrides weekly hours.
-- Returns null when closed, or a jsonb array ["HH:MM","HH:MM"] for open hours.
create or replace function public.effective_day_hours(p_tenant_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t tenants;
  k text;
  base_hours jsonb;
  ex record;
begin
  select * into t from tenants where id = p_tenant_id;
  if not found then return null; end if;

  select * into ex
  from schedule_exceptions e
  where e.tenant_id = p_tenant_id and p_day between e.date_from and e.date_to
  order by e.is_closed desc, e.date_from desc, e.created_at desc
  limit 1;

  if found then
    if ex.is_closed then return null; end if;
    return ex.hours;
  end if;

  k := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_day)::int + 1];
  base_hours := t.config->'hours'->k;
  if base_hours is null or jsonb_typeof(base_hours) <> 'array' then return null; end if;
  return base_hours;
end $$;

revoke all on function public.effective_day_hours(uuid, date) from public, anon, authenticated;
grant execute on function public.effective_day_hours(uuid, date) to service_role;

-- Helper: is a start inside any configured break for that weekday/date window context?
-- Breaks are configured in tenant config as {"mon":[["13:00","14:00"]], ...} (local times).
create or replace function public.slot_in_break(p_tenant_id uuid, p_start timestamptz, p_service_minutes int)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t tenants;
  k text;
  b jsonb;
  item jsonb;
  b_start timestamptz;
  b_end timestamptz;
  local_day date;
begin
  select * into t from tenants where id = p_tenant_id;
  if not found then return false; end if;
  local_day := (p_start at time zone t.timezone)::date;
  k := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from local_day)::int + 1];
  b := t.config->'breaks'->k;
  if b is null or jsonb_typeof(b) <> 'array' then return false; end if;
  for item in select value from jsonb_array_elements(b)
  loop
    if jsonb_typeof(item) <> 'array' or jsonb_array_length(item) <> 2 then continue; end if;
    b_start := (local_day + (item->>0)::time)::timestamp at time zone t.timezone;
    b_end := (local_day + (item->>1)::time)::timestamp at time zone t.timezone;
    if b_end <= b_start then continue; end if;
    -- overlap between [slot, slot+duration) and [break_start, break_end)
    if tstzrange(p_start, p_start + make_interval(mins => p_service_minutes), '[)') &&
       tstzrange(b_start, b_end, '[)') then
      return true;
    end if;
  end loop;
  return false;
end $$;

revoke all on function public.slot_in_break(uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.slot_in_break(uuid, timestamptz, int) to service_role;

create or replace function public.get_slots(p_slug text, p_service uuid, p_day date)
returns table(slot timestamptz, free bool)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t tenants;
  s services;
  h jsonb;
  ts timestamptz;
  lim timestamptz;
  step int;
  window_minutes int;
  svc_end timestamptz;
  occ_end timestamptz;
begin
  select * into t from tenants where slug = p_slug;
  if not found then return; end if;
  select * into s from services where id = p_service and tenant_id = t.id and active;
  if not found then return; end if;

  h := public.effective_day_hours(t.id, p_day);
  if h is null or jsonb_typeof(h) <> 'array' then return; end if;

  step := greatest(5, coalesce((t.config->>'slot_minutes')::int, 60));
  ts  := (p_day + (h->>0)::time)::timestamp at time zone t.timezone;
  lim := (p_day + (h->>1)::time)::timestamp at time zone t.timezone;
  if lim <= ts then return; end if;
  window_minutes := floor(extract(epoch from (lim - ts)) / 60)::int;

  while ts + make_interval(mins => case when s.duration_minutes > window_minutes then step else s.duration_minutes end) <= lim loop
    svc_end := ts + make_interval(mins => s.duration_minutes);
    occ_end := svc_end + make_interval(mins => coalesce(t.buffer_minutes, 0));
    slot := ts;
    free := ts > now()
      and not public.slot_in_break(t.id, ts, s.duration_minutes)
      and exists(
        select 1 from resources r
        where r.tenant_id = t.id
          and not exists (
            select 1
            from resource_occupancies x
            where x.resource_id = r.id
              and x.during && tstzrange(ts, occ_end, '[)')
          )
      );
    return next;
    ts := ts + make_interval(mins => step);
  end loop;
end $$;

revoke all on function public.get_slots(text, uuid, date) from public;
grant execute on function public.get_slots(text, uuid, date) to anon, authenticated;

-- Owner schedule exceptions management
create or replace function public.owner_schedule_exceptions(p_slug text)
returns table(id uuid, date_from date, date_to date, is_closed boolean, hours jsonb, note text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  return query
    select e.id, e.date_from, e.date_to, e.is_closed, e.hours, e.note
    from schedule_exceptions e
    where e.tenant_id = t
    order by e.date_from desc, e.created_at desc;
end $$;

create or replace function public.owner_upsert_schedule_exception(
  p_slug text,
  p_id uuid,
  p_date_from date,
  p_date_to date,
  p_is_closed boolean,
  p_hours jsonb,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  v uuid;
  norm_hours jsonb;
begin
  t := owner_tenant(p_slug);
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'bad_range';
  end if;
  if coalesce(p_is_closed, true) then
    norm_hours := null;
  else
    if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 2 then
      raise exception 'bad_hours';
    end if;
    if (p_hours->>0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (p_hours->>1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'bad_hours';
    end if;
    if (p_hours->>1) <= (p_hours->>0) then raise exception 'bad_hours'; end if;
    norm_hours := jsonb_build_array(p_hours->>0, p_hours->>1);
  end if;

  if p_id is null then
    insert into schedule_exceptions(tenant_id, date_from, date_to, is_closed, hours, note)
    values (t, p_date_from, p_date_to, coalesce(p_is_closed, true), norm_hours, left(coalesce(p_note, ''), 120))
    returning id into v;
  else
    update schedule_exceptions
    set date_from = p_date_from,
        date_to = p_date_to,
        is_closed = coalesce(p_is_closed, true),
        hours = norm_hours,
        note = left(coalesce(p_note, ''), 120)
    where id = p_id and tenant_id = t
    returning id into v;
    if v is null then raise exception 'not_found'; end if;
  end if;
  return v;
end $$;

create or replace function public.owner_delete_schedule_exception(p_slug text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  delete from schedule_exceptions where id = p_id and tenant_id = t;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Allow owners to update buffer and scheduling policies (best-effort; later migrations may further redefine config RPC).
create or replace function public.owner_update_schedule_settings(p_slug text, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  b int;
  ch int;
  rh int;
  allowed boolean;
begin
  t := owner_tenant(p_slug);
  if p_patch ? 'buffer_minutes' then
    b := (p_patch->>'buffer_minutes')::int;
    if b is null or b < 0 or b > 240 then raise exception 'bad_config'; end if;
    update tenants set buffer_minutes = b where id = t;
  end if;
  if p_patch ? 'cancel_hours' then
    ch := (p_patch->>'cancel_hours')::int;
    if ch is null or ch < 0 or ch > 168 then raise exception 'bad_config'; end if;
  end if;
  if p_patch ? 'reschedule_hours' then
    rh := (p_patch->>'reschedule_hours')::int;
    if rh is null or rh < 0 or rh > 168 then raise exception 'bad_config'; end if;
  end if;
  if p_patch ? 'client_reschedule_enabled' then
    allowed := (p_patch->>'client_reschedule_enabled')::boolean;
  end if;

  update tenants
  set config = config
    || case when p_patch ? 'buffer_minutes' then jsonb_build_object('buffer_minutes', b) else '{}'::jsonb end
    || case when p_patch ? 'slot_minutes' then jsonb_build_object('slot_minutes', greatest(5, least(240, coalesce((p_patch->>'slot_minutes')::int, 60)))) else '{}'::jsonb end
    || case when p_patch ? 'cancel_hours' then jsonb_build_object('cancel_hours', ch) else '{}'::jsonb end
    || case when p_patch ? 'reschedule_hours' then jsonb_build_object('reschedule_hours', rh) else '{}'::jsonb end
    || case when p_patch ? 'client_reschedule_enabled' then jsonb_build_object('client_reschedule_enabled', allowed) else '{}'::jsonb end
    || case when p_patch ? 'breaks' then jsonb_build_object('breaks', p_patch->'breaks') else '{}'::jsonb end
  where id = t;
end $$;

revoke all on function public.owner_schedule_exceptions(text),
  public.owner_upsert_schedule_exception(text, uuid, date, date, boolean, jsonb, text),
  public.owner_delete_schedule_exception(text, uuid),
  public.owner_update_schedule_settings(text, jsonb) from public, anon;
grant execute on function public.owner_schedule_exceptions(text),
  public.owner_upsert_schedule_exception(text, uuid, date, date, boolean, jsonb, text),
  public.owner_delete_schedule_exception(text, uuid),
  public.owner_update_schedule_settings(text, jsonb) to authenticated;
