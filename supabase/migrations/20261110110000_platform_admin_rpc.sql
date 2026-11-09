-- Servio platform: серверные функции админки. Вызываются только Edge Function platform-admin
-- через service_role; каждая функция сама проверяет, что p_actor есть в platform_admins.

create or replace function public.platform_log(p_actor uuid,p_action text,p_tenant uuid,p_payload jsonb)
returns void language sql security definer set search_path=public as $$
  insert into public.platform_audit_logs(actor_id,action,tenant_id,payload) values(p_actor,p_action,p_tenant,coalesce(p_payload,'{}'::jsonb)) $$;

create or replace function public.platform_sub_event(p_sub uuid,p_type text,p_payload jsonb,p_actor uuid)
returns void language sql security definer set search_path=public as $$
  insert into public.subscription_events(subscription_id,type,payload,actor_id) values(p_sub,p_type,coalesce(p_payload,'{}'::jsonb),p_actor) $$;

-- ------------------------------------------------------------------ чтение
create or replace function public.platform_dashboard(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare tz text; month_start timestamptz; r jsonb;
begin
  perform public.platform_assert(p_actor);
  tz := coalesce((select value #>> '{}' from public.platform_settings where key='timezone'),'Asia/Aqtobe');
  month_start := date_trunc('month', now() at time zone tz) at time zone tz;
  with cur as (
    select distinct on (t.id) t.id as tenant_id, s.id as sub_id, s.ends_at, s.plan_id,
      case when s.id is null then 'none' else public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at) end as phase
    from public.tenants t left join public.subscriptions s on s.tenant_id=t.id
    order by t.id, coalesce(s.status in ('trial','active','grace','suspended'),false) desc, s.created_at desc nulls last)
  select jsonb_build_object(
    'organizations',(select count(*) from cur),
    'active',(select count(*) from cur where phase='active'),
    'trial',(select count(*) from cur where phase='trial'),
    'grace',(select count(*) from cur where phase='grace'),
    'suspended',(select count(*) from cur where phase in ('suspended','expired')),
    'revenue_month_kzt',coalesce((select sum(amount_kzt) from public.saas_payments where status='paid' and received_at>=month_start),0),
    'expiring',coalesce((select jsonb_agg(jsonb_build_object('tenant_id',c.tenant_id,'slug',t.slug,'name',t.config->>'name',
        'plan',p.code,'phase',c.phase,'ends_at',c.ends_at) order by c.ends_at)
      from cur c join public.tenants t on t.id=c.tenant_id join public.plans p on p.id=c.plan_id
      where c.ends_at is not null and c.ends_at between now() and now()+interval '7 days' and c.phase in ('trial','active')),'[]'::jsonb),
    'new_by_month',coalesce((select jsonb_agg(jsonb_build_object('month',m,'count',n) order by m)
      from (select to_char(date_trunc('month',coalesce(t.created_at,(select min(created_at) from public.subscriptions x where x.tenant_id=t.id)) at time zone tz),'YYYY-MM') as m,count(*) as n
            from public.tenants t group by 1) q),'[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function public.platform_list_tenants(p_actor uuid,p_search text default null,p_phase text default null,
  p_plan text default null,p_limit int default 50,p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb; q text := nullif(trim(coalesce(p_search,'')),'');
begin
  perform public.platform_assert(p_actor);
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created desc nulls last),'[]'::jsonb) into r from (
    select * from (
      select t.id,t.slug,t.config->>'name' as name,t.status as tenant_status,
        coalesce(t.created_at,s.created_at) as created,
        (select u.email from public.tenant_members m join auth.users u on u.id=m.user_id
          where m.tenant_id=t.id and m.role='owner' order by u.created_at limit 1) as owner_email,
        p.code as plan_code,s.id as subscription_id,s.ends_at,
        case when s.id is null then 'none' else public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at) end as phase
      from public.tenants t
      left join lateral (select * from public.subscriptions x where x.tenant_id=t.id
        order by (x.status in ('trial','active','grace','suspended')) desc,x.created_at desc limit 1) s on true
      left join public.plans p on p.id=s.plan_id) y
    where (q is null or y.name ilike '%'||q||'%' or y.slug ilike '%'||q||'%' or y.owner_email ilike '%'||q||'%')
      and (p_phase is null or y.phase=p_phase) and (p_plan is null or y.plan_code=p_plan)
    order by y.created desc nulls last limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)) x;
  return r;
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
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'last_sign_in_at',u.last_sign_in_at))
      from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=t.id),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'plan_code',p.code,'plan_name',p.name,'status',s.status,
        'phase',public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at),'starts_at',s.starts_at,'ends_at',s.ends_at,
        'grace_ends_at',s.grace_ends_at,'created_at',s.created_at) order by s.created_at desc)
      from public.subscriptions s join public.plans p on p.id=s.plan_id where s.tenant_id=t.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc) from (
      select id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,confirmed_by,refund_reason,note
      from public.saas_payments where tenant_id=t.id order by received_at desc limit 100) x),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select e.id,e.subscription_id,e.type,e.payload,e.actor_id,e.created_at
      from public.subscription_events e join public.subscriptions s on s.id=e.subscription_id
      where s.tenant_id=t.id order by e.created_at desc limit 100) x),'[]'::jsonb),
    'counters',jsonb_build_object(
      'staff',(select count(*) from public.tenant_members where tenant_id=t.id),
      'services',(select count(*) from public.services where tenant_id=t.id),
      'bookings_30d',(select count(*) from public.bookings where tenant_id=t.id and created_at>=now()-interval '30 days'))
  ) into r;
  return r;
