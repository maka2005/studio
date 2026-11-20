-- Communication templates, per-job delivery details and bounce suppression.
-- All tenant data stays behind SECURITY DEFINER RPCs; the tables have no RLS policies.

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null default 'telegram' check (channel in ('telegram','email','sms')),
  kind text not null check (kind in ('booking_created','booking_cancelled','booking_reminder','booking_followup','waitlist_interest')),
  audience text not null default 'client' check (audience in ('client','owner')),
  subject text check (subject is null or char_length(subject) <= 200),
  body text not null check (char_length(body) between 10 and 2000),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel, kind, audience)
);
alter table public.notification_templates enable row level security;
revoke all on public.notification_templates from public, anon, authenticated;
grant all on public.notification_templates to service_role;

alter table public.notification_jobs
  add column channel text not null default 'telegram' check (channel in ('telegram','email','sms')),
  add column template_code text,
  add column bounced_at timestamptz,
  add column bounce_type text check (bounce_type in ('soft','hard','complaint'));
create index if not exists notification_jobs_tenant_status_created_idx
  on public.notification_jobs (tenant_id, status, created_at desc);

alter table public.platform_billing_email_outbox
  add column bounced_at timestamptz,
  add column bounce_type text check (bounce_type in ('soft','hard','complaint'));

create table public.bounce_suppressions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  provider text not null default '',
  event_id text not null default '',
  channel text not null default 'email' check (channel in ('telegram','email','sms')),
  recipient text not null,
  bounce_type text not null check (bounce_type in ('soft','hard','complaint')),
  created_at timestamptz not null default now(),
  unique (provider, event_id, recipient)
);
create index bounce_suppressions_tenant_recipient_idx
  on public.bounce_suppressions (tenant_id, lower(recipient), created_at desc);
alter table public.bounce_suppressions enable row level security;
revoke all on public.bounce_suppressions from public, anon, authenticated;
grant all on public.bounce_suppressions to service_role;

-- finish_notification_job gains an optional template code; the old 3-argument
-- signature is replaced so existing callers keep working.
drop function if exists public.finish_notification_job(uuid, boolean, text);
create function public.finish_notification_job(
  p_id uuid, p_ok boolean, p_error text, p_template_code text default null
) returns void language plpgsql security definer set search_path=public as $$
declare a int;
begin
  select attempts into a from notification_jobs where id = p_id;
  if p_ok then
    update notification_jobs set status='sent', sent_at=now(), lease_until=null,
      last_error=null, template_code=coalesce(p_template_code, template_code) where id=p_id;
  elsif a >= 8 then
    update notification_jobs set status='failed', lease_until=null,
      last_error=left(p_error, 300), template_code=coalesce(p_template_code, template_code) where id=p_id;
  else
    update notification_jobs set run_after=now()+make_interval(mins=>least(power(2,a)::int,60)),
      lease_until=null, last_error=left(p_error,300),
      template_code=coalesce(p_template_code, template_code) where id=p_id;
  end if;
end $$;
revoke all on function public.finish_notification_job(uuid,boolean,text,text) from public, anon, authenticated;
grant execute on function public.finish_notification_job(uuid,boolean,text,text) to service_role;

-- A fixed, predictable list of slots is returned even when nothing is customised.
-- The two legacy reminder fields are exposed as the matching client templates.
create or replace function public.owner_notification_templates(p_slug text)
returns jsonb language plpgsql stable security definer
set search_path=public set statement_timeout='5s' as $$
declare
  v_tenant uuid := public.owner_tenant(p_slug);
  v_reminder text; v_repeat text; v_audience text; v_kind text;
  t public.notification_templates;
  v jsonb := '[]'::jsonb;
begin
  select reminder_message, repeat_message into v_reminder, v_repeat
    from public.tenant_notification_settings where tenant_id=v_tenant;
  for v_audience in select unnest(array['client','owner']) loop
    for v_kind in select unnest(array['booking_created','booking_cancelled','booking_reminder','booking_followup','waitlist_interest']) loop
      t := null;
      select * into t from public.notification_templates
        where tenant_id=v_tenant and channel='telegram' and kind=v_kind and audience=v_audience;
      v := v || jsonb_build_array(jsonb_build_object(
        'id', t.id,
        'kind', v_kind,
        'audience', v_audience,
        'channel', 'telegram',
        'subject', t.subject,
        'body', coalesce(t.body,
          case when v_audience='client' and v_kind='booking_reminder' then v_reminder
               when v_audience='client' and v_kind='booking_followup' then v_repeat end),
        'is_active', coalesce(t.is_active, false),
        'source', case when t.id is null then 'default' else 'template' end,
        'updated_at', t.updated_at
      ));
    end loop;
  end loop;
  return v;
end $$;

