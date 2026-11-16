-- Idempotent transactional outbox for SaaS billing email.
create table public.platform_billing_email_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  recipient_email text not null,
  kind text not null check (kind in ('ending_7d','ending_3d','payment_failed','subscription_suspended')),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index platform_billing_email_ready_idx
  on public.platform_billing_email_outbox(status,run_after,created_at)
  where status in ('pending','processing');
create index platform_billing_email_tenant_idx
  on public.platform_billing_email_outbox(tenant_id,created_at desc);
alter table public.platform_billing_email_outbox enable row level security;
revoke all on public.platform_billing_email_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.platform_billing_email_outbox to service_role;

create table public.platform_billing_reminder_runs (
  run_date date primary key,
  created_at timestamptz not null default now()
);
alter table public.platform_billing_reminder_runs enable row level security;
revoke all on public.platform_billing_reminder_runs from public,anon,authenticated;

create or replace function public.enqueue_platform_billing_email(
  p_tenant uuid,p_subscription uuid,p_email text,p_kind text,p_dedupe text,p_payload jsonb
) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_email is null or btrim(p_email)='' then return; end if;
  insert into public.platform_billing_email_outbox(tenant_id,subscription_id,recipient_email,kind,dedupe_key,payload)
  values(p_tenant,p_subscription,lower(btrim(p_email)),p_kind,p_dedupe,coalesce(p_payload,'{}'::jsonb))
  on conflict(dedupe_key) do nothing;
end $$;

