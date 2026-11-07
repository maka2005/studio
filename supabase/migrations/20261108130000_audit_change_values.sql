create or replace function public.audit_service_change() returns trigger language plpgsql security definer set search_path=public as $$
declare details jsonb := '{}'::jsonb; t uuid; item uuid; act text;
begin
  if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='INSERT' then
    t:=new.tenant_id; item:=new.id; act:='created';
    details:=jsonb_build_object('name',new.name,'category',new.category,'active',new.active,'price_cents',new.price_cents);
  elsif tg_op='DELETE' then
    t:=old.tenant_id; item:=old.id; act:='deleted';
    details:=jsonb_build_object('name',old.name,'category',old.category,'active',old.active,'price_cents',old.price_cents);
  else
    t:=new.tenant_id; item:=new.id; act:='updated';
    details:=jsonb_strip_nulls(jsonb_build_object(
      'name',case when old.name is distinct from new.name then jsonb_build_object('from',old.name,'to',new.name) end,
      'category',case when old.category is distinct from new.category then jsonb_build_object('from',old.category,'to',new.category) end,
      'active',case when old.active is distinct from new.active then jsonb_build_object('from',old.active,'to',new.active) end,
      'price_cents',case when old.price_cents is distinct from new.price_cents then jsonb_build_object('from',old.price_cents,'to',new.price_cents) end));
    if details='{}'::jsonb then return new; end if;
  end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(t,auth.uid(),'service',item,act,details);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.audit_resource_change() returns trigger language plpgsql security definer set search_path=public as $$
declare details jsonb; t uuid; item uuid; act text;
begin
  if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then t:=old.tenant_id; item:=old.id; act:='deleted'; details:=jsonb_build_object('name',old.name);
  elsif tg_op='INSERT' then t:=new.tenant_id; item:=new.id; act:='created'; details:=jsonb_build_object('name',new.name);
  else
    if old.name is not distinct from new.name then return new; end if;
    t:=new.tenant_id; item:=new.id; act:='updated'; details:=jsonb_build_object('name',jsonb_build_object('from',old.name,'to',new.name));
  end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(t,auth.uid(),'resource',item,act,details);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.audit_tenant_config_change() returns trigger language plpgsql security definer set search_path=public as $$
declare changed_keys jsonb; details jsonb;
begin
  if auth.uid() is null or old.config is not distinct from new.config then return new; end if;
  select coalesce(jsonb_agg(k.key order by k.key),'[]'::jsonb) into changed_keys
  from (select key from jsonb_each(new.config) union select key from jsonb_each(old.config)) k
  where old.config->k.key is distinct from new.config->k.key;
  details:=jsonb_build_object('fields',changed_keys);
  if old.config->'hours' is distinct from new.config->'hours' then
    details:=details||jsonb_build_object('hours',jsonb_build_object('from',old.config->'hours','to',new.config->'hours'));
  end if;
  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(new.id,auth.uid(),'studio',new.id,'settings_changed',details);
  return new;
end;
$$;
