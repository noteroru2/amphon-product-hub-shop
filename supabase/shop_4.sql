-- AMPHON SHOP — SHOP-4 App Publish Center ↔ Shop Commerce Integration
-- Run after supabase/shop_3.sql. Safe to re-run.
--
-- Goals:
-- 1) Let the authenticated AMPHON app prepare/configure a Shop listing before Website publish.
-- 2) Expose one staff-safe editor projection with taxonomy + Merchant readiness.
-- 3) Keep taxonomy hierarchy valid at the database boundary.
-- 4) Keep checkout/Merchant activation LOCKED until SHOP-5 implements order/reservation checkout.
-- 5) Align Merchant condition values with Google Merchant Center: new / refurbished / used only.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- MERCHANT CONDITION CORRECTION
-- ------------------------------------------------------------
-- SHOP-3 allowed DAMAGED as a Schema.org condition. Google Merchant product data,
-- however, accepts only NEW / REFURBISHED / USED. Physical defects belong in
-- visible defect/condition content; a damaged second-hand item remains USED.

update public.commerce_listings
   set merchant_item_condition = 'USED'
 where merchant_item_condition = 'DAMAGED';

alter table public.commerce_listings
  drop constraint if exists commerce_listings_merchant_item_condition_check;

alter table public.commerce_listings
  add constraint commerce_listings_merchant_item_condition_check
  check (merchant_item_condition in ('NEW','USED','REFURBISHED'));

alter table public.commerce_listings
  drop constraint if exists commerce_listings_gtin_format_check;

alter table public.commerce_listings
  add constraint commerce_listings_gtin_format_check
  check (
    gtin is null
    or btrim(gtin) = ''
    or btrim(gtin) ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
  );

-- ------------------------------------------------------------
-- SHOP-4 PURCHASE ACTIVATION LOCK
-- ------------------------------------------------------------
-- Deliberately blocks accidental Merchant activation before SHOP-5.
-- SHOP-5 must explicitly DROP this constraint when checkout/order reservation
-- is implemented and production-tested.

update public.commerce_store_settings set purchase_enabled = false where id = 1;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop4_purchase_lock;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop4_purchase_lock
  check (purchase_enabled = false);

-- SHOP-3 could have an enabled but partial shipping configuration. Disable it
-- before adding the stronger SHOP-4 completeness invariant; do not fabricate
-- missing shipping rates or delivery windows.
update public.commerce_store_settings
   set shipping_enabled = false
 where shipping_enabled = true
   and (
     shipping_country is null
     or shipping_rate is null
     or handling_min_days is null
     or handling_max_days is null
     or transit_min_days is null
     or transit_max_days is null
   );

-- Old free-form settings may also contain inverted windows. Clear only the
-- invalid pair and disable shipping rather than guessing the intended values.
update public.commerce_store_settings
   set shipping_enabled = false, handling_min_days = null, handling_max_days = null
 where handling_min_days is not null and handling_max_days is not null
   and handling_min_days > handling_max_days;

update public.commerce_store_settings
   set shipping_enabled = false, transit_min_days = null, transit_max_days = null
 where transit_min_days is not null and transit_max_days is not null
   and transit_min_days > transit_max_days;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shipping_day_order_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_shipping_day_order_check
  check (
    (handling_min_days is null or handling_max_days is null or handling_min_days <= handling_max_days)
    and (transit_min_days is null or transit_max_days is null or transit_min_days <= transit_max_days)
  );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shipping_completeness_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_shipping_completeness_check
  check (
    shipping_enabled = false
    or (
      shipping_country is not null
      and shipping_rate is not null
      and handling_min_days is not null
      and handling_max_days is not null
      and transit_min_days is not null
      and transit_max_days is not null
    )
  );

-- Disable legacy incomplete return settings instead of inventing a return
-- window or policy link during migration.
update public.commerce_store_settings
   set return_policy_enabled = false
 where return_policy_enabled = true
   and (
     (return_policy_category = 'FINITE' and return_days is null)
     or (return_policy_category is null and nullif(btrim(return_policy_url), '') is null)
   );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_return_window_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_return_window_check
  check (
    return_policy_enabled = false
    or return_policy_category <> 'FINITE'
    or return_days is not null
  );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_return_completeness_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_return_completeness_check
  check (
    return_policy_enabled = false
    or return_policy_category is not null
    or nullif(btrim(return_policy_url), '') is not null
  );

-- ------------------------------------------------------------
-- TAXONOMY HIERARCHY VALIDATION
-- ------------------------------------------------------------

create or replace function private.validate_commerce_listing_hierarchy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  series_row public.commerce_series%rowtype;
  model_row public.commerce_models%rowtype;
