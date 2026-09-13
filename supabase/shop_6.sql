-- AMPHON SHOP — SHOP-6 Payment Gateway + Shipping / Tracking + Invoice / Warranty Fulfillment
-- Run after supabase/shop_5.sql. Safe to re-run.
--
-- Safety contract:
-- 1) Product Hub remains inventory source of truth.
-- 2) Stripe/browser redirects are never payment evidence; only a verified provider webhook can mark Stripe orders paid.
-- 3) Payment amount + currency must match the immutable order total before reserved physical SKUs become SOLD.
-- 4) Provider event IDs are unique/idempotent.
-- 5) Full refunds move SOLD physical SKUs to RETURNED, never back to PUBLISHED automatically.
-- 6) Documents snapshot order/seller/customer/item data at issuance.
-- 7) Warranty duration/terms are snapshotted into order items at checkout and cannot be changed retroactively.
-- 8) Secrets stay in the Cloudflare Worker; this migration stores no gateway credentials.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- STORE PAYMENT / DOCUMENT / WARRANTY CONFIGURATION
-- ------------------------------------------------------------

alter table public.commerce_store_settings
  add column if not exists stripe_enabled boolean not null default false,
  add column if not exists stripe_promptpay_enabled boolean not null default false,
  add column if not exists document_mode text not null default 'RECEIPT_ONLY',
  add column if not exists invoice_seller_name text,
  add column if not exists invoice_tax_id text,
  add column if not exists invoice_branch_code text,
  add column if not exists invoice_address text,
  add column if not exists invoice_email text,
  add column if not exists default_warranty_days integer not null default 0,
  add column if not exists default_warranty_terms text;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_document_mode_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_document_mode_check
  check (document_mode in ('RECEIPT_ONLY','INVOICE_RECEIPT','VAT_TAX_INVOICE'));

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_warranty_days_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_warranty_days_check
  check (default_warranty_days between 0 and 3650);

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_stripe_reservation_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_stripe_reservation_check
  check (stripe_enabled = false or reservation_minutes between 45 and 240);

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_promptpay_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_promptpay_check
  check (stripe_promptpay_enabled = false or (stripe_enabled = true and currency = 'THB'));

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_tax_invoice_config_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_tax_invoice_config_check
  check (
    document_mode <> 'VAT_TAX_INVOICE'
    or (
      nullif(btrim(invoice_seller_name), '') is not null
      and nullif(btrim(invoice_tax_id), '') is not null
      and nullif(btrim(invoice_address), '') is not null
    )
  );

-- Keep checkout activation conservative. At least one real payment rail must be enabled.
alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop5_purchase_ready_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop6_purchase_ready_check
  check (
    purchase_enabled = false
    or (
      shipping_enabled = true
      and return_policy_enabled = true
      and checkout_turnstile_enabled = true
      and nullif(btrim(turnstile_site_key), '') is not null
      and nullif(btrim(site_url), '') is not null
      and (bank_transfer_enabled = true or stripe_enabled = true or (pay_at_store_enabled = true and pickup_enabled = true))
    )
  );

-- ------------------------------------------------------------
-- PER-SKU WARRANTY OVERRIDE
-- ------------------------------------------------------------

alter table public.commerce_listings
  add column if not exists store_warranty_days integer,
  add column if not exists store_warranty_terms text;

alter table public.commerce_listings
  drop constraint if exists commerce_listings_store_warranty_days_check;
alter table public.commerce_listings
  add constraint commerce_listings_store_warranty_days_check
  check (store_warranty_days is null or store_warranty_days between 0 and 3650);

-- ------------------------------------------------------------
-- ORDER PAYMENT / INVOICE SNAPSHOT FIELDS
-- ------------------------------------------------------------

alter table public.commerce_orders
  add column if not exists payment_provider text not null default 'MANUAL',
  add column if not exists provider_checkout_session_id text,
  add column if not exists provider_payment_intent_id text,
  add column if not exists provider_payment_status text,
  add column if not exists provider_checkout_url text,
  add column if not exists provider_refund_id text,
  add column if not exists refund_status text,
  add column if not exists invoice_requested boolean not null default false,
  add column if not exists invoice_customer jsonb not null default '{}'::jsonb;

alter table public.commerce_orders
  drop constraint if exists commerce_orders_payment_method_check;
alter table public.commerce_orders
  add constraint commerce_orders_payment_method_check
  check (payment_method in ('BANK_TRANSFER','PAY_AT_STORE','STRIPE'));

alter table public.commerce_orders
  drop constraint if exists commerce_orders_payment_status_check;
alter table public.commerce_orders
  add constraint commerce_orders_payment_status_check
  check (payment_status in ('UNPAID','REVIEW','PAID','REFUND_PENDING','REFUNDED'));

alter table public.commerce_orders
  drop constraint if exists commerce_orders_fulfillment_status_check;
alter table public.commerce_orders
  add constraint commerce_orders_fulfillment_status_check
  check (fulfillment_status in ('UNFULFILLED','PACKING','SHIPPED','IN_TRANSIT','DELIVERED','PICKUP_READY','PICKED_UP','CANCELLED'));

