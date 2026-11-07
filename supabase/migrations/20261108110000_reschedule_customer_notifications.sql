create or replace function public.owner_update_notification_settings(
  p_slug text, p_reminder_hours smallint, p_repeat_days smallint, p_reminder_message text, p_repeat_message text
) returns void language plpgsql security definer set search_path = public as $$
declare t uuid; reminder_text text; repeat_text text;
begin
  t := owner_tenant(p_slug);
  if p_reminder_hours not between 1 and 168 or p_repeat_days not between 7 and 365
    or char_length(coalesce(p_reminder_message,'')) > 500 or char_length(coalesce(p_repeat_message,'')) > 500 then
    raise exception 'bad_notification_settings';
  end if;
  reminder_text := nullif(btrim(p_reminder_message),'');
  repeat_text := nullif(btrim(p_repeat_message),'');
  insert into public.tenant_notification_settings(tenant_id, reminder_hours_before, repeat_after_days, reminder_message, repeat_message, updated_at)
  values(t,p_reminder_hours,p_repeat_days,reminder_text,repeat_text,now())
  on conflict(tenant_id) do update set reminder_hours_before=excluded.reminder_hours_before,
    repeat_after_days=excluded.repeat_after_days, reminder_message=excluded.reminder_message,
    repeat_message=excluded.repeat_message, updated_at=now();

  update public.notification_jobs j set
    run_after=greatest(b.starts_at-make_interval(hours=>p_reminder_hours),now())
  from public.bookings b
  where j.tenant_id=t and j.booking_id=b.id and b.tenant_id=t and b.status='booked'
    and j.kind='booking_reminder' and j.status='pending';

  update public.notification_jobs j set
    run_after=greatest(b.starts_at+make_interval(days=>p_repeat_days),now()),
    payload=j.payload || jsonb_build_object('message',repeat_text)
  from public.bookings b
  where j.tenant_id=t and j.booking_id=b.id and b.tenant_id=t and b.status='done'
    and j.kind='booking_followup' and j.status='pending';

  insert into public.admin_audit_events(tenant_id,actor_id,entity,entity_id,action,details)
  values(t,auth.uid(),'notifications',t,'settings_changed',jsonb_build_object('fields',jsonb_build_array('reminder_hours_before','repeat_after_days','reminder_message','repeat_message')));
end;
$$;
