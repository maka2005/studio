-- SaaS health metrics for the platform dashboard. Revenue is based on confirmed payments.
create or replace function public.platform_dashboard(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare tz text; month_start timestamptz; year_start timestamptz; r jsonb;
begin
  perform public.platform_assert(p_actor);
  tz := coalesce((select value #>> '{}' from public.platform_settings where key='timezone'),'Asia/Aqtobe');
  month_start := date_trunc('month', now() at time zone tz) at time zone tz;
  year_start := (date_trunc('month', now() at time zone tz) - interval '11 months') at time zone tz;
  with cur as (
    select distinct on (t.id) t.id as tenant_id, s.id as sub_id, s.ends_at, s.plan_id,
      case when s.id is null then 'none' else public.subscription_phase(s.status,s.starts_at,s.ends_at,s.grace_ends_at) end as phase
    from public.tenants t left join public.subscriptions s on s.tenant_id=t.id
    order by t.id, coalesce(s.status in ('trial','active','grace','suspended'),false) desc, s.created_at desc nulls last
  ),
  paid_current as (
    select distinct s.tenant_id, p.price_kzt, p.period_months
    from public.subscriptions s join public.plans p on p.id=s.plan_id
    where s.status in ('active','grace')
      and exists (select 1 from public.saas_payments sp where sp.subscription_id=s.id and sp.status='paid' and sp.period_end>=now())
  ),
  trial_cohort as (
    select s.id, s.tenant_id, s.created_at
    from public.subscriptions s
    join public.subscription_events e on e.subscription_id=s.id and e.type='created' and coalesce((e.payload->>'trial')::boolean,false)
    where s.created_at >= now()-interval '12 months'
  ),
  churn as (
    select count(distinct s.tenant_id)::int as n
    from public.subscription_events e join public.subscriptions s on s.id=e.subscription_id
    where e.type in ('cancelled','expired') and e.created_at>=month_start and e.created_at<month_start+interval '1 month'
      and exists (select 1 from public.saas_payments sp where sp.subscription_id=s.id and sp.status in ('paid','refunded'))
  ),
  conversion as (
    select count(*)::int as trials,
      count(*) filter (where exists(select 1 from public.saas_payments p where p.tenant_id=t.tenant_id and p.status='paid'
        and p.received_at>=t.created_at and p.received_at<=t.created_at+interval '30 days'))::int as converted
    from trial_cohort t
  ),
  rev_months as (
    select to_char(date_trunc('month',sp.received_at at time zone tz),'YYYY-MM') as month,
      sum(sp.amount_kzt)::bigint as amount_kzt
    from public.saas_payments sp where sp.status='paid' and sp.received_at>=year_start
    group by 1
  )
  select jsonb_build_object(
    'organizations',(select count(*) from cur),
    'active',(select count(*) from cur where phase='active'),
    'trial',(select count(*) from cur where phase='trial'),
    'grace',(select count(*) from cur where phase='grace'),
    'suspended',(select count(*) from cur where phase in ('suspended','expired')),
    'revenue_month_kzt',coalesce((select sum(amount_kzt) from public.saas_payments where status='paid' and received_at>=month_start),0),
    'mrr_kzt',coalesce((select sum(price_kzt / period_months) from paid_current),0),
    'arr_kzt',coalesce((select sum(price_kzt / period_months)*12 from paid_current),0),
    'arpu_kzt',coalesce((select round(sum(price_kzt::numeric/period_months)/nullif(count(*),0)) from paid_current),0),
    'paying_organizations',(select count(*) from paid_current),
    'churned_this_month',(select n from churn),
    'churn_rate_pct',coalesce((select round(n*100.0/nullif(n+(select count(*) from paid_current),0),1) from churn),0),
    'trial_conversion_pct',coalesce((select round(converted*100.0/nullif(trials,0),1) from conversion),0),
    'trial_cohort_size',(select trials from conversion),
    'new_by_month',coalesce((select jsonb_agg(jsonb_build_object('month',m,'count',n) order by m)
      from (select to_char(date_trunc('month',coalesce(t.created_at,(select min(created_at) from public.subscriptions x where x.tenant_id=t.id)) at time zone tz),'YYYY-MM') as m,count(*) as n
            from public.tenants t group by 1) q),'[]'::jsonb),
    'revenue_by_month',coalesce((select jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),'amount_kzt',coalesce(rm.amount_kzt,0)) order by m)
      from generate_series(date_trunc('month',now() at time zone tz)-interval '11 months',date_trunc('month',now() at time zone tz),interval '1 month') g(m)
      left join rev_months rm on rm.month=to_char(m,'YYYY-MM')),'[]'::jsonb),
    'expiring',coalesce((select jsonb_agg(jsonb_build_object('tenant_id',c.tenant_id,'slug',t.slug,'name',t.config->>'name',
        'plan',p.code,'phase',c.phase,'ends_at',c.ends_at) order by c.ends_at)
      from cur c join public.tenants t on t.id=c.tenant_id join public.plans p on p.id=c.plan_id
      where c.ends_at is not null and c.ends_at between now() and now()+interval '7 days' and c.phase in ('trial','active')),'[]'::jsonb)
  ) into r;
  return r;
end $$;