alter table public.commerce_orders
  drop constraint if exists commerce_orders_payment_provider_check;
alter table public.commerce_orders
  add constraint commerce_orders_payment_provider_check
  check (payment_provider in ('MANUAL','STRIPE'));

create unique index if not exists commerce_orders_provider_session_uidx
  on public.commerce_orders(provider_checkout_session_id)
  where provider_checkout_session_id is not null;
create unique index if not exists commerce_orders_provider_payment_uidx
  on public.commerce_orders(provider_payment_intent_id)
  where provider_payment_intent_id is not null;

alter table public.commerce_order_items
  add column if not exists warranty_days integer not null default 0,
  add column if not exists warranty_terms text;

alter table public.commerce_order_items
  drop constraint if exists commerce_order_items_warranty_days_check;
alter table public.commerce_order_items
  add constraint commerce_order_items_warranty_days_check
  check (warranty_days between 0 and 3650);

-- ------------------------------------------------------------
-- PROVIDER PAYMENT LEDGER
-- ------------------------------------------------------------

create table if not exists public.commerce_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  provider text not null check (provider in ('STRIPE','MANUAL')),
  checkout_session_id text,
  payment_intent_id text,
  provider_status text,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, provider)
);

create table if not exists public.commerce_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  order_id uuid references public.commerce_orders(id) on delete set null,
  provider_payment_id text,
  amount_minor bigint,
  currency text,
  processed boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists commerce_payment_events_order_idx on public.commerce_payment_events(order_id, created_at desc);
create index if not exists commerce_payment_transactions_order_idx on public.commerce_payment_transactions(order_id);

-- ------------------------------------------------------------
-- SHIPPING + IMMUTABLE FULFILLMENT TIMELINE
-- ------------------------------------------------------------

create table if not exists public.commerce_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.commerce_orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  tracking_url text,
  status text not null default 'PACKING'
    check (status in ('PACKING','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_fulfillment_events (
  id bigserial primary key,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commerce_fulfillment_events_order_idx
  on public.commerce_fulfillment_events(order_id, created_at asc);

-- ------------------------------------------------------------
-- IMMUTABLE DOCUMENT SNAPSHOTS
-- ------------------------------------------------------------

create sequence if not exists public.commerce_document_seq;

create table if not exists public.commerce_documents (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  document_number text not null unique,
  document_type text not null check (document_type in ('RECEIPT_ONLY','INVOICE_RECEIPT','VAT_TAX_INVOICE')),
  seller_snapshot jsonb not null,
  customer_snapshot jsonb not null,
  totals_snapshot jsonb not null,
  items_snapshot jsonb not null,
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id, document_type)
);

-- ------------------------------------------------------------
-- WARRANTY CERTIFICATES + CLAIM TIMELINE
-- ------------------------------------------------------------

create sequence if not exists public.commerce_warranty_seq;

create table if not exists public.commerce_warranties (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  order_item_id uuid not null unique references public.commerce_order_items(id) on delete restrict,
  certificate_number text not null unique,
  sku text not null,
  title text not null,
  warranty_days integer not null check (warranty_days > 0),
  terms text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRED','VOID')),
  created_at timestamptz not null default now()
);

create table if not exists public.commerce_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  warranty_id uuid not null references public.commerce_warranties(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN','IN_REVIEW','APPROVED','REJECTED','RESOLVED','CANCELLED')),
  issue text not null,
  resolution text,
  opened_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists commerce_warranties_order_idx on public.commerce_warranties(order_id);
create index if not exists commerce_warranty_claims_warranty_idx on public.commerce_warranty_claims(warranty_id, opened_at desc);

-- ------------------------------------------------------------
-- SERVER-ONLY ACCESS BOUNDARY
-- ------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'commerce_payment_transactions','commerce_payment_events','commerce_shipments','commerce_fulfillment_events',
    'commerce_documents','commerce_warranties','commerce_warranty_claims'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- DOCUMENT / WARRANTY ISSUANCE HELPERS
-- ------------------------------------------------------------

create or replace function private.issue_commerce_document(target_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  s public.commerce_store_settings%rowtype;
  doc_type text;
  doc_id uuid;
  seller jsonb;
  customer jsonb;
  totals jsonb;
  items jsonb;
begin
  select * into o from public.commerce_orders where id = target_order_id;
  if o.id is null or o.payment_status <> 'PAID' then return null; end if;
  select * into s from public.commerce_store_settings where id = 1;

  doc_type := case
    when o.invoice_requested = true and s.document_mode in ('INVOICE_RECEIPT','VAT_TAX_INVOICE') then s.document_mode
    else 'RECEIPT_ONLY'
  end;

  select d.id into doc_id from public.commerce_documents d where d.order_id = o.id and d.document_type = doc_type;
  if doc_id is not null then return doc_id; end if;

  seller := jsonb_build_object(
    'merchantName', s.merchant_name,
    'legalName', s.legal_name,
    'sellerName', coalesce(s.invoice_seller_name, s.legal_name, s.merchant_name),
    'taxId', s.invoice_tax_id,
    'branchCode', s.invoice_branch_code,
    'address', s.invoice_address,
    'email', s.invoice_email,
    'siteUrl', s.site_url,
    'countryCode', s.country_code
  );

  customer := jsonb_build_object(
    'name', o.customer_name,
    'phone', o.customer_phone,
    'email', o.customer_email,
    'deliveryAddress', jsonb_strip_nulls(jsonb_build_object(
      'addressLine',o.address_line,'subdistrict',o.subdistrict,'district',o.district,'province',o.province,'postalCode',o.postal_code
    )),
    'invoiceRequested',o.invoice_requested,
    'invoice',coalesce(o.invoice_customer,'{}'::jsonb)
  );

  totals := jsonb_build_object('currency',o.currency,'subtotal',o.subtotal,'shippingAmount',o.shipping_amount,'total',o.total,'paidAt',o.paid_at);
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku',oi.sku,'title',oi.title,'unitPrice',oi.unit_price,'quantity',oi.quantity,'condition',oi.merchant_item_condition,
    'warrantyDays',oi.warranty_days,'warrantyTerms',oi.warranty_terms
  ) order by oi.created_at),'[]'::jsonb)
  into items from public.commerce_order_items oi where oi.order_id = o.id;

  insert into public.commerce_documents(order_id,document_number,document_type,seller_snapshot,customer_snapshot,totals_snapshot,items_snapshot)
  values (
    o.id,
    'AT-' || case when doc_type='VAT_TAX_INVOICE' then 'TAX' when doc_type='INVOICE_RECEIPT' then 'INV' else 'RCP' end || '-' ||
      to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || '-' || lpad(nextval('public.commerce_document_seq')::text,6,'0'),
    doc_type,seller,customer,totals,items
  )
  returning id into doc_id;
  return doc_id;
