-- AMPHON SHOP — SHOP-8.4 Member Session + Checkout Identity Bridge
-- Generated 2026-09-13
--
-- This migration intentionally DOES NOT enable member_checkout_required.
-- Guest checkout remains available until SHOP-8.5 activation.
--
-- The browser creates the order through the existing Store API, then an authenticated
-- customer may atomically attach ownership to that exact order using the high-entropy
-- checkout idempotency key held by the browser. The database, not the browser, builds
-- the immutable profile/address snapshots from trusted rows.

create or replace function public.attach_customer_checkout_identity(
  target_idempotency_key uuid,
  target_address_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  customer public.commerce_customer_profiles%rowtype;
  target_order public.commerce_orders%rowtype;
  shipping_address public.commerce_customer_addresses%rowtype;
  customer_snapshot jsonb;
  address_snapshot jsonb := null;
  combined_address_line text;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into customer
    from public.commerce_customer_profiles
   where auth_user_id = actor_id
     and status = 'ACTIVE'
   limit 1;

  if customer.id is null then
    raise exception 'CUSTOMER_PROFILE_NOT_FOUND';
  end if;

  if customer.email_verified_at is null or nullif(btrim(coalesce(customer.email, '')), '') is null then
    raise exception 'CUSTOMER_EMAIL_NOT_VERIFIED';
  end if;

  select *
    into target_order
    from public.commerce_orders
   where idempotency_key = target_idempotency_key
   for update;

  if target_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Limit the ownership bridge to the live checkout window. This is not a historical
  -- account-linking mechanism; historical linking requires a separate verified flow.
  if target_order.created_at < now() - interval '30 minutes' then
    raise exception 'ORDER_IDENTITY_WINDOW_EXPIRED';
  end if;

  if target_order.customer_id is not null and target_order.customer_id <> customer.id then
    raise exception 'ORDER_ALREADY_OWNED';
  end if;

  if target_order.auth_user_id is not null and target_order.auth_user_id <> actor_id then
    raise exception 'ORDER_ALREADY_OWNED';
  end if;

  -- The Store API checkout is still guest-compatible in SHOP-8.4. Requiring the
  -- verified auth email to match the order email prevents a signed-in user from
  -- claiming an unrelated guest order even if an idempotency key were disclosed.
  if nullif(btrim(coalesce(target_order.customer_email, '')), '') is null
     or lower(btrim(target_order.customer_email)) <> lower(btrim(customer.email)) then
    raise exception 'ORDER_EMAIL_MISMATCH';
  end if;

  customer_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'customerId', customer.id,
    'authUserId', customer.auth_user_id,
    'email', customer.email,
    'displayName', customer.display_name,
    'phone', customer.phone,
    'emailVerifiedAt', customer.email_verified_at,
    'authProvider', customer.auth_provider,
    'capturedAt', now()
  ));

  if target_order.delivery_method = 'SHIPPING' then
    if target_address_id is null then
      raise exception 'MEMBER_ADDRESS_REQUIRED';
    end if;

    select *
      into shipping_address
      from public.commerce_customer_addresses
     where id = target_address_id
       and customer_id = customer.id
       and is_active = true
     limit 1;

    if shipping_address.id is null then
      raise exception 'CUSTOMER_ADDRESS_NOT_FOUND';
    end if;

    combined_address_line := concat_ws(' ',
      nullif(btrim(shipping_address.address_line1), ''),
      nullif(btrim(coalesce(shipping_address.address_line2, '')), '')
    );

    address_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'addressId', shipping_address.id,
      'label', shipping_address.label,
      'recipientName', shipping_address.recipient_name,
      'phone', shipping_address.phone,
      'addressLine1', shipping_address.address_line1,
      'addressLine2', shipping_address.address_line2,
      'subdistrict', shipping_address.subdistrict,
      'district', shipping_address.district,
      'province', shipping_address.province,
      'postalCode', shipping_address.postal_code,
      'countryCode', shipping_address.country_code,
      'capturedAt', now()
    ));

    update public.commerce_orders
       set customer_id = customer.id,
           auth_user_id = actor_id,
           customer_profile_snapshot = customer_snapshot,
           shipping_address_snapshot = address_snapshot,
           customer_name = shipping_address.recipient_name,
           customer_phone = shipping_address.phone,
           customer_email = customer.email,
           address_line = nullif(combined_address_line, ''),
           subdistrict = shipping_address.subdistrict,
           district = shipping_address.district,
           province = shipping_address.province,
           postal_code = shipping_address.postal_code
     where id = target_order.id;

  elsif target_order.delivery_method = 'PICKUP' then
    if char_length(btrim(coalesce(customer.display_name, ''))) < 2 then
      raise exception 'CUSTOMER_NAME_REQUIRED';
    end if;
    if char_length(regexp_replace(coalesce(customer.phone, ''), '[^0-9+]', '', 'g')) < 8 then
      raise exception 'CUSTOMER_PHONE_REQUIRED';
    end if;

    update public.commerce_orders
       set customer_id = customer.id,
           auth_user_id = actor_id,
           customer_profile_snapshot = customer_snapshot,
           shipping_address_snapshot = null,
           customer_name = customer.display_name,
           customer_phone = customer.phone,
           customer_email = customer.email,
           address_line = null,
           subdistrict = null,
           district = null,
           province = null,
           postal_code = null
     where id = target_order.id;
  else
    raise exception 'INVALID_DELIVERY_METHOD';
  end if;

  return jsonb_build_object(
    'attached', true,
    'orderId', target_order.id,
    'publicToken', target_order.public_token,
    'customerId', customer.id,
    'authUserId', actor_id,
    'addressId', case when target_order.delivery_method = 'SHIPPING' then shipping_address.id else null end
  );
end;
$$;

revoke all on function public.attach_customer_checkout_identity(uuid, uuid) from public, anon;
grant execute on function public.attach_customer_checkout_identity(uuid, uuid) to authenticated;
grant execute on function public.attach_customer_checkout_identity(uuid, uuid) to service_role;

comment on function public.attach_customer_checkout_identity(uuid, uuid) is
'SHOP-8.4: attaches a newly-created checkout order to the authenticated customer and captures trusted immutable profile/address snapshots. Does not enable member-required checkout.';
