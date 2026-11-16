-- Tenant-scoped roles. Existing memberships remain owners for backwards compatibility.
alter table public.tenant_members add column if not exists role text not null default 'owner';
alter table public.tenant_members add column if not exists resource_id uuid;
alter table public.tenant_members drop constraint if exists tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check check (role in ('owner','manager','staff'));
alter table public.tenant_members add constraint tenant_members_resource_fk foreign key (tenant_id,resource_id) references public.resources(tenant_id,id) on delete set null (resource_id);

create or replace function public.member_role(p_tenant uuid) returns text
language sql stable security definer set search_path=public as $$
 select role from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid()
$$;
create or replace function public.member_resource(p_tenant uuid) returns uuid
language sql stable security definer set search_path=public as $$
 select resource_id from public.tenant_members where tenant_id=p_tenant and user_id=auth.uid()
$$;
create or replace function public.owner_access(p_slug text) returns text
language plpgsql stable security definer set search_path=public as $$
declare r text;
begin select m.role into r from public.tenant_members m join public.tenants t on t.id=m.tenant_id
 where t.slug=p_slug and m.user_id=auth.uid(); return r; end $$;

-- Manager can run day-to-day admin functions. Staff can only use the dedicated staff endpoints.
create or replace function public.owner_tenant(p_slug text) returns uuid language plpgsql stable security definer set search_path=public as $$
declare t uuid;
begin
 select id into t from public.tenants where slug=p_slug;
 if t is null or public.member_role(t) not in ('owner','manager') then raise exception 'forbidden'; end if;
 return t;
end $$;
create or replace function public.owner_booking_tenant(p_booking uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 select tenant_id into t from public.bookings where id=p_booking;
 if t is null or public.member_role(t) not in ('owner','manager') then raise exception 'forbidden'; end if;
 return t;
end $$;
create or replace function public.owner_unblock(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 select tenant_id into t from public.resource_occupancies where id=p_id and kind='block';
 if t is null or public.member_role(t) not in ('owner','manager') then raise exception 'forbidden'; end if;
 delete from public.resource_occupancies where id=p_id;
end $$;
create or replace function public.owner_telegram_unlink(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 select tenant_id into t from public.telegram_links where id=p_id;
 if t is null or public.member_role(t) not in ('owner','manager') then raise exception 'forbidden'; end if;
 delete from public.telegram_links where id=p_id;
end $$;
-- Staff cannot upload, replace or delete studio media even if they call Storage directly.
create or replace function public.media_ok(p_name text) returns boolean language sql stable security definer set search_path=public as $$
 select case when split_part(p_name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then public.member_role(split_part(p_name,'/',1)::uuid) in ('owner','manager') else false end
$$;

-- Restrict all direct authenticated table reads, not just the dashboard RPCs.
drop policy if exists own_b on public.bookings;
create policy own_b on public.bookings for select to authenticated
 using (public.is_member(tenant_id) and (public.member_role(tenant_id)<>'staff' or resource_id=public.member_resource(tenant_id)));
drop policy if exists own_p on public.payments;
create policy own_p on public.payments for select to authenticated
 using (public.is_member(tenant_id) and public.member_role(tenant_id) in ('owner','manager'));
drop policy if exists own_o on public.resource_occupancies;
create policy own_o on public.resource_occupancies for select to authenticated
 using (public.is_member(tenant_id) and (public.member_role(tenant_id)<>'staff' or resource_id=public.member_resource(tenant_id)));
drop policy if exists own_r on public.resources;
create policy own_r on public.resources for select to authenticated
 using (public.is_member(tenant_id) and (public.member_role(tenant_id)<>'staff' or id=public.member_resource(tenant_id)));

create or replace function public.owner_me(p_slug text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.slug=p_slug and m.user_id=auth.uid())
$$;

create function public.staff_bookings(p_slug text,p_from date,p_to date)
returns table(id uuid,service_id uuid,service_name text,starts_at timestamptz,ends_at timestamptz,status text,customer_name text,
 customer_phone text,car text,price_cents int,paid_cents int,resource_name text)
language plpgsql stable security definer set search_path=public as $$
declare t uuid; tz text; rid uuid;
begin
 select tn.id,tn.timezone,m.resource_id into t,tz,rid from public.tenants tn join public.tenant_members m on m.tenant_id=tn.id
 where tn.slug=p_slug and m.user_id=auth.uid() and m.role='staff';
 if t is null or rid is null then raise exception 'forbidden'; end if;
 return query select b.id,b.service_id,s.name,b.starts_at,b.ends_at,b.status,b.customer_name,b.customer_phone,b.car,0::int,0::int,r.name
 from public.bookings b join public.services s on s.tenant_id=b.tenant_id and s.id=b.service_id
 join public.resources r on r.tenant_id=b.tenant_id and r.id=b.resource_id
 where b.tenant_id=t and b.resource_id=rid and b.starts_at>=p_from::timestamp at time zone tz and b.starts_at<(p_to+1)::timestamp at time zone tz order by b.starts_at;
end $$;
create function public.staff_set_status(p_booking uuid,p_status text) returns void language plpgsql security definer set search_path=public as $$
declare cur text;
begin
 if p_status not in ('arrived','done') or not exists(select 1 from public.bookings b join public.tenant_members m on m.tenant_id=b.tenant_id
   where b.id=p_booking and b.resource_id=m.resource_id and m.user_id=auth.uid() and m.role='staff') then raise exception 'forbidden'; end if;
 select status into cur from public.bookings where id=p_booking for update;
 if cur in ('cancelled','done') or (p_status='arrived' and cur<>'booked') then raise exception 'bad_transition'; end if;
 update public.bookings set status=p_status where id=p_booking;
end $$;

revoke all on function public.member_role(uuid),public.member_resource(uuid),public.owner_access(text),public.staff_bookings(text,date,date),public.staff_set_status(uuid,text) from public,anon;
grant execute on function public.member_role(uuid),public.member_resource(uuid),public.owner_access(text),public.staff_bookings(text,date,date),public.staff_set_status(uuid,text) to authenticated;
