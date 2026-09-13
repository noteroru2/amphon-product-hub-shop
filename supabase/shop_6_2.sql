-- AMPHON SHOP — SHOP-6.2 Payment & Fulfillment E2E Acceptance Gate
-- Run after supabase/shop_6.sql. Safe to re-run.
--
-- Goals:
-- 1) Keep public purchase disabled until a real Stripe TEST provider E2E has passed.
-- 2) Allow isolated AT-TST-* checkout fixtures without exposing public checkout.
-- 3) Invalidate acceptance automatically if payment/fulfillment-critical settings change.
-- 4) Make full-refund warranty/claim state deterministic.
-- 5) Never store Stripe/Supabase secrets in PostgreSQL.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- ACCEPTANCE STATE
-- ------------------------------------------------------------

alter table public.commerce_store_settings
  add column if not exists shop62_acceptance_version text,
  add column if not exists shop62_accepted_at timestamptz,
  add column if not exists shop62_acceptance_evidence jsonb not null default '{}'::jsonb,
  add column if not exists shop62_test_token_hash text,
  add column if not exists shop62_test_token_expires_at timestamptz,
  add column if not exists shop62_last_invalidated_at timestamptz,
  add column if not exists shop62_last_invalidated_reason text;

-- Ensure an older enabled checkout cannot stay open merely because SHOP-6.2 was added.
update public.commerce_store_settings
   set purchase_enabled = false
 where id = 1
   and purchase_enabled = true
   and coalesce(shop62_acceptance_version, '') <> 'SHOP-6.2';

create or replace function private.shop62_actor_is_service_or_postgres()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select session_user = 'postgres' or coalesce(auth.role(), '') = 'service_role';
$$;

revoke all on function private.shop62_actor_is_service_or_postgres() from public, anon, authenticated;

-- A small deterministic trigger is safer than relying on UI discipline. Any material
-- checkout/payment/fulfillment config change revokes the provider acceptance evidence.
create or replace function private.invalidate_shop62_acceptance_on_critical_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.shop62_test_mode', true), '') = 'on' then
    return new;
  end if;

  if
    new.site_url is distinct from old.site_url
    or new.currency is distinct from old.currency
    or new.shipping_enabled is distinct from old.shipping_enabled
    or new.shipping_country is distinct from old.shipping_country
    or new.shipping_rate is distinct from old.shipping_rate
    or new.handling_min_days is distinct from old.handling_min_days
    or new.handling_max_days is distinct from old.handling_max_days
    or new.transit_min_days is distinct from old.transit_min_days
    or new.transit_max_days is distinct from old.transit_max_days
    or new.return_policy_enabled is distinct from old.return_policy_enabled
    or new.return_policy_category is distinct from old.return_policy_category
    or new.return_days is distinct from old.return_days
    or new.return_method is distinct from old.return_method
    or new.return_fees is distinct from old.return_fees
    or new.reservation_minutes is distinct from old.reservation_minutes
    or new.bank_transfer_enabled is distinct from old.bank_transfer_enabled
    or new.pay_at_store_enabled is distinct from old.pay_at_store_enabled
    or new.pickup_enabled is distinct from old.pickup_enabled
    or new.checkout_turnstile_enabled is distinct from old.checkout_turnstile_enabled
    or new.turnstile_site_key is distinct from old.turnstile_site_key
    or new.stripe_enabled is distinct from old.stripe_enabled
    or new.stripe_promptpay_enabled is distinct from old.stripe_promptpay_enabled
    or new.document_mode is distinct from old.document_mode
    or new.default_warranty_days is distinct from old.default_warranty_days
    or new.default_warranty_terms is distinct from old.default_warranty_terms
  then
    new.purchase_enabled := false;
    new.shop62_acceptance_version := null;
    new.shop62_accepted_at := null;
    new.shop62_acceptance_evidence := '{}'::jsonb;
    new.shop62_last_invalidated_at := now();
    new.shop62_last_invalidated_reason := 'PAYMENT_OR_FULFILLMENT_CONFIG_CHANGED';
  end if;

  return new;
