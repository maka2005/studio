-- Rate limiting for public Edge Function gateways.
create function public.consume_public_rate(p_scope text,p_key text,p_limit int,p_window int)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_scope not in ('slots','booking_read','booking_cancel','waitlist','review','admin_login') or p_key is null or length(p_key)<4
    or p_limit not between 1 and 1000 or p_window not between 1 and 86400 then return false; end if;
  return hit_limit('public:'||p_scope||':'||md5(p_key),p_limit,p_window);
end $$;
revoke all on function public.consume_public_rate(text,text,int,int) from public,anon,authenticated;
grant execute on function public.consume_public_rate(text,text,int,int) to service_role;

alter table public.bookings add column if not exists source text not null default 'direct' check(source ~ '^[a-z0-9_-]{1,40}$');
alter table public.bookings add column if not exists promo_code text;
alter table public.bookings add column if not exists discount_cents int not null default 0 check(discount_cents>=0);
alter table public.notification_jobs add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check check(kind in ('booking_created','booking_cancelled','booking_reminder','waitlist_interest'));

create table public.promo_codes(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants on delete cascade,
  code text not null,discount_kind text not null check(discount_kind in ('percent','fixed')),discount_value int not null check(discount_value>0),
  usage_limit int check(usage_limit is null or usage_limit>0),used_count int not null default 0,starts_at timestamptz,ends_at timestamptz,
  active boolean not null default true,created_at timestamptz not null default now(),unique(tenant_id,code));
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from public,anon,authenticated;

create table public.waitlist(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants on delete cascade,
  service_id uuid not null,preferred_day date not null,customer_name text not null,customer_phone text not null,car text not null,
  consent_at timestamptz not null default now(),consent_version text not null,
  status text not null default 'waiting' check(status in ('waiting','contacted','closed')),created_at timestamptz not null default now(),
  foreign key(tenant_id,service_id) references services(tenant_id,id));
alter table public.waitlist enable row level security;
revoke all on public.waitlist from public,anon,authenticated;
create index waitlist_owner_idx on public.waitlist(tenant_id,status,preferred_day,created_at desc);
create unique index waitlist_once_idx on public.waitlist(tenant_id,service_id,preferred_day,customer_phone);

create function public.submit_waitlist(p_slug text,p_service uuid,p_day date,p_name text,p_phone text,p_car text,p_consent text)
returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid; service_label text; item uuid;
begin
  select id into t from tenants where slug=p_slug;
  if t is null then raise exception 'not_found'; end if;
  select name into service_label from services where tenant_id=t and id=p_service and active;
  if service_label is null then raise exception 'not_found'; end if;
  if length(btrim(p_name)) not between 1 and 80 or length(p_phone) not between 10 and 16 or length(btrim(p_car)) not between 2 and 60 or length(trim(coalesce(p_consent,''))) not between 1 and 40 then raise exception 'bad_request'; end if;
  insert into waitlist(tenant_id,service_id,preferred_day,customer_name,customer_phone,car,consent_version)
    values(t,p_service,p_day,btrim(p_name),p_phone,btrim(p_car),trim(p_consent)) returning id into item;
  insert into notification_jobs(tenant_id,kind,booking_id,dedupe_key,payload)
    values(t,'waitlist_interest',null,'waitlist:'||item,jsonb_build_object('service',service_label,'day',p_day,'name',btrim(p_name),'phone',p_phone,'car',btrim(p_car)));
  return item;
