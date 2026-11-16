-- Быстрый поиск пользователя Auth по email для server-side операций платформы.
-- Заменяет постраничный перебор auth.admin.listUsers в Edge Functions.
create or replace function public.platform_find_auth_user_by_email(p_email text)
returns table (id uuid, email text)
language sql
security definer
set search_path = auth, public
as $$
  select u.id, u.email::text
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.platform_find_auth_user_by_email(text) from public;
revoke all on function public.platform_find_auth_user_by_email(text) from anon;
revoke all on function public.platform_find_auth_user_by_email(text) from authenticated;
grant execute on function public.platform_find_auth_user_by_email(text) to service_role;
