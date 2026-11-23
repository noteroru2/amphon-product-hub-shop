-- Mirrored from the Supabase Production migration applied 2026-11-23.
-- Supabase grants service_role ALL by default on new tables in public.
-- All existing Source Change requests remain immutable after creation.
revoke all on public.commerce_seo_source_change_requests from service_role;
grant select, insert on public.commerce_seo_source_change_requests to service_role;