end;
$$;

revoke all on function private.issue_commerce_document(uuid) from public, anon, authenticated;

create or replace function private.issue_commerce_warranties(target_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  item record;
  start_at timestamptz;
  inserted_count integer := 0;
begin
  select * into o from public.commerce_orders where id = target_order_id;
  if o.id is null or o.order_status <> 'COMPLETED' or o.payment_status <> 'PAID' then return 0; end if;
  start_at := coalesce(o.completed_at, now());
  for item in
    select oi.* from public.commerce_order_items oi where oi.order_id=o.id and oi.warranty_days > 0 order by oi.created_at
  loop
    insert into public.commerce_warranties(order_id,order_item_id,certificate_number,sku,title,warranty_days,terms,starts_at,ends_at)
    values (
      o.id,item.id,
      'AT-WAR-' || to_char(start_at at time zone 'Asia/Bangkok','YYMMDD') || '-' || lpad(nextval('public.commerce_warranty_seq')::text,6,'0'),
      item.sku,item.title,item.warranty_days,item.warranty_terms,start_at,start_at + make_interval(days => item.warranty_days)
    ) on conflict (order_item_id) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function private.issue_commerce_warranties(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- SHARED PAID TRANSITION
-- ------------------------------------------------------------

create or replace function private.mark_commerce_order_paid(
  target_order_id uuid,
  actor_id uuid default null,
  provider_name text default 'MANUAL',
  provider_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  item record;
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.payment_status = 'PAID' then
    return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status);
  end if;
  if target.payment_status not in ('UNPAID','REVIEW') or target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if target.reservation_expires_at <= now() then raise exception 'RESERVATION_EXPIRED'; end if;

  for item in select product_id from public.commerce_order_items where order_id=target.id order by product_id loop
    perform 1 from public.products where id=item.product_id for update;
    update public.products set status='sold', updated_by=actor_id
     where id=item.product_id and status='reserved'
       and exists(select 1 from public.commerce_reservations r where r.product_id=item.product_id and r.order_id=target.id);
    if not found then raise exception 'RESERVED_PRODUCT_STATE_MISMATCH'; end if;
  end loop;

  delete from public.commerce_reservations where order_id=target.id;
  update public.commerce_orders
     set payment_status='PAID', order_status='PROCESSING', fulfillment_status='PACKING', paid_at=coalesce(paid_at,now()),
         payment_provider=upper(coalesce(provider_name,'MANUAL')),
         provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),
         provider_payment_status='PAID'
   where id=target.id
   returning * into target;

  insert into public.commerce_payment_transactions(order_id,provider,payment_intent_id,provider_status,amount,currency,paid_at)
  values (target.id,upper(coalesce(provider_name,'MANUAL')),provider_payment_id,'PAID',target.total,target.currency,target.paid_at)
  on conflict (order_id,provider) do update
    set payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),
        provider_status='PAID',paid_at=coalesce(public.commerce_payment_transactions.paid_at,excluded.paid_at),updated_at=now();

  perform private.issue_commerce_document(target.id);
  insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata)
  values(target.id,'PAYMENT_CONFIRMED',actor_id,jsonb_build_object('provider',upper(coalesce(provider_name,'MANUAL'))));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function private.mark_commerce_order_paid(uuid,uuid,text,text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- SHOP-6 ATOMIC CHECKOUT (REPLACES SHOP-5 VERSION)
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
  invoice_requested_value boolean := false;
  invoice_customer_value jsonb := '{}'::jsonb;
begin
  select * into settings from public.commerce_store_settings where id=1 for share;
  if settings.id is null or settings.purchase_enabled is not true then raise exception 'CHECKOUT_DISABLED'; end if;

  begin idem := (checkout->>'idempotencyKey')::uuid; exception when others then raise exception 'INVALID_IDEMPOTENCY_KEY'; end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(idem::text,0));
  select * into existing from public.commerce_orders where idempotency_key=idem;
  if existing.id is not null then
    return jsonb_build_object('orderId',existing.id,'publicToken',existing.public_token,'orderNumber',existing.order_number,
      'orderStatus',existing.order_status,'paymentStatus',existing.payment_status,'reservationExpiresAt',existing.reservation_expires_at,
      'subtotal',existing.subtotal,'shippingAmount',existing.shipping_amount,'total',existing.total,'currency',existing.currency,
      'paymentMethod',existing.payment_method,'providerCheckoutUrl',existing.provider_checkout_url);
  end if;

  select array_agg(distinct upper(btrim(v)) order by upper(btrim(v))) into requested_skus
    from jsonb_array_elements_text(coalesce(checkout->'skus','[]'::jsonb)) t(v) where btrim(v)<>'';
  item_count := coalesce(cardinality(requested_skus),0);
  if item_count<1 or item_count>10 then raise exception 'INVALID_CART_SIZE'; end if;

  customer_name_value := left(btrim(coalesce(checkout->>'customerName','')),120);
  customer_phone_value := left(regexp_replace(coalesce(checkout->>'customerPhone',''),'[^0-9+]','','g'),30);
  customer_email_value := nullif(left(btrim(coalesce(checkout->>'customerEmail','')),180),'');
  if char_length(customer_name_value)<2 then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
  if char_length(customer_phone_value)<8 then raise exception 'CUSTOMER_PHONE_REQUIRED'; end if;

  payment_method_value := upper(coalesce(checkout->>'paymentMethod','BANK_TRANSFER'));
  delivery_method_value := upper(coalesce(checkout->>'deliveryMethod','SHIPPING'));
  if payment_method_value not in ('BANK_TRANSFER','PAY_AT_STORE','STRIPE') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if delivery_method_value not in ('SHIPPING','PICKUP') then raise exception 'INVALID_DELIVERY_METHOD'; end if;
  if payment_method_value='BANK_TRANSFER' and settings.bank_transfer_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value='STRIPE' and settings.stripe_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value='PAY_AT_STORE' and (settings.pay_at_store_enabled is not true or settings.pickup_enabled is not true or delivery_method_value<>'PICKUP') then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if delivery_method_value='PICKUP' and settings.pickup_enabled is not true then raise exception 'PICKUP_DISABLED'; end if;
  if delivery_method_value='SHIPPING' then
    if settings.shipping_enabled is not true then raise exception 'SHIPPING_DISABLED'; end if;
    if nullif(btrim(coalesce(checkout->>'addressLine','')),'') is null
       or nullif(btrim(coalesce(checkout->>'district','')),'') is null
       or nullif(btrim(coalesce(checkout->>'province','')),'') is null
       or nullif(btrim(coalesce(checkout->>'postalCode','')),'') is null then raise exception 'SHIPPING_ADDRESS_REQUIRED'; end if;
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
    currency,subtotal,shipping_amount,total,reservation_expires_at,invoice_requested,invoice_customer
  ) values (
    idem,'ATSO-'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')||'-'||lpad(nextval('public.commerce_order_seq')::text,6,'0'),
    payment_method_value,case when payment_method_value='STRIPE' then 'STRIPE' else 'MANUAL' end,delivery_method_value,
    customer_name_value,customer_phone_value,customer_email_value,
    nullif(left(btrim(coalesce(checkout->>'addressLine','')),250),''),nullif(left(btrim(coalesce(checkout->>'subdistrict','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'district','')),120),''),nullif(left(btrim(coalesce(checkout->>'province','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'postalCode','')),20),''),nullif(left(btrim(coalesce(checkout->>'note','')),500),''),
    coalesce(settings.currency,'THB'),subtotal_amount,shipping_amount_value,total_amount,expires_at_value,invoice_requested_value,invoice_customer_value
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

  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(new_order.id,'ORDER_RESERVED',jsonb_build_object('paymentMethod',payment_method_value,'deliveryMethod',delivery_method_value));

  return jsonb_build_object('orderId',new_order.id,'publicToken',new_order.public_token,'orderNumber',new_order.order_number,
    'orderStatus',new_order.order_status,'paymentStatus',new_order.payment_status,'reservationExpiresAt',new_order.reservation_expires_at,
    'subtotal',new_order.subtotal,'shippingAmount',new_order.shipping_amount,'total',new_order.total,'currency',new_order.currency,
    'paymentMethod',new_order.payment_method);
end;
$$;

revoke all on function public.create_commerce_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_commerce_order(jsonb) to service_role;

-- ------------------------------------------------------------
-- GATEWAY SESSION / WEBHOOK RPCS
-- ------------------------------------------------------------

create or replace function public.attach_commerce_gateway_checkout(
  target_order_id uuid,
  provider_name text,
  checkout_session_id text,
  checkout_url text,
  provider_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.commerce_orders%rowtype;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_method<>'STRIPE' or upper(provider_name)<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;
  if o.payment_status<>'UNPAID' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  update public.commerce_orders set payment_provider='STRIPE',provider_checkout_session_id=checkout_session_id,
    provider_checkout_url=checkout_url,provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),provider_payment_status='CHECKOUT_OPEN'
    where id=o.id returning * into o;
  insert into public.commerce_payment_transactions(order_id,provider,checkout_session_id,payment_intent_id,provider_status,amount,currency)
  values(o.id,'STRIPE',checkout_session_id,provider_payment_id,'CHECKOUT_OPEN',o.total,o.currency)
  on conflict(order_id,provider) do update set checkout_session_id=excluded.checkout_session_id,
    payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),provider_status='CHECKOUT_OPEN',updated_at=now();
  return jsonb_build_object('orderId',o.id,'publicToken',o.public_token,'checkoutUrl',o.provider_checkout_url,'checkoutSessionId',o.provider_checkout_session_id);