end $$;
revoke all on function public.submit_waitlist(text,uuid,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_waitlist(text,uuid,date,text,text,text,text) to service_role;

create table public.booking_reviews(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants on delete cascade,booking_id uuid not null,
  rating int not null check(rating between 1 and 5),comment text not null default '' check(length(comment)<=1000),
  published boolean not null default false,created_at timestamptz not null default now(),unique(booking_id),
  foreign key(tenant_id,booking_id) references bookings(tenant_id,id) on delete cascade);
alter table public.booking_reviews enable row level security;
revoke all on public.booking_reviews from public,anon,authenticated;

-- New booking wrapper keeps all the previous server-side slot, validation, and idempotency rules.
create function public.create_booking_with_promo(
  p_slug text,p_service uuid,p_start timestamptz,p_name text,p_phone text,p_car text,p_key text,p_token text,
  p_consent text,p_promo text default null,p_source text default 'direct')
returns table(booking_id uuid,resource_id uuid,starts_at timestamptz,ends_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare t uuid; pc promo_codes; b record; discount int; base_price int; new_source text;
begin
  select id into t from tenants where slug=p_slug; if t is null then raise exception 'tenant_not_found'; end if;
  if exists(select 1 from bookings where tenant_id=t and idempotency_key=p_key) then
    return query select x.id,x.resource_id,x.starts_at,x.ends_at from bookings x where x.tenant_id=t and x.idempotency_key=p_key; return;
  end if;
  if nullif(trim(p_promo),'') is not null then
    select * into pc from promo_codes where tenant_id=t and code=upper(trim(p_promo)) and active for update;
    if not found or (pc.starts_at is not null and pc.starts_at>now()) or (pc.ends_at is not null and pc.ends_at<now())
      or (pc.usage_limit is not null and pc.used_count>=pc.usage_limit) then raise exception 'promo_invalid'; end if;
  end if;
  select s.price_cents into base_price from services s where s.id=p_service and s.tenant_id=t and s.active;
  if base_price is null then raise exception 'service_not_found'; end if;
  select * into b from public.create_booking(p_slug,p_service,p_start,p_name,p_phone,p_car,p_key,p_token,p_consent);
  if b.booking_id is null then raise exception 'booking_unavailable'; end if;
  discount:=case when pc.id is null then 0 when pc.discount_kind='percent' then floor(base_price*least(pc.discount_value,100)/100.0)::int else least(base_price,pc.discount_value) end;
  new_source:=lower(coalesce(p_source,'direct')); if new_source !~ '^[a-z0-9_-]{1,40}$' then new_source:='direct'; end if;
  update bookings set price_cents=greatest(0,base_price-discount),discount_cents=discount,promo_code=case when pc.id is null then null else pc.code end,source=new_source where id=b.booking_id;
  if pc.id is not null then update promo_codes set used_count=used_count+1 where id=pc.id; end if;
  booking_id:=b.booking_id; resource_id:=b.resource_id; starts_at:=b.starts_at; ends_at:=b.ends_at; return next;
end $$;
revoke all on function public.create_booking_with_promo(text,uuid,timestamptz,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_booking_with_promo(text,uuid,timestamptz,text,text,text,text,text,text,text,text) to service_role;
revoke all on function public.get_slots(text,uuid,date),public.get_booking(text),public.cancel_booking(text) from public,anon,authenticated;
grant execute on function public.get_slots(text,uuid,date),public.get_booking(text),public.cancel_booking(text) to service_role;
drop function public.get_booking(text);
create function public.get_booking(p_token text)
returns table(id uuid,tenant_slug text,service_name text,service_id uuid,starts_at timestamptz,ends_at timestamptz,price_cents int,status text,customer_name text,car text,can_cancel bool,reviewed bool)
language sql stable security definer set search_path=public,extensions as $$
  select b.id,t.slug,s.name,b.service_id,b.starts_at,b.ends_at,b.price_cents,b.status,b.customer_name,b.car,
    b.status='booked' and b.starts_at-now()>=make_interval(hours=>coalesce((t.config->>'cancel_hours')::int,24)),
    exists(select 1 from booking_reviews r where r.booking_id=b.id)
  from bookings b join tenants t on t.id=b.tenant_id join services s on s.tenant_id=b.tenant_id and s.id=b.service_id
  where b.token_hash=digest(p_token,'sha256')
$$;
revoke all on function public.get_booking(text) from public,anon,authenticated;
grant execute on function public.get_booking(text) to service_role;

create function public.submit_booking_review(p_token text,p_rating int,p_comment text)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare b bookings;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' or p_rating not between 1 and 5 or length(coalesce(p_comment,''))>1000 then raise exception 'bad_review'; end if;
  select * into b from bookings where token_hash=digest(p_token,'sha256') and status='done' and starts_at<=now();
  if not found then raise exception 'review_unavailable'; end if;
  insert into booking_reviews(tenant_id,booking_id,rating,comment) values(b.tenant_id,b.id,p_rating,btrim(coalesce(p_comment,'')));
  return true;
end $$;
revoke all on function public.submit_booking_review(text,int,text) from public,anon,authenticated;
grant execute on function public.submit_booking_review(text,int,text) to service_role;

create function public.owner_waitlist(p_slug text)
returns table(id uuid,service_name text,preferred_day date,customer_name text,customer_phone text,car text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin t:=owner_tenant(p_slug); return query select w.id,s.name,w.preferred_day,w.customer_name,w.customer_phone,w.car,w.status,w.created_at from waitlist w join services s on s.tenant_id=w.tenant_id and s.id=w.service_id where w.tenant_id=t order by w.preferred_day,w.created_at desc; end $$;
create function public.owner_waitlist_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin if p_status not in ('waiting','contacted','closed') then raise exception 'bad_status'; end if; select tenant_id into t from waitlist where id=p_id; perform owner_tenant((select slug from tenants where id=t)); update waitlist set status=p_status where id=p_id and tenant_id=t; end $$;
create function public.owner_promo_codes(p_slug text)
returns table(id uuid,code text,discount_kind text,discount_value int,usage_limit int,used_count int,starts_at timestamptz,ends_at timestamptz,active boolean)
language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin t:=owner_tenant(p_slug); return query select p.id,p.code,p.discount_kind,p.discount_value,p.usage_limit,p.used_count,p.starts_at,p.ends_at,p.active from promo_codes p where p.tenant_id=t order by p.created_at desc; end $$;
create function public.owner_upsert_promo(p_slug text,p_id uuid,p_code text,p_kind text,p_value int,p_limit int,p_starts timestamptz,p_ends timestamptz,p_active boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid; out_id uuid;
begin
  t:=owner_tenant(p_slug);
  if p_code !~ '^[A-Za-z0-9_-]{3,24}$' or p_kind not in ('percent','fixed') or p_value<=0 or (p_kind='percent' and p_value>100) or (p_limit is not null and p_limit<1) or (p_starts is not null and p_ends is not null and p_ends<=p_starts) then raise exception 'bad_promo'; end if;
  if p_id is null then insert into promo_codes(tenant_id,code,discount_kind,discount_value,usage_limit,starts_at,ends_at,active) values(t,upper(p_code),p_kind,p_value,p_limit,p_starts,p_ends,coalesce(p_active,true)) returning id into out_id;
  else update promo_codes set code=upper(p_code),discount_kind=p_kind,discount_value=p_value,usage_limit=p_limit,starts_at=p_starts,ends_at=p_ends,active=coalesce(p_active,true) where id=p_id and tenant_id=t returning id into out_id; end if;
  if out_id is null then raise exception 'not_found'; end if; return out_id;
end $$;
create function public.owner_reviews(p_slug text)
returns table(id uuid,booking_id uuid,rating int,comment text,published boolean,created_at timestamptz,customer_name text,service_name text)
language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin t:=owner_tenant(p_slug); return query select r.id,r.booking_id,r.rating,r.comment,r.published,r.created_at,b.customer_name,s.name from booking_reviews r join bookings b on b.id=r.booking_id and b.tenant_id=r.tenant_id join services s on s.id=b.service_id and s.tenant_id=b.tenant_id where r.tenant_id=t order by r.created_at desc; end $$;
create function public.owner_publish_review(p_id uuid,p_published boolean) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin select tenant_id into t from booking_reviews where id=p_id; perform owner_tenant((select slug from tenants where id=t)); update booking_reviews set published=p_published where id=p_id and tenant_id=t; end $$;
create function public.published_reviews(p_slug text)
returns table(rating int,comment text,created_at timestamptz) language sql stable security definer set search_path=public as $$
  select r.rating,r.comment,r.created_at from booking_reviews r join tenants t on t.id=r.tenant_id where t.slug=p_slug and r.published order by r.created_at desc limit 12
$$;
create function public.owner_source_stats(p_slug text,p_from date,p_to date)
returns table(source text,visits bigint,received_cents bigint) language plpgsql stable security definer set search_path=public as $$
declare t uuid; tz text;
begin t:=owner_tenant(p_slug); select timezone into tz from tenants where id=t; return query select b.source,count(*)::bigint,
  coalesce(sum((select coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end),0) from payments p where p.booking_id=b.id and p.tenant_id=t)),0)::bigint
  from bookings b where b.tenant_id=t and b.starts_at>=p_from::timestamp at time zone tz and b.starts_at<(p_to+1)::timestamp at time zone tz and b.status<>'cancelled' group by b.source order by count(*) desc; end $$;

revoke all on function public.owner_waitlist(text),public.owner_waitlist_status(uuid,text),public.owner_promo_codes(text),public.owner_upsert_promo(text,uuid,text,text,int,int,timestamptz,timestamptz,boolean),public.owner_reviews(text),public.owner_publish_review(uuid,boolean),public.owner_source_stats(text,date,date),public.published_reviews(text) from public,anon;
grant execute on function public.owner_waitlist(text),public.owner_waitlist_status(uuid,text),public.owner_promo_codes(text),public.owner_upsert_promo(text,uuid,text,text,int,int,timestamptz,timestamptz,boolean),public.owner_reviews(text),public.owner_publish_review(uuid,boolean),public.owner_source_stats(text,date,date) to authenticated;
grant execute on function public.published_reviews(text) to anon,authenticated;

drop function public.lease_notification_jobs(int);
create function public.lease_notification_jobs(p_limit int)
returns table(id uuid,tenant_id uuid,kind text,booking_id uuid,attempts int,payload jsonb) language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
begin
  insert into notification_jobs(tenant_id,kind,booking_id,dedupe_key)
  select b.tenant_id,'booking_reminder',b.id,'reminder24:'||b.id from bookings b where b.status='booked' and b.starts_at>=now()+interval '24 hours' and b.starts_at<now()+interval '24 hours 1 minute' on conflict(dedupe_key) do nothing;
  delete from notification_jobs where status='sent' and created_at<now()-interval '30 days';
  return query with c as(select j.id from notification_jobs j where j.status='pending' and j.run_after<=now() and (j.lease_until is null or j.lease_until<now()) order by j.created_at limit least(greatest(p_limit,1),50) for update skip locked)
  update notification_jobs n set lease_until=now()+interval '2 minutes',attempts=n.attempts+1 from c where n.id=c.id returning n.id,n.tenant_id,n.kind,n.booking_id,n.attempts,n.payload;
end $$;
revoke all on function public.lease_notification_jobs(int) from public,anon,authenticated;
grant execute on function public.lease_notification_jobs(int) to service_role;
