-- Уведомления владельцу: очередь (outbox) с повторами, привязка Telegram-чатов, триггеры на события записи.
create table notification_jobs(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind text not null check (kind in ('booking_created','booking_cancelled')),
  booking_id uuid,
  dedupe_key text not null unique,                       -- одно событие = одно уведомление
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz);
create index notification_jobs_pending on notification_jobs(run_after) where status = 'pending';
create table telegram_links(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  chat_id bigint not null, created_at timestamptz not null default now(),
  unique(tenant_id, chat_id));
create table telegram_link_codes(
  code text primary key, tenant_id uuid not null references tenants on delete cascade,
  expires_at timestamptz not null, used bool not null default false);
alter table notification_jobs enable row level security; alter table telegram_links enable row level security; alter table telegram_link_codes enable row level security;
revoke all on notification_jobs, telegram_links, telegram_link_codes from anon, authenticated;

-- События. Запись, внесённая сотрудником (consent_version = 'staff'), и отмена самим владельцем уведомлений не создают.
create function enqueue_booking_job() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.consent_version, '') <> 'staff' then
      insert into notification_jobs(tenant_id, kind, booking_id, dedupe_key)
      values (new.tenant_id, 'booking_created', new.id, 'created:' || new.id) on conflict (dedupe_key) do nothing;
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    if not (auth.uid() is not null and is_member(new.tenant_id)) then
      insert into notification_jobs(tenant_id, kind, booking_id, dedupe_key)
      values (new.tenant_id, 'booking_cancelled', new.id, 'cancelled:' || new.id) on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger bookings_notify_ins after insert on bookings for each row execute function enqueue_booking_job();
create trigger bookings_notify_upd after update of status on bookings for each row execute function enqueue_booking_job();

-- Выдача заданий воркеру с арендой (lease): два воркера не возьмут одно задание.
create function lease_notification_jobs(p_limit int)
returns table(id uuid, tenant_id uuid, kind text, booking_id uuid, attempts int)
language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
begin
  delete from notification_jobs where status = 'sent' and created_at < now() - interval '30 days';
  return query
  with c as (select j.id from notification_jobs j
             where j.status = 'pending' and j.run_after <= now() and (j.lease_until is null or j.lease_until < now())
             order by j.created_at limit p_limit for update skip locked)
  update notification_jobs n set lease_until = now() + interval '2 minutes', attempts = n.attempts + 1
  from c where n.id = c.id
  returning n.id, n.tenant_id, n.kind, n.booking_id, n.attempts;
end $$;

create function finish_notification_job(p_id uuid, p_ok boolean, p_error text) returns void language plpgsql security definer set search_path=public as $$
declare a int;
begin
  select attempts into a from notification_jobs where id = p_id;
  if p_ok then
    update notification_jobs set status = 'sent', sent_at = now(), lease_until = null, last_error = null where id = p_id;
  elsif a >= 8 then
    update notification_jobs set status = 'failed', lease_until = null, last_error = left(p_error, 300) where id = p_id;
  else
    update notification_jobs set run_after = now() + make_interval(mins => least(power(2, a)::int, 60)), lease_until = null, last_error = left(p_error, 300) where id = p_id;
  end if;
end $$;

-- Привязка чата: владелец получает одноразовый код, бот принимает его в /start.
create function owner_telegram_code(p_slug text) returns text language plpgsql security definer set search_path=public, extensions as $$
declare t uuid; c text;
begin
  t := owner_tenant(p_slug);
  delete from telegram_link_codes where tenant_id = t and (used or expires_at < now());
  -- Repeated clicks/retries reuse the current code instead of consuming one of five slots.
  select code into c from telegram_link_codes
    where tenant_id = t and not used and expires_at > now()
    order by expires_at desc limit 1;
  if c is not null then return c; end if;
  if (select count(*) from telegram_link_codes where tenant_id = t) >= 5 then raise exception 'rate_limited'; end if;
  c := encode(gen_random_bytes(12), 'hex');
  insert into telegram_link_codes(code, tenant_id, expires_at) values (c, t, now() + interval '15 minutes');
  return c;
end $$;
create function owner_telegram_links(p_slug text) returns table(id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
#variable_conflict use_column
declare t uuid;
begin
  t := owner_tenant(p_slug);
  return query select l.id, l.created_at from telegram_links l where l.tenant_id = t order by l.created_at;
end $$;
create function owner_telegram_unlink(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  select tenant_id into t from telegram_links where id = p_id;
  if t is null or not is_member(t) then raise exception 'forbidden'; end if;
  delete from telegram_links where id = p_id;
end $$;
create function telegram_link_consume(p_code text, p_chat bigint) returns text language plpgsql security definer set search_path=public as $$
declare c telegram_link_codes; n text;
begin
  select * into c from telegram_link_codes where code = p_code and not used and expires_at > now() for update;
  if not found then return null; end if;
  insert into telegram_links(tenant_id, chat_id) values (c.tenant_id, p_chat) on conflict (tenant_id, chat_id) do nothing;
  update telegram_link_codes set used = true where code = p_code;
  select coalesce(config->>'name', slug) into n from tenants where id = c.tenant_id;
  return n;
end $$;
create function telegram_unlink_chat(p_chat bigint) returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  delete from telegram_links where chat_id = p_chat; get diagnostics n = row_count; return n;
end $$;

revoke all on function enqueue_booking_job, lease_notification_jobs, finish_notification_job, owner_telegram_code, owner_telegram_links,
  owner_telegram_unlink, telegram_link_consume, telegram_unlink_chat from public, anon, authenticated;
grant execute on function lease_notification_jobs, finish_notification_job, telegram_link_consume, telegram_unlink_chat to service_role;
grant execute on function owner_telegram_code, owner_telegram_links, owner_telegram_unlink to authenticated;