end;
$$;

revoke all on function public.attach_commerce_gateway_checkout(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.attach_commerce_gateway_checkout(uuid,text,text,text,text) to service_role;

create or replace function public.cancel_commerce_gateway_order(target_order_id uuid, reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare released integer;
begin
  released := private.release_commerce_order_inventory(target_order_id,'CANCELLED');
  update public.commerce_orders set provider_payment_status='CHECKOUT_CREATE_FAILED',provider_checkout_url=null where id=target_order_id and payment_status='UNPAID';
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(target_order_id,'GATEWAY_CHECKOUT_CANCELLED',jsonb_build_object('reason',left(coalesce(reason,''),300)));
  return released;
end;
$$;

revoke all on function public.cancel_commerce_gateway_order(uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_commerce_gateway_order(uuid,text) to service_role;

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
  if o.payment_provider<>'STRIPE' or o.payment_status<>'PAID' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;
  update public.commerce_orders as co
     set payment_status='REFUND_PENDING',provider_refund_id=v_provider_refund_id,refund_status='PENDING'
   where co.id=o.id returning co.* into o;
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(o.id,'REFUND_REQUESTED',jsonb_build_object('provider','STRIPE','refundId',v_provider_refund_id));
  return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status);
end;
$$;

revoke all on function public.mark_commerce_gateway_refund_pending(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_commerce_gateway_refund_pending(uuid,text) to service_role;

create or replace function public.process_gateway_payment_event(
  provider_name text,
  provider_event_id text,
  normalized_event text,
  target_order_id uuid default null,
  provider_payment_id text default null,
  amount_minor bigint default null,
  currency_code text default null,
  event_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_event_id uuid;
  o public.commerce_orders%rowtype;
  expected_minor bigint;
  v_provider_name text := upper(provider_name);
  v_provider_event_id text := provider_event_id;
  v_action text := upper(normalized_event);
  v_target_order_id uuid := target_order_id;
  v_provider_payment_id text := provider_payment_id;
  v_amount_minor bigint := amount_minor;
  v_currency_code text := upper(currency_code);
  v_event_payload jsonb := coalesce(event_payload,'{}'::jsonb);
  item record;
begin
  insert into public.commerce_payment_events(provider,provider_event_id,event_type,order_id,provider_payment_id,amount_minor,currency,payload)
  values(v_provider_name,v_provider_event_id,v_action,v_target_order_id,v_provider_payment_id,v_amount_minor,v_currency_code,v_event_payload)
  on conflict on constraint commerce_payment_events_provider_provider_event_id_key do nothing
  returning id into inserted_event_id;
  if inserted_event_id is null then return jsonb_build_object('duplicate',true,'providerEventId',v_provider_event_id); end if;

  if v_target_order_id is not null then select co.* into o from public.commerce_orders as co where co.id=v_target_order_id for update;
  elsif v_provider_payment_id is not null then select co.* into o from public.commerce_orders as co where co.provider_payment_intent_id=v_provider_payment_id for update;
  end if;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' or v_provider_name<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;

  if v_provider_payment_id is not null and o.provider_payment_intent_id is null then
    update public.commerce_orders as co set provider_payment_intent_id=v_provider_payment_id where co.id=o.id returning co.* into o;
  end if;

  if v_action='PAYMENT_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if v_amount_minor is null or v_amount_minor<>expected_minor then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
    if coalesce(v_currency_code,'')<>upper(o.currency) then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;
    perform private.mark_commerce_order_paid(o.id,null,'STRIPE',v_provider_payment_id);
    update public.commerce_orders as co set provider_payment_status='PAID',provider_checkout_url=null where co.id=o.id;
    update public.commerce_payment_transactions as cpt
       set provider_status='PAID',payment_intent_id=coalesce(v_provider_payment_id,cpt.payment_intent_id),paid_at=coalesce(cpt.paid_at,now()),updated_at=now()
     where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='PAYMENT_FAILED' then
    update public.commerce_orders as co set provider_payment_status='FAILED' where co.id=o.id and co.payment_status='UNPAID';
    update public.commerce_payment_transactions as cpt set provider_status='FAILED',updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='CHECKOUT_EXPIRED' then
    if o.payment_status in ('UNPAID','REVIEW') then perform private.release_commerce_order_inventory(o.id,'EXPIRED'); end if;
    update public.commerce_orders as co set provider_payment_status='EXPIRED',provider_checkout_url=null where co.id=o.id;
    update public.commerce_payment_transactions as cpt set provider_status='EXPIRED',updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='REFUND_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if v_amount_minor is not null and v_amount_minor<>expected_minor then raise exception 'PARTIAL_REFUND_NOT_SUPPORTED'; end if;
    if o.payment_status not in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select product_id from public.commerce_order_items where order_id=o.id order by product_id loop
      perform 1 from public.products where id=item.product_id for update;
      update public.products set status='returned',updated_by=null where id=item.product_id and status='sold';
    end loop;
    update public.commerce_orders as co set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='SUCCEEDED',provider_payment_status='REFUNDED' where co.id=o.id;
    update public.commerce_payment_transactions as cpt set provider_status='REFUNDED',refunded_at=now(),updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_CONFIRMED',jsonb_build_object('provider','STRIPE'));
  elsif v_action='REFUND_FAILED' then
    update public.commerce_orders as co set payment_status=case when co.payment_status='REFUND_PENDING' then 'PAID' else co.payment_status end,refund_status='FAILED' where co.id=o.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_FAILED',jsonb_build_object('provider','STRIPE'));
  else
    raise exception 'UNSUPPORTED_GATEWAY_EVENT';
  end if;

  update public.commerce_payment_events as cpe set processed=true,processed_at=now(),order_id=o.id where cpe.id=inserted_event_id;
  select co.* into o from public.commerce_orders as co where co.id=o.id;
  return jsonb_build_object('duplicate',false,'orderId',o.id,'orderNumber',o.order_number,'paymentStatus',o.payment_status,'orderStatus',o.order_status,'fulfillmentStatus',o.fulfillment_status);
end;
$$;

revoke all on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) to service_role;

-- ------------------------------------------------------------
-- STAFF ORDER ACTIONS — PAYMENT, SHIPPING, TRACKING, WARRANTY
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
  carrier_value text;
  tracking_value text;
  tracking_url_value text;
  shipment_status text;
  claim_warranty_id uuid;
  claim_issue text;
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  if action='CONFIRM_PAYMENT' then
    if target.payment_provider='STRIPE' or target.payment_method='STRIPE' then raise exception 'GATEWAY_WEBHOOK_REQUIRED'; end if;
    perform private.mark_commerce_order_paid(target.id,actor_id,'MANUAL',null);
  elsif action='CANCEL' then
    if target.payment_status in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRES_REFUND'; end if;
    if target.order_status not in ('CANCELLED','EXPIRED') then perform private.release_commerce_order_inventory(target.id,'CANCELLED'); end if;
  elsif action='MARK_PACKING' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING',fulfillment_status='PACKING' where id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'PACKING',actor_id);
  elsif action='MARK_SHIPPED' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method<>'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    carrier_value:=nullif(left(btrim(coalesce(action_data->>'trackingCarrier','')),100),'');
    tracking_value:=nullif(left(btrim(coalesce(action_data->>'trackingNumber','')),120),'');
    tracking_url_value:=nullif(left(btrim(coalesce(action_data->>'trackingUrl','')),500),'');
    if tracking_value is null then raise exception 'TRACKING_REQUIRED'; end if;
    update public.commerce_orders set order_status='SHIPPED',fulfillment_status='SHIPPED',shipped_at=coalesce(shipped_at,now()),tracking_carrier=carrier_value,tracking_number=tracking_value where id=target.id;
    insert into public.commerce_shipments(order_id,carrier,tracking_number,tracking_url,status,shipped_at)
    values(target.id,carrier_value,tracking_value,tracking_url_value,'SHIPPED',now())
    on conflict(order_id) do update set carrier=excluded.carrier,tracking_number=excluded.tracking_number,tracking_url=excluded.tracking_url,status='SHIPPED',shipped_at=coalesce(public.commerce_shipments.shipped_at,excluded.shipped_at),updated_at=now();
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata) values(target.id,'SHIPPED',actor_id,jsonb_build_object('carrier',carrier_value,'trackingNumber',tracking_value,'trackingUrl',tracking_url_value));
  elsif action='MARK_IN_TRANSIT' then
    if target.payment_status<>'PAID' or target.delivery_method<>'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    update public.commerce_orders set order_status='SHIPPED',fulfillment_status='IN_TRANSIT' where id=target.id;
    update public.commerce_shipments set status='IN_TRANSIT',updated_at=now() where order_id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'IN_TRANSIT',actor_id);
  elsif action='MARK_DELIVERED' then
    if target.payment_status<>'PAID' or target.delivery_method<>'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    if target.fulfillment_status not in ('SHIPPED','IN_TRANSIT') then raise exception 'SHIPMENT_NOT_READY'; end if;
    update public.commerce_orders set order_status='COMPLETED',fulfillment_status='DELIVERED',completed_at=coalesce(completed_at,now()) where id=target.id;
    update public.commerce_shipments set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),updated_at=now() where order_id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'DELIVERED',actor_id);
    perform private.issue_commerce_warranties(target.id);
  elsif action='MARK_PICKUP_READY' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method<>'PICKUP' then raise exception 'PICKUP_ORDER_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING',fulfillment_status='PICKUP_READY' where id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'PICKUP_READY',actor_id);
  elsif action='COMPLETE' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method='SHIPPING' then
      if target.fulfillment_status not in ('SHIPPED','IN_TRANSIT') then raise exception 'SHIPMENT_NOT_READY'; end if;
      update public.commerce_orders set order_status='COMPLETED',fulfillment_status='DELIVERED',completed_at=coalesce(completed_at,now()) where id=target.id;
      update public.commerce_shipments set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),updated_at=now() where order_id=target.id;
    else
      if target.fulfillment_status<>'PICKUP_READY' then raise exception 'PICKUP_NOT_READY'; end if;
      update public.commerce_orders set order_status='COMPLETED',fulfillment_status='PICKED_UP',completed_at=coalesce(completed_at,now()) where id=target.id;
    end if;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'COMPLETED',actor_id);
    perform private.issue_commerce_warranties(target.id);
  elsif action='REFUND' then
    if target.payment_provider='STRIPE' or target.payment_method='STRIPE' then raise exception 'GATEWAY_REFUND_REQUIRED'; end if;
    if target.payment_status<>'PAID' then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select product_id from public.commerce_order_items where order_id=target.id order by product_id loop
      perform 1 from public.products where id=item.product_id for update;
      update public.products set status='returned',updated_by=actor_id where id=item.product_id and status='sold';
    end loop;
    update public.commerce_orders set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='MANUAL_CONFIRMED' where id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata) values(target.id,'REFUND_CONFIRMED',actor_id,jsonb_build_object('provider','MANUAL'));
  elsif action='OPEN_WARRANTY_CLAIM' then
    begin claim_warranty_id := (action_data->>'warrantyId')::uuid; exception when others then raise exception 'INVALID_WARRANTY_ID'; end;
    claim_issue := nullif(left(btrim(coalesce(action_data->>'issue','')),1000),'');
    if claim_issue is null then raise exception 'WARRANTY_ISSUE_REQUIRED'; end if;
    if not exists(select 1 from public.commerce_warranties w where w.id=claim_warranty_id and w.order_id=target.id) then raise exception 'WARRANTY_NOT_FOUND'; end if;
    insert into public.commerce_warranty_claims(warranty_id,issue,opened_by) values(claim_warranty_id,claim_issue,actor_id);
  else
    raise exception 'INVALID_ORDER_ACTION';
  end if;

  select * into target from public.commerce_orders where id=target_order_id;
  insert into public.activity_logs(actor_id,action,metadata)
  values(actor_id,'commerce_order_'||lower(action),jsonb_build_object('orderId',target.id,'orderNumber',target.order_number));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) to service_role;

