-- A tenant opts in by saving a retention_days value in its legal policy.
create or replace function public.owner_update_legal(p_slug text,p_legal jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid; k text; clean jsonb:='{}'::jsonb; days int;
begin
 t:=public.owner_tenant_owner(p_slug);
 if jsonb_typeof(p_legal)<>'object' then raise exception 'bad_config'; end if;
 foreach k in array array['name','bin','address','email','retention'] loop
  if p_legal?k then
   if jsonb_typeof(p_legal->k)<>'string' or length(p_legal->>k)>200 then raise exception 'bad_config'; end if;
   clean:=clean||jsonb_build_object(k,trim(p_legal->>k));
  end if;
 end loop;
 if p_legal?'retention_days' then
  if jsonb_typeof(p_legal->'retention_days')='null' then clean:=clean||jsonb_build_object('retention_days',null);
  else
   if jsonb_typeof(p_legal->'retention_days')<>'number' then raise exception 'bad_config'; end if;
   days:=(p_legal->>'retention_days')::int;
   if days not between 1 and 36500 then raise exception 'bad_config'; end if;
   clean:=clean||jsonb_build_object('retention_days',days);
  end if;
 end if;
 update public.tenants set config=jsonb_set(config,'{legal}',coalesce(config->'legal','{}'::jsonb)||clean,true) where id=t;
end $$;

create or replace function public.cleanup_expired_customer_data()
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare tenant record; cutoff timestamptz; bookings_count int:=0; waitlist_count int:=0; comments_count int:=0; changed int;
begin
 for tenant in select id,(config->'legal'->>'retention_days')::int as days from public.tenants
  where case when coalesce(config->'legal'->>'retention_days','') ~ '^[1-9][0-9]{0,4}$'
    then (config->'legal'->>'retention_days')::int between 1 and 36500 else false end
 loop
  cutoff:=now()-make_interval(days=>tenant.days);
  delete from public.notification_jobs n using public.bookings b where n.tenant_id=tenant.id and n.booking_id=b.id
    and b.tenant_id=tenant.id and greatest(b.ends_at,b.starts_at)<cutoff;
  delete from public.booking_telegram_links l using public.bookings b where l.tenant_id=tenant.id and l.booking_id=b.id
    and b.tenant_id=tenant.id and greatest(b.ends_at,b.starts_at)<cutoff;
  delete from public.booking_telegram_link_codes c using public.bookings b where c.tenant_id=tenant.id and c.booking_id=b.id
    and b.tenant_id=tenant.id and greatest(b.ends_at,b.starts_at)<cutoff;
  update public.booking_reviews r set comment='' from public.bookings b where r.tenant_id=tenant.id and r.booking_id=b.id
    and b.tenant_id=tenant.id and greatest(b.ends_at,b.starts_at)<cutoff and r.comment<>'';
  get diagnostics changed=row_count; comments_count:=comments_count+changed;
  update public.bookings set customer_name='Удалено',customer_phone='',car='Удалено',user_id=null,
    token_hash=digest(gen_random_bytes(32),'sha256'),idempotency_key='expired:'||id::text
   where tenant_id=tenant.id and customer_name<>'Удалено' and greatest(ends_at,starts_at)<cutoff;
  get diagnostics changed=row_count; bookings_count:=bookings_count+changed;
  delete from public.notification_jobs where tenant_id=tenant.id and kind='waitlist_interest' and created_at<cutoff;
  delete from public.waitlist where tenant_id=tenant.id and created_at<cutoff;
  get diagnostics changed=row_count; waitlist_count:=waitlist_count+changed;
 end loop;
 return jsonb_build_object('anonymized_bookings',bookings_count,'scrubbed_reviews',comments_count,'deleted_waitlist_entries',waitlist_count);
end $$;
revoke all on function public.cleanup_expired_customer_data() from public,anon,authenticated;
grant execute on function public.cleanup_expired_customer_data() to service_role;

do $$ begin
 if exists(select 1 from cron.job where jobname='studio-customer-data-retention') then
  perform cron.unschedule(jobid) from cron.job where jobname='studio-customer-data-retention';
 end if;
 perform cron.schedule('studio-customer-data-retention','15 3 * * *','select public.cleanup_expired_customer_data()');
end $$;
