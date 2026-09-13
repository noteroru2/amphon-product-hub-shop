-- AMPHON SHOP — SHOP-6.1 Production Database Acceptance Gate
-- Read-only. Run AFTER shop_6.sql + shop_6_verify.sql on the target Supabase project.
begin;

select 'SHOP61_REQUIRED_OBJECTS' as gate,
       to_regclass('public.commerce_orders') is not null as orders,
       to_regclass('public.commerce_reservations') is not null as reservations,
       to_regclass('public.commerce_payment_events') is not null as payment_events,
       to_regclass('public.commerce_shipments') is not null as shipments,
       to_regclass('public.commerce_documents') is not null as documents,
       to_regclass('public.commerce_warranties') is not null as warranties;

select 'SHOP61_STORE_SETTINGS' as gate,
       purchase_enabled,
       stripe_enabled,
       stripe_promptpay_enabled,
       bank_transfer_enabled,
       pay_at_store_enabled,
       pickup_enabled,
       shipping_enabled,
       return_policy_enabled,
       checkout_turnstile_enabled,
       reservation_minutes,
       document_mode,
       default_warranty_days
from public.commerce_store_settings where id=1;

select 'SHOP61_RESERVED_WITHOUT_RESERVATION' as gate, count(*) as failures
from public.products p
where p.status='reserved'
  and not exists(select 1 from public.commerce_reservations r where r.product_id=p.id);

select 'SHOP61_RESERVATION_PRODUCT_MISMATCH' as gate, count(*) as failures
from public.commerce_reservations r
join public.products p on p.id=r.product_id
where p.status <> 'reserved';

select 'SHOP61_RESERVATION_ORDER_MISMATCH' as gate, count(*) as failures
from public.commerce_reservations r
join public.commerce_orders o on o.id=r.order_id
where o.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW');

select 'SHOP61_PAID_STRIPE_WITHOUT_PAYMENT_INTENT' as gate, count(*) as failures
from public.commerce_orders
where payment_provider='STRIPE' and payment_status='PAID'
  and nullif(provider_payment_intent_id,'') is null;

select 'SHOP61_SOLD_ORDER_ITEM_MISMATCH' as gate, count(*) as failures
from public.commerce_order_items oi
join public.commerce_orders o on o.id=oi.order_id
join public.products p on p.id=oi.product_id
where o.payment_status='PAID' and o.order_status not in ('REFUNDED','CANCELLED') and p.status <> 'sold';

select 'SHOP61_REFUNDED_ITEM_NOT_RETURNED' as gate, count(*) as failures
from public.commerce_order_items oi
join public.commerce_orders o on o.id=oi.order_id
join public.products p on p.id=oi.product_id
where o.order_status='REFUNDED' and p.status <> 'returned';

select 'SHOP61_DUPLICATE_PROVIDER_EVENTS' as gate, count(*) as failures
from (
  select provider,provider_event_id,count(*) c
  from public.commerce_payment_events
  group by provider,provider_event_id
  having count(*)>1
) x;

select 'SHOP61_COMPLETED_MISSING_DOCUMENT' as gate, count(*) as failures
from public.commerce_orders o
where o.order_status='COMPLETED' and o.payment_status='PAID'
  and not exists(select 1 from public.commerce_documents d where d.order_id=o.id and d.voided_at is null);

select 'SHOP61_COMPLETED_WARRANTY_GAP' as gate, count(*) as failures
from public.commerce_order_items oi
join public.commerce_orders o on o.id=oi.order_id
where o.order_status='COMPLETED' and o.payment_status='PAID' and oi.warranty_days>0
  and not exists(select 1 from public.commerce_warranties w where w.order_item_id=oi.id);

select 'SHOP61_PUBLIC_GRANTS' as gate, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('commerce_orders','commerce_order_items','commerce_reservations','commerce_payment_transactions','commerce_payment_events','commerce_shipments','commerce_documents','commerce_warranties','commerce_warranty_claims')
  and grantee in ('anon','authenticated')
order by table_name,grantee,privilege_type;

rollback;