-- ------------------------------------------------------------
-- STAFF ORDER VIEW
-- ------------------------------------------------------------

create or replace view public.commerce_order_admin_v
with (security_invoker = true)
as
select
  -- SHOP-5 contract: keep every existing column in the same position.
  o.id,o.order_number,o.order_status,o.payment_status,o.fulfillment_status,o.payment_method,o.delivery_method,
  o.customer_name,o.customer_phone,o.customer_email,o.address_line,o.subdistrict,o.district,o.province,o.postal_code,o.customer_note,
  o.currency,o.subtotal,o.shipping_amount,o.total,o.reservation_expires_at,o.payment_reference,o.payment_notified_at,o.paid_at,
  o.tracking_carrier,o.tracking_number,o.shipped_at,o.completed_at,o.cancelled_at,o.expired_at,o.refunded_at,o.created_at,o.updated_at,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id',oi.id,'productId',oi.product_id,'sku',oi.sku,'title',oi.title,'unitPrice',oi.unit_price,'condition',oi.merchant_item_condition,
    'warrantyDays',oi.warranty_days,'warrantyTerms',oi.warranty_terms
  ) order by oi.created_at) from public.commerce_order_items oi where oi.order_id=o.id),'[]'::jsonb) as items,
  -- SHOP-6 additions: append only so CREATE OR REPLACE VIEW remains compatible.
  o.payment_provider,
  o.provider_checkout_session_id,o.provider_payment_intent_id,o.provider_payment_status,o.provider_refund_id,o.refund_status,
  o.invoice_requested,o.invoice_customer,
  sh.tracking_url,sh.status as shipment_status,sh.delivered_at,
  coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'publicToken',w.public_token,'certificateNumber',w.certificate_number,'sku',w.sku,'title',w.title,'status',w.status,'startsAt',w.starts_at,'endsAt',w.ends_at) order by w.created_at) from public.commerce_warranties w where w.order_id=o.id),'[]'::jsonb) as warranties,
  (select jsonb_build_object('publicToken',d.public_token,'documentNumber',d.document_number,'documentType',d.document_type,'issuedAt',d.issued_at) from public.commerce_documents d where d.order_id=o.id and d.voided_at is null order by d.issued_at desc limit 1) as document