end;
$$;

revoke all on function private.invalidate_shop62_acceptance_on_critical_settings() from public, anon, authenticated;

drop trigger if exists commerce_store_settings_shop62_invalidate on public.commerce_store_settings;
create trigger commerce_store_settings_shop62_invalidate
before update on public.commerce_store_settings
for each row execute procedure private.invalidate_shop62_acceptance_on_critical_settings();

-- Replace the SHOP-6 activation guard with the stronger SHOP-6.2 provider gate.
alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop6_purchase_ready_check;
alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop62_purchase_ready_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop62_purchase_ready_check
  check (
    purchase_enabled = false
    or (
      shipping_enabled = true
      and return_policy_enabled = true
      and checkout_turnstile_enabled = true
      and nullif(btrim(turnstile_site_key), '') is not null
      and nullif(btrim(site_url), '') is not null
      and (bank_transfer_enabled = true or stripe_enabled = true or (pay_at_store_enabled = true and pickup_enabled = true))
      and shop62_acceptance_version = 'SHOP-6.2'
      and shop62_accepted_at is not null
      and coalesce(shop62_acceptance_evidence->>'provider', '') = 'STRIPE'
      and coalesce(shop62_acceptance_evidence->>'mode', '') = 'test'
      and coalesce(shop62_acceptance_evidence->>'card', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'signedWebhook', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'duplicateEvent', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'amountMismatch', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'currencyMismatch', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'reservationExpiry', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'shippingLifecycle', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'pickupLifecycle', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'documentSnapshot', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'warrantySnapshot', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'refundReturned', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'warrantyVoided', '') = 'PASS'
      and (
        stripe_promptpay_enabled = false
        or coalesce(shop62_acceptance_evidence->>'promptPay', '') = 'PASS'
      )
    )
  );

-- ------------------------------------------------------------
-- SHORT-LIVED TEST TOKEN
-- ------------------------------------------------------------

create or replace function public.set_shop62_test_token(test_token text, ttl_minutes integer default 30)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  expires_at_value timestamptz;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  if char_length(coalesce(test_token, '')) < 32 then raise exception 'SHOP62_TEST_TOKEN_TOO_SHORT'; end if;
  if ttl_minutes < 5 or ttl_minutes > 120 then raise exception 'SHOP62_TEST_TOKEN_TTL_INVALID'; end if;

  expires_at_value := now() + make_interval(mins => ttl_minutes);
  update public.commerce_store_settings
     set shop62_test_token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(test_token, 'UTF8')), 'hex'),
         shop62_test_token_expires_at = expires_at_value
   where id = 1;
  return expires_at_value;
end;
$$;

revoke all on function public.set_shop62_test_token(text, integer) from public, anon, authenticated;
grant execute on function public.set_shop62_test_token(text, integer) to service_role;

create or replace function private.shop62_assert_test_token(test_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.commerce_store_settings%rowtype;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  select * into s from public.commerce_store_settings where id = 1 for update;
  if s.id is null then raise exception 'STORE_SETTINGS_NOT_FOUND'; end if;
  if s.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;
  if s.shop62_test_token_hash is null or s.shop62_test_token_expires_at is null or s.shop62_test_token_expires_at <= now() then
    raise exception 'SHOP62_TEST_TOKEN_EXPIRED';
  end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(test_token, ''), 'UTF8')), 'hex') <> s.shop62_test_token_hash then
    raise exception 'SHOP62_TEST_TOKEN_INVALID';
  end if;
end;
$$;

