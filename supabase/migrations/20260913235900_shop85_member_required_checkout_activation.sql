-- AMPHON SHOP — SHOP-8.5 explicit production activation
-- Owner-requested activation after foundation + frontend production gates passed.
-- This migration changes only member_checkout_required and preserves all payment rails.

update public.commerce_store_settings
   set member_checkout_required = true,
       updated_at = now()
 where id = 1
   and purchase_enabled = true
   and stripe_enabled = true
   and stripe_promptpay_enabled = false
   and member_checkout_required is false;

do $$
begin
  if not exists (
    select 1
      from public.commerce_store_settings
     where id = 1
       and purchase_enabled = true
       and member_checkout_required = true
       and stripe_enabled = true
       and stripe_promptpay_enabled = false
  ) then
    raise exception 'SHOP85_ACTIVATION_SAFETY_GATE_FAILED';
  end if;
end
$$;

comment on column public.commerce_store_settings.member_checkout_required is
'SHOP-8.5 ACTIVE: new production checkout orders require a verified authenticated customer. Shipping uses an owned saved address; pickup requires profile name/phone.';
