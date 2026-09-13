-- AMPHON SHOP — SHOP-5 Cart + Atomic Reservation + Checkout + Order Management
-- Run after supabase/shop_4.sql. Safe to re-run.
--
-- Design principles
-- 1) Product Hub remains inventory source of truth.
-- 2) A checkout reservation is created atomically in PostgreSQL, never in the browser.
-- 3) Public checkout/order PII is never exposed through anon/authenticated table access.
-- 4) Checkout retries use an idempotency key.
-- 5) Product status is RESERVED while payment is pending and SOLD only after staff confirms payment.
-- 6) Expired unpaid reservations are released back to PUBLISHED automatically.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- STORE CHECKOUT CONFIGURATION
-- ------------------------------------------------------------

alter table public.commerce_store_settings
  add column if not exists reservation_minutes integer not null default 60,
  add column if not exists payment_review_hold_hours integer not null default 24,
  add column if not exists bank_transfer_enabled boolean not null default false,
  add column if not exists bank_name text,
  add column if not exists bank_account_name text,
  add column if not exists bank_account_number text,
  add column if not exists pay_at_store_enabled boolean not null default false,
  add column if not exists pickup_enabled boolean not null default true,
  add column if not exists checkout_terms_url text,
  add column if not exists checkout_turnstile_enabled boolean not null default false,
  add column if not exists turnstile_site_key text;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop4_purchase_lock;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_reservation_window_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_reservation_window_check
  check (reservation_minutes between 10 and 240 and payment_review_hold_hours between 1 and 72);

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_bank_transfer_complete_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_bank_transfer_complete_check
  check (
    bank_transfer_enabled = false
    or (
      nullif(btrim(bank_name), '') is not null
      and nullif(btrim(bank_account_name), '') is not null
      and nullif(btrim(bank_account_number), '') is not null
    )
  );

-- To enable purchase/merchant offers, the store must have real shipping/payment/return
-- configuration and bot protection. Disable an older/incomplete activation before installing
-- the stronger SHOP-5 constraint so this migration remains safe to re-run.
update public.commerce_store_settings
   set purchase_enabled = false
 where purchase_enabled = true
   and (
     shipping_enabled is not true
     or bank_transfer_enabled is not true
     or return_policy_enabled is not true
     or checkout_turnstile_enabled is not true
     or nullif(btrim(turnstile_site_key), '') is null
     or nullif(btrim(site_url), '') is null
   );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop5_purchase_ready_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop5_purchase_ready_check
  check (
    purchase_enabled = false
    or (
      shipping_enabled = true
      and bank_transfer_enabled = true
      and return_policy_enabled = true
      and checkout_turnstile_enabled = true
      and nullif(btrim(turnstile_site_key), '') is not null
      and nullif(btrim(site_url), '') is not null
    )
  );

-- ------------------------------------------------------------
-- ORDERS / ORDER ITEMS / ACTIVE RESERVATIONS
-- ------------------------------------------------------------

create sequence if not exists public.commerce_order_seq;

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  idempotency_key uuid not null unique,
  order_number text not null unique,
  order_status text not null default 'AWAITING_PAYMENT'
    check (order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW','PROCESSING','SHIPPED','COMPLETED','CANCELLED','EXPIRED','REFUNDED')),
  payment_status text not null default 'UNPAID'
    check (payment_status in ('UNPAID','REVIEW','PAID','REFUNDED')),
  fulfillment_status text not null default 'UNFULFILLED'
    check (fulfillment_status in ('UNFULFILLED','PACKING','SHIPPED','DELIVERED','PICKUP_READY','PICKED_UP','CANCELLED')),
  payment_method text not null
    check (payment_method in ('BANK_TRANSFER','PAY_AT_STORE')),
  delivery_method text not null
    check (delivery_method in ('SHIPPING','PICKUP')),

  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  address_line text,
  subdistrict text,
  district text,
  province text,
  postal_code text,
  customer_note text,

  currency text not null default 'THB',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total numeric(12,2) not null check (total >= 0),

  reservation_expires_at timestamptz not null,
  payment_reference text,
  payment_notified_at timestamptz,
  paid_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  refunded_at timestamptz,
  tracking_carrier text,
  tracking_number text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null,
  title text not null,
  unit_price numeric(12,2) not null check (unit_price > 0),
  quantity integer not null default 1 check (quantity = 1),
  merchant_item_condition text not null default 'USED'
    check (merchant_item_condition in ('NEW','USED','REFURBISHED')),
  created_at timestamptz not null default now(),
  unique(order_id, product_id)
);

