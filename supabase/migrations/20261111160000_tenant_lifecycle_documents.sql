-- Reversible organization lifecycle and SaaS document register (no tax-system integration).
alter table public.tenants add column if not exists deletion_requested_at timestamptz;
alter table public.tenants add column if not exists deletion_reason text;

create or replace function public.platform_tenant_card(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t public.tenants; r jsonb;
begin
  perform public.platform_assert(p_actor);
  select * into t from public.tenants where id=p_tenant; if not found then raise exception 'not_found'; end if;
  select jsonb_build_object('tenant',jsonb_build_object('id',t.id,'slug',t.slug,'status',t.status,'timezone',t.timezone,'created_at',t.created_at,'config',t.config,'archived_at',t.archived_at,'deletion_requested_at',t.deletion_requested_at,'deletion_reason',t.deletion_reason),
    'access_state',public.tenant_access_state(t.id),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'last_sign_in_at',u.last_sign_in_at)) from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=t.id),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'plan_code',p.code,'plan_name',p.name,'status',s.status,'phase',public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at),'starts_at',s.starts_at,'ends_at',s.ends_at,'grace_ends_at',s.grace_ends_at,'created_at',s.created_at) order by s.created_at desc) from public.subscriptions s join public.plans p on p.id=s.plan_id where s.tenant_id=t.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at desc) from (select id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,confirmed_by,refund_reason,note from public.saas_payments where tenant_id=t.id order by received_at desc limit 100)x),'[]'::jsonb),
    'counters',jsonb_build_object('staff',(select count(*) from public.tenant_members where tenant_id=t.id),'services',(select count(*) from public.services where tenant_id=t.id),'bookings_30d',(select count(*) from public.bookings where tenant_id=t.id and created_at>=now()-interval '30 days')),
    'plan_access',public.tenant_plan_access(t.id),'plan_usage',public.tenant_plan_usage(t.id)) into r;
  return r;
end $$;
alter table public.tenants add column if not exists archived_at timestamptz;

create table if not exists public.platform_billing_documents(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_type text not null check(document_type in ('invoice','act')),
  number text not null,
  issue_date date not null,
  service_from date not null,
  service_to date not null,
  amount_kzt bigint not null check(amount_kzt>=0),
  currency text not null default 'KZT' check(currency='KZT'),
  seller jsonb not null default '{}'::jsonb,
  buyer jsonb not null default '{}'::jsonb,
  description text not null,
  payment_id uuid references public.saas_payments(id) on delete set null,
  esf_number text,
  esf_status text not null default 'not_issued' check(esf_status in ('not_issued','draft','issued','rejected','corrected')),
  status text not null default 'draft' check(status in ('draft','issued','void')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(service_to>=service_from),
  unique(document_type,number)
);
create index if not exists platform_billing_documents_tenant_idx on public.platform_billing_documents(tenant_id,issue_date desc);
alter table public.platform_billing_documents enable row level security;
revoke all on public.platform_billing_documents from public,anon,authenticated;

create or replace function public.platform_tenant_lifecycle(p_actor uuid,p_tenant uuid,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.tenants; s public.subscriptions; due timestamptz;
begin
  perform public.platform_assert(p_actor);
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner' and is_active) then raise exception 'forbidden'; end if;
  if p_action not in ('archive','restore','delete_request') or length(btrim(coalesce(p_reason,'')))<5 or length(btrim(p_reason))>500 then raise exception 'bad_request'; end if;
  select * into t from public.tenants where id=p_tenant for update; if not found then raise exception 'not_found'; end if;
  if p_action='archive' then
    update public.tenants set archived_at=coalesce(archived_at,now()) where id=p_tenant;
  elsif p_action='restore' then
    update public.tenants set archived_at=null,deletion_requested_at=null,deletion_reason=null where id=p_tenant;
  else
    due:=now()+interval '30 days';
    update public.tenants set archived_at=coalesce(archived_at,now()),deletion_requested_at=coalesce(deletion_requested_at,now()),deletion_reason=btrim(p_reason) where id=p_tenant;
  end if;
  perform public.platform_log(p_actor,'tenant.'||p_action,p_tenant,jsonb_build_object('reason',btrim(p_reason),'retention_until',case when p_action='delete_request' then due else null end));
  return jsonb_build_object('archived_at',(select archived_at from public.tenants where id=p_tenant),'deletion_requested_at',(select deletion_requested_at from public.tenants where id=p_tenant),'retention_until',due);
end $$;

create or replace function public.platform_billing_document_save(p_actor uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare did uuid; tid uuid; typ text; docnum text; d public.platform_billing_documents; b jsonb; s jsonb;
begin
  perform public.platform_assert(p_actor);
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role in ('owner','finance') and is_active) then raise exception 'forbidden'; end if;
  begin tid:=(p->>'tenant_id')::uuid; exception when others then raise exception 'bad_request'; end;
  typ:=p->>'document_type';docnum:=btrim(coalesce(p->>'number',''));
  if typ not in ('invoice','act') or length(docnum) not between 1 and 40 or length(btrim(coalesce(p->>'description','')))<2 then raise exception 'bad_request';end if;
  begin
    b:=coalesce(p->'buyer','{}'::jsonb);s:=coalesce(p->'seller','{}'::jsonb);
    if (p->>'amount_kzt')::bigint<0 or (p->>'service_to')::date<(p->>'service_from')::date then raise exception 'bad_request';end if;
    insert into public.platform_billing_documents(tenant_id,document_type,number,issue_date,service_from,service_to,amount_kzt,seller,buyer,description,payment_id,esf_number,esf_status,status,created_by)
    values(tid,typ,docnum,(p->>'issue_date')::date,(p->>'service_from')::date,(p->>'service_to')::date,(p->>'amount_kzt')::bigint,s,b,p->>'description',nullif(p->>'payment_id','')::uuid,nullif(btrim(p->>'esf_number'),''),coalesce(p->>'esf_status','not_issued'),coalesce(p->>'status','draft'),p_actor)
    on conflict(document_type,number) do update set issue_date=excluded.issue_date,service_from=excluded.service_from,service_to=excluded.service_to,amount_kzt=excluded.amount_kzt,seller=excluded.seller,buyer=excluded.buyer,description=excluded.description,payment_id=excluded.payment_id,esf_number=excluded.esf_number,esf_status=excluded.esf_status,status=excluded.status
    returning id into did;
  exception when others then if sqlerrm='bad_request' then raise; else raise exception 'bad_request';end if;end;
  perform public.platform_log(p_actor,'billing_document.save',tid,jsonb_build_object('document_id',did,'type',typ,'number',docnum,'esf_status',p->>'esf_status'));
  return jsonb_build_object('id',did);
end $$;

create or replace function public.platform_billing_documents_list(p_actor uuid,p_tenant uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.platform_assert(p_actor);
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role in ('owner','finance','read_only') and is_active) then raise exception 'forbidden';end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.issue_date desc,x.created_at desc) from (select * from public.platform_billing_documents where p_tenant is null or tenant_id=p_tenant order by issue_date desc,created_at desc limit 500)x),'[]'::jsonb);
end $$;

revoke all on function public.platform_tenant_lifecycle(uuid,uuid,text,text),public.platform_billing_document_save(uuid,jsonb),public.platform_billing_documents_list(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_tenant_lifecycle(uuid,uuid,text,text),public.platform_billing_document_save(uuid,jsonb),public.platform_billing_documents_list(uuid,uuid) to service_role;
notify pgrst,'reload schema';
