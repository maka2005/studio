create or replace function public.owner_support_list(p_slug text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_tenant_id uuid; actor uuid:=auth.uid(); result_tickets jsonb; result_events jsonb;
begin
  if actor is null then raise exception 'unauthorized'; end if;
  select t.id into v_tenant_id from public.tenants t
    join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=actor and m.role in ('owner','manager','staff');
  if v_tenant_id is null then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'subject',q.subject,'category',q.category,'custom_type',q.custom_type,'severity',q.severity,
    'status',q.status,'created_by_email',q.created_by_email,'updated_by_email',q.updated_by_email,
    'created_at',q.created_at,'updated_at',q.updated_at) order by q.updated_at desc),'[]'::jsonb)
    into result_tickets from (select * from public.platform_tenant_cases where platform_tenant_cases.tenant_id=v_tenant_id order by updated_at desc limit 100) q;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'case_id',q.case_id,'event_type',q.event_type,'message',q.message,'status',q.status,
    'actor_email',q.actor_email,'created_at',q.created_at) order by q.created_at asc),'[]'::jsonb)
    into result_events from (select * from public.platform_tenant_case_events e where e.tenant_id=v_tenant_id
      and e.case_id in (select c.id from public.platform_tenant_cases c where c.tenant_id=v_tenant_id)
      order by e.created_at desc limit 1000) q;
  return jsonb_build_object('tickets',result_tickets,'events',result_events);
end $$;

create or replace function public.owner_support_create(
  p_slug text,p_subject text,p_category text,p_custom_type text,p_severity text,p_message text
) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_tenant_id uuid; actor uuid:=auth.uid(); actor_email text; ticket_id uuid; category text:=btrim(p_category); custom_type text:=nullif(btrim(p_custom_type),'');
begin
  if actor is null then raise exception 'unauthorized'; end if;
  select t.id into v_tenant_id from public.tenants t join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=actor and m.role in ('owner','manager','staff');
  if v_tenant_id is null then raise exception 'forbidden'; end if;
  if char_length(btrim(coalesce(p_subject,''))) not between 3 and 200
    or category is null or category not in ('technical','billing','access','booking','feature','other')
    or (category='other' and char_length(coalesce(custom_type,'')) not between 3 and 120)
    or p_severity is null or p_severity not in ('low','normal','high','urgent')
    or char_length(btrim(coalesce(p_message,''))) not between 5 and 3000 then raise exception 'bad_request'; end if;
  select email into actor_email from auth.users where id=actor;
  insert into public.platform_tenant_cases(tenant_id,subject,category,custom_type,severity,status,created_by,updated_by,created_by_email,updated_by_email)
    values(v_tenant_id,btrim(p_subject),category,case when category='other' then custom_type else null end,p_severity,'open',actor,actor,coalesce(actor_email,''),coalesce(actor_email,'')) returning id into ticket_id;
  insert into public.platform_tenant_case_events(tenant_id,case_id,event_type,message,status,actor_id,actor_email)
    values(v_tenant_id,ticket_id,'created',btrim(p_message),'open',actor,coalesce(actor_email,''));
  return jsonb_build_object('ok',true,'ticket_id',ticket_id);
end $$;

create or replace function public.owner_support_reply(p_slug text,p_ticket uuid,p_message text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_tenant_id uuid; actor uuid:=auth.uid(); actor_email text; current_status text; next_status text;
begin
  if actor is null then raise exception 'unauthorized'; end if;
  select t.id into v_tenant_id from public.tenants t join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=actor and m.role in ('owner','manager','staff');
  if v_tenant_id is null then raise exception 'forbidden'; end if;
  if p_ticket is null or char_length(btrim(coalesce(p_message,''))) not between 1 and 3000 then raise exception 'bad_request'; end if;
  select status into current_status from public.platform_tenant_cases where id=p_ticket and platform_tenant_cases.tenant_id=v_tenant_id for update;
  if current_status is null then raise exception 'not_found'; end if;
  next_status:=case when current_status='resolved' then 'open' else current_status end;
  select email into actor_email from auth.users where id=actor;
  update public.platform_tenant_cases set status=next_status,updated_by=actor,updated_by_email=coalesce(actor_email,''),updated_at=now()
    where id=p_ticket and platform_tenant_cases.tenant_id=v_tenant_id;
  insert into public.platform_tenant_case_events(tenant_id,case_id,event_type,message,status,actor_id,actor_email)
    values(v_tenant_id,p_ticket,'message',btrim(p_message),next_status,actor,coalesce(actor_email,''));
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.owner_support_list(text),public.owner_support_create(text,text,text,text,text,text),public.owner_support_reply(text,uuid,text) from public,anon;
grant execute on function public.owner_support_list(text),public.owner_support_create(text,text,text,text,text,text),public.owner_support_reply(text,uuid,text) to authenticated;

notify pgrst,'reload schema';
