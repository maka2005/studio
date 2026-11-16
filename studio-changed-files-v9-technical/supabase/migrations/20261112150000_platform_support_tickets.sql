alter table public.platform_tenant_cases
  add column if not exists severity text not null default 'normal',
  add column if not exists custom_type text;

alter table public.platform_tenant_cases
  drop constraint if exists platform_tenant_cases_category_check,
  add constraint platform_tenant_cases_category_check
    check (category in ('support','billing','technical','access','booking','feature','other')),
  drop constraint if exists platform_tenant_cases_severity_check,
  add constraint platform_tenant_cases_severity_check
    check (severity in ('low','normal','high','urgent')),
  drop constraint if exists platform_tenant_cases_custom_type_check,
  add constraint platform_tenant_cases_custom_type_check
    check (custom_type is null or char_length(custom_type) between 3 and 120);

create index if not exists platform_tenant_cases_queue_idx
  on public.platform_tenant_cases (status, severity, updated_at desc);
