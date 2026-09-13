-- AMPHON SHOP — SHOP-8.5 Member-Required Checkout Enforcement Foundation
-- Generated 2026-09-13
--
-- IMPORTANT: this migration prepares server-side enforcement but DOES NOT activate it.
-- Activation is a separate forward-only migration after production UI verification.
--
-- Security design:
-- 1) Browser creates a short-lived checkout intent using its authenticated Supabase JWT.
-- 2) Intent is keyed by the existing high-entropy checkout idempotency UUID.
-- 3) Existing Store API continues to pass that UUID to create_commerce_order().
-- 4) When member_checkout_required=true, create_commerce_order() refuses checkout unless
--    a valid intent exists, then re-reads profile/address from trusted DB rows and writes
--    ownership + immutable snapshots atomically with the Order.

create table if not exists public.commerce_member_checkout_intents (
  idempotency_key uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.commerce_customer_profiles(id) on delete cascade,
  address_id uuid references public.commerce_customer_addresses(id) on delete set null,
  delivery_method text not null check (delivery_method in ('SHIPPING','PICKUP')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  order_id uuid references public.commerce_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_member_checkout_intents_expiry_idx
on public.commerce_member_checkout_intents(expires_at)
where consumed_at is null;

alter table public.commerce_member_checkout_intents enable row level security;
revoke all on public.commerce_member_checkout_intents from public, anon, authenticated;
grant select, insert, update, delete on public.commerce_member_checkout_intents to service_role;

comment on table public.commerce_member_checkout_intents is
'SHOP-8.5 short-lived authenticated intent binding a checkout idempotency UUID to one customer and optional saved shipping address.';

create or replace function public.get_member_checkout_policy()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select member_checkout_required
    from public.commerce_store_settings
    where id = 1
  ), false);
$$;

revoke all on function public.get_member_checkout_policy() from public;
grant execute on function public.get_member_checkout_policy() to anon, authenticated, service_role;

comment on function public.get_member_checkout_policy() is
'Public SHOP-8.5 policy probe. Returns only whether verified membership is currently required for checkout.';

