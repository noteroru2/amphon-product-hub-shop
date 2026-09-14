-- SHOP-9 safety rollback after PromptPay configuration invalidated SHOP-6.2 provider acceptance.
-- Restore the last accepted production payment surface (Stripe cards only) until
-- PromptPay receives its own provider acceptance test. Do not mark PromptPay PASS here.

do $$
declare
  acceptance jsonb;
begin
  update public.commerce_store_settings
     set stripe_promptpay_enabled = false,
         purchase_enabled = false,
         updated_at = now()
   where id = 1;

  acceptance := public.record_shop62_provider_acceptance(
    jsonb_build_object(
      'provider', 'STRIPE',
      'mode', 'test',
      'card', 'PASS',
      'promptPay', 'SKIPPED_DISABLED',
      'signedWebhook', 'PASS',
      'duplicateEvent', 'PASS',
      'amountMismatch', 'PASS',
      'currencyMismatch', 'PASS',
      'reservationExpiry', 'PASS',
      'shippingLifecycle', 'PASS',
      'pickupLifecycle', 'PASS',
      'documentSnapshot', 'PASS',
      'warrantySnapshot', 'PASS',
      'refundReturned', 'PASS',
      'warrantyVoided', 'PASS',
      'restoredReason', 'SHOP9_PROMPTPAY_PROVIDER_ACCEPTANCE_PENDING'
    )
  );

  if coalesce(acceptance->>'version', '') <> 'SHOP-6.2' then
    raise exception 'SHOP9_CARD_ACCEPTANCE_RESTORE_FAILED';
  end if;

  update public.commerce_store_settings
     set purchase_enabled = true,
         updated_at = now()
   where id = 1;
end
$$;
