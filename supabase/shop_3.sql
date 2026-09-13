-- AMPHON SHOP — SHOP-3 Product Detail SEO + Merchant Listing + Used Product Trust UX
-- Run after supabase/shop_2.sql. Safe to re-run.
--
-- Guardrails:
-- 1) No cost/profit/supplier/customer/employee fields are exposed to storefront.
-- 2) Shipping/return schema is emitted only when the merchant explicitly configures it.
-- 3) Used-product condition is explicit per listing and defaults to USED for the current second-hand catalog.
-- 4) Merchant eligibility is a readiness signal, not a promise that Google will show a rich result.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- LISTING MERCHANT CONDITION
-- ------------------------------------------------------------

alter table public.commerce_listings
  add column if not exists merchant_item_condition text not null default 'USED';

alter table public.commerce_listings
  drop constraint if exists commerce_listings_merchant_item_condition_check;

alter table public.commerce_listings
  add constraint commerce_listings_merchant_item_condition_check
  check (merchant_item_condition in ('NEW','USED','REFURBISHED','DAMAGED'));

-- ------------------------------------------------------------
-- STORE-WIDE PUBLIC MERCHANT POLICY SETTINGS
-- ------------------------------------------------------------
-- This table contains ONLY data that is safe to expose through the Store API.
-- Do not add secrets, credentials, banking data or internal notes here.

