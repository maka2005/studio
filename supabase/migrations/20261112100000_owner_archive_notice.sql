create or replace function public.owner_archive_status(p_slug text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  return (select jsonb_build_object('archived',t.archived_at is not null,'archived_at',t.archived_at,'deletion_requested_at',t.deletion_requested_at)
    from public.tenants t join public.tenant_members m on m.tenant_id=t.id
    where t.slug=p_slug and m.user_id=auth.uid() and m.role='owner' limit 1);
end $$;
revoke all on function public.owner_archive_status(text) from public,anon;
grant execute on function public.owner_archive_status(text) to authenticated;
notify pgrst,'reload schema';
