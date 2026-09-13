-- SHOP-6.2 rollback-safe database contract acceptance.
-- This script intentionally ends with ROLLBACK and leaves no fixtures/evidence behind.

begin;

do $$
declare
  token text := 'SHOP62-CONTRACT-TEST-TOKEN-0123456789abcdef';
  sku_card text := 'AT-TST-CONTRACT-CARD';
  sku_amount text := 'AT-TST-CONTRACT-AMOUNT';
  sku_currency text := 'AT-TST-CONTRACT-CURRENCY';
  sku_expiry text := 'AT-TST-CONTRACT-EXPIRY';
  sku_pickup text := 'AT-TST-CONTRACT-PICKUP';
  pid uuid;
  order_result jsonb;
  v_order_id uuid;
  total_minor bigint;
  duplicate_result jsonb;
  warranty_id uuid;
  expiry_order uuid;
  pickup_order uuid;
  tmp jsonb;
  settings_purchase boolean;
  mismatch_seen boolean := false;
  currency_seen boolean := false;
  s text;
begin
  select purchase_enabled into settings_purchase from public.commerce_store_settings where id=1;
  if settings_purchase then raise exception 'SHOP62 CONTRACT: purchase_enabled must be false'; end if;

  perform public.set_shop62_test_token(token, 30);

  foreach s in array array[sku_card,sku_amount,sku_currency,sku_expiry,sku_pickup]
  loop
    insert into public.products(sku,category,brand,model,title,status,condition_percent,price,specs)
    values(s,'notebook','SHOP62','E2E','SHOP-6.2 E2E '||s,'published',99,19.00,'{}'::jsonb)
    returning id into pid;

    insert into public.product_publications(product_id,channel,status,published_at)
    values(pid,'website','published',now());

    -- Publishing to the website fires product_publications_ensure_commerce_listing,
    -- which creates the one-to-one commerce_listings row synchronously. Reconfigure
    -- that generated row for the private E2E fixture instead of inserting a second
    -- listing for the same product_id.
    update public.commerce_listings
       set slug = lower(replace(s,'_','-')),
           index_policy = 'NOINDEX',
           merchant_enabled = false,
           merchant_item_condition = 'USED',
           store_warranty_days = 30,
           store_warranty_terms = 'SHOP-6.2 contract warranty',
           updated_at = now()
     where product_id = pid;

    if not found then
      raise exception 'SHOP62 CONTRACT: website publication did not create commerce listing for %', s;
    end if;
  end loop;

  -- Card-like success + duplicate + shipping + warranty + refund/void.
  order_result := public.create_commerce_test_order(jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'skus',jsonb_build_array(sku_card),'customerName','SHOP62 Contract',
    'customerPhone','0800000000','customerEmail','shop62@example.invalid','deliveryMethod','SHIPPING','paymentMethod','STRIPE',
    'addressLine','TEST','district','TEST','province','Ubon Ratchathani','postalCode','34000'
  ), token);
  v_order_id := (order_result->>'orderId')::uuid;
  select round(co.total*100)::bigint into total_minor from public.commerce_orders as co where co.id=v_order_id;

  tmp := public.process_gateway_payment_event('STRIPE','evt_shop62_contract_paid','PAYMENT_SUCCEEDED',v_order_id,'pi_shop62_contract',total_minor,'THB','{}'::jsonb);
  if coalesce(tmp->>'paymentStatus','') <> 'PAID' then raise exception 'SHOP62 CONTRACT: payment success failed'; end if;
  if (select status from public.products where sku=sku_card) <> 'sold' then raise exception 'SHOP62 CONTRACT: SKU not sold after payment'; end if;

  duplicate_result := public.process_gateway_payment_event('STRIPE','evt_shop62_contract_paid','PAYMENT_SUCCEEDED',v_order_id,'pi_shop62_contract',total_minor,'THB','{}'::jsonb);
  if coalesce((duplicate_result->>'duplicate')::boolean,false) is not true then raise exception 'SHOP62 CONTRACT: duplicate event not idempotent'; end if;
  if (select count(*) from public.commerce_payment_events as cpe where cpe.provider='STRIPE' and cpe.provider_event_id='evt_shop62_contract_paid') <> 1 then raise exception 'SHOP62 CONTRACT: duplicate event ledger count invalid'; end if;

  perform public.admin_commerce_order_action(v_order_id,'MARK_SHIPPED',null,jsonb_build_object('trackingCarrier','SHOP62','trackingNumber','TEST-TRACK'));
  perform public.admin_commerce_order_action(v_order_id,'MARK_DELIVERED',null,'{}'::jsonb);
  if (select co.fulfillment_status from public.commerce_orders as co where co.id=v_order_id) <> 'DELIVERED' then raise exception 'SHOP62 CONTRACT: shipping lifecycle failed'; end if;
  if not exists(select 1 from public.commerce_documents as cd where cd.order_id=v_order_id and cd.voided_at is null) then raise exception 'SHOP62 CONTRACT: document snapshot missing'; end if;
  select cw.id into warranty_id from public.commerce_warranties as cw where cw.order_id=v_order_id limit 1;
  if warranty_id is null then raise exception 'SHOP62 CONTRACT: warranty snapshot missing'; end if;

  tmp := public.process_gateway_payment_event('STRIPE','evt_shop62_contract_refund','REFUND_SUCCEEDED',v_order_id,'pi_shop62_contract',total_minor,'THB','{}'::jsonb);
  if (select co.payment_status from public.commerce_orders as co where co.id=v_order_id) <> 'REFUNDED' then raise exception 'SHOP62 CONTRACT: refund failed'; end if;
  if (select status from public.products where sku=sku_card) <> 'returned' then raise exception 'SHOP62 CONTRACT: refunded SKU not returned'; end if;
  if (select status from public.commerce_warranties where id=warranty_id) <> 'VOID' then raise exception 'SHOP62 CONTRACT: warranty not voided'; end if;
  if exists(select 1 from public.commerce_documents as cd where cd.order_id=v_order_id and cd.voided_at is null) then raise exception 'SHOP62 CONTRACT: refunded document not voided'; end if;

  -- Amount mismatch must be rejected and leave the test order unpaid.
  order_result := public.create_commerce_test_order(jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'skus',jsonb_build_array(sku_amount),'customerName','SHOP62 Contract',
    'customerPhone','0800000000','deliveryMethod','SHIPPING','paymentMethod','STRIPE','addressLine','TEST','district','TEST','province','Ubon Ratchathani','postalCode','34000'
  ), token);
  v_order_id := (order_result->>'orderId')::uuid;
  select round(co.total*100)::bigint into total_minor from public.commerce_orders as co where co.id=v_order_id;
  begin
    perform public.process_gateway_payment_event('STRIPE','evt_shop62_bad_amount','PAYMENT_SUCCEEDED',v_order_id,'pi_shop62_bad_amount',total_minor+1,'THB','{}'::jsonb);
  exception when others then
    if sqlerrm not like '%PAYMENT_AMOUNT_MISMATCH%' then raise; end if;
    mismatch_seen := true;
  end;
  if mismatch_seen is not true then raise exception 'SHOP62 CONTRACT: amount mismatch was not rejected'; end if;
  if (select co.payment_status from public.commerce_orders as co where co.id=v_order_id) <> 'UNPAID' then raise exception 'SHOP62 CONTRACT: amount mismatch changed payment state'; end if;
  if (select p.status from public.products as p where p.sku=sku_amount) <> 'reserved' then raise exception 'SHOP62 CONTRACT: amount mismatch released or sold SKU'; end if;

  -- Currency mismatch must be rejected.
  order_result := public.create_commerce_test_order(jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'skus',jsonb_build_array(sku_currency),'customerName','SHOP62 Contract',
    'customerPhone','0800000000','deliveryMethod','SHIPPING','paymentMethod','STRIPE','addressLine','TEST','district','TEST','province','Ubon Ratchathani','postalCode','34000'
  ), token);
  v_order_id := (order_result->>'orderId')::uuid;
  select round(co.total*100)::bigint into total_minor from public.commerce_orders as co where co.id=v_order_id;
  begin
    perform public.process_gateway_payment_event('STRIPE','evt_shop62_bad_currency','PAYMENT_SUCCEEDED',v_order_id,'pi_shop62_bad_currency',total_minor,'USD','{}'::jsonb);
  exception when others then
    if sqlerrm not like '%PAYMENT_CURRENCY_MISMATCH%' then raise; end if;
    currency_seen := true;
  end;
  if currency_seen is not true then raise exception 'SHOP62 CONTRACT: currency mismatch was not rejected'; end if;
  if (select co.payment_status from public.commerce_orders as co where co.id=v_order_id) <> 'UNPAID' then raise exception 'SHOP62 CONTRACT: currency mismatch changed payment state'; end if;
  if (select p.status from public.products as p where p.sku=sku_currency) <> 'reserved' then raise exception 'SHOP62 CONTRACT: currency mismatch released or sold SKU'; end if;

  -- Reservation expiry returns the physical SKU to published.
  order_result := public.create_commerce_test_order(jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'skus',jsonb_build_array(sku_expiry),'customerName','SHOP62 Contract',
    'customerPhone','0800000000','deliveryMethod','SHIPPING','paymentMethod','STRIPE','addressLine','TEST','district','TEST','province','Ubon Ratchathani','postalCode','34000'
  ), token);
  expiry_order := (order_result->>'orderId')::uuid;
  update public.commerce_orders set reservation_expires_at=now()-interval '1 minute' where id=expiry_order;
  update public.commerce_reservations set expires_at=now()-interval '1 minute' where order_id=expiry_order;
  perform public.expire_commerce_reservations(100);
  if (select order_status from public.commerce_orders where id=expiry_order) <> 'EXPIRED' then raise exception 'SHOP62 CONTRACT: expiry order not expired'; end if;
  if (select status from public.products where sku=sku_expiry) <> 'published' then raise exception 'SHOP62 CONTRACT: expired SKU not republished'; end if;
  if exists(select 1 from public.commerce_reservations as cr where cr.order_id=expiry_order) then raise exception 'SHOP62 CONTRACT: expired reservation not released'; end if;

  -- Pickup lifecycle uses the exact order/action state machine.
  order_result := public.create_commerce_test_order(jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'skus',jsonb_build_array(sku_pickup),'customerName','SHOP62 Contract',
    'customerPhone','0800000000','deliveryMethod','PICKUP','paymentMethod','STRIPE'
  ), token);
  pickup_order := (order_result->>'orderId')::uuid;
  select round(total*100)::bigint into total_minor from public.commerce_orders where id=pickup_order;
  perform public.process_gateway_payment_event('STRIPE','evt_shop62_pickup_paid','PAYMENT_SUCCEEDED',pickup_order,'pi_shop62_pickup',total_minor,'THB','{}'::jsonb);
  perform public.admin_commerce_order_action(pickup_order,'MARK_PICKUP_READY',null,'{}'::jsonb);
  perform public.admin_commerce_order_action(pickup_order,'COMPLETE',null,'{}'::jsonb);
  if (select fulfillment_status from public.commerce_orders where id=pickup_order) <> 'PICKED_UP' then raise exception 'SHOP62 CONTRACT: pickup lifecycle failed'; end if;

  if (select purchase_enabled from public.commerce_store_settings where id=1) is true then raise exception 'SHOP62 CONTRACT: public checkout escaped closed state'; end if;

  raise notice 'SHOP62_DATABASE_CONTRACT_ACCEPTANCE: PASS';
end $$;

rollback;

-- Prove that the transaction boundary removed the contract fixtures and did
-- not open public checkout. These assertions are intentionally outside it.
do $$
begin
  if exists (
    select 1 from public.products as p
     where p.sku like 'AT-TST-CONTRACT-%'
  ) then
    raise exception 'SHOP62 CONTRACT: rollback left product fixtures behind';
  end if;

  if exists (
    select 1 from public.commerce_payment_events as cpe
     where cpe.provider_event_id like 'evt_shop62_%'
  ) then
    raise exception 'SHOP62 CONTRACT: rollback left payment event fixtures behind';
  end if;

  if (select css.purchase_enabled from public.commerce_store_settings as css where css.id=1) is true then
    raise exception 'SHOP62 CONTRACT: purchase_enabled changed after rollback';
  end if;

  raise notice 'SHOP62_DATABASE_CONTRACT_ROLLBACK: PASS';
end $$;