-- One active reservation row per physical product. Removing this row releases the SKU.
create table if not exists public.commerce_reservations (
  product_id uuid primary key references public.products(id) on delete cascade,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists commerce_orders_status_idx
  on public.commerce_orders(order_status, created_at desc);
create index if not exists commerce_orders_payment_idx
  on public.commerce_orders(payment_status, created_at desc);
create index if not exists commerce_orders_reservation_expiry_idx
  on public.commerce_orders(reservation_expires_at)
  where order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW');
create index if not exists commerce_order_items_order_idx
  on public.commerce_order_items(order_id);
create index if not exists commerce_order_items_product_idx
  on public.commerce_order_items(product_id);
create index if not exists commerce_reservations_expiry_idx
  on public.commerce_reservations(expires_at);

create or replace function public.touch_commerce_order()
returns trigger
language plpgsql
set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

drop trigger if exists commerce_orders_touch on public.commerce_orders;
create trigger commerce_orders_touch
before update on public.commerce_orders
for each row execute procedure public.touch_commerce_order();

alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.commerce_reservations enable row level security;

-- Checkout/order PII is server-only. Product Hub staff reaches it through the authenticated Worker.
revoke all on public.commerce_orders from anon, authenticated;
revoke all on public.commerce_order_items from anon, authenticated;
revoke all on public.commerce_reservations from anon, authenticated;
grant select, insert, update, delete on public.commerce_orders to service_role;
grant select, insert, update, delete on public.commerce_order_items to service_role;
grant select, insert, update, delete on public.commerce_reservations to service_role;

-- ------------------------------------------------------------
-- INTERNAL RELEASE / EXPIRY HELPERS
-- ------------------------------------------------------------

create or replace function private.release_commerce_order_inventory(target_order_id uuid, terminal_status text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  released integer := 0;
begin
  -- All order mutations lock the order first, then products. Keep one global lock order
  -- to avoid expiry/payment-confirmation deadlocks.
  perform 1
    from public.commerce_orders o
   where o.id = target_order_id
     and o.payment_status in ('UNPAID','REVIEW')
     and o.order_status not in ('CANCELLED','EXPIRED','COMPLETED','REFUNDED')
   for update;
  if not found then return 0; end if;

  -- Lock every product in deterministic order before releasing.
  for item in
    select oi.product_id
      from public.commerce_order_items oi
     where oi.order_id = target_order_id
     order by oi.product_id
     for update
  loop
    perform 1 from public.products p where p.id = item.product_id for update;
    update public.products p
       set status = 'published', updated_by = null
     where p.id = item.product_id
       and p.status = 'reserved'
       and exists (
         select 1 from public.commerce_reservations r
          where r.product_id = p.id and r.order_id = target_order_id
       );
    if found then released := released + 1; end if;
  end loop;

  delete from public.commerce_reservations r where r.order_id = target_order_id;

  update public.commerce_orders o
     set order_status = terminal_status,
         fulfillment_status = 'CANCELLED',
         cancelled_at = case when terminal_status = 'CANCELLED' then now() else o.cancelled_at end,
         expired_at = case when terminal_status = 'EXPIRED' then now() else o.expired_at end
   where o.id = target_order_id
     and o.payment_status in ('UNPAID','REVIEW');

  return released;
end;
$$;

revoke all on function private.release_commerce_order_inventory(uuid,text) from public, anon, authenticated;

create or replace function public.expire_commerce_reservations(max_orders integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  affected integer := 0;
begin
  for target in
    select o.id
      from public.commerce_orders o
     where o.order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW')
       and o.payment_status in ('UNPAID','REVIEW')
       and o.reservation_expires_at <= now()
     order by o.reservation_expires_at asc
     limit greatest(1, least(coalesce(max_orders,100),500))
     for update skip locked
  loop
    perform private.release_commerce_order_inventory(target.id, 'EXPIRED');
    affected := affected + 1;
  end loop;
  return affected;
end;
$$;

revoke all on function public.expire_commerce_reservations(integer) from public, anon, authenticated;
grant execute on function public.expire_commerce_reservations(integer) to service_role;

-- ------------------------------------------------------------
-- ATOMIC PUBLIC CHECKOUT RPC (SERVICE ROLE ONLY)
-- ------------------------------------------------------------

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
begin
  select * into settings from public.commerce_store_settings where id = 1 for share;
  if settings.id is null or settings.purchase_enabled is not true then raise exception 'CHECKOUT_DISABLED'; end if;

  begin idem := (checkout->>'idempotencyKey')::uuid; exception when others then raise exception 'INVALID_IDEMPOTENCY_KEY'; end;
  -- Serialize retries/double-clicks carrying the same idempotency key before checking/inserting.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(idem::text, 0));
  select * into existing from public.commerce_orders where idempotency_key = idem;
  if existing.id is not null then
    return jsonb_build_object('orderId',existing.id,'publicToken',existing.public_token,'orderNumber',existing.order_number,
      'orderStatus',existing.order_status,'paymentStatus',existing.payment_status,'reservationExpiresAt',existing.reservation_expires_at,
      'subtotal',existing.subtotal,'shippingAmount',existing.shipping_amount,'total',existing.total,'currency',existing.currency);
  end if;

  select array_agg(distinct upper(btrim(v)) order by upper(btrim(v)))
    into requested_skus
    from jsonb_array_elements_text(coalesce(checkout->'skus','[]'::jsonb)) t(v)
   where btrim(v) <> '';
  item_count := coalesce(cardinality(requested_skus),0);
  if item_count < 1 or item_count > 10 then raise exception 'INVALID_CART_SIZE'; end if;

  customer_name_value := left(btrim(coalesce(checkout->>'customerName','')),120);
  customer_phone_value := left(regexp_replace(coalesce(checkout->>'customerPhone',''),'[^0-9+]','','g'),30);
  customer_email_value := nullif(left(btrim(coalesce(checkout->>'customerEmail','')),180),'');
  if char_length(customer_name_value) < 2 then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
  if char_length(customer_phone_value) < 8 then raise exception 'CUSTOMER_PHONE_REQUIRED'; end if;

  payment_method_value := upper(coalesce(checkout->>'paymentMethod','BANK_TRANSFER'));
  delivery_method_value := upper(coalesce(checkout->>'deliveryMethod','SHIPPING'));
  if payment_method_value not in ('BANK_TRANSFER','PAY_AT_STORE') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if delivery_method_value not in ('SHIPPING','PICKUP') then raise exception 'INVALID_DELIVERY_METHOD'; end if;
  if payment_method_value = 'BANK_TRANSFER' and settings.bank_transfer_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value = 'PAY_AT_STORE' and (settings.pay_at_store_enabled is not true or settings.pickup_enabled is not true or delivery_method_value <> 'PICKUP') then
    raise exception 'PAYMENT_METHOD_DISABLED';
  end if;
  if delivery_method_value = 'PICKUP' and settings.pickup_enabled is not true then raise exception 'PICKUP_DISABLED'; end if;
  if delivery_method_value = 'SHIPPING' then
    if settings.shipping_enabled is not true then raise exception 'SHIPPING_DISABLED'; end if;
    if nullif(btrim(coalesce(checkout->>'addressLine','')), '') is null
       or nullif(btrim(coalesce(checkout->>'district','')), '') is null
       or nullif(btrim(coalesce(checkout->>'province','')), '') is null
       or nullif(btrim(coalesce(checkout->>'postalCode','')), '') is null then
      raise exception 'SHIPPING_ADDRESS_REQUIRED';
    end if;
    shipping_amount_value := coalesce(settings.shipping_rate,0);
  end if;

  -- Confirm all SKU identities exist before stale-release work. Availability is checked under row locks below.
  if (select count(*) from public.products p where p.sku = any(requested_skus)) <> item_count then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- Release stale holds BEFORE taking requested product locks. This avoids lock-order inversion
  -- when an expired multi-item order overlaps a new cart.
  for stale in
    select distinct r.order_id
      from public.commerce_reservations r
      join public.products p on p.id = r.product_id
     where p.sku = any(requested_skus)
       and r.expires_at <= now()
  loop
    perform private.release_commerce_order_inventory(stale.order_id, 'EXPIRED');
  end loop;

  -- Lock requested products in deterministic SKU order and validate public sale state + price snapshot.
  for locked_product in
    select p.id, p.sku, p.title, p.status, p.price,
           coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition
      from public.products p
      join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website' and pp.status = 'published'
      left join public.commerce_listings cl on cl.product_id = p.id
     where p.sku = any(requested_skus)
     order by p.sku
     for update of p
  loop
    if locked_product.status <> 'published' then raise exception 'PRODUCT_UNAVAILABLE:%', locked_product.sku; end if;
    if locked_product.price is null or locked_product.price <= 0 then raise exception 'PRODUCT_PRICE_INVALID:%', locked_product.sku; end if;
    if exists (select 1 from public.commerce_reservations r where r.product_id = locked_product.id) then
      raise exception 'PRODUCT_RESERVED:%', locked_product.sku;
    end if;
    validated_count := validated_count + 1;
    subtotal_amount := subtotal_amount + locked_product.price;
  end loop;

  if validated_count <> item_count then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if subtotal_amount <= 0 then raise exception 'EMPTY_CART'; end if;
  total_amount := subtotal_amount + shipping_amount_value;
  expires_at_value := now() + make_interval(mins => settings.reservation_minutes);

  insert into public.commerce_orders (
    idempotency_key, order_number, payment_method, delivery_method,
    customer_name, customer_phone, customer_email,
    address_line, subdistrict, district, province, postal_code, customer_note,
    currency, subtotal, shipping_amount, total, reservation_expires_at
  ) values (
    idem,
    'ATSO-' || to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || '-' || lpad(nextval('public.commerce_order_seq')::text,6,'0'),
    payment_method_value, delivery_method_value,
    customer_name_value, customer_phone_value, customer_email_value,
    nullif(left(btrim(coalesce(checkout->>'addressLine','')),250),''),
    nullif(left(btrim(coalesce(checkout->>'subdistrict','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'district','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'province','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'postalCode','')),20),''),
    nullif(left(btrim(coalesce(checkout->>'note','')),500),''),
    coalesce(settings.currency,'THB'), subtotal_amount, shipping_amount_value, total_amount, expires_at_value
  ) returning * into new_order;

  for locked_product in
    select p.id, p.sku, p.title, p.price, coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition
      from public.products p
      left join public.commerce_listings cl on cl.product_id = p.id
     where p.sku = any(requested_skus)
     order by p.sku
  loop
    insert into public.commerce_order_items(order_id,product_id,sku,title,unit_price,merchant_item_condition)
    values (new_order.id,locked_product.id,locked_product.sku,locked_product.title,locked_product.price,locked_product.merchant_item_condition);
    insert into public.commerce_reservations(product_id,order_id,expires_at)
    values (locked_product.id,new_order.id,expires_at_value);
    update public.products set status = 'reserved', updated_by = null where id = locked_product.id and status = 'published';
    if not found then raise exception 'PRODUCT_RESERVATION_RACE:%', locked_product.sku; end if;
  end loop;

  return jsonb_build_object(
    'orderId',new_order.id,'publicToken',new_order.public_token,'orderNumber',new_order.order_number,
    'orderStatus',new_order.order_status,'paymentStatus',new_order.payment_status,
    'reservationExpiresAt',new_order.reservation_expires_at,
    'subtotal',new_order.subtotal,'shippingAmount',new_order.shipping_amount,'total',new_order.total,'currency',new_order.currency
  );
end;
$$;

revoke all on function public.create_commerce_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_commerce_order(jsonb) to service_role;

-- ------------------------------------------------------------
-- CUSTOMER PAYMENT NOTIFICATION
-- ------------------------------------------------------------

create or replace function public.notify_commerce_payment(target_public_token uuid, payment_reference_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  settings public.commerce_store_settings%rowtype;
  new_expiry timestamptz;
begin
  select * into target from public.commerce_orders where public_token = target_public_token for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.order_status in ('CANCELLED','EXPIRED','REFUNDED','COMPLETED') then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if target.payment_status = 'PAID' then
    return jsonb_build_object('orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status);
  end if;
  if target.reservation_expires_at <= now() and target.payment_status in ('UNPAID','REVIEW') then
    perform private.release_commerce_order_inventory(target.id,'EXPIRED');
    raise exception 'RESERVATION_EXPIRED';
  end if;
  if target.payment_method <> 'BANK_TRANSFER' then raise exception 'PAYMENT_NOTIFICATION_NOT_REQUIRED'; end if;
  -- Repeated clicks while already under review are idempotent and must not extend the hold forever.
  if target.payment_status = 'REVIEW' then
    return jsonb_build_object('orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status,
      'reservationExpiresAt',target.reservation_expires_at);
  end if;

  select * into settings from public.commerce_store_settings where id = 1;
  new_expiry := greatest(target.reservation_expires_at, now() + make_interval(hours => coalesce(settings.payment_review_hold_hours,24)));

  update public.commerce_orders
     set order_status = 'PAYMENT_REVIEW', payment_status = 'REVIEW',
         payment_reference = nullif(left(btrim(coalesce(payment_reference_value,'')),180),''),
         payment_notified_at = coalesce(payment_notified_at,now()),
         reservation_expires_at = new_expiry
   where id = target.id
   returning * into target;
  update public.commerce_reservations set expires_at = new_expiry where order_id = target.id;

  return jsonb_build_object('orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status,
    'reservationExpiresAt',target.reservation_expires_at);
end;
$$;

revoke all on function public.notify_commerce_payment(uuid,text) from public, anon, authenticated;
grant execute on function public.notify_commerce_payment(uuid,text) to service_role;

-- ------------------------------------------------------------
-- STAFF ORDER ACTIONS (WORKER AUTHORIZES ROLE; DB KEEPS TRANSITIONS ATOMIC)
-- ------------------------------------------------------------

create or replace function public.admin_commerce_order_action(
  target_order_id uuid,
  action_name text,
  actor_id uuid,
  action_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  item record;
  action text := upper(btrim(action_name));
begin
  select * into target from public.commerce_orders where id = target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  if action = 'CONFIRM_PAYMENT' then
    if target.payment_status = 'PAID' then null;
    elsif target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then raise exception 'ORDER_NOT_PAYABLE';
    else
      for item in select product_id from public.commerce_order_items where order_id = target.id order by product_id loop
        perform 1 from public.products where id = item.product_id for update;
        update public.products set status = 'sold', updated_by = actor_id where id = item.product_id and status = 'reserved';
        if not found then raise exception 'RESERVED_PRODUCT_STATE_MISMATCH'; end if;
      end loop;
      delete from public.commerce_reservations where order_id = target.id;
      update public.commerce_orders
         set payment_status='PAID', order_status='PROCESSING', fulfillment_status='PACKING', paid_at=now()
       where id=target.id;
    end if;
  elsif action = 'CANCEL' then
    if target.payment_status = 'PAID' then raise exception 'PAID_ORDER_REQUIRES_REFUND'; end if;
    if target.order_status not in ('CANCELLED','EXPIRED') then
      perform private.release_commerce_order_inventory(target.id,'CANCELLED');
    end if;
  elsif action = 'MARK_PACKING' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING', fulfillment_status='PACKING' where id=target.id;
  elsif action = 'MARK_SHIPPED' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method <> 'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    update public.commerce_orders
       set order_status='SHIPPED', fulfillment_status='SHIPPED', shipped_at=coalesce(shipped_at,now()),
           tracking_carrier=nullif(left(btrim(coalesce(action_data->>'trackingCarrier','')),100),''),
           tracking_number=nullif(left(btrim(coalesce(action_data->>'trackingNumber','')),120),'')
     where id=target.id;
  elsif action = 'MARK_PICKUP_READY' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method <> 'PICKUP' then raise exception 'PICKUP_ORDER_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING', fulfillment_status='PICKUP_READY' where id=target.id;
  elsif action = 'COMPLETE' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method = 'SHIPPING' and target.fulfillment_status <> 'SHIPPED' then raise exception 'SHIPMENT_NOT_READY'; end if;
    if target.delivery_method = 'PICKUP' and target.fulfillment_status <> 'PICKUP_READY' then raise exception 'PICKUP_NOT_READY'; end if;
    update public.commerce_orders
       set order_status='COMPLETED',
           fulfillment_status=case when delivery_method='PICKUP' then 'PICKED_UP' else 'DELIVERED' end,
           completed_at=coalesce(completed_at,now())
     where id=target.id;
  elsif action = 'REFUND' then
    if target.payment_status <> 'PAID' then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select product_id from public.commerce_order_items where order_id = target.id order by product_id loop
      perform 1 from public.products where id = item.product_id for update;
      update public.products set status='returned', updated_by=actor_id where id=item.product_id and status='sold';
    end loop;
    update public.commerce_orders
       set payment_status='REFUNDED', order_status='REFUNDED', fulfillment_status='CANCELLED', refunded_at=now()
     where id=target.id;
  else
    raise exception 'INVALID_ORDER_ACTION';
  end if;

  select * into target from public.commerce_orders where id=target_order_id;
  insert into public.activity_logs(actor_id, action, metadata)
  values (actor_id, 'commerce_order_' || lower(action), jsonb_build_object('orderId',target.id,'orderNumber',target.order_number));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'orderStatus',target.order_status,
    'paymentStatus',target.payment_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) to service_role;

-- ------------------------------------------------------------
-- STAFF-SAFE ADMIN VIEW (PII IS AUTHENTICATED APP DATA, NEVER STORE API DATA)
-- ------------------------------------------------------------

create or replace view public.commerce_order_admin_v
with (security_invoker = true)
as
select
  o.id, o.order_number, o.order_status, o.payment_status, o.fulfillment_status,
  o.payment_method, o.delivery_method,
  o.customer_name, o.customer_phone, o.customer_email,
  o.address_line, o.subdistrict, o.district, o.province, o.postal_code, o.customer_note,
  o.currency, o.subtotal, o.shipping_amount, o.total,
  o.reservation_expires_at, o.payment_reference, o.payment_notified_at, o.paid_at,
  o.tracking_carrier, o.tracking_number, o.shipped_at, o.completed_at, o.cancelled_at, o.expired_at, o.refunded_at,
  o.created_at, o.updated_at,
  coalesce((select jsonb_agg(jsonb_build_object(
    'productId',oi.product_id,'sku',oi.sku,'title',oi.title,'unitPrice',oi.unit_price,'condition',oi.merchant_item_condition
  ) order by oi.created_at) from public.commerce_order_items oi where oi.order_id=o.id),'[]'::jsonb) as items
from public.commerce_orders o;

revoke all on public.commerce_order_admin_v from anon, authenticated;
grant select on public.commerce_order_admin_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC PRODUCT/STORE PROJECTION REFRESH
-- ------------------------------------------------------------
-- Store API reads this server-only view. Include checkout capability without exposing bank details.

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  merchant_name, legal_name, site_url, currency, country_code, purchase_enabled,
  shipping_enabled, shipping_country, shipping_rate, handling_min_days, handling_max_days,
  transit_min_days, transit_max_days, shipping_policy_url,
  return_policy_enabled, return_policy_category, return_days, return_method, return_fees, return_policy_url,
  warranty_policy_url,
  updated_at,
  reservation_minutes, bank_transfer_enabled, pay_at_store_enabled, pickup_enabled, checkout_terms_url,
  checkout_turnstile_enabled, turnstile_site_key
from public.commerce_store_settings
where id=1;

revoke all on public.commerce_public_store_settings_v from anon, authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- Existing merchant readiness view should now become activation-ready when the real checkout is enabled.
-- Recreate SHOP-4 editor view with purchase lock removed from its semantics by keeping the same source flag.

-- Realtime is not required for public checkout; staff order screens poll/refetch through Worker.
