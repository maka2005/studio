-- Read-only billing views for the owner cabinet. Both functions resolve the tenant
-- through owner_tenant(), so an authenticated member can only see their own organization.

create or replace function public.owner_billing_documents(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  v_tenant uuid := public.owner_tenant(p_slug);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.issue_date desc, x.created_at desc)
    from (
      select id, document_type, number, issue_date, service_from, service_to,
             amount_kzt, currency, description, esf_number, esf_status, status, created_at
      from public.platform_billing_documents
      where tenant_id = v_tenant and status <> 'void'
      order by issue_date desc, created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.owner_payments(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path=public
set statement_timeout='5s'
as $$
declare
  v_tenant uuid := public.owner_tenant(p_slug);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.received_at desc)
    from (
      select id, amount_kzt, method, status, received_at, period_start, period_end,
             note, refund_reason, created_at
      from public.saas_payments
      where tenant_id = v_tenant
      order by received_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.owner_billing_documents(text), public.owner_payments(text)
  from public, anon;
grant execute on function public.owner_billing_documents(text), public.owner_payments(text)
  to authenticated;

notify pgrst, 'reload schema';