create table if not exists public.commerce_store_settings (
  id smallint primary key default 1 check (id = 1),
  merchant_name text not null default 'AMPHON TRADING',
  legal_name text,
  site_url text not null default 'https://shop.amphon.co.th',
  currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  country_code text not null default 'TH' check (country_code ~ '^[A-Z]{2}$'),

  -- Keep false until the storefront itself supports a purchase/order flow.
  purchase_enabled boolean not null default false,

  shipping_enabled boolean not null default false,
  shipping_country text default 'TH' check (shipping_country is null or shipping_country ~ '^[A-Z]{2}$'),
  shipping_rate numeric(12,2) check (shipping_rate is null or shipping_rate >= 0),
  handling_min_days integer check (handling_min_days is null or handling_min_days >= 0),
  handling_max_days integer check (handling_max_days is null or handling_max_days >= 0),
  transit_min_days integer check (transit_min_days is null or transit_min_days >= 0),
  transit_max_days integer check (transit_max_days is null or transit_max_days >= 0),
  shipping_policy_url text,

  return_policy_enabled boolean not null default false,
  return_policy_category text
    check (return_policy_category is null or return_policy_category in ('FINITE','NOT_PERMITTED','UNLIMITED')),
  return_days integer check (return_days is null or return_days >= 0),
  return_method text
    check (return_method is null or return_method in ('MAIL','IN_STORE','MAIL_AND_IN_STORE')),
  return_fees text
    check (return_fees is null or return_fees in ('FREE','CUSTOMER_RESPONSIBILITY')),
  return_policy_url text,

  warranty_policy_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.commerce_store_settings (id, merchant_name, site_url, currency, country_code)
values (1, 'AMPHON TRADING', 'https://shop.amphon.co.th', 'THB', 'TH')
on conflict (id) do nothing;

drop trigger if exists commerce_store_settings_touch on public.commerce_store_settings;
create trigger commerce_store_settings_touch
before update on public.commerce_store_settings
for each row execute procedure private.touch_commerce_row();

alter table public.commerce_store_settings enable row level security;
revoke all on public.commerce_store_settings from anon;
grant select, update on public.commerce_store_settings to authenticated;

drop policy if exists commerce_store_settings_read_staff on public.commerce_store_settings;
drop policy if exists commerce_store_settings_update_admin on public.commerce_store_settings;

create policy commerce_store_settings_read_staff
on public.commerce_store_settings for select to authenticated
using (public.current_user_active());

create policy commerce_store_settings_update_admin
on public.commerce_store_settings for update to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

-- ------------------------------------------------------------
-- MERCHANT READINESS VIEW FOR STAFF
-- ------------------------------------------------------------

create or replace view public.commerce_merchant_readiness_v
with (security_invoker = true)
as
select
  cl.product_id,
  p.sku,
  p.title,
  p.status as product_status,
  pp.status as website_status,
  cl.merchant_enabled,
  cl.merchant_item_condition,
  cl.index_policy,
  p.price,
  count(pi.id)::int as image_count,
  count(pi.id) filter (where pi.is_cover = true)::int as cover_image_count,
  count(pi.id) filter (where pi.image_role = 'defect')::int as defect_image_count,
  count(pi.id) filter (where pi.image_role = 'accessories')::int as accessory_image_count,
  count(pi.id) filter (where pi.image_role = 'warranty')::int as warranty_image_count,
  (
    p.title is not null and length(trim(p.title)) >= 4
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.merchant_item_condition is not null
    and cl.index_policy = 'INDEX'
  ) as data_ready,
  (
    s.purchase_enabled
    and cl.merchant_enabled
    and pp.status = 'published'
    and p.status = 'published'
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.index_policy = 'INDEX'
  ) as merchant_activation_ready,
  array_remove(array[
    case when p.title is null or length(trim(p.title)) < 4 then 'TITLE' end,
    case when p.price is null or p.price <= 0 then 'PRICE' end,
    case when count(pi.id) filter (where pi.public_url is not null) = 0 then 'IMAGE' end,
    case when cl.merchant_item_condition is null then 'ITEM_CONDITION' end,
    case when cl.index_policy <> 'INDEX' then 'INDEX_POLICY' end,
    case when not s.purchase_enabled then 'PURCHASE_FLOW_DISABLED' end,
    case when not cl.merchant_enabled then 'MERCHANT_DISABLED' end,
    case when pp.status <> 'published' then 'WEBSITE_NOT_PUBLISHED' end,
    case when p.status <> 'published' then 'PRODUCT_NOT_AVAILABLE' end
  ], null) as blockers,
  greatest(p.updated_at, cl.updated_at, pp.updated_at, s.updated_at) as updated_at
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website'
cross join public.commerce_store_settings s
left join public.product_images pi on pi.product_id = p.id
group by cl.product_id, p.sku, p.title, p.status, pp.status, cl.merchant_enabled,
  cl.merchant_item_condition, cl.index_policy, p.price, s.purchase_enabled,
  p.updated_at, cl.updated_at, pp.updated_at, s.updated_at;

revoke all on public.commerce_merchant_readiness_v from anon;
grant select on public.commerce_merchant_readiness_v to authenticated;
grant select on public.commerce_merchant_readiness_v to service_role;

-- ------------------------------------------------------------
-- SERVER-ONLY STORE SETTINGS PROJECTION
-- ------------------------------------------------------------

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  merchant_name,
  legal_name,
  site_url,
  currency,
  country_code,
  purchase_enabled,
  shipping_enabled,
  shipping_country,
  shipping_rate,
  handling_min_days,
  handling_max_days,
  transit_min_days,
  transit_max_days,
  shipping_policy_url,
  return_policy_enabled,
  return_policy_category,
  return_days,
  return_method,
  return_fees,
  return_policy_url,
  warranty_policy_url,
  updated_at
from public.commerce_store_settings
where id = 1;

revoke all on public.commerce_public_store_settings_v from anon;
revoke all on public.commerce_public_store_settings_v from authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- ------------------------------------------------------------
-- EXTEND SERVER-ONLY PUBLIC PRODUCT PROJECTION
-- ------------------------------------------------------------
-- Keep SHOP-2 column order and append SHOP-3 fields at the end so dependent
-- PostgREST clients remain backward compatible.

create or replace view public.commerce_public_listing_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.category as source_category,
  p.subtype as source_subtype,
  p.brand as source_brand,
  p.model as source_model,
  p.title,
  p.status,
  p.condition_percent,
  p.price,
  p.warranty_until,
  p.defects,
  p.specs,
  p.updated_at as product_updated_at,

  cl.slug,
  cl.seo_title,
  cl.seo_description,
  cl.index_policy,
  cl.merchant_enabled,
  cl.google_product_category,
  cl.gtin,
  cl.mpn,

  c.key as category_key,
  c.name_th as category_name_th,
  c.name_en as category_name_en,
  c.slug as category_slug,

  b.name as catalog_brand_name,
  b.slug as catalog_brand_slug,

  s.name as series_name,
  s.slug as series_slug,

  m.model_name as catalog_model_name,
  m.model_code as catalog_model_code,
  m.slug as catalog_model_slug,

  pp.published_at,
  pp.updated_at as publication_updated_at,

  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'url', pi.public_url,
          'role', pi.image_role,
          'isCover', pi.is_cover,
          'sortOrder', pi.sort_order,
          'width', pi.width,
          'height', pi.height
        )
        order by pi.is_cover desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
    ),
    '[]'::jsonb
  ) as images,

  c.id as category_id,
  b.id as catalog_brand_id,
  s.id as series_id,
  m.id as catalog_model_id,

  -- SHOP-3 appended columns.
  cl.merchant_item_condition
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
left join public.commerce_listings cl
  on cl.product_id = p.id
left join public.commerce_categories c
  on c.id = cl.category_id
left join public.commerce_brands b
  on b.id = cl.brand_id
left join public.commerce_series s
  on s.id = cl.series_id
left join public.commerce_models m
  on m.id = cl.model_id
where cl.id is not null
  and (
    (pp.status = 'published' and p.status in ('published','reserved'))
    or (pp.status = 'ended' and p.status = 'sold')
  )
  and p.price is not null
  and p.price > 0;

revoke all on public.commerce_public_listing_v from anon;
revoke all on public.commerce_public_listing_v from authenticated;
grant select on public.commerce_public_listing_v to service_role;

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists commerce_listings_merchant_idx
on public.commerce_listings(merchant_enabled, merchant_item_condition, updated_at desc);
