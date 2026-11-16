-- Server-enforced plan limits, feature access and per-tenant exceptions.
alter table public.plans add column if not exists limits jsonb not null default '{}'::jsonb;
alter table public.plans add column if not exists feature_access jsonb not null default '{}'::jsonb;

update public.plans set
  limits=case code
    when 'START' then '{"employees":3,"services":20,"branches":1,"bookings_per_month":300}'::jsonb
    when 'PRO' then '{"employees":15,"services":100,"branches":5,"bookings_per_month":3000}'::jsonb
    when 'LEGACY' then '{"employees":null,"services":null,"branches":null,"bookings_per_month":null}'::jsonb
    else case when limits='{}'::jsonb then '{"employees":5,"services":30,"branches":1,"bookings_per_month":500}'::jsonb else limits end
  end,
  feature_access=case when feature_access='{}'::jsonb then '{"telegram":true,"export":true,"reviews":true}'::jsonb else feature_access end;

-- Every new tenant starts with the selected plan's service cap applied as well.
-- Insert the subscription before any tenant-owned catalog rows so later server
-- checks always resolve the correct plan in the same transaction.

create table public.tenant_plan_overrides(
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  limits jsonb not null default '{}'::jsonb,
  feature_access jsonb not null default '{}'::jsonb,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.tenant_plan_overrides enable row level security;
revoke all on public.tenant_plan_overrides from public,anon,authenticated;

create or replace function public.tenant_plan_access(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare base_limits jsonb; base_features jsonb; overrides public.tenant_plan_overrides; code text;
begin
  select p.code,p.limits,p.feature_access into code,base_limits,base_features
  from public.subscriptions s join public.plans p on p.id=s.plan_id
  where s.tenant_id=p_tenant
  order by (s.status in ('trial','active','grace','suspended')) desc,s.created_at desc limit 1;
  if code is null then
    code:='START';
    base_limits:='{"employees":3,"services":20,"branches":1,"bookings_per_month":300}'::jsonb;
    base_features:='{"telegram":true,"export":true,"reviews":true}'::jsonb;
  end if;
  select * into overrides from public.tenant_plan_overrides where tenant_id=p_tenant;
  base_limits:=coalesce(base_limits,'{}'::jsonb);
  base_features:=coalesce(base_features,'{}'::jsonb);
  return jsonb_build_object('plan_code',code,
    'limits',base_limits||coalesce(overrides.limits,'{}'::jsonb),
    'features',base_features||coalesce(overrides.feature_access,'{}'::jsonb),
    'override',jsonb_build_object('limits',coalesce(overrides.limits,'{}'::jsonb),
      'features',coalesce(overrides.feature_access,'{}'::jsonb),'reason',overrides.reason,'updated_at',overrides.updated_at));
end $$;

create or replace function public.tenant_feature_enabled(p_tenant uuid,p_feature text) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((public.tenant_plan_access(p_tenant)->'features'->>p_feature)::boolean,false)
$$;

create or replace function public.tenant_plan_usage(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare tz text; month_start timestamptz;
begin
  select coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty') into tz
    from public.tenants t where t.id=p_tenant;
  if tz is null then raise exception 'not_found'; end if;
  month_start:=date_trunc('month',now() at time zone tz) at time zone tz;
  return jsonb_build_object(
    'employees',(select count(*) from public.tenant_members where tenant_id=p_tenant and role in ('manager','staff')),
    'services',(select count(*) from public.services where tenant_id=p_tenant),
    -- До появления отдельной модели филиалов каждая организация считается одной основной точкой.
    'branches',1,
    'bookings_per_month',(select count(*) from public.bookings where tenant_id=p_tenant and created_at>=month_start),
    'period_start',month_start);
end $$;

create or replace function public.owner_plan_usage(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t uuid; access jsonb;
begin
  t:=public.owner_tenant(p_slug); access:=public.tenant_plan_access(t);
  return access||jsonb_build_object('usage',public.tenant_plan_usage(t));
end $$;

create or replace function public.assert_tenant_plan_capacity(p_tenant uuid,p_key text) returns void
language plpgsql security definer set search_path=public as $$
declare access jsonb; usage jsonb; cap jsonb; current_count bigint;
begin
  if p_key not in ('employees','services','branches','bookings_per_month') then raise exception 'bad_limit_key'; end if;
  perform 1 from public.tenants where id=p_tenant for update;
  if not found then raise exception 'not_found'; end if;
  access:=public.tenant_plan_access(p_tenant); cap:=access->'limits'->p_key;
  if cap is null or cap='null'::jsonb then return; end if;
  usage:=public.tenant_plan_usage(p_tenant); current_count:=coalesce((usage->>p_key)::bigint,0);
  if current_count >= (cap#>>'{}')::bigint then raise exception 'plan_limit_%',p_key; end if;
end $$;

create or replace function public.enforce_plan_service_limit() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_tenant_plan_capacity(new.tenant_id,'services');
  return new;
end $$;
create trigger enforce_plan_service_limit before insert on public.services
  for each row execute function public.enforce_plan_service_limit();

create or replace function public.enforce_plan_booking_limit() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.bookings where tenant_id=new.tenant_id and idempotency_key=new.idempotency_key) then
    perform public.assert_tenant_plan_capacity(new.tenant_id,'bookings_per_month');
  end if;
  return new;
end $$;
create trigger enforce_plan_booking_limit before insert on public.bookings
  for each row execute function public.enforce_plan_booking_limit();

-- Keep the current service RPC contract and guard only creation; editing an existing service stays available.
create or replace function public.owner_upsert_service(
  p_slug text,p_id uuid,p_name text,p_price_cents integer,p_duration integer,p_active boolean,p_category text
) returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid; v uuid; c text:=coalesce(nullif(btrim(p_category),''),'Другое');
begin
  t:=public.owner_tenant(p_slug);
  if p_name is null or length(trim(p_name))=0 or p_price_cents is null or p_price_cents<0 or p_duration is null
    or p_duration<=0 or p_active is null or char_length(c)>60 then raise exception 'bad_service'; end if;
  if p_id is null then
    perform public.assert_tenant_plan_capacity(t,'services');
    insert into public.services(tenant_id,name,category,price_cents,duration_minutes,active)
    values(t,trim(p_name),c,p_price_cents,p_duration,p_active) returning id into v;
  else
    update public.services set name=trim(p_name),category=c,price_cents=p_price_cents,duration_minutes=p_duration,active=p_active
    where id=p_id and tenant_id=t returning id into v;
    if v is null then raise exception 'forbidden'; end if;
  end if;
  return v;
end $$;

-- Count employees in SQL as well as in the Edge Function, so the service role cannot bypass the limit.
create or replace function public.owner_team_require_capacity(p_slug text,p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
  select id into t from public.tenants where slug=p_slug;
  perform public.assert_tenant_plan_capacity(t,'employees');
end $$;

create or replace function public.owner_team_set(p_slug text,p_actor uuid,p_user uuid,p_role text,p_resource uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid; actor_role text; target_role text; target_email text; post_name text; act text;
begin
  if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
  select id into t from public.tenants where slug=p_slug;
  select role into actor_role from public.tenant_members where tenant_id=t and user_id=p_actor;
  if p_role not in ('manager','staff') or (actor_role='manager' and p_role<>'staff') then raise exception 'bad_role'; end if;
  if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'user_not_found'; end if;
  if p_role='staff' then
    if p_resource is null or not exists(select 1 from public.resources where tenant_id=t and id=p_resource) then raise exception 'bad_resource'; end if;
  elsif p_resource is not null then raise exception 'bad_resource'; end if;
  select role into target_role from public.tenant_members where tenant_id=t and user_id=p_user;
  if target_role='owner' or (actor_role='manager' and target_role='manager') then raise exception 'owner_protected'; end if;
  if target_role is null then perform public.assert_tenant_plan_capacity(t,'employees'); end if;
  select email into target_email from auth.users where id=p_user;
  select name into post_name from public.resources where tenant_id=t and id=p_resource;
  act:=case when target_role is null then 'created' else 'updated' end;
  insert into public.tenant_members(tenant_id,user_id,role,resource_id) values(t,p_user,p_role,p_resource)
    on conflict(tenant_id,user_id) do update set role=excluded.role,resource_id=excluded.resource_id;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
    values(t,p_actor,'team',p_user,act,jsonb_strip_nulls(jsonb_build_object('email',target_email,'role',p_role,'resource',post_name)));
end $$;

create or replace function public.owner_telegram_code(p_slug text) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare t uuid; c text;
begin
  t:=public.owner_tenant_owner(p_slug);
  if not public.tenant_feature_enabled(t,'telegram') then raise exception 'feature_disabled'; end if;
  delete from public.telegram_link_codes where tenant_id=t and (used or expires_at<now());
  select code into c from public.telegram_link_codes where tenant_id=t and not used and expires_at>now() order by expires_at desc limit 1;
  if c is not null then return c; end if;
  if (select count(*) from public.telegram_link_codes where tenant_id=t)>=5 then raise exception 'rate_limited'; end if;
  c:=encode(gen_random_bytes(16),'hex');
  insert into public.telegram_link_codes(code,tenant_id,expires_at) values(c,t,now()+interval '10 minutes');
  return c;
end $$;

create or replace function public.customer_telegram_code(p_token text,p_consent_version text,p_repeat_consent boolean default false)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare b public.bookings; code text;
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{32,128}$' or p_consent_version is distinct from 'telegram_booking_v1' or p_repeat_consent is null then raise exception 'bad_request'; end if;
  select * into b from public.bookings where token_hash=digest(p_token,'sha256') and status='booked' and starts_at>now() for update;
  if not found then raise exception 'booking_unavailable'; end if;
  if not public.tenant_feature_enabled(b.tenant_id,'telegram') then raise exception 'feature_disabled'; end if;
  if not exists(select 1 from public.tenants where id=b.tenant_id and coalesce((config->>'client_telegram_enabled')::boolean,false)) then raise exception 'feature_disabled'; end if;
  if exists(select 1 from public.booking_telegram_links where booking_id=b.id) then return null; end if;
  delete from public.booking_telegram_link_codes where expires_at<=now() or used_at is not null;
  code:=encode(gen_random_bytes(16),'hex');
  insert into public.booking_telegram_link_codes(code_hash,tenant_id,booking_id,consent_at,consent_version,repeat_consent,expires_at)
    values(digest(code,'sha256'),b.tenant_id,b.id,now(),p_consent_version,p_repeat_consent,now()+interval '10 minutes');
  return code;
end $$;

create or replace function public.published_reviews(p_slug text)
returns table(rating int,comment text,created_at timestamptz) language sql stable security definer set search_path=public as $$
  select r.rating,r.comment,r.created_at from public.booking_reviews r join public.tenants t on t.id=r.tenant_id
  where t.slug=p_slug and r.published and public.tenant_feature_enabled(t.id,'reviews')
  order by r.created_at desc limit 12
$$;

create or replace function public.platform_upsert_plan(p_actor uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pid uuid; v_code text; lim jsonb; features jsonb;
begin
  perform public.platform_assert(p_actor);
  lim:=coalesce(p->'limits','{"employees":5,"services":30,"branches":1,"bookings_per_month":500}'::jsonb);
  features:=coalesce(p->'feature_access','{"telegram":true,"export":true,"reviews":true}'::jsonb);
  if jsonb_typeof(lim)<>'object' or jsonb_typeof(features)<>'object' then raise exception 'bad_limits'; end if;
  if exists(select 1 from jsonb_each(lim) x where x.key not in ('employees','services','branches','bookings_per_month')
      or case when x.value='null'::jsonb then false when jsonb_typeof(x.value)='number' then (x.value#>>'{}')::numeric<1 or (x.value#>>'{}')::numeric>1000000 or (x.value#>>'{}')::numeric<>trunc((x.value#>>'{}')::numeric) else true end) then raise exception 'bad_limits'; end if;
  if exists(select 1 from jsonb_each(features) x where x.key not in ('telegram','export','reviews') or jsonb_typeof(x.value)<>'boolean') then raise exception 'bad_features'; end if;
  if nullif(p->>'id','') is not null then
    pid:=(p->>'id')::uuid;
    update public.plans set name=coalesce(nullif(p->>'name',''),name),
      description=case when p?'description' then p->>'description' else description end,
      price_kzt=coalesce((p->>'price_kzt')::int,price_kzt),period_months=coalesce((p->>'period_months')::int,period_months),
      features=case when p?'features' then p->'features' else features end,
      limits=case when p?'limits' then lim else limits end,
      feature_access=case when p?'feature_access' then features else feature_access end,
      is_active=coalesce((p->>'is_active')::boolean,is_active),sort_order=coalesce((p->>'sort_order')::int,sort_order)
      where id=pid;
    if not found then raise exception 'not_found'; end if;
  else
    v_code:=upper(trim(coalesce(p->>'code','')));
    insert into public.plans(code,name,description,price_kzt,period_months,features,limits,feature_access,is_active,sort_order)
      values(v_code,p->>'name',p->>'description',(p->>'price_kzt')::int,coalesce((p->>'period_months')::int,1),
        coalesce(p->'features','[]'::jsonb),lim,features,coalesce((p->>'is_active')::boolean,true),coalesce((p->>'sort_order')::int,100)) returning id into pid;
  end if;
  perform public.platform_log(p_actor,'plan.upsert',null,jsonb_build_object('plan_id',pid,'data',p));
  return jsonb_build_object('id',pid);
end $$;

create or replace function public.platform_create_tenant(p_actor uuid,p_key text,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prev public.platform_requests; fingerprint text; tid uuid; sid uuid; plan public.plans; v_slug text; tz text; start_at timestamptz; end_at timestamptz;
  grace int; trial boolean; months int; cfg jsonb; svc jsonb; res jsonb; owner uuid; service_count int:=0;
begin
  perform public.platform_assert(p_actor);
  fingerprint:=md5(jsonb_build_object('action','tenant.create','payload',p)::text);
  select * into prev from public.platform_requests where idempotency_key=p_key;
  if found then
    if prev.actor_id is distinct from p_actor or prev.action<>'tenant.create' or prev.request_fingerprint<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return prev.result||jsonb_build_object('replayed',true);
  end if;
  v_slug:=lower(trim(coalesce(p->>'slug','')));
  if v_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'bad_slug'; end if;
  if exists(select 1 from public.tenants where tenants.slug=v_slug) then raise exception 'slug_taken'; end if;
  if length(trim(coalesce(p->>'name',''))) not between 2 and 80 then raise exception 'bad_name'; end if;
  tz:=coalesce(nullif(p->>'timezone',''),'Asia/Aqtobe');
  if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'bad_timezone'; end if;
  owner:=(p->>'owner_user_id')::uuid;
  if owner is null or not exists(select 1 from auth.users where id=owner) then raise exception 'owner_missing'; end if;
  trial:=coalesce((p->>'trial')::boolean,false);
  select * into plan from public.plans where code=upper(coalesce(nullif(p->>'plan_code',''),'START')) and is_active;
  if not found then raise exception 'plan_not_found'; end if;
  if jsonb_typeof(coalesce(p->'services','[]'::jsonb))<>'array' then raise exception 'bad_request'; end if;
  select count(*)::int into service_count from jsonb_array_elements(coalesce(p->'services','[]'::jsonb)) as items(x)
    where length(trim(coalesce(x->>'name',''))) between 1 and 120 and coalesce((x->>'price')::int,-1)>=0 and coalesce((x->>'duration_minutes')::int,0)>0;
  if plan.limits->'services' is not null and plan.limits->'services'<>'null'::jsonb
     and service_count>(plan.limits->>'services')::int then raise exception 'plan_limit_services'; end if;
  start_at:=coalesce(nullif(p->>'start','')::timestamptz,now()); grace:=public.platform_setting_int('grace_days',5);
  if trial then end_at:=start_at+make_interval(days=>public.platform_setting_int('trial_days',14));
  else months:=coalesce((p->>'months')::int,plan.period_months); if months not between 1 and 36 then raise exception 'bad_duration'; end if; end_at:=start_at+make_interval(months=>months); end if;
  cfg:=jsonb_build_object('slug',v_slug,'name',trim(p->>'name'),'short_name',trim(p->>'name'),'accent','#4690FF',
    'timezone',tz,'currency',coalesce(nullif(p->>'currency',''),'₸'),'buffer_minutes',15,'slot_minutes',60,'cancel_hours',24,
    'business_type',coalesce(nullif(p->>'business_type',''),'autoservice'),'phone',coalesce(p->>'phone',''),'address',coalesce(p->>'address',''),
    'description','','resources',jsonb_build_array('Пост 1'),'hours',jsonb_build_object('mon',jsonb_build_array('09:00','18:00'),'tue',jsonb_build_array('09:00','18:00'),
      'wed',jsonb_build_array('09:00','18:00'),'thu',jsonb_build_array('09:00','18:00'),'fri',jsonb_build_array('09:00','18:00'),
      'sat',jsonb_build_array('09:00','16:00'),'sun','null'::jsonb));
  insert into public.tenants(slug,status,timezone,buffer_minutes,config,created_at) values(v_slug,'live',tz,15,cfg,now()) returning id into tid;
  insert into public.resources(tenant_id,name) values(tid,'Пост 1');
  insert into public.tenant_members(tenant_id,user_id,role) values(tid,owner,'owner');
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at,ends_at,grace_ends_at)
    values(tid,plan.id,case when trial then 'trial' else 'active' end,start_at,end_at,end_at+make_interval(days=>grace)) returning id into sid;
  for svc in select * from jsonb_array_elements(coalesce(p->'services','[]'::jsonb)) loop
    if length(trim(coalesce(svc->>'name',''))) between 1 and 120 and coalesce((svc->>'price')::int,-1)>=0 and coalesce((svc->>'duration_minutes')::int,0)>0 then
      insert into public.services(tenant_id,name,category,price_cents,duration_minutes)
      values(tid,trim(svc->>'name'),coalesce(nullif(svc->>'category',''),'Другое'),(svc->>'price')::int*100,(svc->>'duration_minutes')::int);
    end if;
  end loop;
  perform public.platform_sub_event(sid,'created',jsonb_build_object('plan',plan.code,'trial',trial,'starts_at',start_at,'ends_at',end_at),p_actor);
  perform public.platform_log(p_actor,'tenant.create',tid,jsonb_build_object('slug',v_slug,'plan',plan.code,'owner_user_id',owner,'owner_email',p->>'owner_email'));
  res:=jsonb_build_object('tenant_id',tid,'subscription_id',sid,'slug',v_slug);
  insert into public.platform_requests(idempotency_key,action,actor_id,request_fingerprint,result) values(p_key,'tenant.create',p_actor,fingerprint,res);
  return res;
end $$;

create or replace function public.platform_set_tenant_plan_override(p_actor uuid,p_tenant uuid,p_limits jsonb,p_features jsonb,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare before_access jsonb; after_access jsonb;
begin
  perform public.platform_assert(p_actor);
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner' and is_active) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'not_found'; end if;
  before_access:=public.tenant_plan_access(p_tenant);
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 or jsonb_typeof(coalesce(p_limits,'{}'::jsonb))<>'object'
    or jsonb_typeof(coalesce(p_features,'{}'::jsonb))<>'object' then raise exception 'bad_request'; end if;
  if exists(select 1 from jsonb_each(coalesce(p_limits,'{}'::jsonb)) x where x.key not in ('employees','services','branches','bookings_per_month')
      or case when x.value='null'::jsonb then false when jsonb_typeof(x.value)='number' then (x.value#>>'{}')::numeric<1 or (x.value#>>'{}')::numeric>1000000 or (x.value#>>'{}')::numeric<>trunc((x.value#>>'{}')::numeric) else true end) then raise exception 'bad_limits'; end if;
  if exists(select 1 from jsonb_each(coalesce(p_features,'{}'::jsonb)) x where x.key not in ('telegram','export','reviews') or jsonb_typeof(x.value)<>'boolean') then raise exception 'bad_features'; end if;
  if coalesce(p_limits,'{}'::jsonb)='{}'::jsonb and coalesce(p_features,'{}'::jsonb)='{}'::jsonb then
    delete from public.tenant_plan_overrides where tenant_id=p_tenant;
  else
    insert into public.tenant_plan_overrides(tenant_id,limits,feature_access,reason,updated_by,updated_at)
      values(p_tenant,coalesce(p_limits,'{}'::jsonb),coalesce(p_features,'{}'::jsonb),btrim(p_reason),p_actor,now())
      on conflict(tenant_id) do update set limits=excluded.limits,feature_access=excluded.feature_access,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
  end if;
  after_access:=public.tenant_plan_access(p_tenant);
  perform public.platform_log(p_actor,'tenant.limits_override',p_tenant,jsonb_build_object('before',before_access,'after',after_access,'reason',btrim(p_reason)));
end $$;

create or replace function public.platform_tenant_card(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t public.tenants; r jsonb;
begin
  perform public.platform_assert(p_actor);
  select * into t from public.tenants where id=p_tenant; if not found then raise exception 'not_found'; end if;
  select jsonb_build_object(
    'tenant',jsonb_build_object('id',t.id,'slug',t.slug,'status',t.status,'timezone',t.timezone,'created_at',t.created_at,'config',t.config),
    'access_state',public.tenant_access_state(t.id),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'last_sign_in_at',u.last_sign_in_at)) from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=t.id),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'plan_code',p.code,'plan_name',p.name,'status',s.status,'phase',public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at),'starts_at',s.starts_at,'ends_at',s.ends_at,'grace_ends_at',s.grace_ends_at,'created_at',s.created_at) order by s.created_at desc) from public.subscriptions s join public.plans p on p.id=s.plan_id where s.tenant_id=t.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc) from (select id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,confirmed_by,refund_reason,note from public.saas_payments where tenant_id=t.id order by received_at desc limit 100) x),'[]'::jsonb),
    'plan_access',public.tenant_plan_access(t.id),'plan_usage',public.tenant_plan_usage(t.id),
    'counters',jsonb_build_object('staff',(select count(*) from public.tenant_members where tenant_id=t.id),'services',(select count(*) from public.services where tenant_id=t.id),'bookings_30d',(select count(*) from public.bookings where tenant_id=t.id and created_at>=now()-interval '30 days'))
  ) into r;
  return r;
end $$;

revoke all on function public.platform_create_tenant(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.platform_create_tenant(uuid,text,jsonb) to service_role;

revoke all on function public.tenant_plan_access(uuid),public.tenant_feature_enabled(uuid,text),public.tenant_plan_usage(uuid),public.assert_tenant_plan_capacity(uuid,text),public.enforce_plan_booking_limit(),public.enforce_plan_service_limit(),public.owner_team_require_capacity(text,uuid),public.platform_set_tenant_plan_override(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.owner_plan_usage(text) to authenticated,service_role;
grant execute on function public.tenant_feature_enabled(uuid,text) to service_role;
grant execute on function public.owner_team_require_capacity(text,uuid),public.platform_set_tenant_plan_override(uuid,uuid,jsonb,jsonb,text) to service_role;

-- Telegram code creation is blocked at the database boundary when a plan has no Telegram access.
create or replace function public.guard_plan_telegram_code() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not public.tenant_feature_enabled(new.tenant_id,'telegram') then raise exception 'feature_disabled'; end if;
  return new;
end $$;
create trigger guard_plan_owner_telegram_code before insert on public.telegram_link_codes
  for each row execute function public.guard_plan_telegram_code();
create trigger guard_plan_customer_telegram_code before insert on public.booking_telegram_link_codes
  for each row execute function public.guard_plan_telegram_code();

-- Reviews can still be read by owners for their records, but new reviews and public display obey the plan.
create or replace function public.guard_plan_review() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not public.tenant_feature_enabled(new.tenant_id,'reviews') then raise exception 'feature_disabled'; end if;
  return new;
end $$;
create trigger guard_plan_review before insert on public.booking_reviews
  for each row execute function public.guard_plan_review();

revoke all on function public.owner_plan_usage(text),public.guard_plan_telegram_code(),public.guard_plan_review() from public,anon;
grant execute on function public.owner_plan_usage(text) to authenticated,service_role;

notify pgrst,'reload schema';