begin
  if new.series_id is not null then
    select * into series_row from public.commerce_series where id = new.series_id and is_active = true;
    if series_row.id is null then raise exception 'INVALID_SERIES'; end if;
    if new.category_id is distinct from series_row.category_id then raise exception 'SERIES_CATEGORY_MISMATCH'; end if;
    if new.brand_id is distinct from series_row.brand_id then raise exception 'SERIES_BRAND_MISMATCH'; end if;
  end if;

  if new.model_id is not null then
    select * into model_row from public.commerce_models where id = new.model_id and is_active = true;
    if model_row.id is null then raise exception 'INVALID_MODEL'; end if;
    if new.category_id is distinct from model_row.category_id then raise exception 'MODEL_CATEGORY_MISMATCH'; end if;
    if new.brand_id is distinct from model_row.brand_id then raise exception 'MODEL_BRAND_MISMATCH'; end if;
    if model_row.series_id is not null and new.series_id is distinct from model_row.series_id then
      raise exception 'MODEL_SERIES_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_commerce_listing_hierarchy() from public;
revoke all on function private.validate_commerce_listing_hierarchy() from anon;
revoke all on function private.validate_commerce_listing_hierarchy() from authenticated;

drop trigger if exists commerce_listings_validate_hierarchy on public.commerce_listings;
create trigger commerce_listings_validate_hierarchy
before insert or update of category_id, brand_id, series_id, model_id
on public.commerce_listings
for each row execute procedure private.validate_commerce_listing_hierarchy();

-- ------------------------------------------------------------
-- PREPARE LISTING RPC
-- ------------------------------------------------------------
-- Allows Publish Center to generate the stable Shop slug and taxonomy mapping
-- before the Website publication row is created. It never publishes the product.

