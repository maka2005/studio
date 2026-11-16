create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create table tenants(
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  status text not null default 'preview' check (status in ('preview','live')),
  timezone text not null, config jsonb not null,
  buffer_minutes int not null default 15 check (buffer_minutes >= 0));
create table tenant_members(
  tenant_id uuid references tenants on delete cascade,
  user_id uuid references auth.users on delete cascade,
  primary key(tenant_id,user_id));
create table resources(
  id uuid default gen_random_uuid(), tenant_id uuid not null references tenants on delete cascade,
  name text not null, primary key(id), unique(tenant_id,id));
create table services(
  id uuid default gen_random_uuid(), tenant_id uuid not null references tenants on delete cascade,
  name text not null, price_cents int not null check (price_cents >= 0),
  duration_minutes int not null check (duration_minutes > 0), active bool not null default true,
  primary key(id), unique(tenant_id,id));
create table bookings(
  id uuid default gen_random_uuid(), tenant_id uuid not null,
  service_id uuid not null, resource_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  price_cents int not null,            -- историческая цена: снимок на момент записи
  duration_minutes int not null,
  status text not null default 'booked' check (status in ('booked','arrived','done','cancelled')),
  customer_name text not null check (length(customer_name) between 1 and 80),
  customer_phone text not null, car text not null,
  token_hash bytea not null, idempotency_key text not null,
  created_at timestamptz default now(),
  primary key(id), unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,service_id) references services(tenant_id,id),
  foreign key(tenant_id,resource_id) references resources(tenant_id,id));
-- единая занятость поста: и бронь, и блокировка
create table resource_occupancies(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  resource_id uuid not null, booking_id uuid, kind text not null check (kind in ('booking','block')),
  during tstzrange not null check (not isempty(during)),
  foreign key(tenant_id,resource_id) references resources(tenant_id,id),
  foreign key(tenant_id,booking_id) references bookings(tenant_id,id) on delete cascade,
  exclude using gist (resource_id with =, during with &&));
create table payments(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, booking_id uuid not null,
  amount_cents int not null check (amount_cents <> 0), kind text not null check (kind in ('payment','refund')),
  created_at timestamptz default now(),
  foreign key(tenant_id,booking_id) references bookings(tenant_id,id));

alter table tenants enable row level security;  alter table tenant_members enable row level security;
alter table resources enable row level security; alter table services enable row level security;
alter table bookings enable row level security;  alter table resource_occupancies enable row level security;
alter table payments enable row level security;
revoke all on all tables in schema public from anon, authenticated;
grant select on tenants, services to anon;
create policy pub_tenants on tenants for select to anon using (true);
create policy pub_services on services for select to anon using (active);
create function is_member(t uuid) returns bool language sql stable security definer set search_path=public as
$$ select exists(select 1 from tenant_members where tenant_id=t and user_id=auth.uid()) $$;
grant select on bookings, payments, resource_occupancies, resources to authenticated;
create policy own_b on bookings for select to authenticated using (is_member(tenant_id));
create policy own_p on payments for select to authenticated using (is_member(tenant_id));
create policy own_o on resource_occupancies for select to authenticated using (is_member(tenant_id));
create policy own_r on resources for select to authenticated using (is_member(tenant_id));

-- Атомарное создание. Цена, длительность и tenant берутся на сервере. Повтор по idempotency_key
-- возвращает ту же запись. В БД только sha256 токена доступа.
create function create_booking(p_slug text, p_service uuid, p_start timestamptz,
  p_name text, p_phone text, p_car text, p_key text, p_token text)
returns table(booking_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare t tenants; s services; r record; b uuid; e timestamptz; occ_end timestamptz;
begin
  select * into t from tenants where slug=p_slug; if not found then raise exception 'tenant_not_found'; end if;
  select * into s from services where id=p_service and tenant_id=t.id and active; if not found then raise exception 'service_not_found'; end if;
  return query select x.id, x.resource_id, x.starts_at, x.ends_at from bookings x
    where x.tenant_id=t.id and x.idempotency_key=p_key;
  if found then return; end if;
  if p_start < now() then raise exception 'past_start'; end if;
  e := p_start + make_interval(mins => s.duration_minutes);
  occ_end := e + make_interval(mins => t.buffer_minutes);
  for r in select id from resources where tenant_id=t.id order by name loop
    begin
      b := gen_random_uuid();
      insert into bookings(id,tenant_id,service_id,resource_id,starts_at,ends_at,price_cents,duration_minutes,
        customer_name,customer_phone,car,token_hash,idempotency_key)
      values(b,t.id,s.id,r.id,p_start,e,s.price_cents,s.duration_minutes,p_name,p_phone,p_car,
        digest(p_token,'sha256'),p_key);
      insert into resource_occupancies(tenant_id,resource_id,booking_id,kind,during)
      values(t.id,r.id,b,'booking',tstzrange(p_start,occ_end,'[)'));
      return query select b, r.id, p_start, e; return;
    exception when exclusion_violation then null;  -- откат подтранзакции (и брони), пробуем следующий пост
    end;
  end loop;
  raise exception 'slot_taken';
end $$;
revoke all on function create_booking from public; grant execute on function create_booking to anon, authenticated;