end $$;

create or replace function public.platform_list_subscriptions(p_actor uuid,p_phase text default null,p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb;
begin
  perform public.platform_assert(p_actor);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into r from (
    select * from (
      select s.id,s.tenant_id,t.slug,t.config->>'name' as name,p.code as plan_code,s.status,
        public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at) as phase,s.starts_at,s.ends_at,s.grace_ends_at,s.created_at
      from public.subscriptions s join public.tenants t on t.id=s.tenant_id join public.plans p on p.id=s.plan_id) y
    where p_phase is null or y.phase=p_phase order by y.created_at desc limit least(greatest(p_limit,1),500)) x;
  return r;
end $$;

create or replace function public.platform_list_plans(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order,p.code) from public.plans p),'[]'::jsonb);
end $$;

create or replace function public.platform_list_payments(p_actor uuid,p_status text default null,p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc) from (
    select pay.id,pay.tenant_id,t.slug,t.config->>'name' as name,pay.subscription_id,pay.amount_kzt,pay.period_start,pay.period_end,
      pay.method,pay.status,pay.received_at,pay.confirmed_by,pay.refund_reason,pay.note
    from public.saas_payments pay join public.tenants t on t.id=pay.tenant_id
    where p_status is null or pay.status=p_status order by pay.received_at desc limit least(greatest(p_limit,1),500)) x),'[]'::jsonb);
end $$;

create or replace function public.platform_audit_list(p_actor uuid,p_tenant uuid default null,p_from timestamptz default null,
  p_to timestamptz default null,p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select a.id,a.actor_id,u.email as actor_email,a.action,a.tenant_id,t.slug,a.payload,a.created_at
    from public.platform_audit_logs a left join auth.users u on u.id=a.actor_id left join public.tenants t on t.id=a.tenant_id
    where (p_tenant is null or a.tenant_id=p_tenant) and (p_from is null or a.created_at>=p_from) and (p_to is null or a.created_at<p_to)
    order by a.created_at desc limit least(greatest(p_limit,1),1000)) x),'[]'::jsonb);
end $$;

