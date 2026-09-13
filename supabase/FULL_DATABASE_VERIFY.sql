-- AMPHON Product Hub + SHOP-6.1 — FULL DATABASE VERIFY
-- Read-only verification. Run after FULL_DATABASE_SETUP.sql.


-- ===== BEGIN shop_6_verify.sql =====
-- SHOP-6 verification. Read-only checks inside a transaction.
begin;

-- Required objects
select relname, relkind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and relname in (
  'commerce_payment_transactions','commerce_payment_events','commerce_shipments','commerce_fulfillment_events',
  'commerce_documents','commerce_warranties','commerce_warranty_claims','commerce_order_admin_v','commerce_listing_editor_v','commerce_public_store_settings_v'
)
order by relname;

-- Required RPCs
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'create_commerce_order','attach_commerce_gateway_checkout','cancel_commerce_gateway_order',
  'mark_commerce_gateway_refund_pending','process_gateway_payment_event','admin_commerce_order_action'
)
order by p.proname;

-- Server-only tables must have RLS enabled.
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'commerce_payment_transactions','commerce_payment_events','commerce_shipments','commerce_fulfillment_events',
  'commerce_documents','commerce_warranties','commerce_warranty_claims'
)
order by c.relname;

-- No direct table grants to anon/authenticated.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in (
    'commerce_orders','commerce_order_items','commerce_reservations','commerce_payment_transactions','commerce_payment_events',
    'commerce_shipments','commerce_fulfillment_events','commerce_documents','commerce_warranties','commerce_warranty_claims'
  )
  and grantee in ('anon','authenticated')
order by table_name,grantee,privilege_type;

-- Public settings projection must never contain gateway/bank secrets or private seller credentials.
select column_name
from information_schema.columns
where table_schema='public' and table_name='commerce_public_store_settings_v'
  and lower(column_name) ~ '(secret|api[_]?key|webhook|password|bank_account_number|invoice_tax_id|invoice_address)'
order by column_name;

-- Gateway readiness columns expected on settings/orders/listings.
select table_name, column_name
from information_schema.columns
where table_schema='public' and (
  (table_name='commerce_store_settings' and column_name in ('stripe_enabled','stripe_promptpay_enabled','document_mode','default_warranty_days'))
  or (table_name='commerce_orders' and column_name in ('payment_provider','provider_checkout_session_id','provider_payment_intent_id','provider_checkout_url','invoice_requested','invoice_customer'))
  or (table_name='commerce_listings' and column_name in ('store_warranty_days','store_warranty_terms'))
  or (table_name='commerce_order_items' and column_name in ('warranty_days','warranty_terms'))
)
order by table_name,column_name;

-- One active reservation per physical SKU remains enforced by PK.
select tc.constraint_name, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema and kcu.table_name=tc.table_name
where tc.table_schema='public' and tc.table_name='commerce_reservations' and tc.constraint_type='PRIMARY KEY';

-- Provider event idempotency must be unique.
select indexname, indexdef
from pg_indexes
where schemaname='public' and tablename='commerce_payment_events' and indexdef ilike '%unique%';

-- No order should simultaneously be Stripe + manual provider.
select count(*) as stripe_provider_mismatch
from public.commerce_orders
where payment_method='STRIPE' and payment_provider<>'STRIPE';

-- No paid Stripe order without provider payment id after a real gateway event.
select count(*) as paid_stripe_missing_payment_intent
from public.commerce_orders
where payment_provider='STRIPE' and payment_status='PAID' and provider_payment_intent_id is null;

-- No duplicate documents/warranties by immutable ownership keys.
select order_id, document_type, count(*)
from public.commerce_documents
group by order_id,document_type having count(*)>1;

select order_item_id, count(*)
from public.commerce_warranties
group by order_item_id having count(*)>1;

-- Shipping/fulfillment referential integrity sanity.
select count(*) as orphan_shipments
from public.commerce_shipments s left join public.commerce_orders o on o.id=s.order_id
where o.id is null;

select count(*) as orphan_payment_events
from public.commerce_payment_events e left join public.commerce_orders o on o.id=e.order_id
where e.order_id is not null and o.id is null;