from public.commerce_orders o
left join public.commerce_shipments sh on sh.order_id=o.id;

revoke all on public.commerce_order_admin_v from anon, authenticated;
grant select on public.commerce_order_admin_v to service_role;

-- ------------------------------------------------------------
-- COMMERCE LISTING EDITOR VIEW WITH WARRANTY OVERRIDE
-- ------------------------------------------------------------

create or replace view public.commerce_listing_editor_v
with (security_invoker = true)
as
select
  -- SHOP-4 contract: preserve the original column order through updated_at.
  p.id as product_id,p.sku,p.title,p.status as product_status,cl.id as listing_id,cl.slug,
  '/p/'||cl.slug||'-'||lower(p.sku)||'/' as canonical_path,
  cl.category_id,c.name_th as category_name,cl.brand_id,b.name as brand_name,cl.series_id,s.name as series_name,
  cl.model_id,m.model_name,cl.seo_title,cl.seo_description,cl.index_policy,cl.merchant_enabled,cl.merchant_item_condition,
  cl.google_product_category,cl.gtin,cl.mpn,
  coalesce(r.website_status,'not_published') as website_status,coalesce(r.data_ready,false) as data_ready,
  coalesce(r.merchant_activation_ready,false) as merchant_activation_ready,coalesce(r.blockers,array[]::text[]) as blockers,cl.updated_at,
  -- SHOP-6 additions: append only.
  cl.store_warranty_days,cl.store_warranty_terms
