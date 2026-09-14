-- SHOP-9 — PromptPay QR Payment activation
-- Forward-only production activation. Keeps Stripe cards enabled and only opens PromptPay
-- after owner-confirmed enablement in Stripe Dashboard.

do $$
declare
  s public.commerce_store_settings%rowtype;
begin
  select * into s
  from public.commerce_store_settings
  where id = 1
  for update;

  if not found then
    raise exception 'SHOP9_STORE_SETTINGS_NOT_FOUND';
  end if;

  if coalesce(s.purchase_enabled, false) is not true then
    raise exception 'SHOP9_PURCHASE_MUST_BE_ENABLED';
  end if;

  if coalesce(s.member_checkout_required, false) is not true then
    raise exception 'SHOP9_MEMBER_CHECKOUT_MUST_BE_ENABLED';
  end if;

  if coalesce(s.stripe_enabled, false) is not true then
    raise exception 'SHOP9_STRIPE_MUST_BE_ENABLED';
  end if;

  if upper(coalesce(s.currency, '')) <> 'THB' then
    raise exception 'SHOP9_PROMPTPAY_REQUIRES_THB';
  end if;

  if upper(coalesce(s.country_code, '')) <> 'TH' then
    raise exception 'SHOP9_PROMPTPAY_REQUIRES_TH_STORE';
  end if;

  update public.commerce_store_settings
  set stripe_promptpay_enabled = true,
      updated_at = now()
  where id = 1;
end
$$;
