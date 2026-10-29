create function public.owner_delete_promo(p_slug text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  t := owner_tenant(p_slug);
  delete from public.promo_codes where id = p_id and tenant_id = t;
  if not found then raise exception 'not_found'; end if;
end;
$$;

create function public.owner_delete_service(p_slug text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  t := owner_tenant(p_slug);
  if not exists (select 1 from public.services where id = p_id and tenant_id = t) then
    raise exception 'not_found';
  end if;
  if exists (select 1 from public.bookings where tenant_id = t and service_id = p_id)
     or exists (select 1 from public.waitlist where tenant_id = t and service_id = p_id) then
    raise exception 'service_in_use';
  end if;
  delete from public.services where id = p_id and tenant_id = t;
end;
$$;

revoke all on function public.owner_delete_promo(text, uuid) from public, anon;
revoke all on function public.owner_delete_service(text, uuid) from public, anon;
grant execute on function public.owner_delete_promo(text, uuid) to authenticated;
grant execute on function public.owner_delete_service(text, uuid) to authenticated;
