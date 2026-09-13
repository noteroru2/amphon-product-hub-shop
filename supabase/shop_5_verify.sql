-- SHOP-5 verification queries. Expected blockers are noted inline.
select 'store_checkout' as check_name,
       purchase_enabled, shipping_enabled, bank_transfer_enabled, return_policy_enabled,
       reservation_minutes, payment_review_hold_hours, checkout_turnstile_enabled, turnstile_site_key
from public.commerce_store_settings where id=1;

select 'order_tables' as check_name,
  to_regclass('public.commerce_orders') is not null as orders_ok,
  to_regclass('public.commerce_order_items') is not null as items_ok,
  to_regclass('public.commerce_reservations') is not null as reservations_ok;

select 'service_rpcs' as check_name,
  to_regprocedure('public.create_commerce_order(jsonb)') is not null as checkout_rpc_ok,
  to_regprocedure('public.notify_commerce_payment(uuid,text)') is not null as payment_notify_rpc_ok,
  to_regprocedure('public.expire_commerce_reservations(integer)') is not null as expiry_rpc_ok,
  to_regprocedure('public.admin_commerce_order_action(uuid,text,uuid,jsonb)') is not null as admin_action_rpc_ok;

select 'active_reservation_integrity' as check_name,
  count(*) filter (where p.status <> 'reserved') as reservation_product_status_mismatch
from public.commerce_reservations r join public.products p on p.id=r.product_id;

select 'order_total_integrity' as check_name,
  count(*) filter (where total <> subtotal + shipping_amount) as invalid_totals
from public.commerce_orders;

select 'duplicate_reserved_product' as check_name,
  count(*) - count(distinct product_id) as duplicate_count
from public.commerce_reservations;

select 'pii_public_grants' as check_name,
  has_table_privilege('anon','public.commerce_orders','select') as anon_orders_select,
  has_table_privilege('authenticated','public.commerce_orders','select') as authenticated_orders_select,
  has_table_privilege('anon','public.commerce_order_items','select') as anon_items_select;
-- Expected: all false.
