-- Read-only SHOP-6.2 readiness verification.
select
  purchase_enabled,
  stripe_enabled,
  stripe_promptpay_enabled,
  shop62_acceptance_version,
  shop62_accepted_at,
  shop62_last_invalidated_at,
  shop62_last_invalidated_reason
from public.commerce_store_settings
where id=1;

select
  provider_acceptance_ready,
  purchase_enabled,
  stripe_enabled,
  stripe_promptpay_enabled,
  shop62_acceptance_version,
  shop62_accepted_at
from public.commerce_shop62_acceptance_v;

select case when exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_commerce_test_order'
) then 'PASS' else 'FAIL' end as shop62_test_order_rpc;
