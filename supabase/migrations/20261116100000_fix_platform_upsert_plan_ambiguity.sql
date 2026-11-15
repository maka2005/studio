-- Fix: сохранение тарифа в админке падало с "column reference "features" is ambiguous".
-- Причина: локальная переменная features конфликтовала с колонкой plans.features.
-- Переменные переименованы (v_lim, v_features), логика прежняя.
create or replace function public.platform_upsert_plan(p_actor uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare pid uuid; v_code text; v_lim jsonb; v_features jsonb;
begin
  perform public.platform_assert(p_actor);
  v_lim:=coalesce(p->'limits','{"employees":5,"services":30,"branches":1,"bookings_per_month":500}'::jsonb);
  v_features:=coalesce(p->'feature_access','{"telegram":true,"export":true,"reviews":true}'::jsonb);
  if jsonb_typeof(v_lim)<>'object' or jsonb_typeof(v_features)<>'object' then raise exception 'bad_limits'; end if;
  if exists(select 1 from jsonb_each(v_lim) x where x.key not in ('employees','services','branches','bookings_per_month')
      or case when x.value='null'::jsonb then false when jsonb_typeof(x.value)='number' then (x.value#>>'{}')::numeric<1 or (x.value#>>'{}')::numeric>1000000 or (x.value#>>'{}')::numeric<>trunc((x.value#>>'{}')::numeric) else true end) then raise exception 'bad_limits'; end if;
  if exists(select 1 from jsonb_each(v_features) x where x.key not in ('telegram','export','reviews') or jsonb_typeof(x.value)<>'boolean') then raise exception 'bad_features'; end if;
  if nullif(p->>'id','') is not null then
    pid:=(p->>'id')::uuid;
    update public.plans pl set name=coalesce(nullif(p->>'name',''),pl.name),
      description=case when p?'description' then p->>'description' else pl.description end,
      price_kzt=coalesce((p->>'price_kzt')::int,pl.price_kzt),period_months=coalesce((p->>'period_months')::int,pl.period_months),
      features=case when p?'features' then p->'features' else pl.features end,
      limits=case when p?'limits' then v_lim else pl.limits end,
      feature_access=case when p?'feature_access' then v_features else pl.feature_access end,
      is_active=coalesce((p->>'is_active')::boolean,pl.is_active),sort_order=coalesce((p->>'sort_order')::int,pl.sort_order)
      where pl.id=pid;
    if not found then raise exception 'not_found'; end if;
  else
    v_code:=upper(trim(coalesce(p->>'code','')));
    insert into public.plans(code,name,description,price_kzt,period_months,features,limits,feature_access,is_active,sort_order)
      values(v_code,p->>'name',p->>'description',(p->>'price_kzt')::int,coalesce((p->>'period_months')::int,1),
        coalesce(p->'features','[]'::jsonb),v_lim,v_features,coalesce((p->>'is_active')::boolean,true),coalesce((p->>'sort_order')::int,100)) returning id into pid;
  end if;
  perform public.platform_log(p_actor,'plan.upsert',null,jsonb_build_object('plan_id',pid,'data',p));
  return jsonb_build_object('id',pid);
end $$;
