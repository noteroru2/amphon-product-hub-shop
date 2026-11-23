-- Supabase Production migration 20261123115749. Source Change requests are immutable.
revoke all on public.commerce_seo_source_change_requests from service_role;
grant select, insert on public.commerce_seo_source_change_requests to service_role;