create or replace function public.prepare_member_checkout_intent(
  target_idempotency_key uuid,
  target_delivery_method text,
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
  address_row public.commerce_customer_addresses%rowtype;
  existing public.commerce_member_checkout_intents%rowtype;
  auth_email text;
  auth_confirmed_at timestamptz;
  delivery_value text := upper(btrim(coalesce(target_delivery_method, '')));
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if target_idempotency_key is null then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  if delivery_value not in ('SHIPPING','PICKUP') then
    raise exception 'INVALID_DELIVERY_METHOD';
  end if;

  select lower(btrim(coalesce(u.email, ''))), u.email_confirmed_at
    into auth_email, auth_confirmed_at
    from auth.users u
   where u.id = actor_id
   limit 1;

  if nullif(auth_email, '') is null or auth_confirmed_at is null then
    raise exception 'CUSTOMER_EMAIL_NOT_VERIFIED';
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

  if lower(btrim(coalesce(customer.email, ''))) <> auth_email then
    raise exception 'CUSTOMER_EMAIL_MISMATCH';
  end if;

  if delivery_value = 'SHIPPING' then
    if target_address_id is null then
      raise exception 'MEMBER_ADDRESS_REQUIRED';
    end if;

    select *
      into address_row
      from public.commerce_customer_addresses
     where id = target_address_id
       and customer_id = customer.id
       and is_active = true
     limit 1;

    if address_row.id is null then
      raise exception 'CUSTOMER_ADDRESS_NOT_FOUND';
    end if;
  else
    target_address_id := null;
    if char_length(btrim(coalesce(customer.display_name, ''))) < 2 then
      raise exception 'CUSTOMER_NAME_REQUIRED';
    end if;
    if char_length(regexp_replace(coalesce(customer.phone, ''), '[^0-9+]', '', 'g')) < 8 then
      raise exception 'CUSTOMER_PHONE_REQUIRED';
    end if;
  end if;

  select *
    into existing
    from public.commerce_member_checkout_intents
   where idempotency_key = target_idempotency_key
   for update;

  if existing.idempotency_key is not null then
    if existing.auth_user_id <> actor_id or existing.customer_id <> customer.id then
      raise exception 'CHECKOUT_INTENT_ALREADY_OWNED';
    end if;

    if existing.consumed_at is not null then
      return jsonb_build_object(
        'prepared', true,
        'consumed', true,
        'idempotencyKey', existing.idempotency_key,
        'customerId', existing.customer_id,
        'addressId', existing.address_id,
        'deliveryMethod', existing.delivery_method,
        'expiresAt', existing.expires_at,
        'orderId', existing.order_id
      );
    end if;
  end if;

  insert into public.commerce_member_checkout_intents(
    idempotency_key, auth_user_id, customer_id, address_id,
    delivery_method, expires_at, consumed_at, order_id, updated_at
  ) values (
    target_idempotency_key, actor_id, customer.id, target_address_id,
    delivery_value, now() + interval '15 minutes', null, null, now()
  )
  on conflict (idempotency_key) do update
    set address_id = excluded.address_id,
        delivery_method = excluded.delivery_method,
        expires_at = excluded.expires_at,
        updated_at = now()
  where public.commerce_member_checkout_intents.auth_user_id = actor_id
    and public.commerce_member_checkout_intents.customer_id = customer.id
    and public.commerce_member_checkout_intents.consumed_at is null;

  return jsonb_build_object(
    'prepared', true,
    'consumed', false,
    'idempotencyKey', target_idempotency_key,
    'customerId', customer.id,
    'addressId', target_address_id,
    'deliveryMethod', delivery_value,
    'expiresAt', now() + interval '15 minutes'
  );
end;
$$;

revoke all on function public.prepare_member_checkout_intent(uuid, text, uuid) from public, anon;
grant execute on function public.prepare_member_checkout_intent(uuid, text, uuid) to authenticated;
grant execute on function public.prepare_member_checkout_intent(uuid, text, uuid) to service_role;

comment on function public.prepare_member_checkout_intent(uuid, text, uuid) is
'SHOP-8.5: authenticated customer pre-authorizes one checkout idempotency key for 15 minutes. Shipping address ownership is verified here and again during Order creation.';

create or replace function public.create_commerce_order(checkout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.commerce_store_settings%rowtype;
  existing public.commerce_orders%rowtype;
  new_order public.commerce_orders%rowtype;
  requested_skus text[];
  locked_product record;
  item_count integer;
  validated_count integer := 0;
  subtotal_amount numeric(12,2) := 0;
  shipping_amount_value numeric(12,2) := 0;
  total_amount numeric(12,2) := 0;
  expires_at_value timestamptz;
  idem uuid;
  payment_method_value text;
  delivery_method_value text;
  customer_name_value text;
  customer_phone_value text;
  customer_email_value text;
  stale record;
  invoice_requested_value boolean := false;
  invoice_customer_value jsonb := '{}'::jsonb;
  member_intent public.commerce_member_checkout_intents%rowtype;
  member_customer public.commerce_customer_profiles%rowtype;
  member_address public.commerce_customer_addresses%rowtype;
  member_auth_email text;
  member_auth_confirmed_at timestamptz;
  member_customer_snapshot jsonb := null;
  member_address_snapshot jsonb := null;
  trusted_address_line text := null;
begin
  select * into settings from public.commerce_store_settings where id=1 for share;
  if settings.id is null or settings.purchase_enabled is not true then raise exception 'CHECKOUT_DISABLED'; end if;

  begin idem := (checkout->>'idempotencyKey')::uuid; exception when others then raise exception 'INVALID_IDEMPOTENCY_KEY'; end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(idem::text,0));

  payment_method_value := upper(coalesce(checkout->>'paymentMethod','BANK_TRANSFER'));
  delivery_method_value := upper(coalesce(checkout->>'deliveryMethod','SHIPPING'));
  if payment_method_value not in ('BANK_TRANSFER','PAY_AT_STORE','STRIPE') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if delivery_method_value not in ('SHIPPING','PICKUP') then raise exception 'INVALID_DELIVERY_METHOD'; end if;

  if settings.member_checkout_required is true then
    select *
      into member_intent
      from public.commerce_member_checkout_intents
     where idempotency_key = idem
     for update;

    if member_intent.idempotency_key is null then
      raise exception 'MEMBER_CHECKOUT_INTENT_REQUIRED';
    end if;
    if member_intent.expires_at <= now() and member_intent.consumed_at is null then
      raise exception 'MEMBER_CHECKOUT_INTENT_EXPIRED';
    end if;
    if member_intent.delivery_method <> delivery_method_value then
      raise exception 'MEMBER_CHECKOUT_DELIVERY_MISMATCH';
    end if;

    select lower(btrim(coalesce(u.email, ''))), u.email_confirmed_at
      into member_auth_email, member_auth_confirmed_at
      from auth.users u
     where u.id = member_intent.auth_user_id
     limit 1;

    if nullif(member_auth_email, '') is null or member_auth_confirmed_at is null then
      raise exception 'CUSTOMER_EMAIL_NOT_VERIFIED';
    end if;

    select *
      into member_customer
      from public.commerce_customer_profiles
     where id = member_intent.customer_id
       and auth_user_id = member_intent.auth_user_id
       and status = 'ACTIVE'
     limit 1;

    if member_customer.id is null then
      raise exception 'CUSTOMER_PROFILE_NOT_FOUND';
    end if;
    if lower(btrim(coalesce(member_customer.email, ''))) <> member_auth_email then
      raise exception 'CUSTOMER_EMAIL_MISMATCH';
    end if;

    member_customer_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'customerId', member_customer.id,
      'authUserId', member_customer.auth_user_id,
      'email', member_auth_email,
      'displayName', member_customer.display_name,
      'phone', member_customer.phone,
      'emailVerifiedAt', member_auth_confirmed_at,
      'authProvider', member_customer.auth_provider,
      'capturedAt', now()
    ));

    if delivery_method_value = 'SHIPPING' then
      if member_intent.address_id is null then raise exception 'MEMBER_ADDRESS_REQUIRED'; end if;

      select *
        into member_address
        from public.commerce_customer_addresses
       where id = member_intent.address_id
         and customer_id = member_customer.id
         and is_active = true
       limit 1;

      if member_address.id is null then raise exception 'CUSTOMER_ADDRESS_NOT_FOUND'; end if;

      trusted_address_line := nullif(concat_ws(' ',
        nullif(btrim(member_address.address_line1), ''),
        nullif(btrim(coalesce(member_address.address_line2, '')), '')
      ), '');
      customer_name_value := left(btrim(member_address.recipient_name),120);
      customer_phone_value := left(regexp_replace(member_address.phone,'[^0-9+]','','g'),30);

      member_address_snapshot := jsonb_strip_nulls(jsonb_build_object(
        'addressId', member_address.id,
        'label', member_address.label,
        'recipientName', member_address.recipient_name,
        'phone', member_address.phone,
        'addressLine1', member_address.address_line1,
        'addressLine2', member_address.address_line2,
        'subdistrict', member_address.subdistrict,
        'district', member_address.district,
        'province', member_address.province,
        'postalCode', member_address.postal_code,
        'countryCode', member_address.country_code,
        'capturedAt', now()
      ));
    else
      customer_name_value := left(btrim(coalesce(member_customer.display_name,'')),120);
      customer_phone_value := left(regexp_replace(coalesce(member_customer.phone,''),'[^0-9+]','','g'),30);
      if char_length(customer_name_value)<2 then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
      if char_length(customer_phone_value)<8 then raise exception 'CUSTOMER_PHONE_REQUIRED'; end if;
    end if;

    customer_email_value := member_auth_email;
  else
    customer_name_value := left(btrim(coalesce(checkout->>'customerName','')),120);
    customer_phone_value := left(regexp_replace(coalesce(checkout->>'customerPhone',''),'[^0-9+]','','g'),30);
    customer_email_value := nullif(left(btrim(coalesce(checkout->>'customerEmail','')),180),'');
  end if;

  select * into existing from public.commerce_orders where idempotency_key=idem;
  if existing.id is not null then
    if settings.member_checkout_required is true then
      if existing.auth_user_id is distinct from member_intent.auth_user_id
         or existing.customer_id is distinct from member_intent.customer_id then
        raise exception 'MEMBER_ORDER_OWNERSHIP_MISMATCH';
      end if;
    end if;
    return jsonb_build_object('orderId',existing.id,'publicToken',existing.public_token,'orderNumber',existing.order_number,
      'orderStatus',existing.order_status,'paymentStatus',existing.payment_status,'reservationExpiresAt',existing.reservation_expires_at,
      'subtotal',existing.subtotal,'shippingAmount',existing.shipping_amount,'total',existing.total,'currency',existing.currency,
      'paymentMethod',existing.payment_method,'providerCheckoutUrl',existing.provider_checkout_url);
  end if;

  select array_agg(distinct upper(btrim(v)) order by upper(btrim(v))) into requested_skus
    from jsonb_array_elements_text(coalesce(checkout->'skus','[]'::jsonb)) t(v) where btrim(v)<>'';
  item_count := coalesce(cardinality(requested_skus),0);
  if item_count<1 or item_count>10 then raise exception 'INVALID_CART_SIZE'; end if;

  if char_length(customer_name_value)<2 then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
  if char_length(customer_phone_value)<8 then raise exception 'CUSTOMER_PHONE_REQUIRED'; end if;

  if payment_method_value='BANK_TRANSFER' and settings.bank_transfer_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value='STRIPE' and settings.stripe_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value='PAY_AT_STORE' and (settings.pay_at_store_enabled is not true or settings.pickup_enabled is not true or delivery_method_value<>'PICKUP') then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if delivery_method_value='PICKUP' and settings.pickup_enabled is not true then raise exception 'PICKUP_DISABLED'; end if;
  if delivery_method_value='SHIPPING' then
    if settings.shipping_enabled is not true then raise exception 'SHIPPING_DISABLED'; end if;
    if settings.member_checkout_required is true then
      if trusted_address_line is null
         or nullif(btrim(coalesce(member_address.district,'')),'') is null
         or nullif(btrim(coalesce(member_address.province,'')),'') is null
         or nullif(btrim(coalesce(member_address.postal_code,'')),'') is null then raise exception 'SHIPPING_ADDRESS_REQUIRED'; end if;
    else
      if nullif(btrim(coalesce(checkout->>'addressLine','')),'') is null
         or nullif(btrim(coalesce(checkout->>'district','')),'') is null
         or nullif(btrim(coalesce(checkout->>'province','')),'') is null
         or nullif(btrim(coalesce(checkout->>'postalCode','')),'') is null then raise exception 'SHIPPING_ADDRESS_REQUIRED'; end if;
    end if;
    shipping_amount_value := coalesce(settings.shipping_rate,0);
  end if;

  invoice_requested_value := lower(coalesce(checkout->>'invoiceRequested','false')) in ('true','1','yes','on');
  if invoice_requested_value then
    invoice_customer_value := jsonb_strip_nulls(jsonb_build_object(
      'name',nullif(left(btrim(coalesce(checkout->>'invoiceName','')),180),''),
      'taxId',nullif(left(regexp_replace(coalesce(checkout->>'invoiceTaxId',''),'[^0-9]','','g'),20),''),
      'branchCode',nullif(left(btrim(coalesce(checkout->>'invoiceBranchCode','')),20),''),
      'address',nullif(left(btrim(coalesce(checkout->>'invoiceAddress','')),500),''),
      'email',nullif(left(btrim(coalesce(checkout->>'invoiceEmail','')),180),'')
    ));
    if nullif(invoice_customer_value->>'name','') is null or nullif(invoice_customer_value->>'address','') is null then raise exception 'INVOICE_DETAILS_REQUIRED'; end if;
  end if;

  if (select count(*) from public.products p where p.sku=any(requested_skus))<>item_count then raise exception 'PRODUCT_NOT_FOUND'; end if;

  for stale in
    select distinct r.order_id from public.commerce_reservations r join public.products p on p.id=r.product_id
     where p.sku=any(requested_skus) and r.expires_at<=now()
  loop
    perform private.release_commerce_order_inventory(stale.order_id,'EXPIRED');
  end loop;

  for locked_product in
    select p.id,p.sku,p.title,p.status,p.price,coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition,
           coalesce(cl.store_warranty_days,settings.default_warranty_days,0) as warranty_days,
           coalesce(nullif(cl.store_warranty_terms,''),nullif(settings.default_warranty_terms,'')) as warranty_terms
      from public.products p
      join public.product_publications pp on pp.product_id=p.id and pp.channel='website' and pp.status='published'
      left join public.commerce_listings cl on cl.product_id=p.id
     where p.sku=any(requested_skus)
     order by p.sku for update of p
  loop
    if locked_product.status<>'published' then raise exception 'PRODUCT_UNAVAILABLE:%',locked_product.sku; end if;
    if locked_product.price is null or locked_product.price<=0 then raise exception 'PRODUCT_PRICE_INVALID:%',locked_product.sku; end if;
    if exists(select 1 from public.commerce_reservations r where r.product_id=locked_product.id) then raise exception 'PRODUCT_RESERVED:%',locked_product.sku; end if;
    validated_count:=validated_count+1;
    subtotal_amount:=subtotal_amount+locked_product.price;
  end loop;

  if validated_count<>item_count then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if subtotal_amount<=0 then raise exception 'EMPTY_CART'; end if;
  total_amount:=subtotal_amount+shipping_amount_value;
  expires_at_value:=now()+make_interval(mins=>settings.reservation_minutes);

  insert into public.commerce_orders(
    idempotency_key,order_number,payment_method,payment_provider,delivery_method,
    customer_name,customer_phone,customer_email,address_line,subdistrict,district,province,postal_code,customer_note,
    currency,subtotal,shipping_amount,total,reservation_expires_at,invoice_requested,invoice_customer,
    customer_id,auth_user_id,customer_profile_snapshot,shipping_address_snapshot
  ) values (
    idem,'ATSO-'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')||'-'||lpad(nextval('public.commerce_order_seq')::text,6,'0'),
    payment_method_value,case when payment_method_value='STRIPE' then 'STRIPE' else 'MANUAL' end,delivery_method_value,
    customer_name_value,customer_phone_value,customer_email_value,
    case when settings.member_checkout_required is true and delivery_method_value='SHIPPING' then trusted_address_line else nullif(left(btrim(coalesce(checkout->>'addressLine','')),250),'') end,
    case when settings.member_checkout_required is true and delivery_method_value='SHIPPING' then member_address.subdistrict else nullif(left(btrim(coalesce(checkout->>'subdistrict','')),120),'') end,
    case when settings.member_checkout_required is true and delivery_method_value='SHIPPING' then member_address.district else nullif(left(btrim(coalesce(checkout->>'district','')),120),'') end,
    case when settings.member_checkout_required is true and delivery_method_value='SHIPPING' then member_address.province else nullif(left(btrim(coalesce(checkout->>'province','')),120),'') end,
    case when settings.member_checkout_required is true and delivery_method_value='SHIPPING' then member_address.postal_code else nullif(left(btrim(coalesce(checkout->>'postalCode','')),20),'') end,
    nullif(left(btrim(coalesce(checkout->>'note','')),500),''),
    coalesce(settings.currency,'THB'),subtotal_amount,shipping_amount_value,total_amount,expires_at_value,invoice_requested_value,invoice_customer_value,
    case when settings.member_checkout_required is true then member_customer.id else null end,
    case when settings.member_checkout_required is true then member_intent.auth_user_id else null end,
    case when settings.member_checkout_required is true then member_customer_snapshot else null end,
    case when settings.member_checkout_required is true then member_address_snapshot else null end
  ) returning * into new_order;

  for locked_product in
    select p.id,p.sku,p.title,p.price,coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition,
           coalesce(cl.store_warranty_days,settings.default_warranty_days,0) as warranty_days,
           coalesce(nullif(cl.store_warranty_terms,''),nullif(settings.default_warranty_terms,'')) as warranty_terms
      from public.products p left join public.commerce_listings cl on cl.product_id=p.id
     where p.sku=any(requested_skus) order by p.sku
  loop
    insert into public.commerce_order_items(order_id,product_id,sku,title,unit_price,merchant_item_condition,warranty_days,warranty_terms)
    values(new_order.id,locked_product.id,locked_product.sku,locked_product.title,locked_product.price,locked_product.merchant_item_condition,locked_product.warranty_days,locked_product.warranty_terms);
    insert into public.commerce_reservations(product_id,order_id,expires_at) values(locked_product.id,new_order.id,expires_at_value);
    update public.products set status='reserved',updated_by=null where id=locked_product.id and status='published';
    if not found then raise exception 'PRODUCT_RESERVATION_RACE:%',locked_product.sku; end if;
  end loop;

  if settings.member_checkout_required is true then
    update public.commerce_member_checkout_intents
       set consumed_at = now(),
           order_id = new_order.id,
           updated_at = now()
     where idempotency_key = idem
       and auth_user_id = member_intent.auth_user_id
       and customer_id = member_customer.id;
  end if;

  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(new_order.id,'ORDER_RESERVED',jsonb_build_object(
    'paymentMethod',payment_method_value,
    'deliveryMethod',delivery_method_value,
    'memberCheckout',settings.member_checkout_required is true
  ));

  return jsonb_build_object('orderId',new_order.id,'publicToken',new_order.public_token,'orderNumber',new_order.order_number,
    'orderStatus',new_order.order_status,'paymentStatus',new_order.payment_status,'reservationExpiresAt',new_order.reservation_expires_at,
    'subtotal',new_order.subtotal,'shippingAmount',new_order.shipping_amount,'total',new_order.total,'currency',new_order.currency,
    'paymentMethod',new_order.payment_method);
end;
$$;

revoke all on function public.create_commerce_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_commerce_order(jsonb) to service_role;

comment on function public.create_commerce_order(jsonb) is
'SHOP-8.5-ready atomic checkout. Guest behavior remains unchanged while member_checkout_required=false; when true, a verified authenticated checkout intent is mandatory and trusted customer/address snapshots are written with the Order.';