create or replace function public.enqueue_platform_billing_reminders() returns integer
language plpgsql security definer set search_path=public,auth as $$
declare v_run_date date; v_count integer:=0;
begin
  v_run_date:=(now() at time zone 'UTC')::date;
  insert into public.platform_billing_reminder_runs(run_date) values(v_run_date)
    on conflict(run_date) do nothing returning run_date into v_run_date;
  if not found then return 0; end if;

  with due as (
    select s.id as subscription_id,s.tenant_id,s.ends_at,p.name as plan_name,p.code as plan_code,p.price_kzt,
      t.slug,coalesce(t.config->>'name',t.slug) as tenant_name,
      coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty') as tz,
      u.id as owner_id,u.email,
      case when (s.ends_at at time zone coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty'))::date =
        ((now() at time zone coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty'))::date + 7) then 'ending_7d' else 'ending_3d' end as kind
    from public.subscriptions s
      join public.plans p on p.id=s.plan_id
      join public.tenants t on t.id=s.tenant_id
      join public.tenant_members m on m.tenant_id=t.id and m.role='owner'
      join auth.users u on u.id=m.user_id
    where s.status in ('trial','active','grace') and s.ends_at is not null and u.email is not null
      and (s.ends_at at time zone coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty'))::date in (
        (now() at time zone coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty'))::date + 7,
        (now() at time zone coalesce((select z.name from pg_timezone_names z where z.name=t.timezone),'Asia/Almaty'))::date + 3
      )
  )
  insert into public.platform_billing_email_outbox(tenant_id,subscription_id,recipient_email,kind,dedupe_key,payload)
  select d.tenant_id,d.subscription_id,lower(d.email),d.kind,
    d.kind||':'||d.subscription_id::text||':'||d.owner_id::text||':'||to_char(d.ends_at at time zone d.tz,'YYYYMMDD'),
    jsonb_build_object('organization_name',d.tenant_name,'slug',d.slug,'plan_name',d.plan_name,'plan_code',d.plan_code,
      'price_kzt',d.price_kzt,'ends_at',d.ends_at,'timezone',d.tz,'days',case when d.kind='ending_7d' then 7 else 3 end)
  from due d on conflict(dedupe_key) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.capture_saas_payment_failure_email() returns trigger
language plpgsql security definer set search_path=public,auth as $$
declare plan_name text; plan_code text; tenant_name text; tenant_slug text; owner_row record;
begin
  if new.status<>'failed' or old.status='failed' then return new; end if;
  select p.name,p.code,coalesce(t.config->>'name',t.slug),t.slug into plan_name,plan_code,tenant_name,tenant_slug
    from public.tenants t left join public.subscriptions s on s.id=new.subscription_id
      left join public.plans p on p.id=s.plan_id where t.id=new.tenant_id;
  for owner_row in select u.id,u.email from public.tenant_members m join auth.users u on u.id=m.user_id
    where m.tenant_id=new.tenant_id and m.role='owner' and u.email is not null loop
    perform public.enqueue_platform_billing_email(new.tenant_id,new.subscription_id,owner_row.email,'payment_failed',
      'payment-failed:'||new.id::text||':'||owner_row.id::text,
      jsonb_build_object('organization_name',tenant_name,'slug',tenant_slug,'plan_name',plan_name,'plan_code',plan_code,
        'amount_kzt',new.amount_kzt,'reason',new.note,'period_end',new.period_end));
  end loop;
  return new;
end $$;
create trigger platform_billing_payment_failure_email after update of status on public.saas_payments
  for each row when (new.status='failed' and old.status is distinct from new.status)
  execute function public.capture_saas_payment_failure_email();

create or replace function public.capture_saas_suspension_email() returns trigger
language plpgsql security definer set search_path=public,auth as $$
declare s public.subscriptions; p public.plans; t public.tenants; owner_row record;
begin
  if new.type<>'suspended' then return new; end if;
  select * into s from public.subscriptions where id=new.subscription_id;
  if not found then return new; end if;
  select * into p from public.plans where id=s.plan_id;
  select * into t from public.tenants where id=s.tenant_id;
  for owner_row in select u.id,u.email from public.tenant_members m join auth.users u on u.id=m.user_id
    where m.tenant_id=s.tenant_id and m.role='owner' and u.email is not null loop
    perform public.enqueue_platform_billing_email(s.tenant_id,s.id,owner_row.email,'subscription_suspended',
      'subscription-suspended:'||new.id::text||':'||owner_row.id::text,
      jsonb_build_object('organization_name',coalesce(t.config->>'name',t.slug),'slug',t.slug,'plan_name',p.name,'plan_code',p.code,
        'price_kzt',p.price_kzt,'reason',new.payload->>'reason'));
  end loop;
  return new;
end $$;
create trigger platform_billing_suspension_email after insert on public.subscription_events
  for each row when (new.type='suspended') execute function public.capture_saas_suspension_email();

create or replace function public.lease_platform_billing_emails(p_limit integer default 20)
returns table(id uuid,subscription_id uuid,recipient_email text,kind text,dedupe_key text,payload jsonb,attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  update public.platform_billing_email_outbox set status='failed',lease_until=null,last_error='delivery_window_expired'
    where status in ('pending','processing') and created_at<now()-interval '7 days';
  return query with candidates as (
    select q.id from public.platform_billing_email_outbox q
      where q.created_at>=now()-interval '7 days' and q.run_after<=now()
        and (q.status='pending' or (q.status='processing' and q.lease_until<now()))
      order by q.created_at,q.id limit least(greatest(p_limit,1),50) for update skip locked
  )
  update public.platform_billing_email_outbox q set status='processing',attempts=q.attempts+1,lease_until=now()+interval '5 minutes'
    from candidates c where q.id=c.id
    returning q.id,q.subscription_id,q.recipient_email,q.kind,q.dedupe_key,q.payload,q.attempts;
end $$;

create or replace function public.finish_platform_billing_email(p_id uuid,p_sent boolean,p_error text default null,p_message_id text default null)
returns void language plpgsql security definer set search_path=public as $$
declare attempt_count integer;
begin
  select attempts into attempt_count from public.platform_billing_email_outbox where id=p_id for update;
  if not found then return; end if;
  if p_sent then
    update public.platform_billing_email_outbox set status='sent',sent_at=now(),lease_until=null,last_error=null,provider_message_id=p_message_id where id=p_id;
  elsif coalesce(p_error,'') like 'skip:%' then
    update public.platform_billing_email_outbox set status='skipped',lease_until=null,last_error=left(p_error,250) where id=p_id;
  elsif attempt_count>=8 then
    update public.platform_billing_email_outbox set status='failed',lease_until=null,last_error=left(coalesce(p_error,'email_send_failed'),250) where id=p_id;
  else
    update public.platform_billing_email_outbox set status='pending',lease_until=null,
      run_after=now()+make_interval(secs=>least(21600,(60*power(2,attempt_count))::integer)),
      last_error=left(coalesce(p_error,'email_send_failed'),250) where id=p_id;
  end if;
end $$;

revoke all on function public.enqueue_platform_billing_email(uuid,uuid,text,text,text,jsonb),
  public.enqueue_platform_billing_reminders(),public.lease_platform_billing_emails(integer),
  public.finish_platform_billing_email(uuid,boolean,text,text),public.capture_saas_payment_failure_email(),
  public.capture_saas_suspension_email() from public,anon,authenticated;
grant execute on function public.enqueue_platform_billing_reminders(),public.lease_platform_billing_emails(integer),
  public.finish_platform_billing_email(uuid,boolean,text,text) to service_role;

-- Existing CRON_SECRET in Vault protects the Edge Function. It stays disabled for email
-- until RESEND_API_KEY, BILLING_EMAIL_FROM, and BILLING_SUPPORT_EMAIL are configured.
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname='billing-dunning-dispatch';
    perform cron.schedule('billing-dunning-dispatch','*/5 * * * *',$cron$
      select net.http_post(
        url := 'https://ezqelrhialezszepehco.supabase.co/functions/v1/billing-dunning-dispatch',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')
        ),
        body := '{}'::jsonb
      );
    $cron$);
  end if;
end $$;