create or replace function public.platform_get_settings(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  return coalesce((select jsonb_object_agg(key,value) from public.platform_settings),'{}'::jsonb);
end $$;

-- ------------------------------------------------------------------ настройки и тарифы
create or replace function public.platform_set_setting(p_actor uuid,p_key text,p_value jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare n int;
begin
  perform public.platform_assert(p_actor);
  if p_key not in ('trial_days','grace_days') then raise exception 'bad_setting'; end if;
  begin n := (p_value #>> '{}')::int; exception when others then raise exception 'bad_value'; end;
  if n < case when p_key='trial_days' then 1 else 0 end or n > case when p_key='trial_days' then 90 else 30 end then raise exception 'bad_value'; end if;
  insert into public.platform_settings(key,value,updated_at) values(p_key,to_jsonb(n),now())
    on conflict(key) do update set value=excluded.value,updated_at=now();
  perform public.platform_log(p_actor,'settings.update',null,jsonb_build_object('key',p_key,'value',n));
end $$;

-- Тарифы нельзя удалять, только выключать (функции удаления нет намеренно).
create or replace function public.platform_upsert_plan(p_actor uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pid uuid; v_code text;
begin
  perform public.platform_assert(p_actor);
  if nullif(p->>'id','') is not null then
    pid := (p->>'id')::uuid;
    update public.plans set name=coalesce(nullif(p->>'name',''),name),
      description=case when p ? 'description' then p->>'description' else description end,
      price_kzt=coalesce((p->>'price_kzt')::int,price_kzt),
      period_months=coalesce((p->>'period_months')::int,period_months),
      features=case when p ? 'features' then p->'features' else features end,
      is_active=coalesce((p->>'is_active')::boolean,is_active),
      sort_order=coalesce((p->>'sort_order')::int,sort_order)
    where id=pid;
    if not found then raise exception 'not_found'; end if;
  else
    v_code := upper(trim(coalesce(p->>'code','')));
    insert into public.plans(code,name,description,price_kzt,period_months,features,is_active,sort_order)
    values(v_code,p->>'name',p->>'description',(p->>'price_kzt')::int,coalesce((p->>'period_months')::int,1),
      coalesce(p->'features','[]'::jsonb),coalesce((p->>'is_active')::boolean,true),coalesce((p->>'sort_order')::int,100))
    returning id into pid;
  end if;
  perform public.platform_log(p_actor,'plan.upsert',null,jsonb_build_object('plan_id',pid,'data',p));
  return jsonb_build_object('id',pid);
end $$;

-- ------------------------------------------------------------------ создание организации (одна транзакция, идемпотентно)
-- Пользователь-владелец создаётся заранее Edge Function через Auth Admin API и передаётся как owner_user_id.
create or replace function public.platform_create_tenant(p_actor uuid,p_key text,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prev public.platform_requests; fingerprint text; tid uuid; sid uuid; plan public.plans; v_slug text; tz text; start_at timestamptz; end_at timestamptz;
  grace int; trial boolean; months int; cfg jsonb; svc jsonb; res jsonb; owner uuid;
begin
  perform public.platform_assert(p_actor);
  fingerprint := md5(jsonb_build_object('action','tenant.create','payload',p)::text);
  select * into prev from public.platform_requests where idempotency_key=p_key;
  if found then
    if prev.actor_id is distinct from p_actor or prev.action<>'tenant.create' or prev.request_fingerprint<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return prev.result || jsonb_build_object('replayed',true);
  end if;

  v_slug := lower(trim(coalesce(p->>'slug','')));
  if v_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'bad_slug'; end if;
  if exists(select 1 from public.tenants where tenants.slug=v_slug) then raise exception 'slug_taken'; end if;
  if length(trim(coalesce(p->>'name',''))) not between 2 and 80 then raise exception 'bad_name'; end if;
  tz := coalesce(nullif(p->>'timezone',''),'Asia/Aqtobe');
  if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'bad_timezone'; end if;
  owner := (p->>'owner_user_id')::uuid;
  if owner is null or not exists(select 1 from auth.users where id=owner) then raise exception 'owner_missing'; end if;

  trial := coalesce((p->>'trial')::boolean,false);
  select * into plan from public.plans where code=upper(coalesce(nullif(p->>'plan_code',''),'START')) and is_active;
  if not found then raise exception 'plan_not_found'; end if;
  start_at := coalesce(nullif(p->>'start','')::timestamptz,now());
  grace := public.platform_setting_int('grace_days',5);
  if trial then end_at := start_at + make_interval(days => public.platform_setting_int('trial_days',14));
  else
    months := coalesce((p->>'months')::int,plan.period_months);
    if months not between 1 and 36 then raise exception 'bad_duration'; end if;
    end_at := start_at + make_interval(months => months);
  end if;

  cfg := jsonb_build_object('slug',v_slug,'name',trim(p->>'name'),'short_name',trim(p->>'name'),'accent','#4690FF',
    'timezone',tz,'currency',coalesce(nullif(p->>'currency',''),'₸'),'buffer_minutes',15,'slot_minutes',60,'cancel_hours',24,
    'business_type',coalesce(nullif(p->>'business_type',''),'autoservice'),'phone',coalesce(p->>'phone',''),'address',coalesce(p->>'address',''),
    'description','','resources',jsonb_build_array('Пост 1'),
    'hours',jsonb_build_object('mon',jsonb_build_array('09:00','18:00'),'tue',jsonb_build_array('09:00','18:00'),
      'wed',jsonb_build_array('09:00','18:00'),'thu',jsonb_build_array('09:00','18:00'),'fri',jsonb_build_array('09:00','18:00'),
      'sat',jsonb_build_array('09:00','16:00'),'sun','null'::jsonb));
  insert into public.tenants(slug,status,timezone,buffer_minutes,config,created_at) values(v_slug,'live',tz,15,cfg,now()) returning id into tid;
  insert into public.resources(tenant_id,name) values(tid,'Пост 1');

  for svc in select * from jsonb_array_elements(coalesce(p->'services','[]'::jsonb)) loop
    if length(trim(coalesce(svc->>'name',''))) between 1 and 120 and coalesce((svc->>'price')::int,-1)>=0 and coalesce((svc->>'duration_minutes')::int,0)>0 then
      insert into public.services(tenant_id,name,category,price_cents,duration_minutes)
      values(tid,trim(svc->>'name'),coalesce(nullif(svc->>'category',''),'Другое'),(svc->>'price')::int*100,(svc->>'duration_minutes')::int);
    end if;
  end loop;

  insert into public.tenant_members(tenant_id,user_id,role) values(tid,owner,'owner');
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at,ends_at,grace_ends_at)
    values(tid,plan.id,case when trial then 'trial' else 'active' end,start_at,end_at,end_at+make_interval(days=>grace)) returning id into sid;
  perform public.platform_sub_event(sid,'created',jsonb_build_object('plan',plan.code,'trial',trial,'starts_at',start_at,'ends_at',end_at),p_actor);
  perform public.platform_log(p_actor,'tenant.create',tid,jsonb_build_object('slug',v_slug,'plan',plan.code,'owner_user_id',owner,'owner_email',p->>'owner_email'));

  res := jsonb_build_object('tenant_id',tid,'subscription_id',sid,'slug',v_slug);
  insert into public.platform_requests(idempotency_key,action,actor_id,request_fingerprint,result) values(p_key,'tenant.create',p_actor,fingerprint,res);
  return res;
end $$;

-- ------------------------------------------------------------------ подписки
create or replace function public.platform_create_subscription(p_actor uuid,p_key text,p_tenant uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prev public.platform_requests; fingerprint text; plan public.plans; sid uuid; start_at timestamptz; end_at timestamptz; trial boolean; months int; res jsonb;
begin
  perform public.platform_assert(p_actor);
  fingerprint := md5(jsonb_build_object('action','subscription.create','tenant_id',p_tenant,'payload',p)::text);
  select * into prev from public.platform_requests where idempotency_key=p_key;
  if found then
    if prev.actor_id is distinct from p_actor or prev.action<>'subscription.create' or prev.request_fingerprint<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return prev.result || jsonb_build_object('replayed',true);
  end if;
  if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'not_found'; end if;
  if exists(select 1 from public.subscriptions where tenant_id=p_tenant and status in ('trial','active','grace','suspended')) then raise exception 'subscription_exists'; end if;
  select * into plan from public.plans where code=upper(coalesce(nullif(p->>'plan_code',''),'START')) and is_active;
  if not found then raise exception 'plan_not_found'; end if;
  trial := coalesce((p->>'trial')::boolean,false);
  start_at := coalesce(nullif(p->>'start','')::timestamptz,now());
  if trial then end_at := start_at + make_interval(days=>public.platform_setting_int('trial_days',14));
  else months := coalesce((p->>'months')::int,plan.period_months);
    if months not between 1 and 36 then raise exception 'bad_duration'; end if;
    end_at := start_at + make_interval(months=>months); end if;
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at,ends_at,grace_ends_at)
    values(p_tenant,plan.id,case when trial then 'trial' else 'active' end,start_at,end_at,end_at+make_interval(days=>public.platform_setting_int('grace_days',5)))
    returning id into sid;
  perform public.platform_sub_event(sid,'created',jsonb_build_object('plan',plan.code,'trial',trial,'ends_at',end_at),p_actor);
  perform public.platform_log(p_actor,'subscription.create',p_tenant,jsonb_build_object('subscription_id',sid,'plan',plan.code));
  res := jsonb_build_object('subscription_id',sid);
  insert into public.platform_requests(idempotency_key,action,actor_id,request_fingerprint,result) values(p_key,'subscription.create',p_actor,fingerprint,res);
  return res;
end $$;

-- actions: extend{months|days} | change_plan{plan_code} | set_dates{starts_at,ends_at} | suspend{reason} | resume{force?} | cancel{reason}
create or replace function public.platform_subscription_action(p_actor uuid,p_key text,p_sub uuid,p_action text,p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prev public.platform_requests; fingerprint text; s public.subscriptions; plan public.plans; grace int; base timestamptz; new_end timestamptz; new_start timestamptz;
  new_status text; pay public.saas_payments; res jsonb; n int; d int;
begin
  perform public.platform_assert(p_actor);
  fingerprint := md5(jsonb_build_object('action','subscription.'||p_action,'subscription_id',p_sub,'payload',coalesce(p,'{}'::jsonb))::text);
  select * into prev from public.platform_requests where idempotency_key=p_key;
  if found then
    if prev.actor_id is distinct from p_actor or prev.action<>('subscription.'||p_action) or prev.request_fingerprint<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return prev.result || jsonb_build_object('replayed',true);
  end if;
  select * into s from public.subscriptions where id=p_sub for update;
  if not found then raise exception 'not_found'; end if;
  grace := public.platform_setting_int('grace_days',5);

  if p_action='extend' then
    if s.ends_at is null then raise exception 'unlimited_subscription'; end if;
    n := nullif(p->>'months','')::int; d := nullif(p->>'days','')::int;
    if (n is null and d is null) or coalesce(n,1) not between 1 and 36 or coalesce(d,1) not between 1 and 366 then raise exception 'bad_duration'; end if;
    base := greatest(s.ends_at,now());
    new_end := base + make_interval(months=>coalesce(n,0),days=>coalesce(d,0));
    new_status := case when s.status in ('expired','grace') then 'active' else s.status end;
    update public.subscriptions set ends_at=new_end,grace_ends_at=new_end+make_interval(days=>grace),status=new_status where id=s.id;
    perform public.platform_sub_event(s.id,'extended',jsonb_build_object('from',s.ends_at,'to',new_end,'months',n,'days',d),p_actor);
  elsif p_action='change_plan' then
    select * into plan from public.plans where code=upper(coalesce(p->>'plan_code','')) and is_active;
    if not found then raise exception 'plan_not_found'; end if;
    update public.subscriptions set plan_id=plan.id where id=s.id;
    perform public.platform_sub_event(s.id,'plan_changed',jsonb_build_object('from_plan_id',s.plan_id,'to',plan.code),p_actor);
  elsif p_action='set_dates' then
    new_start := coalesce(nullif(p->>'starts_at','')::timestamptz,s.starts_at);
    new_end := nullif(p->>'ends_at','')::timestamptz;
    if new_end is null or new_end <= new_start then raise exception 'bad_dates'; end if;
    update public.subscriptions set starts_at=new_start,ends_at=new_end,grace_ends_at=new_end+make_interval(days=>grace),
      status=case when s.status in ('expired','grace') and new_end>now() then 'active' else s.status end where id=s.id;
    perform public.platform_sub_event(s.id,'dates_changed',jsonb_build_object('starts_at',new_start,'ends_at',new_end,'was_starts_at',s.starts_at,'was_ends_at',s.ends_at),p_actor);
  elsif p_action='suspend' then
    if s.status not in ('trial','active','grace') and public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at) not in ('trial','active','grace','scheduled') then raise exception 'bad_status'; end if;
    update public.subscriptions set status='suspended' where id=s.id;
    perform public.platform_sub_event(s.id,'suspended',jsonb_build_object('reason',p->>'reason'),p_actor);
  elsif p_action='resume' then
    if s.status not in ('suspended','expired') then raise exception 'bad_status'; end if;
    select * into pay from public.saas_payments where subscription_id=s.id and status='paid' and period_end>now() order by period_end desc limit 1;
    if found then new_end := pay.period_end;
    elsif coalesce((p->>'force')::boolean,false) then
      select * into plan from public.plans where id=s.plan_id;
      new_end := now() + make_interval(months=>plan.period_months);
    else raise exception 'no_paid_payment'; end if;
    update public.subscriptions set status='active',ends_at=new_end,grace_ends_at=new_end+make_interval(days=>grace) where id=s.id;
    perform public.platform_sub_event(s.id,'resumed',jsonb_build_object('ends_at',new_end,'payment_id',pay.id,'forced',pay.id is null),p_actor);
  elsif p_action='cancel' then
    if s.status in ('cancelled') then raise exception 'bad_status'; end if;
    update public.subscriptions set status='cancelled' where id=s.id;
    perform public.platform_sub_event(s.id,'cancelled',jsonb_build_object('reason',p->>'reason'),p_actor);
  else raise exception 'bad_action'; end if;

  perform public.platform_log(p_actor,'subscription.'||p_action,s.tenant_id,jsonb_build_object('subscription_id',s.id,'data',p));
  select jsonb_build_object('subscription_id',x.id,'status',x.status,'ends_at',x.ends_at,'phase',public.subscription_phase(x.status,x.starts_at,x.ends_at,x.grace_ends_at))
    into res from public.subscriptions x where x.id=s.id;
  insert into public.platform_requests(idempotency_key,action,actor_id,request_fingerprint,result) values(p_key,'subscription.'||p_action,p_actor,fingerprint,res);
  return res;
end $$;

-- ------------------------------------------------------------------ платежи SaaS
create or replace function public.platform_create_payment(p_actor uuid,p_key text,p_tenant uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pid uuid; sid uuid; fingerprint text; existing public.saas_payments;
begin
  perform public.platform_assert(p_actor);
  if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'not_found'; end if;
  fingerprint := md5(jsonb_build_object('tenant_id',p_tenant,'payload',p)::text);
  select * into existing from public.saas_payments where idempotency_key=p_key;
  if found then
    if existing.tenant_id<>p_tenant or existing.created_by is distinct from p_actor or existing.request_fingerprint<>fingerprint then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'replayed',true);
  end if;
  select id into sid from public.subscriptions where tenant_id=p_tenant
    order by (status in ('trial','active','grace','suspended')) desc,created_at desc limit 1;
  insert into public.saas_payments(tenant_id,subscription_id,amount_kzt,period_start,period_end,method,received_at,note,created_by,request_fingerprint,idempotency_key)
  values(p_tenant,sid,(p->>'amount_kzt')::int,(p->>'period_start')::timestamptz,(p->>'period_end')::timestamptz,
    coalesce(p->>'method','other'),coalesce(nullif(p->>'received_at','')::timestamptz,now()),nullif(p->>'note',''),p_actor,fingerprint,p_key)
  returning id into pid;
  perform public.platform_log(p_actor,'payment.create',p_tenant,jsonb_build_object('payment_id',pid,'amount_kzt',p->>'amount_kzt'));
  return jsonb_build_object('id',pid,'status','pending');
end $$;

create or replace function public.platform_confirm_payment(p_actor uuid,p_payment uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pay public.saas_payments;
begin
  perform public.platform_assert(p_actor);
  select * into pay from public.saas_payments where id=p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pay.status='paid' then return jsonb_build_object('id',pay.id,'status','paid','replayed',true); end if;
  if pay.status<>'pending' then raise exception 'bad_status'; end if;
  update public.saas_payments set status='paid',confirmed_by=p_actor where id=pay.id;
  if pay.subscription_id is not null then
    perform public.platform_sub_event(pay.subscription_id,'payment_confirmed',jsonb_build_object('payment_id',pay.id,'amount_kzt',pay.amount_kzt),p_actor); end if;
  perform public.platform_log(p_actor,'payment.confirm',pay.tenant_id,jsonb_build_object('payment_id',pay.id,'amount_kzt',pay.amount_kzt));
  return jsonb_build_object('id',pay.id,'status','paid');
end $$;

create or replace function public.platform_refund_payment(p_actor uuid,p_payment uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pay public.saas_payments;
begin
  perform public.platform_assert(p_actor);
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;
  select * into pay from public.saas_payments where id=p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pay.status='refunded' then return jsonb_build_object('id',pay.id,'status','refunded','replayed',true); end if;
  if pay.status<>'paid' then raise exception 'bad_status'; end if;
  update public.saas_payments set status='refunded',refund_reason=trim(p_reason) where id=pay.id;
  if pay.subscription_id is not null then
    perform public.platform_sub_event(pay.subscription_id,'payment_refunded',jsonb_build_object('payment_id',pay.id,'reason',trim(p_reason)),p_actor); end if;
  perform public.platform_log(p_actor,'payment.refund',pay.tenant_id,jsonb_build_object('payment_id',pay.id,'reason',trim(p_reason)));
  return jsonb_build_object('id',pay.id,'status','refunded');
end $$;

create or replace function public.platform_fail_payment(p_actor uuid,p_payment uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pay public.saas_payments;
begin
  perform public.platform_assert(p_actor);
  select * into pay from public.saas_payments where id=p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pay.status='failed' then return jsonb_build_object('id',pay.id,'status','failed','replayed',true); end if;
  if pay.status<>'pending' then raise exception 'bad_status'; end if;
  update public.saas_payments set status='failed',note=coalesce(nullif(trim(p_reason),''),note) where id=pay.id;
  perform public.platform_log(p_actor,'payment.fail',pay.tenant_id,jsonb_build_object('payment_id',pay.id,'reason',p_reason));
  return jsonb_build_object('id',pay.id,'status','failed');
end $$;

-- ------------------------------------------------------------------ ночная синхронизация статусов
create or replace function public.platform_sync_subscriptions() returns jsonb
language plpgsql security definer set search_path=public as $$
declare g int; e int;
begin
  with moved as (
    update public.subscriptions set status='grace'
    where status in ('trial','active') and ends_at is not null and now()>=ends_at and now()<coalesce(grace_ends_at,ends_at)
    returning id,ends_at,grace_ends_at),
  ev as (insert into public.subscription_events(subscription_id,type,payload)
    select id,'grace_started',jsonb_build_object('ends_at',ends_at,'grace_ends_at',grace_ends_at) from moved returning 1)
  select count(*) into g from moved;
  with moved as (
    update public.subscriptions set status='expired'
    where status in ('trial','active','grace') and ends_at is not null and now()>=coalesce(grace_ends_at,ends_at)
    returning id,ends_at),
  ev as (insert into public.subscription_events(subscription_id,type,payload)
    select id,'expired',jsonb_build_object('ends_at',ends_at) from moved returning 1)
  select count(*) into e from moved;
  return jsonb_build_object('grace',g,'expired',e);
end $$;

-- ------------------------------------------------------------------ экспорт данных организации
-- Возвращает таблицы как массивы JSON; Edge Function превращает их в CSV и ZIP. token_hash не экспортируется.
create or replace function public.tenant_export_data(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'bookings',coalesce((select jsonb_agg(to_jsonb(b)-'token_hash' order by b.starts_at) from public.bookings b where b.tenant_id=p_tenant),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.last_visit desc) from (
        select customer_phone as phone,max(customer_name) as name,string_agg(distinct car,', ') as cars,count(*) as bookings,
          count(*) filter (where status='done') as completed,max(starts_at) as last_visit
        from public.bookings where tenant_id=p_tenant group by customer_phone) c),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.services s where s.tenant_id=p_tenant),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(to_jsonb(v)) from public.booking_reviews v where v.tenant_id=p_tenant),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p where p.tenant_id=p_tenant),'[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ------------------------------------------------------------------ права: только service_role
revoke all on function public.platform_log(uuid,text,uuid,jsonb), public.platform_sub_event(uuid,text,jsonb,uuid),
  public.platform_dashboard(uuid), public.platform_list_tenants(uuid,text,text,text,int,int), public.platform_tenant_card(uuid,uuid),
  public.platform_list_subscriptions(uuid,text,int), public.platform_list_plans(uuid), public.platform_list_payments(uuid,text,int),
  public.platform_audit_list(uuid,uuid,timestamptz,timestamptz,int), public.platform_get_settings(uuid),
  public.platform_set_setting(uuid,text,jsonb), public.platform_upsert_plan(uuid,jsonb), public.platform_create_tenant(uuid,text,jsonb),
  public.platform_create_subscription(uuid,text,uuid,jsonb), public.platform_subscription_action(uuid,text,uuid,text,jsonb),
  public.platform_create_payment(uuid,text,uuid,jsonb), public.platform_confirm_payment(uuid,uuid),
  public.platform_refund_payment(uuid,uuid,text), public.platform_fail_payment(uuid,uuid,text),
  public.platform_sync_subscriptions(), public.tenant_export_data(uuid) from public, anon, authenticated;
grant execute on function public.platform_log(uuid,text,uuid,jsonb), public.platform_sub_event(uuid,text,jsonb,uuid),
  public.platform_dashboard(uuid), public.platform_list_tenants(uuid,text,text,text,int,int), public.platform_tenant_card(uuid,uuid),
  public.platform_list_subscriptions(uuid,text,int), public.platform_list_plans(uuid), public.platform_list_payments(uuid,text,int),
  public.platform_audit_list(uuid,uuid,timestamptz,timestamptz,int), public.platform_get_settings(uuid),
  public.platform_set_setting(uuid,text,jsonb), public.platform_upsert_plan(uuid,jsonb), public.platform_create_tenant(uuid,text,jsonb),
  public.platform_create_subscription(uuid,text,uuid,jsonb), public.platform_subscription_action(uuid,text,uuid,text,jsonb),
  public.platform_create_payment(uuid,text,uuid,jsonb), public.platform_confirm_payment(uuid,uuid),
  public.platform_refund_payment(uuid,uuid,text), public.platform_fail_payment(uuid,uuid,text),
  public.platform_sync_subscriptions(), public.tenant_export_data(uuid) to service_role;

-- ночная синхронизация (если pg_cron уже включён для notify-dispatch)
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('platform-sync-subscriptions','10 0 * * *',$cron$select public.platform_sync_subscriptions()$cron$);
  end if;
end $$;
