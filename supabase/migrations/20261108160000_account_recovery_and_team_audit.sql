create table if not exists public.account_recovery_keys(
 user_id uuid primary key references auth.users(id) on delete cascade,
 key_hash text not null,
 updated_at timestamptz not null default now()
);
alter table public.account_recovery_keys enable row level security;
revoke all on public.account_recovery_keys from public,anon,authenticated;

create or replace function public.owner_team_can_manage(p_slug text,p_actor uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.tenant_members m join public.tenants t on t.id=m.tenant_id
 where t.slug=p_slug and m.user_id=p_actor and m.role in ('owner','manager'))
$$;
create or replace function public.owner_team_list(p_slug text,p_actor uuid)
returns table(user_id uuid,email text,role text,resource_id uuid,resource_name text)
language plpgsql stable security definer set search_path=public,auth as $$
declare t uuid; actor_role text;
begin
 if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
 select id into t from public.tenants where slug=p_slug;
 select m.role into actor_role from public.tenant_members m where m.tenant_id=t and m.user_id=p_actor;
 return query select m.user_id,u.email::text,m.role,m.resource_id,r.name
 from public.tenant_members m join auth.users u on u.id=m.user_id
 left join public.resources r on r.tenant_id=m.tenant_id and r.id=m.resource_id
 where m.tenant_id=t and m.role<>'owner' and (actor_role='owner' or m.role='staff') order by u.email;
end $$;
create or replace function public.owner_team_set(p_slug text,p_actor uuid,p_user uuid,p_role text,p_resource uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid; actor_role text; target_role text; target_email text; post_name text; act text;
begin
 if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
 select id into t from public.tenants where slug=p_slug;
 select role into actor_role from public.tenant_members where tenant_id=t and user_id=p_actor;
 if p_role not in ('manager','staff') or (actor_role='manager' and p_role<>'staff') then raise exception 'bad_role'; end if;
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'user_not_found'; end if;
 if p_role='staff' then
  if p_resource is null or not exists(select 1 from public.resources where tenant_id=t and id=p_resource) then raise exception 'bad_resource'; end if;
 elsif p_resource is not null then raise exception 'bad_resource'; end if;
 select role into target_role from public.tenant_members where tenant_id=t and user_id=p_user;
 if target_role='owner' or (actor_role='manager' and target_role='manager') then raise exception 'owner_protected'; end if;
 select email into target_email from auth.users where id=p_user;
 select name into post_name from public.resources where tenant_id=t and id=p_resource;
 act:=case when target_role is null then 'created' else 'updated' end;
 insert into public.tenant_members(tenant_id,user_id,role,resource_id) values(t,p_user,p_role,p_resource)
 on conflict(tenant_id,user_id) do update set role=excluded.role,resource_id=excluded.resource_id;
 insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
 values(t,p_actor,'team',p_user,act,jsonb_strip_nulls(jsonb_build_object('email',target_email,'role',p_role,'resource',post_name)));
end $$;
create or replace function public.owner_team_remove(p_slug text,p_actor uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare t uuid; actor_role text; target_role text; target_email text;
begin
 if not public.owner_team_can_manage(p_slug,p_actor) then raise exception 'forbidden'; end if;
 select id into t from public.tenants where slug=p_slug;
 select role into actor_role from public.tenant_members where tenant_id=t and user_id=p_actor;
 select role into target_role from public.tenant_members where tenant_id=t and user_id=p_user;
 if target_role is null or target_role='owner' or p_actor=p_user or (actor_role='manager' and target_role<>'staff') then raise exception 'owner_protected'; end if;
 select email into target_email from auth.users where id=p_user;
 delete from public.tenant_members where tenant_id=t and user_id=p_user;
 insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
 values(t,p_actor,'team',p_user,'deleted',jsonb_build_object('email',target_email,'role',target_role));
end $$;

create or replace function public.owner_team_can_reset(p_slug text,p_actor uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.tenants t join public.tenant_members actor on actor.tenant_id=t.id
 join public.tenant_members target on target.tenant_id=t.id where t.slug=p_slug and actor.user_id=p_actor
 and actor.role in ('owner','manager') and target.user_id=p_user and target.role<>'owner'
 and (actor.role='owner' or target.role='staff'))
$$;
create or replace function public.owner_team_can_assign_manager(p_slug text,p_actor uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.tenants t join public.tenant_members m on m.tenant_id=t.id
 where t.slug=p_slug and m.user_id=p_actor and m.role='owner')
$$;
create or replace function public.owner_team_log_reset(p_slug text,p_actor uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare t uuid; mail text;
begin
 if not public.owner_team_can_reset(p_slug,p_actor,p_user) then raise exception 'forbidden'; end if;
 select id into t from public.tenants where slug=p_slug; select email into mail from auth.users where id=p_user;
 insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
 values(t,p_actor,'team',p_user,'password_reset',jsonb_build_object('email',mail));
end $$;

create or replace function public.store_account_recovery_key(p_user uuid,p_hash text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_user is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad_request'; end if;
 insert into public.account_recovery_keys(user_id,key_hash,updated_at) values(p_user,p_hash,now())
 on conflict(user_id) do update set key_hash=excluded.key_hash,updated_at=now();
end $$;
create or replace function public.consume_account_recovery_key(p_user uuid,p_hash text)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare removed uuid;
begin
 delete from public.account_recovery_keys where user_id=p_user and key_hash=p_hash returning user_id into removed;
 if removed is null then return false; end if;
 insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
 select m.tenant_id,p_user,'team',p_user,'account_recovered',jsonb_build_object('email',u.email)
 from public.tenant_members m join auth.users u on u.id=m.user_id where m.user_id=p_user;
 return true;
end $$;

revoke all on function public.owner_team_can_reset(text,uuid,uuid),public.owner_team_can_assign_manager(text,uuid),public.owner_team_log_reset(text,uuid,uuid),public.store_account_recovery_key(uuid,text),public.consume_account_recovery_key(uuid,text) from public,anon,authenticated;
grant execute on function public.owner_team_can_reset(text,uuid,uuid),public.owner_team_can_assign_manager(text,uuid),public.owner_team_log_reset(text,uuid,uuid),public.store_account_recovery_key(uuid,text),public.consume_account_recovery_key(uuid,text) to service_role;
