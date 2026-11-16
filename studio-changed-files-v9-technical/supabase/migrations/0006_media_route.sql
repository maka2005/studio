-- Хранилище фото студий: читать может любой, писать только владелец в папку своей студии ({tenant_id}/файл).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create function media_ok(p_name text) returns bool language sql stable security definer set search_path=public as $$
  select case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then is_member(split_part(p_name, '/', 1)::uuid) else false end $$;
revoke all on function media_ok from public; grant execute on function media_ok to authenticated;

create policy media_insert on storage.objects for insert to authenticated with check (bucket_id = 'tenant-media' and media_ok(name));
create policy media_update on storage.objects for update to authenticated using (bucket_id = 'tenant-media' and media_ok(name)) with check (bucket_id = 'tenant-media' and media_ok(name));
create policy media_delete on storage.objects for delete to authenticated using (bucket_id = 'tenant-media' and media_ok(name));

-- Владелец теперь может менять фото и ссылку маршрута. Ссылки проверяются на сервере.
create or replace function owner_update_config(p_slug text, p_patch jsonb) returns void language plpgsql security definer set search_path=public as $$
declare t uuid; r text;
begin
  t := owner_tenant(p_slug);
  r := p_patch->>'route_url';
  if r is not null and r <> '' and r !~ '^https://' then raise exception 'bad_url'; end if;
  if p_patch ? 'images' then
    if jsonb_typeof(p_patch->'images') <> 'object'
       or coalesce(p_patch->'images'->>'logo', '') !~ '^(https://|images/)'
       or coalesce(p_patch->'images'->>'hero', '') !~ '^(https://|images/)' then raise exception 'bad_config'; end if;
  end if;
  if p_patch ? 'gallery' then
    if jsonb_typeof(p_patch->'gallery') <> 'array' or jsonb_array_length(p_patch->'gallery') > 12
       or exists(select 1 from jsonb_array_elements(p_patch->'gallery') g where coalesce(g->>'image', '') !~ '^(https://|images/)')
    then raise exception 'bad_config'; end if;
  end if;
  update tenants set config = config || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p_patch) e
    where e.key in ('phone','address','description','cards','hours','gallery','images','route_url')), '{}'::jsonb) where id = t;
end $$;
