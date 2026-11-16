-- Long detailing services can span multiple business days. Keep their starts
-- on the configured grid, while requiring shorter services to finish by closing.
create or replace function get_slots(p_slug text, p_service uuid, p_day date)
returns table(slot timestamptz, free bool) language plpgsql stable security definer set search_path=public as $$
declare t tenants; s services; h jsonb; k text; ts timestamptz; lim timestamptz; step int; window_minutes int;
begin
  select * into t from tenants where slug=p_slug; if not found then return; end if;
  select * into s from services where id=p_service and tenant_id=t.id and active; if not found then return; end if;
  k := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_day)::int + 1];
  h := t.config->'hours'->k;
  if h is null or jsonb_typeof(h) <> 'array' then return; end if;
  step := coalesce((t.config->>'slot_minutes')::int, 60);
  ts  := (p_day + (h->>0)::time)::timestamp at time zone t.timezone;
  lim := (p_day + (h->>1)::time)::timestamp at time zone t.timezone;
  window_minutes := floor(extract(epoch from (lim - ts)) / 60)::int;
  while ts + make_interval(mins => case when s.duration_minutes > window_minutes then step else s.duration_minutes end) <= lim loop
    slot := ts;
    free := ts > now() and exists(
      select 1 from resources r where r.tenant_id = t.id and not exists(
        select 1 from resource_occupancies x where x.resource_id = r.id
          and x.during && tstzrange(ts, ts + make_interval(mins => s.duration_minutes + t.buffer_minutes), '[)')));
    return next;
    ts := ts + make_interval(mins => step);
  end loop;
end $$;

revoke all on function get_slots(text, uuid, date) from public;
grant execute on function get_slots(text, uuid, date) to anon, authenticated;
