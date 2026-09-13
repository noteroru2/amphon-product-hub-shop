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