-- Store activation snapshot: should be reviewed before launch.
select
  purchase_enabled, stripe_enabled, stripe_promptpay_enabled, bank_transfer_enabled, pay_at_store_enabled,
  checkout_turnstile_enabled, shipping_enabled, return_policy_enabled, reservation_minutes,
  document_mode, default_warranty_days
from public.commerce_store_settings where id=1;

rollback;

-- ===== END shop_6_verify.sql =====


-- ===== BEGIN shop_6_1_acceptance.sql =====
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

-- ===== END shop_6_1_acceptance.sql =====


-- ===== BEGIN SHOP61_ACCEPTANCE_ASSERT.sql =====
-- AMPHON SHOP — SHOP-6.1 automated production database assertion
-- Read-only. Raises an exception when a critical integrity/privacy invariant fails.
do $$
declare
  failures bigint;
  obj text;
begin
  foreach obj in array array[
    'commerce_orders','commerce_order_items','commerce_reservations',
    'commerce_payment_transactions','commerce_payment_events','commerce_shipments',
    'commerce_documents','commerce_warranties','commerce_warranty_claims'
  ] loop
    if to_regclass('public.' || obj) is null then
      raise exception 'SHOP61_ACCEPTANCE: missing required object public.%', obj;
    end if;
  end loop;

  select count(*) into failures
  from public.products p
  where p.status='reserved'
    and not exists(select 1 from public.commerce_reservations r where r.product_id=p.id);
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % reserved products have no reservation', failures; end if;

  select count(*) into failures
  from public.commerce_reservations r
  join public.products p on p.id=r.product_id
  where p.status <> 'reserved';
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % reservations point to non-reserved products', failures; end if;

  select count(*) into failures
  from public.commerce_reservations r
  join public.commerce_orders o on o.id=r.order_id
  where o.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW');
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % reservations point to invalid order states', failures; end if;

  select count(*) into failures
  from public.commerce_orders
  where payment_provider='STRIPE' and payment_status='PAID'
    and nullif(provider_payment_intent_id,'') is null;
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % paid Stripe orders have no PaymentIntent id', failures; end if;

  select count(*) into failures
  from public.commerce_order_items oi
  join public.commerce_orders o on o.id=oi.order_id
  join public.products p on p.id=oi.product_id
  where o.payment_status='PAID' and o.order_status not in ('REFUNDED','CANCELLED') and p.status <> 'sold';
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % paid order items are not SOLD', failures; end if;

  select count(*) into failures
  from public.commerce_order_items oi
  join public.commerce_orders o on o.id=oi.order_id
  join public.products p on p.id=oi.product_id
  where o.order_status='REFUNDED' and p.status <> 'returned';
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % refunded items are not RETURNED', failures; end if;

  select count(*) into failures
  from (
    select provider, provider_event_id, count(*) c
    from public.commerce_payment_events
    group by provider, provider_event_id
    having count(*) > 1
  ) x;
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % duplicate provider event ids found', failures; end if;

  select count(*) into failures
  from public.commerce_orders o
  where o.order_status='COMPLETED' and o.payment_status='PAID'
    and not exists(select 1 from public.commerce_documents d where d.order_id=o.id and d.voided_at is null);
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % completed paid orders are missing active documents', failures; end if;

  select count(*) into failures
  from public.commerce_order_items oi
  join public.commerce_orders o on o.id=oi.order_id
  where o.order_status='COMPLETED' and o.payment_status='PAID' and oi.warranty_days>0
    and not exists(select 1 from public.commerce_warranties w where w.order_item_id=oi.id);
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % completed warrantied items are missing warranty records', failures; end if;

  select count(*) into failures
  from information_schema.role_table_grants
  where table_schema='public'
    and table_name in (
      'commerce_orders','commerce_order_items','commerce_reservations',
      'commerce_payment_transactions','commerce_payment_events','commerce_shipments',
      'commerce_documents','commerce_warranties','commerce_warranty_claims'
    )
    and grantee in ('anon','authenticated');
  if failures > 0 then raise exception 'SHOP61_ACCEPTANCE: % direct anon/authenticated grants found on private commerce tables', failures; end if;
end $$;

select 'SHOP61_DATABASE_ACCEPTANCE' as gate, 'PASS' as verdict;

-- ===== END SHOP61_ACCEPTANCE_ASSERT.sql =====


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
