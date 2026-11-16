alter table public.platform_business_leads rename column name to business_name;
alter table public.platform_business_leads
  add column owner_name text not null default '',
  add column owner_email text not null default '';

alter table public.platform_business_leads
  add constraint platform_business_leads_owner_name_check check(char_length(owner_name)<=120),
  add constraint platform_business_leads_owner_email_check check(char_length(owner_email)<=254);