create or replace function public.prepare_commerce_listing(target_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  mapped_category_id uuid;
  listing_id uuid;
begin
  if public.current_user_role() not in ('owner','admin','sales') then
    raise exception 'FORBIDDEN';
  end if;

  select * into p from public.products where id = target_product_id;
  if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

  select c.id into mapped_category_id
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = p.category
     and (c.source_subtype = p.subtype or c.source_subtype is null)
   order by (c.source_subtype is not null) desc, c.is_default_source desc, c.sort_order asc
   limit 1;

  insert into public.commerce_listings (
    product_id, category_id, slug, seo_title, seo_description, index_policy, published_at
  )
  values (
    p.id,
    mapped_category_id,
    private.commerce_slug_base(p.title, p.sku),
    left(p.title || ' มือสอง | AMPHON TRADING', 180),
    left(concat_ws(' ', p.title, case when p.brand is not null then 'แบรนด์ ' || p.brand end,
      'สินค้ามือสองพร้อมข้อมูลสภาพ ราคาและรายละเอียดสินค้าจริงจาก AMPHON TRADING'), 300),
    case when p.status in ('ready_to_list','published','reserved','sold') then 'INDEX' else 'HOLD' end,
    null
  )
  on conflict (product_id) do update
    set category_id = coalesce(public.commerce_listings.category_id, excluded.category_id),
        updated_at = now()
  returning id into listing_id;

  perform private.sync_commerce_listing_taxonomy(p.id);
  return listing_id;
end;
$$;

revoke all on function public.prepare_commerce_listing(uuid) from public;
revoke all on function public.prepare_commerce_listing(uuid) from anon;
grant execute on function public.prepare_commerce_listing(uuid) to authenticated;

-- ------------------------------------------------------------
-- CANONICAL PUBLICATION URL SYNC
-- ------------------------------------------------------------

create or replace function private.sync_website_publication_canonical_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sku_value text;
  shop_origin text;
begin
  select p.sku into sku_value from public.products p where p.id = new.product_id;
  select regexp_replace(s.site_url, '/+$', '') into shop_origin
    from public.commerce_store_settings s where s.id = 1;

  if sku_value is not null and shop_origin is not null then
    update public.product_publications
       set external_url = shop_origin || '/p/' || new.slug || '-' || lower(sku_value) || '/',
           listing_ref = coalesce(listing_ref, sku_value),
           updated_at = now()
     where product_id = new.product_id
       and channel = 'website';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_website_publication_canonical_url() from public;
revoke all on function private.sync_website_publication_canonical_url() from anon;
revoke all on function private.sync_website_publication_canonical_url() from authenticated;

drop trigger if exists commerce_listings_sync_website_url on public.commerce_listings;
create trigger commerce_listings_sync_website_url
after insert or update of slug on public.commerce_listings
for each row execute procedure private.sync_website_publication_canonical_url();

-- Backfill canonical URLs for Website publication history.
update public.product_publications pp
   set external_url = regexp_replace(s.site_url, '/+$', '') || '/p/' || cl.slug || '-' || lower(p.sku) || '/',
       listing_ref = coalesce(pp.listing_ref, p.sku),
       updated_at = now()
  from public.commerce_listings cl
  join public.products p on p.id = cl.product_id
 cross join public.commerce_store_settings s
 where pp.product_id = p.id
   and pp.channel = 'website';

-- ------------------------------------------------------------
-- MERCHANT READINESS: PRE-PUBLISH AWARE
-- ------------------------------------------------------------

create or replace view public.commerce_merchant_readiness_v
with (security_invoker = true)
as
select
  cl.product_id,
  p.sku,
  p.title,
  p.status as product_status,
  coalesce(pp.status, 'not_published') as website_status,
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
    and cl.merchant_item_condition in ('NEW','USED','REFURBISHED')
    and cl.index_policy = 'INDEX'
    and (cl.gtin is null or btrim(cl.gtin) = '' or btrim(cl.gtin) ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$')
  ) as data_ready,
  (
    s.purchase_enabled
    and cl.merchant_enabled
    and pp.status = 'published'
    and p.status = 'published'
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.merchant_item_condition in ('NEW','USED','REFURBISHED')
    and cl.index_policy = 'INDEX'
  ) as merchant_activation_ready,
  array_remove(array[
    case when p.title is null or length(trim(p.title)) < 4 then 'TITLE' end,
    case when p.price is null or p.price <= 0 then 'PRICE' end,
    case when count(pi.id) filter (where pi.public_url is not null) = 0 then 'IMAGE' end,
    case when cl.merchant_item_condition not in ('NEW','USED','REFURBISHED') then 'ITEM_CONDITION' end,
    case when cl.index_policy <> 'INDEX' then 'INDEX_POLICY' end,
    case when cl.gtin is not null and btrim(cl.gtin) <> '' and btrim(cl.gtin) !~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' then 'GTIN_INVALID' end,
    case when not s.purchase_enabled then 'PURCHASE_FLOW_DISABLED' end,
    case when not cl.merchant_enabled then 'MERCHANT_DISABLED' end,
    case when pp.status is null or pp.status <> 'published' then 'WEBSITE_NOT_PUBLISHED' end,
    case when p.status <> 'published' then 'PRODUCT_NOT_AVAILABLE' end
  ], null) as blockers,
  greatest(p.updated_at, cl.updated_at, pp.updated_at, s.updated_at) as updated_at
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
left join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website'
cross join public.commerce_store_settings s
left join public.product_images pi on pi.product_id = p.id
group by cl.product_id, p.sku, p.title, p.status, pp.status, cl.merchant_enabled,
  cl.merchant_item_condition, cl.index_policy, cl.gtin, p.price, s.purchase_enabled,
  p.updated_at, cl.updated_at, pp.updated_at, s.updated_at;

revoke all on public.commerce_merchant_readiness_v from anon;
grant select on public.commerce_merchant_readiness_v to authenticated;
grant select on public.commerce_merchant_readiness_v to service_role;

-- ------------------------------------------------------------
-- STAFF-SAFE COMMERCE EDITOR VIEW
-- ------------------------------------------------------------

create or replace view public.commerce_listing_editor_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.title,
  p.status as product_status,
  cl.id as listing_id,
  cl.slug,
  '/p/' || cl.slug || '-' || lower(p.sku) || '/' as canonical_path,
  cl.category_id,
  c.name_th as category_name,
  cl.brand_id,
  b.name as brand_name,
  cl.series_id,
  s.name as series_name,
  cl.model_id,
  m.model_name,
  cl.seo_title,
  cl.seo_description,
  cl.index_policy,
  cl.merchant_enabled,
  cl.merchant_item_condition,
  cl.google_product_category,
  cl.gtin,
  cl.mpn,
  coalesce(r.website_status, 'not_published') as website_status,
  coalesce(r.data_ready, false) as data_ready,
  coalesce(r.merchant_activation_ready, false) as merchant_activation_ready,
  coalesce(r.blockers, array[]::text[]) as blockers,
  cl.updated_at
from public.products p
join public.commerce_listings cl on cl.product_id = p.id
left join public.commerce_categories c on c.id = cl.category_id
left join public.commerce_brands b on b.id = cl.brand_id
left join public.commerce_series s on s.id = cl.series_id
left join public.commerce_models m on m.id = cl.model_id
left join public.commerce_merchant_readiness_v r on r.product_id = p.id;

revoke all on public.commerce_listing_editor_v from anon;
grant select on public.commerce_listing_editor_v to authenticated;
grant select on public.commerce_listing_editor_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC STORE SETTINGS VIEW: keep server-only, append no secrets.
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
