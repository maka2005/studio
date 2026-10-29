create index if not exists bookings_done_tenant_phone_start_idx
  on public.bookings(tenant_id, customer_phone, starts_at)
  where status = 'done';

create function public.owner_repeat_stats(p_slug text, p_from date, p_to date)
returns table(
  completed_visits integer,
  unique_clients integer,
  returning_clients integer,
  returning_visits integer,
  average_check_cents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t uuid;
  tz text;
  start_at timestamptz;
  end_at timestamptz;
begin
  t := owner_tenant(p_slug);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad_range'; end if;
  select timezone into tz from public.tenants where id = t;
  start_at := p_from::timestamp at time zone tz;
  end_at := (p_to + 1)::timestamp at time zone tz;

  return query
  with completed as (
    select b.customer_phone, b.price_cents,
      exists (
        select 1 from public.bookings previous
        where previous.tenant_id = t
          and previous.customer_phone = b.customer_phone
          and previous.status = 'done'
          and previous.starts_at < b.starts_at
      ) as has_previous_visit
    from public.bookings b
    where b.tenant_id = t
      and b.status = 'done'
      and b.starts_at >= start_at
      and b.starts_at < end_at
  )
  select
    count(*)::integer,
    count(distinct c.customer_phone)::integer,
    count(distinct c.customer_phone) filter (where c.has_previous_visit)::integer,
    count(*) filter (where c.has_previous_visit)::integer,
    coalesce(round(avg(c.price_cents)), 0)::bigint
  from completed c;
end;
$$;

revoke all on function public.owner_repeat_stats(text, date, date) from public, anon;
grant execute on function public.owner_repeat_stats(text, date, date) to authenticated;
