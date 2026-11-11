-- Trial identity ledger: one trial per verified email, phone or BIN/IIN.
create table public.trial_identity_claims(
  identity_type text not null check(identity_type in ('email','phone','bin_iin')),
  identity_hash text not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  claimed_at timestamptz not null default now(),
  primary key(identity_type,identity_hash),
  unique(tenant_id,identity_type)
);
alter table public.trial_identity_claims enable row level security;
revoke all on public.trial_identity_claims from public,anon,authenticated;
create or replace function public.trial_identity_hash(p_value text) returns text language sql immutable strict set search_path=public as $$
  select encode(digest(lower(regexp_replace(btrim(p_value),'[^[:alnum:]@.]','','g')),'sha256'),'hex')
$$;
create or replace function public.claim_trial_identities(p_tenant uuid,p_email text,p_phone text,p_bin text) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare em text:=public.trial_identity_hash(coalesce(p_email,'')); ph text:=public.trial_identity_hash(coalesce(p_phone,'')); bn text:=public.trial_identity_hash(coalesce(p_bin,''));
begin
  if nullif(p_email,'') is null then raise exception 'trial_identity_required'; end if;
  if exists(select 1 from public.trial_identity_claims where (identity_type='email' and identity_hash=em) or (nullif(p_phone,'') is not null and identity_type='phone' and identity_hash=ph) or (nullif(p_bin,'') is not null and identity_type='bin_iin' and identity_hash=bn)) then raise exception 'trial_already_used'; end if;
  insert into public.trial_identity_claims(identity_type,identity_hash,tenant_id) values('email',em,p_tenant);
  if nullif(p_phone,'') is not null then insert into public.trial_identity_claims values('phone',ph,p_tenant,now()); end if;
  if nullif(p_bin,'') is not null then insert into public.trial_identity_claims values('bin_iin',bn,p_tenant,now()); end if;
