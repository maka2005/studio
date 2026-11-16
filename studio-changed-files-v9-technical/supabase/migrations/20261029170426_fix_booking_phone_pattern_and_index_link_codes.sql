-- Use a bracketed plus sign so this remains identical through SQL, JSON and
-- migration tooling escaping layers.
create or replace function public.create_booking(
  p_slug text, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_car text, p_key text, p_token text, p_consent text default null
)
returns table(booking_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public, extensions as $$
declare t tenants; s services; r record; b uuid; e timestamptz; occ_end timestamptz;
begin
  p_name := btrim(coalesce(p_name, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_car := btrim(coalesce(p_car, ''));
  if length(p_name) not between 1 and 80 then raise exception 'bad_name'; end if;
  if length(p_phone) not between 10 and 18 or p_phone !~ '^[+]?[0-9[:space:]()-]+$'
     or length(regexp_replace(p_phone, '[^0-9]', '', 'g')) not between 10 and 15 then raise exception 'bad_phone'; end if;
  if length(p_car) not between 2 and 60 then raise exception 'bad_car'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{16,128}$' then raise exception 'bad_idempotency_key'; end if;
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' then raise exception 'bad_token'; end if;
  if p_consent is null or length(trim(p_consent)) = 0 then raise exception 'consent_required'; end if;
  select * into t from tenants where slug=p_slug; if not found then raise exception 'tenant_not_found'; end if;
  select * into s from services where id=p_service and tenant_id=t.id and active; if not found then raise exception 'service_not_found'; end if;
  return query select x.id, x.resource_id, x.starts_at, x.ends_at from bookings x
    where x.tenant_id=t.id and x.idempotency_key=p_key;
  if found then return; end if;
  if p_start is null or p_start < now() then raise exception 'past_start'; end if;
  e := p_start + make_interval(mins => s.duration_minutes);
  occ_end := e + make_interval(mins => t.buffer_minutes);
  for r in select id from resources where tenant_id=t.id order by name loop
    begin
      b := gen_random_uuid();
      insert into bookings(id,tenant_id,service_id,resource_id,starts_at,ends_at,price_cents,duration_minutes,
        customer_name,customer_phone,car,token_hash,idempotency_key,consent_at,consent_version)
      values(b,t.id,s.id,r.id,p_start,e,s.price_cents,s.duration_minutes,p_name,p_phone,p_car,
        digest(p_token,'sha256'),p_key,now(),left(trim(p_consent),40));
      insert into resource_occupancies(tenant_id,resource_id,booking_id,kind,during)
      values(t.id,r.id,b,'booking',tstzrange(p_start,occ_end,'[)'));
      return query select b, r.id, p_start, e; return;
    exception when exclusion_violation then null;
    end;
  end loop;
  raise exception 'slot_taken';
end $$;

create index if not exists telegram_link_codes_tenant_idx on public.telegram_link_codes(tenant_id);
