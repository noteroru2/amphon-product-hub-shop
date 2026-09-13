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