exception when unique_violation then raise exception 'trial_already_used';
end $$;
revoke all on function public.trial_identity_hash(text),public.claim_trial_identities(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_trial_identities(uuid,text,text,text) to service_role;
-- Insert trial identities transactionally with the tenant and trial subscription.
create or replace function public.platform_create_tenant(p_actor uuid,p_key text,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prev public.platform_requests; fingerprint text; tid uuid; sid uuid; plan public.plans; v_slug text; tz text; start_at timestamptz; end_at timestamptz;
  grace int; trial boolean; months int; cfg jsonb; svc jsonb; res jsonb; owner uuid; service_count int:=0;
begin
  perform public.platform_assert(p_actor);
  fingerprint:=md5(jsonb_build_object('action','tenant.create','payload',p)::text);
  select * into prev from public.platform_requests where idempotency_key=p_key;
  if found then if prev.actor_id is distinct from p_actor or prev.action<>'tenant.create' or prev.request_fingerprint<>fingerprint then raise exception 'idempotency_conflict'; end if; return prev.result||jsonb_build_object('replayed',true); end if;
  v_slug:=lower(trim(coalesce(p->>'slug',''))); if v_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'bad_slug'; end if;
  if exists(select 1 from public.tenants where slug=v_slug) then raise exception 'slug_taken'; end if;
  if length(trim(coalesce(p->>'name',''))) not between 2 and 80 then raise exception 'bad_name'; end if;
  tz:=coalesce(nullif(p->>'timezone',''),'Asia/Aqtobe'); if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'bad_timezone'; end if;
  owner:=(p->>'owner_user_id')::uuid; if owner is null or not exists(select 1 from auth.users where id=owner) then raise exception 'owner_missing'; end if;
  trial:=coalesce((p->>'trial')::boolean,false);
  if trial and exists(select 1 from public.trial_identity_claims where identity_type='email' and identity_hash=public.trial_identity_hash(coalesce(p->>'owner_email',''))) then raise exception 'trial_already_used'; end if;
  select * into plan from public.plans where code=upper(coalesce(nullif(p->>'plan_code',''),'START')) and is_active; if not found then raise exception 'plan_not_found'; end if;
  if jsonb_typeof(coalesce(p->'services','[]'::jsonb))<>'array' then raise exception 'bad_request'; end if;
  select count(*)::int into service_count from jsonb_array_elements(coalesce(p->'services','[]'::jsonb)) as x(s) where length(trim(coalesce(s->>'name',''))) between 1 and 120 and coalesce((s->>'price')::int,-1)>=0 and coalesce((s->>'duration_minutes')::int,0)>0;
  if plan.limits->'services' is not null and plan.limits->'services'<>'null'::jsonb and service_count>(plan.limits->>'services')::int then raise exception 'plan_limit_services'; end if;
  start_at:=coalesce(nullif(p->>'start','')::timestamptz,now()); grace:=public.platform_setting_int('grace_days',5);
  if trial then end_at:=start_at+make_interval(days=>public.platform_setting_int('trial_days',14)); else months:=coalesce((p->>'months')::int,plan.period_months); if months not between 1 and 36 then raise exception 'bad_duration'; end if; end_at:=start_at+make_interval(months=>months); end if;
  cfg:=jsonb_build_object('slug',v_slug,'name',trim(p->>'name'),'short_name',trim(p->>'name'),'accent','#4690FF','timezone',tz,'currency',coalesce(nullif(p->>'currency',''),'₸'),'buffer_minutes',15,'slot_minutes',60,'cancel_hours',24,'business_type',coalesce(nullif(p->>'business_type',''),'autoservice'),'phone',coalesce(p->>'phone',''),'address',coalesce(p->>'address',''),'description','','resources',jsonb_build_array('Пост 1'),'hours',jsonb_build_object('mon',jsonb_build_array('09:00','18:00'),'tue',jsonb_build_array('09:00','18:00'),'wed',jsonb_build_array('09:00','18:00'),'thu',jsonb_build_array('09:00','18:00'),'fri',jsonb_build_array('09:00','18:00'),'sat',jsonb_build_array('09:00','16:00'),'sun','null'::jsonb));
  insert into public.tenants(slug,status,timezone,buffer_minutes,config,created_at) values(v_slug,'live',tz,15,cfg,now()) returning id into tid;
  insert into public.resources(tenant_id,name) values(tid,'Пост 1'); insert into public.tenant_members(tenant_id,user_id,role) values(tid,owner,'owner');
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at,ends_at,grace_ends_at) values(tid,plan.id,case when trial then 'trial' else 'active' end,start_at,end_at,end_at+make_interval(days=>grace)) returning id into sid;
  if trial then perform public.claim_trial_identities(tid,coalesce(p->>'owner_email',''),coalesce(p->>'phone',''),coalesce(p->>'bin_iin','')); end if;
  for svc in select * from jsonb_array_elements(coalesce(p->'services','[]'::jsonb)) loop if length(trim(coalesce(svc->>'name',''))) between 1 and 120 and coalesce((svc->>'price')::int,-1)>=0 and coalesce((svc->>'duration_minutes')::int,0)>0 then insert into public.services(tenant_id,name,category,price_cents,duration_minutes) values(tid,trim(svc->>'name'),coalesce(nullif(svc->>'category',''),'Другое'),(svc->>'price')::int*100,(svc->>'duration_minutes')::int); end if; end loop;
  perform public.platform_sub_event(sid,'created',jsonb_build_object('plan',plan.code,'trial',trial,'starts_at',start_at,'ends_at',end_at),p_actor);
  perform public.platform_log(p_actor,'tenant.create',tid,jsonb_build_object('slug',v_slug,'plan',plan.code,'owner_user_id',owner,'owner_email',p->>'owner_email','trial',trial));
  res:=jsonb_build_object('tenant_id',tid,'subscription_id',sid,'slug',v_slug); insert into public.platform_requests(idempotency_key,action,actor_id,request_fingerprint,result) values(p_key,'tenant.create',p_actor,fingerprint,res);return res;
end $$;
revoke all on function public.platform_create_tenant(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.platform_create_tenant(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
