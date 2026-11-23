-- Supabase Production migration 20261123115749: service_role defaults to ALL.
revoke all on public.commerce_seo_source_change_requests from service_role;
grant select, insert on public.commerce_seo_source_change_requests to service_role;