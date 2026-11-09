-- Тестовые данные Servio (НЕ для production с реальными клиентами).
-- Повторный запуск безопасен. Удалить тестовые организации: см. конец файла.
-- 1) Замените email суперадмина ниже на свой (пользователь должен уже существовать в Supabase Auth).

do $seed$
declare
  admin_email text := 'CHANGE_ME@example.com';   -- <-- ваш email
  admin_id uuid;
  d record; tid uuid; sid uuid; pid_start uuid; pid_pro uuid; svc uuid; res uuid; i int; pay uuid;
begin
  select id into admin_id from auth.users where lower(email)=lower(admin_email);
  if admin_id is null then
    raise notice 'Пользователь % не найден в auth.users. Создайте его (Auth → Users) и запустите seed снова.', admin_email;
  else
    insert into public.platform_admins(user_id) values(admin_id) on conflict do nothing;
  end if;

  select id into pid_start from public.plans where code='START';
  select id into pid_pro from public.plans where code='PRO';

  for d in select * from (values
    ('demo-pro-active',  'Тест PRO активный',      'pro',   'active',    interval '-40 days', interval '20 days'),
    ('demo-trial',       'Тест Пробный период',    'start', 'trial',     interval '-5 days',  interval '9 days'),
    ('demo-expiring',    'Тест Истекает скоро',    'start', 'active',    interval '-27 days', interval '3 days'),
    ('demo-grace',       'Тест Grace-период',      'start', 'active',    interval '-32 days', interval '-2 days'),
    ('demo-suspended',   'Тест Приостановлен',     'pro',   'suspended', interval '-50 days', interval '-20 days')
  ) as v(slug,name,plan,status,start_off,end_off) loop
    continue when exists(select 1 from public.tenants where slug=d.slug);

    insert into public.tenants(slug,status,timezone,buffer_minutes,config,created_at)
    values(d.slug,'live','Asia/Aqtobe',15,jsonb_build_object('slug',d.slug,'name',d.name,'short_name',d.name,'accent','#4690FF',
      'timezone','Asia/Aqtobe','currency','₸','buffer_minutes',15,'slot_minutes',60,'cancel_hours',24,'business_type','autoservice',
      'phone','+7 700 000 00 00','address','Костанай, тестовая 1','demo',true,'resources',jsonb_build_array('Пост 1'),
      'hours',jsonb_build_object('mon',jsonb_build_array('09:00','18:00'),'tue',jsonb_build_array('09:00','18:00'),
        'wed',jsonb_build_array('09:00','18:00'),'thu',jsonb_build_array('09:00','18:00'),'fri',jsonb_build_array('09:00','18:00'),
        'sat',jsonb_build_array('09:00','16:00'),'sun','null'::jsonb)),
      now()+d.start_off)
    returning id into tid;

    insert into public.resources(tenant_id,name) values(tid,'Пост 1') returning id into res;
    insert into public.services(tenant_id,name,category,price_cents,duration_minutes) values
      (tid,'Мойка кузова','Мойка',250000,60),(tid,'Замена масла','Обслуживание',600000,60),(tid,'Диагностика','Диагностика',400000,60);
    select id into svc from public.services where tenant_id=tid order by name limit 1;

    -- записи создаём ДО подписки: у закрытой организации триггер запретил бы вставку
    for i in 1..6 loop
      insert into public.bookings(tenant_id,service_id,resource_id,starts_at,ends_at,price_cents,duration_minutes,status,
        customer_name,customer_phone,car,token_hash,idempotency_key,created_at)
      values(tid,svc,res,now()-make_interval(days=>i*3,hours=>2),now()-make_interval(days=>i*3,hours=>1),250000,60,'done',
        'Клиент '||i,'+7700000'||lpad(i::text,4,'0'),'Toyota Camry',decode(md5(d.slug||i),'hex'),'seed-bk-'||d.slug||'-'||i,now()-make_interval(days=>i*3+1))
      on conflict do nothing;
    end loop;

    insert into public.subscriptions(tenant_id,plan_id,status,starts_at,ends_at,grace_ends_at)
    values(tid,case when d.plan='pro' then pid_pro else pid_start end,d.status,now()+d.start_off,now()+d.end_off,now()+d.end_off+interval '5 days')
    returning id into sid;
    insert into public.subscription_events(subscription_id,type,payload,actor_id,created_at) values
      (sid,'created',jsonb_build_object('seed',true),admin_id,now()+d.start_off);
    if d.status='suspended' then
      insert into public.subscription_events(subscription_id,type,payload,actor_id) values(sid,'suspended','{"reason":"seed: неоплата"}',admin_id);
    end if;

    -- платежи: оплаченный за текущий месяц (для выручки), ожидающий и возврат на разных организациях
    if d.status in ('active','suspended') then
      insert into public.saas_payments(tenant_id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,confirmed_by,request_fingerprint,idempotency_key)
      values(tid,sid,case when d.plan='pro' then 25000 else 15000 end,now()+d.start_off,now()+d.start_off+interval '1 month','kaspi','paid',
        date_trunc('month',now())+interval '2 days',admin_id,md5('seed-paid-'||d.slug),'seed-paid-'||d.slug);
    end if;
    if d.slug='demo-grace' then
      insert into public.saas_payments(tenant_id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,request_fingerprint,idempotency_key)
      values(tid,sid,15000,now()+d.end_off,now()+d.end_off+interval '1 month','transfer','pending',now()-interval '1 day',md5('seed-pending-'||d.slug),'seed-pending-'||d.slug);
    end if;
    if d.slug='demo-suspended' then
      insert into public.saas_payments(tenant_id,subscription_id,amount_kzt,period_start,period_end,method,status,received_at,confirmed_by,refund_reason,request_fingerprint,idempotency_key)
      values(tid,sid,25000,now()-interval '80 days',now()-interval '50 days','cash','refunded',now()-interval '78 days',admin_id,'seed: возврат по просьбе клиента',md5('seed-refund-'||d.slug),'seed-refund-'||d.slug);
    end if;

    insert into public.platform_audit_logs(actor_id,action,tenant_id,payload) values(admin_id,'tenant.create',tid,jsonb_build_object('seed',true,'slug',d.slug));
  end loop;
end
$seed$;

-- Удаление тестовых организаций (по необходимости, выполнять осознанно):
-- delete from public.saas_payments where tenant_id in (select id from public.tenants where slug like 'demo-%' and slug<>'demo');
-- delete from public.subscriptions where tenant_id in (select id from public.tenants where slug like 'demo-%');
-- delete from public.tenants where slug in ('demo-pro-active','demo-trial','demo-expiring','demo-grace','demo-suspended');