-- Passing an empty body removes the override and restores the built-in wording.
create or replace function public.owner_upsert_notification_template(
  p_slug text, p_kind text, p_audience text, p_body text, p_active boolean
) returns uuid language plpgsql security definer
set search_path=public,extensions set statement_timeout='5s' as $$
declare
  v_tenant uuid := public.owner_tenant(p_slug);
  v_body text := btrim(coalesce(p_body, ''));
  v_left text; v_id uuid;
begin
  if p_kind not in ('booking_created','booking_cancelled','booking_reminder','booking_followup','waitlist_interest')
     or p_audience not in ('client','owner') then raise exception 'bad_template'; end if;
  if v_body <> '' and char_length(v_body) not between 10 and 2000 then raise exception 'bad_template'; end if;
  v_left := regexp_replace(v_body, '\{(studio|service|date|time|address|customer|phone|car|price)\}', '', 'g');
  if v_left ~ '\{[a-z_]+\}' then raise exception 'bad_template'; end if;

  if v_body = '' then
    delete from public.notification_templates
      where tenant_id=v_tenant and channel='telegram' and kind=p_kind and audience=p_audience;
  else
    insert into public.notification_templates(tenant_id,channel,kind,audience,body,is_active,updated_at)
    values(v_tenant,'telegram',p_kind,p_audience,v_body,coalesce(p_active,true),now())
    on conflict(tenant_id,channel,kind,audience) do update
      set body=excluded.body, is_active=excluded.is_active, updated_at=now()
    returning id into v_id;
  end if;

  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(v_tenant,auth.uid(),'notifications',v_tenant,'template_changed',
    jsonb_build_object('kind',p_kind,'audience',p_audience,'removed',v_body=''));
  return v_id;
end $$;