from public.products p
join public.commerce_listings cl on cl.product_id=p.id
left join public.commerce_categories c on c.id=cl.category_id
left join public.commerce_brands b on b.id=cl.brand_id
left join public.commerce_series s on s.id=cl.series_id
left join public.commerce_models m on m.id=cl.model_id
left join public.commerce_merchant_readiness_v r on r.product_id=p.id;

revoke all on public.commerce_listing_editor_v from anon;
grant select on public.commerce_listing_editor_v to authenticated;
grant select on public.commerce_listing_editor_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC STORE SETTINGS PROJECTION (SERVER-ONLY VIEW, NO SECRETS)
-- ------------------------------------------------------------

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  -- SHOP-3 contract, then SHOP-5 columns, then SHOP-6 columns. Append only.
  merchant_name,legal_name,site_url,currency,country_code,purchase_enabled,
  shipping_enabled,shipping_country,shipping_rate,handling_min_days,handling_max_days,transit_min_days,transit_max_days,shipping_policy_url,
  return_policy_enabled,return_policy_category,return_days,return_method,return_fees,return_policy_url,warranty_policy_url,
  updated_at,
  reservation_minutes,bank_transfer_enabled,pay_at_store_enabled,pickup_enabled,checkout_terms_url,checkout_turnstile_enabled,turnstile_site_key,
  stripe_enabled,stripe_promptpay_enabled,document_mode,default_warranty_days
from public.commerce_store_settings where id=1;

revoke all on public.commerce_public_store_settings_v from anon, authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- ------------------------------------------------------------
-- UPDATE TOUCH TRIGGERS FOR NEW MUTABLE TABLES
-- ------------------------------------------------------------

drop trigger if exists commerce_payment_transactions_touch on public.commerce_payment_transactions;
create trigger commerce_payment_transactions_touch before update on public.commerce_payment_transactions
for each row execute procedure public.touch_commerce_order();

drop trigger if exists commerce_shipments_touch on public.commerce_shipments;
create trigger commerce_shipments_touch before update on public.commerce_shipments
for each row execute procedure public.touch_commerce_order();

drop trigger if exists commerce_warranty_claims_touch on public.commerce_warranty_claims;
create trigger commerce_warranty_claims_touch before update on public.commerce_warranty_claims
for each row execute procedure public.touch_commerce_order();

-- Service role owns the server-only RPC surface.
grant usage, select on sequence public.commerce_document_seq to service_role;
grant usage, select on sequence public.commerce_warranty_seq to service_role;
