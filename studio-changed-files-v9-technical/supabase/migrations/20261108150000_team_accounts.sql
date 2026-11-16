create or replace function public.owner_team_can_manage(p_slug text,p_actor uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.tenant_members m join public.tenants t on t.id=m.tenant_id
 where t.slug=p_slug and m.user_id=p_actor and m.role='owner')
$$;

create or replace function public.owner_tenant_owner(p_slug text) returns uuid language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin select id into t from public.tenants where slug=p_slug;
 if t is null or public.member_role(t)<>'owner' then raise exception 'forbidden'; end if;
 return t;
end $$;
-- Enforce owner-only settings and studio Telegram connection at the database boundary.
do $$ declare f record; d text; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('owner_update_config','owner_update_legal','owner_update_notification_settings','owner_telegram_code','owner_telegram_links')
 loop
  d:=pg_get_functiondef(f.signature::oid);
  d:=replace(d,'owner_tenant(p_slug)','owner_tenant_owner(p_slug)');
  d:=replace(d,'public.owner_tenant(p_slug)','public.owner_tenant_owner(p_slug)');
  execute d;
 end loop;
end $$;
create or replace function public.media_ok(p_name text) returns boolean language sql stable security definer set search_path=public as $$
 select case when split_part(p_name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then public.member_role(split_part(p_name,'/',1)::uuid)='owner' else false end
$$;

create or replace function public.owner_team_list(p_slug text,p_actor uuid)
returns table(user_id uuid,email text,role text,resource_id uuid,resource_name text)
language plpgsql stable security definer set search_path=public,auth as $$
declare t uuid;
begin
 if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
 select id into t from public.tenants where slug=p_slug;
 return query select m.user_id,u.email::text,m.role,m.resource_id,r.name
 from public.tenant_members m join auth.users u on u.id=m.user_id
 left join public.resources r on r.tenant_id=m.tenant_id and r.id=m.resource_id
 where m.tenant_id=t and m.role<>'owner' order by u.email;
end $$;

create or replace function public.owner_team_set(p_slug text,p_actor uuid,p_user uuid,p_role text,p_resource uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid; target_role text;
begin
 if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
 if p_role not in ('manager','staff') then raise exception 'bad_role'; end if;
 select id into t from public.tenants where slug=p_slug;
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'user_not_found'; end if;
 if p_role='staff' then
   if p_resource is null or not exists(select 1 from public.resources where tenant_id=t and id=p_resource) then raise exception 'bad_resource'; end if;
 elsif p_resource is not null then raise exception 'bad_resource'; end if;
 select role into target_role from public.tenant_members where tenant_id=t and user_id=p_user;
 if target_role='owner' then raise exception 'owner_protected'; end if;
 insert into public.tenant_members(tenant_id,user_id,role,resource_id) values(t,p_user,p_role,p_resource)
 on conflict(tenant_id,user_id) do update set role=excluded.role,resource_id=excluded.resource_id;
end $$;

create or replace function public.owner_team_remove(p_slug text,p_actor uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid; target_role text;
begin
 if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
 select id into t from public.tenants where slug=p_slug;
 select role into target_role from public.tenant_members where tenant_id=t and user_id=p_user;
 if target_role is null or target_role='owner' or p_actor=p_user then raise exception 'owner_protected'; end if;
 delete from public.tenant_members where tenant_id=t and user_id=p_user;
end $$;

revoke all on function public.owner_team_can_manage(text,uuid),public.owner_team_list(text,uuid),public.owner_team_set(text,uuid,uuid,text,uuid),public.owner_team_remove(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_team_can_manage(text,uuid),public.owner_team_list(text,uuid),public.owner_team_set(text,uuid,uuid,text,uuid),public.owner_team_remove(text,uuid,uuid) to service_role;
