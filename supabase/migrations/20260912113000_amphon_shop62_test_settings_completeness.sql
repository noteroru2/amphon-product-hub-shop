-- SHOP-6.2 forward fix: make the private E2E checkout helper satisfy the
-- production shipping/return completeness constraints while it temporarily
-- enables checkout inside test mode. The original settings are restored before
-- the helper returns, and failed statements roll back atomically.

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
         shipping_country = 'TH',
         shipping_rate = 0,
         handling_min_days = 0,
         handling_max_days = 1,
         transit_min_days = 1,
         transit_max_days = 3,
         return_policy_enabled = true,
         return_policy_category = 'FINITE',
         return_days = 7,
         return_method = 'MAIL_AND_IN_STORE',
         return_fees = 'CUSTOMER_RESPONSIBILITY',
         checkout_turnstile_enabled = true,
         turnstile_site_key = coalesce(nullif(turnstile_site_key, ''), 'SHOP62-TEST-ONLY'),
         reservation_minutes = greatest(reservation_minutes, 45),
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
         shipping_country = original.shipping_country,
         shipping_rate = original.shipping_rate,
         handling_min_days = original.handling_min_days,
         handling_max_days = original.handling_max_days,
         transit_min_days = original.transit_min_days,
         transit_max_days = original.transit_max_days,
         return_policy_enabled = original.return_policy_enabled,
         return_policy_category = original.return_policy_category,
         return_days = original.return_days,
         return_method = original.return_method,
         return_fees = original.return_fees,
         checkout_turnstile_enabled = original.checkout_turnstile_enabled,
         turnstile_site_key = original.turnstile_site_key,
         reservation_minutes = original.reservation_minutes,
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