create or replace function public.owner_notification_jobs(
  p_slug text, p_status text default 'all', p_kind text default 'all',
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer
set search_path=public set statement_timeout='5s' as $$
declare
  v_tenant uuid := public.owner_tenant(p_slug);
  v_rows jsonb; v_count bigint;
begin
  if p_limit not between 1 and 100 or p_offset < 0 then raise exception 'bad_range'; end if;
  if coalesce(p_status,'all') not in ('all','pending','sent','failed')
     or coalesce(p_kind,'all') not in ('all','booking_created','booking_cancelled','booking_reminder','booking_followup','waitlist_interest') then
    raise exception 'bad_range';
  end if;
  select count(*) into v_count from public.notification_jobs j
    where j.tenant_id=v_tenant
      and (coalesce(p_status,'all')='all' or j.status=p_status)
      and (coalesce(p_kind,'all')='all' or j.kind=p_kind);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select j.id, j.kind, j.channel, j.status, j.attempts, j.last_error,
           j.created_at, j.sent_at, j.bounced_at, j.bounce_type, j.template_code, j.booking_id
      from public.notification_jobs j
      where j.tenant_id=v_tenant
        and (coalesce(p_status,'all')='all' or j.status=p_status)
        and (coalesce(p_kind,'all')='all' or j.kind=p_kind)
      order by j.created_at desc
      limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;

-- Re-queue a failed job. The dedupe key changes so the original event is not
-- rejected by the unique constraint on the next worker pass.
create or replace function public.owner_notification_retry(p_slug text, p_job_id uuid)
returns void language plpgsql security definer
set search_path=public,extensions set statement_timeout='5s' as $$
declare v_tenant uuid := public.owner_tenant(p_slug); v uuid;
begin
  update public.notification_jobs
    set status='pending', attempts=0, run_after=now(), lease_until=null,
        last_error=null, bounced_at=null, bounce_type=null,
        dedupe_key=dedupe_key||':retry:'||encode(gen_random_bytes(4),'hex')
    where id=p_job_id and tenant_id=v_tenant and status='failed'
    returning id into v;
  if v is null then raise exception 'not_found'; end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(v_tenant,auth.uid(),'notifications',p_job_id,'delivery_retried','{}'::jsonb);
end $$;

create or replace function public.owner_notification_bounces(
  p_slug text, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer
set search_path=public set statement_timeout='5s' as $$
declare v_tenant uuid := public.owner_tenant(p_slug); v_rows jsonb; v_count bigint;
begin
  if p_limit not between 1 and 100 or p_offset < 0 then raise exception 'bad_range'; end if;
  select count(*) into v_count from public.bounce_suppressions s where s.tenant_id=v_tenant;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select s.id, s.channel, s.recipient, s.bounce_type, s.provider, s.created_at
      from public.bounce_suppressions s where s.tenant_id=v_tenant
      order by s.created_at desc limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;

create or replace function public.platform_notification_delivery(
  p_status text default 'all', p_kind text default 'all',
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer
set search_path=public set statement_timeout='5s' as $$
declare v_rows jsonb; v_count bigint; v_summary jsonb;
begin
  if p_limit not between 1 and 100 or p_offset < 0 then raise exception 'bad_range'; end if;
  if coalesce(p_status,'all') not in ('all','pending','sent','failed')
     or coalesce(p_kind,'all') not in ('all','booking_created','booking_cancelled','booking_reminder','booking_followup','waitlist_interest') then
    raise exception 'bad_range';
  end if;
  select jsonb_build_object(
    'pending', count(*) filter (where j.status='pending'),
    'sent', count(*) filter (where j.status='sent'),
    'failed', count(*) filter (where j.status='failed'),
    'bounced', count(*) filter (where j.bounced_at is not null)
  ) into v_summary from public.notification_jobs j where j.created_at > now()-interval '30 days';
  select count(*) into v_count from public.notification_jobs j
    where (coalesce(p_status,'all')='all' or j.status=p_status)
      and (coalesce(p_kind,'all')='all' or j.kind=p_kind);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select j.id, j.tenant_id, t.slug, j.kind, j.channel, j.status, j.attempts,
           j.last_error, j.created_at, j.sent_at, j.bounced_at, j.bounce_type
      from public.notification_jobs j left join public.tenants t on t.id=j.tenant_id
      where (coalesce(p_status,'all')='all' or j.status=p_status)
        and (coalesce(p_kind,'all')='all' or j.kind=p_kind)
      order by j.created_at desc limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'count', v_count, 'summary', v_summary);
end $$;

create or replace function public.platform_notification_bounces(
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer
set search_path=public set statement_timeout='5s' as $$
declare v_rows jsonb; v_count bigint;
begin
  if p_limit not between 1 and 100 or p_offset < 0 then raise exception 'bad_range'; end if;
  select count(*) into v_count from public.bounce_suppressions;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select s.id, s.tenant_id, t.slug, s.channel, s.recipient, s.bounce_type, s.provider, s.created_at
      from public.bounce_suppressions s left join public.tenants t on t.id=s.tenant_id
      order by s.created_at desc limit p_limit offset p_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;

-- Provider-agnostic bounce intake. Callers send a small JSON event; repeated
-- deliveries with the same provider/event/recipient are ignored.
create or replace function public.record_email_bounce(p_provider text, p_event jsonb)
returns void language plpgsql security definer
set search_path=public set statement_timeout='5s' as $$
declare
  v_recipient text;
  v_raw text;
  v_type text;
  v_event_id text;
  v_tenant uuid;
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object' then raise exception 'bad_request'; end if;
  v_recipient := lower(btrim(coalesce(
    p_event->>'email', p_event->>'recipient', p_event->>'to',
    p_event#>>'{bounce,bouncedRecipients,0,emailAddress}',
    p_event#>>'{bounce,bouncedRecipients,0,email}'
  , '')));
  if v_recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_recipient'; end if;
  v_raw := lower(coalesce(p_event->>'bounce_type', p_event#>>'{bounce,bounceType}', 'soft'));
  v_type := case
    when v_raw in ('hard','permanent','permanentfailure','5.1.1') then 'hard'
    when v_raw in ('complaint','spamcomplaint','abuse') then 'complaint'
    else 'soft' end;
  v_event_id := coalesce(p_event->>'event_id', p_event->>'id', p_event->>'message_id', '');

  select tenant_id into v_tenant from public.platform_billing_email_outbox
    where lower(recipient_email)=v_recipient order by created_at desc limit 1;

  insert into public.bounce_suppressions(tenant_id,provider,event_id,channel,recipient,bounce_type)
  values(v_tenant,left(coalesce(p_provider,''),40),left(v_event_id,120),'email',v_recipient,v_type)
  on conflict(provider,event_id,recipient) do nothing;

  update public.platform_billing_email_outbox
    set bounced_at=now(), bounce_type=v_type, lease_until=null,
        status=case when v_type='hard' then 'failed' else status end,
        last_error=case when v_type='hard' then 'bounced_hard' else last_error end
    where lower(recipient_email)=v_recipient and bounced_at is null;
end $$;

revoke all on function
  public.owner_notification_templates(text),
  public.owner_upsert_notification_template(text,text,text,text,boolean),
  public.owner_notification_jobs(text,text,text,integer,integer),
  public.owner_notification_retry(text,uuid),
  public.owner_notification_bounces(text,integer,integer),
  public.platform_notification_delivery(text,text,integer,integer),
  public.platform_notification_bounces(integer,integer)
  from public, anon;
grant execute on function
  public.owner_notification_templates(text),
  public.owner_upsert_notification_template(text,text,text,text,boolean),
  public.owner_notification_jobs(text,text,text,integer,integer),
  public.owner_notification_retry(text,uuid),
  public.owner_notification_bounces(text,integer,integer)
  to authenticated;
revoke all on function
  public.platform_notification_delivery(text,text,integer,integer),
  public.platform_notification_bounces(integer,integer),
  public.record_email_bounce(text,jsonb)
  from public, anon, authenticated;
grant execute on function
  public.platform_notification_delivery(text,text,integer,integer),
  public.platform_notification_bounces(integer,integer),
  public.record_email_bounce(text,jsonb)
  to service_role;

notify pgrst, 'reload schema';
