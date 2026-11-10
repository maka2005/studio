-- Platform administrator roles and lifecycle controls.
alter table public.platform_admins
  add column if not exists role text not null default 'owner'
    check (role in ('owner','support','finance','read_only')),
  add column if not exists is_active boolean not null default true;

create or replace function public.is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select p_user is not null and exists(
    select 1 from public.platform_admins where user_id=p_user and is_active
  ) $$;

create or replace function public.platform_admin_list(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner' and is_active) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'email',u.email,'role',a.role,'is_active',a.is_active,'created_at',a.created_at) order by a.created_at)
    from public.platform_admins a join auth.users u on u.id=a.user_id),'[]'::jsonb);
end $$;

revoke all on function public.platform_admin_list(uuid) from public,anon,authenticated;
grant execute on function public.platform_admin_list(uuid) to service_role;