revoke all on function private.shop62_assert_test_token(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ISOLATED TEST ORDER CREATION
-- ------------------------------------------------------------
-- The existing create_commerce_order() remains the reservation/order owner. This wrapper
-- only creates an uncommitted, transaction-local settings bypass so AT-TST-* fixtures can
-- exercise the exact production order engine while public checkout remains disabled to
-- every concurrent transaction.

create or replace function public.create_commerce_test_order(checkout jsonb, test_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.commerce_store_settings%rowtype;
  result jsonb;
  sku text;
begin
  perform private.shop62_assert_test_token(test_token);
  select * into original from public.commerce_store_settings where id = 1 for update;

  if original.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;
  if coalesce(jsonb_array_length(coalesce(checkout->'skus', '[]'::jsonb)), 0) < 1 then raise exception 'INVALID_CART_SIZE'; end if;

  for sku in select upper(btrim(value)) from jsonb_array_elements_text(coalesce(checkout->'skus', '[]'::jsonb))
  loop
    if sku !~ '^AT-TST-' then raise exception 'SHOP62_TEST_SKU_REQUIRED:%', sku; end if;
  end loop;

  perform pg_catalog.set_config('app.shop62_test_mode', 'on', true);

  update public.commerce_store_settings
     set purchase_enabled = true,
         stripe_enabled = true,
         shipping_enabled = true,
         return_policy_enabled = true,
         checkout_turnstile_enabled = true,
         turnstile_site_key = coalesce(nullif(turnstile_site_key, ''), 'SHOP62-TEST-ONLY'),
         reservation_minutes = greatest(reservation_minutes, 45),
         shipping_rate = coalesce(shipping_rate, 0),
         pickup_enabled = true,
         shop62_acceptance_version = 'SHOP-6.2',
         shop62_accepted_at = now(),
         shop62_acceptance_evidence = jsonb_build_object(
           'provider','STRIPE','mode','test','card','PASS','signedWebhook','PASS','duplicateEvent','PASS',
           'amountMismatch','PASS','currencyMismatch','PASS','reservationExpiry','PASS','shippingLifecycle','PASS',
           'pickupLifecycle','PASS','documentSnapshot','PASS','warrantySnapshot','PASS','refundReturned','PASS',
           'warrantyVoided','PASS','promptPay','PASS','temporaryBypass',true
         )
   where id = 1;

  result := public.create_commerce_order(checkout);

  update public.commerce_store_settings
     set purchase_enabled = original.purchase_enabled,
         stripe_enabled = original.stripe_enabled,
         shipping_enabled = original.shipping_enabled,
         return_policy_enabled = original.return_policy_enabled,
         checkout_turnstile_enabled = original.checkout_turnstile_enabled,
         turnstile_site_key = original.turnstile_site_key,
         reservation_minutes = original.reservation_minutes,
         shipping_rate = original.shipping_rate,
         pickup_enabled = original.pickup_enabled,
         shop62_acceptance_version = original.shop62_acceptance_version,
         shop62_accepted_at = original.shop62_accepted_at,
         shop62_acceptance_evidence = original.shop62_acceptance_evidence,
         shop62_last_invalidated_at = original.shop62_last_invalidated_at,
         shop62_last_invalidated_reason = original.shop62_last_invalidated_reason
   where id = 1;

  return result;
end;
$$;

revoke all on function public.create_commerce_test_order(jsonb, text) from public, anon, authenticated;
grant execute on function public.create_commerce_test_order(jsonb, text) to service_role;

-- ------------------------------------------------------------
-- ACCEPTANCE RECORDING
-- ------------------------------------------------------------

create or replace function public.record_shop62_provider_acceptance(evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.commerce_store_settings%rowtype;
  promptpay_result text;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  select * into s from public.commerce_store_settings where id = 1 for update;
  if s.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;

  if coalesce(evidence->>'provider','') <> 'STRIPE' or coalesce(evidence->>'mode','') <> 'test' then raise exception 'SHOP62_PROVIDER_EVIDENCE_INVALID'; end if;
  if coalesce(evidence->>'card','') <> 'PASS' then raise exception 'SHOP62_CARD_REQUIRED'; end if;
  if coalesce(evidence->>'signedWebhook','') <> 'PASS' then raise exception 'SHOP62_SIGNED_WEBHOOK_REQUIRED'; end if;
  if coalesce(evidence->>'duplicateEvent','') <> 'PASS' then raise exception 'SHOP62_DUPLICATE_EVENT_REQUIRED'; end if;
  if coalesce(evidence->>'amountMismatch','') <> 'PASS' then raise exception 'SHOP62_AMOUNT_MISMATCH_REQUIRED'; end if;
  if coalesce(evidence->>'currencyMismatch','') <> 'PASS' then raise exception 'SHOP62_CURRENCY_MISMATCH_REQUIRED'; end if;
  if coalesce(evidence->>'reservationExpiry','') <> 'PASS' then raise exception 'SHOP62_EXPIRY_REQUIRED'; end if;
  if coalesce(evidence->>'shippingLifecycle','') <> 'PASS' then raise exception 'SHOP62_SHIPPING_REQUIRED'; end if;
  if coalesce(evidence->>'pickupLifecycle','') <> 'PASS' then raise exception 'SHOP62_PICKUP_REQUIRED'; end if;
  if coalesce(evidence->>'documentSnapshot','') <> 'PASS' then raise exception 'SHOP62_DOCUMENT_REQUIRED'; end if;
  if coalesce(evidence->>'warrantySnapshot','') <> 'PASS' then raise exception 'SHOP62_WARRANTY_REQUIRED'; end if;
  if coalesce(evidence->>'refundReturned','') <> 'PASS' then raise exception 'SHOP62_REFUND_REQUIRED'; end if;
  if coalesce(evidence->>'warrantyVoided','') <> 'PASS' then raise exception 'SHOP62_WARRANTY_VOID_REQUIRED'; end if;

  promptpay_result := coalesce(evidence->>'promptPay','');
  if s.stripe_promptpay_enabled is true and promptpay_result <> 'PASS' then raise exception 'SHOP62_PROMPTPAY_REQUIRED'; end if;
  if s.stripe_promptpay_enabled is false and promptpay_result not in ('PASS','SKIPPED_DISABLED') then raise exception 'SHOP62_PROMPTPAY_EVIDENCE_INVALID'; end if;

  update public.commerce_store_settings
     set purchase_enabled = false,
         shop62_acceptance_version = 'SHOP-6.2',
         shop62_accepted_at = now(),
         shop62_acceptance_evidence = evidence || jsonb_build_object('recordedAt', now()),
         shop62_test_token_hash = null,
         shop62_test_token_expires_at = null,
         shop62_last_invalidated_reason = null
   where id = 1
   returning * into s;

  return jsonb_build_object(
    'version', s.shop62_acceptance_version,
    'acceptedAt', s.shop62_accepted_at,
    'purchaseEnabled', s.purchase_enabled,
    'evidence', s.shop62_acceptance_evidence
  );
end;
$$;

revoke all on function public.record_shop62_provider_acceptance(jsonb) from public, anon, authenticated;
grant execute on function public.record_shop62_provider_acceptance(jsonb) to service_role;

-- ------------------------------------------------------------
-- REFUND/WARRANTY SAFETY
-- ------------------------------------------------------------
-- Void any issued warranty and cancel unresolved claims after a full refund, regardless
-- of whether the refund arrived before or after fulfillment metadata was written.

create or replace function private.shop62_void_warranty_after_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'REFUNDED' and old.payment_status is distinct from 'REFUNDED' then
    update public.commerce_warranties
       set status = 'VOID'
     where order_id = new.id
       and status <> 'VOID';

    update public.commerce_warranty_claims c
       set status = 'CANCELLED',
           resolution = coalesce(c.resolution, 'Order fully refunded'),
           resolved_at = coalesce(c.resolved_at, now()),
           updated_at = now()
     where c.warranty_id in (select w.id from public.commerce_warranties w where w.order_id = new.id)
       and c.status in ('OPEN','IN_REVIEW','APPROVED');

    update public.commerce_documents
       set voided_at = coalesce(voided_at, now())
     where order_id = new.id
       and voided_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.shop62_void_warranty_after_refund() from public, anon, authenticated;

drop trigger if exists commerce_orders_shop62_refund_cleanup on public.commerce_orders;
create trigger commerce_orders_shop62_refund_cleanup
after update of payment_status on public.commerce_orders
for each row execute procedure private.shop62_void_warranty_after_refund();

-- Refund race hardening: if Stripe's signed webhook confirms the refund before the API
-- call can mark REFUND_PENDING, treat the later mark-pending call as an idempotent success.
create or replace function public.mark_commerce_gateway_refund_pending(target_order_id uuid, provider_refund_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  v_provider_refund_id text := provider_refund_id;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;

  if o.payment_status='REFUNDED' then
    update public.commerce_orders as co
       set provider_refund_id = coalesce(v_provider_refund_id, co.provider_refund_id),
           refund_status = coalesce(co.refund_status, 'SUCCEEDED')
     where co.id=o.id
     returning co.* into o;
    return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',true);
  end if;

  if o.payment_status<>'PAID' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;
  update public.commerce_orders as co
     set payment_status='REFUND_PENDING',provider_refund_id=v_provider_refund_id,refund_status='PENDING'
   where co.id=o.id returning co.* into o;
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(o.id,'REFUND_REQUESTED',jsonb_build_object('provider','STRIPE','refundId',v_provider_refund_id));
  return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',false);
end;
$$;

revoke all on function public.mark_commerce_gateway_refund_pending(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_commerce_gateway_refund_pending(uuid,text) to service_role;

-- ------------------------------------------------------------
-- TEST FIXTURE CLEANUP
-- ------------------------------------------------------------

create or replace function public.cleanup_shop62_test_fixtures(test_token text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order uuid;
  removed integer := 0;
begin
  perform private.shop62_assert_test_token(test_token);

  for target_order in
    select distinct oi.order_id
      from public.commerce_order_items oi
     where oi.sku like 'AT-TST-%'
  loop
    delete from public.commerce_warranty_claims where warranty_id in (select id from public.commerce_warranties where order_id=target_order);
    delete from public.commerce_warranties where order_id=target_order;
    delete from public.commerce_documents where order_id=target_order;
    delete from public.commerce_fulfillment_events where order_id=target_order;
    delete from public.commerce_shipments where order_id=target_order;
    delete from public.commerce_payment_events where order_id=target_order;
    delete from public.commerce_payment_transactions where order_id=target_order;
    delete from public.commerce_reservations where order_id=target_order;
    delete from public.commerce_order_items where order_id=target_order;
    delete from public.commerce_orders where id=target_order;
    removed := removed + 1;
  end loop;

  delete from public.products where sku like 'AT-TST-%';
  return removed;
end;
$$;

revoke all on function public.cleanup_shop62_test_fixtures(text) from public, anon, authenticated;
grant execute on function public.cleanup_shop62_test_fixtures(text) to service_role;

-- ------------------------------------------------------------
-- SERVER-ONLY SECURITY + READINESS VIEW
-- ------------------------------------------------------------

create or replace view public.commerce_shop62_acceptance_v
with (security_invoker = true)
as
select
  s.purchase_enabled,
  s.stripe_enabled,
  s.stripe_promptpay_enabled,
  s.shop62_acceptance_version,
  s.shop62_accepted_at,
  s.shop62_acceptance_evidence,
  s.shop62_last_invalidated_at,
  s.shop62_last_invalidated_reason,
  case
    when s.shop62_acceptance_version='SHOP-6.2'
      and s.shop62_accepted_at is not null
      and coalesce(s.shop62_acceptance_evidence->>'card','')='PASS'
      and coalesce(s.shop62_acceptance_evidence->>'signedWebhook','')='PASS'
      and coalesce(s.shop62_acceptance_evidence->>'refundReturned','')='PASS'
      and (s.stripe_promptpay_enabled=false or coalesce(s.shop62_acceptance_evidence->>'promptPay','')='PASS')
    then true else false
  end as provider_acceptance_ready
from public.commerce_store_settings s
where s.id=1;

revoke all on public.commerce_shop62_acceptance_v from anon, authenticated;
grant select on public.commerce_shop62_acceptance_v to service_role;

-- Keep the release closed by default. The separate activation step remains explicit.
update public.commerce_store_settings set purchase_enabled=false where id=1;
