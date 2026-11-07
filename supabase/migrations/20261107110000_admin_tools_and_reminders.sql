-- Per-studio customer reminder and repeat-visit settings.
create table public.tenant_notification_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  reminder_hours_before smallint not null default 24 check (reminder_hours_before between 1 and 168),
  repeat_after_days smallint not null default 90 check (repeat_after_days between 7 and 365),
  reminder_message text check (reminder_message is null or char_length(reminder_message) <= 500),
  repeat_message text check (repeat_message is null or char_length(repeat_message) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.tenant_notification_settings enable row level security;
revoke all on public.tenant_notification_settings from public, anon, authenticated;

create function public.owner_notification_settings(p_slug text)
returns table(reminder_hours_before smallint, repeat_after_days smallint, reminder_message text, repeat_message text)
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  insert into public.tenant_notification_settings(tenant_id) values(t) on conflict(tenant_id) do nothing;
  return query select s.reminder_hours_before, s.repeat_after_days, s.reminder_message, s.repeat_message
    from public.tenant_notification_settings s where s.tenant_id=t;
end;
$$;

create function public.owner_update_notification_settings(
  p_slug text, p_reminder_hours smallint, p_repeat_days smallint, p_reminder_message text, p_repeat_message text
) returns void language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  if p_reminder_hours not between 1 and 168 or p_repeat_days not between 7 and 365
    or char_length(coalesce(p_reminder_message,'')) > 500 or char_length(coalesce(p_repeat_message,'')) > 500 then
    raise exception 'bad_notification_settings';
  end if;
  insert into public.tenant_notification_settings(tenant_id, reminder_hours_before, repeat_after_days, reminder_message, repeat_message, updated_at)
  values(t,p_reminder_hours,p_repeat_days,nullif(btrim(p_reminder_message),''),nullif(btrim(p_repeat_message),''),now())
  on conflict(tenant_id) do update set reminder_hours_before=excluded.reminder_hours_before,
    repeat_after_days=excluded.repeat_after_days, reminder_message=excluded.reminder_message,
    repeat_message=excluded.repeat_message, updated_at=now();
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(t,auth.uid(),'notifications',t,'settings_changed',jsonb_build_object('fields',jsonb_build_array('reminder_hours_before','repeat_after_days','reminder_message','repeat_message')));
end;
$$;

-- The current scheduler treats one resource as one independently bookable calendar (staff member or work post).
create function public.owner_upsert_resource(p_slug text, p_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid; v uuid;
begin
  t := owner_tenant(p_slug);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then raise exception 'bad_resource'; end if;
  if exists(select 1 from public.resources r where r.tenant_id=t and lower(r.name)=lower(btrim(p_name)) and r.id is distinct from p_id) then
    raise exception 'duplicate_resource';
  end if;
  if p_id is null then
    insert into public.resources(tenant_id,name) values(t,btrim(p_name)) returning id into v;
  else
    update public.resources set name=btrim(p_name) where id=p_id and tenant_id=t returning id into v;
    if v is null then raise exception 'not_found'; end if;
  end if;
  return v;
end;
$$;

create function public.owner_delete_resource(p_slug text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  t := owner_tenant(p_slug);
  if not exists(select 1 from public.resources where id=p_id and tenant_id=t) then raise exception 'not_found'; end if;
  if exists(select 1 from public.bookings where tenant_id=t and resource_id=p_id)
    or exists(select 1 from public.resource_occupancies where tenant_id=t and resource_id=p_id) then raise exception 'resource_in_use'; end if;
  delete from public.resources where id=p_id and tenant_id=t;
end;
$$;

-- Auditing stores only operational changes; no customer names, phones, or car details are copied.
create table public.admin_audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid,
  entity text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_events_tenant_created_idx on public.admin_audit_events(tenant_id, created_at desc, id desc);
alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from public, anon, authenticated;

create function public.audit_booking_change() returns trigger language plpgsql security definer set search_path=public as $$
declare changed jsonb := '{}'::jsonb; t uuid; item uuid; act text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op='INSERT' then
    t:=new.tenant_id; item:=new.id; act:='created';
    changed:=jsonb_build_object('status',new.status,'starts_at',new.starts_at,'service_id',new.service_id,'resource_id',new.resource_id);
  elsif tg_op='UPDATE' then
    if old.status is not distinct from new.status and old.starts_at is not distinct from new.starts_at
      and old.service_id is not distinct from new.service_id and old.resource_id is not distinct from new.resource_id then return new; end if;
    t:=new.tenant_id; item:=new.id; act:='updated';
    changed:=jsonb_strip_nulls(jsonb_build_object(
      'status',case when old.status is distinct from new.status then jsonb_build_object('from',old.status,'to',new.status) end,
      'starts_at',case when old.starts_at is distinct from new.starts_at then jsonb_build_object('from',old.starts_at,'to',new.starts_at) end,
      'service_id',case when old.service_id is distinct from new.service_id then jsonb_build_object('from',old.service_id,'to',new.service_id) end,
      'resource_id',case when old.resource_id is distinct from new.resource_id then jsonb_build_object('from',old.resource_id,'to',new.resource_id) end));
  else return old; end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details) values(t,auth.uid(),'booking',item,act,changed);
  return new;
end;
$$;
create trigger admin_audit_bookings after insert or update on public.bookings for each row execute function public.audit_booking_change();

create function public.audit_service_change() returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb; t uuid; item uuid; act text;
begin
  if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then row_data:=to_jsonb(old); t:=old.tenant_id; item:=old.id; act:='deleted';
  elsif tg_op='INSERT' then row_data:=to_jsonb(new); t:=new.tenant_id; item:=new.id; act:='created';
  else row_data:=to_jsonb(new); t:=new.tenant_id; item:=new.id; act:='updated'; end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(t,auth.uid(),'service',item,act,jsonb_build_object('name',row_data->>'name','category',row_data->>'category','active',row_data->>'active','price_cents',row_data->>'price_cents'));
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger admin_audit_services after insert or update or delete on public.services for each row execute function public.audit_service_change();

create function public.audit_resource_change() returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb; t uuid; item uuid; act text;
begin
  if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then row_data:=to_jsonb(old); t:=old.tenant_id; item:=old.id; act:='deleted';
  elsif tg_op='INSERT' then row_data:=to_jsonb(new); t:=new.tenant_id; item:=new.id; act:='created';
  else row_data:=to_jsonb(new); t:=new.tenant_id; item:=new.id; act:='updated'; end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(t,auth.uid(),'resource',item,act,jsonb_build_object('name',row_data->>'name'));
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger admin_audit_resources after insert or update or delete on public.resources for each row execute function public.audit_resource_change();

create function public.audit_payment_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then
    insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
    values(new.tenant_id,auth.uid(),'payment',new.booking_id,new.kind,jsonb_build_object('amount_cents',new.amount_cents));
  end if;
  return new;
end;
$$;
create trigger admin_audit_payments after insert on public.payments for each row execute function public.audit_payment_change();

create function public.audit_tenant_config_change() returns trigger language plpgsql security definer set search_path=public as $$
declare changed_keys jsonb;
begin
  if auth.uid() is null or old.config is not distinct from new.config then return new; end if;
  select coalesce(jsonb_agg(k.key order by k.key),'[]'::jsonb) into changed_keys
  from (select key from jsonb_each(new.config) union select key from jsonb_each(old.config)) k
  where old.config->k.key is distinct from new.config->k.key;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(new.id,auth.uid(),'studio',new.id,'settings_changed',jsonb_build_object('fields',changed_keys));
  return new;
end;
$$;
create trigger admin_audit_tenant_config after update of config on public.tenants for each row execute function public.audit_tenant_config_change();

create function public.owner_audit_history(p_slug text, p_limit integer default 50, p_offset integer default 0)
returns table(id bigint, created_at timestamptz, entity text, entity_id uuid, action text, details jsonb, actor_email text)
language plpgsql stable security definer set search_path=public,auth as $$
declare t uuid;
begin
  t:=owner_tenant(p_slug);
  if p_limit not between 1 and 100 or p_offset < 0 then raise exception 'bad_range'; end if;
  return query select e.id,e.created_at,e.entity,e.entity_id,e.action,e.details,u.email::text
    from public.admin_audit_events e left join auth.users u on u.id=e.actor_id
    where e.tenant_id=t order by e.created_at desc,e.id desc limit p_limit offset p_offset;
end;
$$;

alter table public.booking_telegram_link_codes add column repeat_consent boolean not null default false;
alter table public.booking_telegram_links add column repeat_consent boolean not null default false;
alter table public.notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check
  check(kind in ('booking_created','booking_cancelled','booking_reminder','waitlist_interest','booking_followup'));

drop function public.customer_telegram_code(text,text);
create function public.customer_telegram_code(p_token text,p_consent_version text,p_repeat_consent boolean default false)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare b public.bookings; code text;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' or p_consent_version is distinct from 'telegram_booking_v1'
    or p_repeat_consent is null then raise exception 'bad_request'; end if;
  select * into b from public.bookings where token_hash=digest(p_token,'sha256') and status='booked' and starts_at>now() for update;
  if not found then raise exception 'booking_unavailable'; end if;
  if not exists(select 1 from public.tenants where id=b.tenant_id and coalesce((config->>'client_telegram_enabled')::boolean,false)) then raise exception 'feature_disabled'; end if;
  if exists(select 1 from public.booking_telegram_links where booking_id=b.id) then return null; end if;
  delete from public.booking_telegram_link_codes where expires_at<=now() or used_at is not null;
  code:=encode(gen_random_bytes(16),'hex');
  insert into public.booking_telegram_link_codes(code_hash,tenant_id,booking_id,consent_at,consent_version,repeat_consent,expires_at)
    values(digest(code,'sha256'),b.tenant_id,b.id,now(),p_consent_version,p_repeat_consent,now()+interval '15 minutes');
  return code;
end;
$$;
revoke all on function public.customer_telegram_code(text,text,boolean) from public,anon,authenticated;
grant execute on function public.customer_telegram_code(text,text,boolean) to service_role;

create or replace function public.customer_telegram_link_consume(p_code text,p_chat bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare c public.booking_telegram_link_codes; b public.bookings; t public.tenants; s public.services; reminder_hours int;
begin
  if p_code is null or p_code !~ '^[A-Fa-f0-9]{32}$' or p_chat is null then return null; end if;
  select * into c from public.booking_telegram_link_codes where code_hash=digest(p_code,'sha256') and used_at is null and expires_at>now() for update;
  if not found then return null; end if;
  update public.booking_telegram_link_codes set used_at=now() where code_hash=c.code_hash;
  select * into b from public.bookings where id=c.booking_id and tenant_id=c.tenant_id and status='booked' and starts_at>now();
  if not found then return null; end if;
  select * into t from public.tenants where id=b.tenant_id;
  if not coalesce((t.config->>'client_telegram_enabled')::boolean,false) then return null; end if;
  select * into s from public.services where id=b.service_id and tenant_id=b.tenant_id;
  if t.id is null or s.id is null then return null; end if;
  insert into public.booking_telegram_links(tenant_id,booking_id,chat_id,consent_at,consent_version,repeat_consent)
    values(c.tenant_id,c.booking_id,p_chat,c.consent_at,c.consent_version,c.repeat_consent)
    on conflict(booking_id) do update set chat_id=excluded.chat_id,consent_at=excluded.consent_at,consent_version=excluded.consent_version,
      repeat_consent=excluded.repeat_consent,created_at=now();
  select coalesce(ns.reminder_hours_before,24) into reminder_hours from public.tenant_notification_settings ns where ns.tenant_id=b.tenant_id;
  insert into public.notification_jobs(tenant_id,kind,booking_id,dedupe_key,run_after)
    values(b.tenant_id,'booking_reminder',b.id,'reminder24:'||b.id,greatest(b.starts_at-make_interval(hours=>coalesce(reminder_hours,24)),now()))
    on conflict(dedupe_key) do nothing;
  return jsonb_build_object('studio',coalesce(t.config->>'short_name',t.config->>'name',t.slug),'service',s.name,
    'starts_at',b.starts_at,'timezone',t.timezone,'address',coalesce(t.config->>'address',''),'price_cents',b.price_cents,'currency',coalesce(t.config->>'currency',''),
    'reminder_hours_before',coalesce(reminder_hours,24),'repeat_consent',c.repeat_consent);
end;
$$;
revoke all on function public.customer_telegram_link_consume(text,bigint) from public,anon,authenticated;
grant execute on function public.customer_telegram_link_consume(text,bigint) to service_role;

create or replace function public.lease_notification_jobs(p_limit int)
returns table(id uuid,tenant_id uuid,kind text,booking_id uuid,attempts int,payload jsonb)
language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
begin
  insert into public.notification_jobs(tenant_id,kind,booking_id,dedupe_key,run_after)
  select b.tenant_id,'booking_reminder',b.id,'reminder24:'||b.id,now()
  from public.bookings b left join public.tenant_notification_settings ns on ns.tenant_id=b.tenant_id
  where b.status='booked'
    and b.starts_at>=now()+make_interval(hours=>coalesce(ns.reminder_hours_before,24))
    and b.starts_at<now()+make_interval(hours=>coalesce(ns.reminder_hours_before,24),mins=>1)
  on conflict(dedupe_key) do nothing;
  delete from public.notification_jobs where status='sent' and created_at<now()-interval '30 days';
  return query with c as (
    select j.id from public.notification_jobs j where j.status='pending' and j.run_after<=now()
      and (j.lease_until is null or j.lease_until<now()) order by j.created_at
      limit least(greatest(p_limit,1),50) for update skip locked
  )
  update public.notification_jobs n set lease_until=now()+interval '2 minutes',attempts=n.attempts+1
  from c where n.id=c.id returning n.id,n.tenant_id,n.kind,n.booking_id,n.attempts,n.payload;
end;
$$;
revoke all on function public.lease_notification_jobs(int) from public,anon,authenticated;
grant execute on function public.lease_notification_jobs(int) to service_role;

create function public.enqueue_booking_followup() returns trigger language plpgsql security definer set search_path=public as $$
declare days_after int; custom_message text;
begin
  if new.status <> 'done' or old.status = 'done' then return new; end if;
  if not exists(select 1 from public.booking_telegram_links l where l.tenant_id=new.tenant_id and l.booking_id=new.id and l.repeat_consent) then return new; end if;
  if not coalesce((select (config->>'client_telegram_enabled')::boolean from public.tenants where id=new.tenant_id),false) then return new; end if;
  select coalesce(s.repeat_after_days,90),s.repeat_message into days_after,custom_message
    from public.tenant_notification_settings s where s.tenant_id=new.tenant_id;
  insert into public.notification_jobs(tenant_id,kind,booking_id,dedupe_key,payload,run_after)
  values(new.tenant_id,'booking_followup',new.id,'followup:'||new.id,jsonb_build_object('message',custom_message),
    greatest(new.starts_at+make_interval(days=>coalesce(days_after,90)),now())) on conflict(dedupe_key) do nothing;
  return new;
end;
$$;
create trigger booking_followup_after_done after update of status on public.bookings for each row execute function public.enqueue_booking_followup();

revoke all on function public.owner_notification_settings(text), public.owner_update_notification_settings(text,smallint,smallint,text,text),
  public.owner_upsert_resource(text,uuid,text), public.owner_delete_resource(text,uuid), public.owner_audit_history(text,integer,integer) from public,anon;
grant execute on function public.owner_notification_settings(text), public.owner_update_notification_settings(text,smallint,smallint,text,text),
  public.owner_upsert_resource(text,uuid,text), public.owner_delete_resource(text,uuid), public.owner_audit_history(text,integer,integer) to authenticated;
