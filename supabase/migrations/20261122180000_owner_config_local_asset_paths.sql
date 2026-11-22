-- Configs created before media uploads use static paths such as
-- /servio-default.svg and /tenants/{slug}/hero.jpg. The previous restore of
-- owner_update_config only accepted https:// or images/, so saving any media
-- for those studios failed with bad_config. Accept local absolute paths too.
create or replace function public.owner_update_config(p_slug text, p_patch jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid; r text;
begin
  t := public.owner_tenant_owner(p_slug);
  r := p_patch->>'route_url';
  if r is not null and r <> '' and r !~ '^https://' then raise exception 'bad_url'; end if;
  if p_patch ? 'images' then
    if jsonb_typeof(p_patch->'images') <> 'object'
       or coalesce(p_patch->'images'->>'logo', '') !~ '^(https://|images/|/(?!/))'
       or coalesce(p_patch->'images'->>'hero', '') !~ '^(https://|images/|/(?!/))'
    then raise exception 'bad_config'; end if;
  end if;
  if p_patch ? 'gallery' then
    if jsonb_typeof(p_patch->'gallery') <> 'array'
       or jsonb_array_length(p_patch->'gallery') > 12
       or exists (
         select 1 from jsonb_array_elements(p_patch->'gallery') g
         where coalesce(g->>'image', '') !~ '^(https://|images/|/(?!/))'
       )
    then raise exception 'bad_config'; end if;
  end if;
  update public.tenants
     set config = config || coalesce((
       select jsonb_object_agg(e.key, e.value) from jsonb_each(p_patch) e
       where e.key in ('phone','address','description','cards','hours','gallery','images','route_url','client_telegram_enabled')
     ), '{}'::jsonb)
   where id = t;
  if p_patch ? 'client_telegram_enabled' and p_patch->'client_telegram_enabled' = 'false'::jsonb then
    delete from public.booking_telegram_links where tenant_id = t;
  end if;
end $$;

revoke all on function public.owner_update_config(text, jsonb) from public, anon;
grant execute on function public.owner_update_config(text, jsonb) to authenticated;
