-- Запись, созданная вошедшим клиентом, сразу привязывается к его профилю.
-- Записи владельца (ручные, через owner_create_booking) к аккаунту владельца не привязываются.
create function bookings_set_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.user_id is null and auth.uid() is not null and not is_member(new.tenant_id) then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;
create trigger bookings_user before insert on bookings for each row execute function bookings_set_user();
