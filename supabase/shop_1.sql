-- AMPHON SHOP — SHOP-1 Commerce Foundation
-- Run after supabase/batch4_1.sql
-- Safe to re-run.
--
-- Goals:
-- 1) Keep Product Hub as the inventory source of truth.
-- 2) Add durable SEO/catalog entities without copying private inventory data.
-- 3) Keep the public storefront server-only: anon/authenticated do not read these tables directly.
-- 4) Preserve existing website publication lifecycle from product_publications.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- ENUM-LIKE CHECK VALUES
-- ------------------------------------------------------------

-- SEO index lifecycle is text + check to make future migrations explicit.
-- INDEX   = intended to be indexable
-- NOINDEX = public route may exist, but should not be indexed
-- HOLD    = not ready for SEO release yet
-- RETIRED = no longer an active SEO owner

-- ------------------------------------------------------------
-- EVERGREEN TAXONOMY
-- ------------------------------------------------------------

create table if not exists public.commerce_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name_th text not null,
  name_en text,
  slug text not null unique,
  parent_id uuid references public.commerce_categories(id) on delete set null,

  -- Mapping back to Product Hub fields. Multiple SEO categories may share
  -- the same source_category; is_default_source chooses the automatic fallback.
  source_category text,
  source_subtype text,
  source_query text,
  is_default_source boolean not null default false,

  seo_title text,
  seo_description text,
  intro_content text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),

  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_categories_parent_idx
on public.commerce_categories(parent_id, sort_order);

create index if not exists commerce_categories_source_idx
on public.commerce_categories(source_category, source_subtype, is_default_source, sort_order);

create unique index if not exists commerce_categories_one_default_per_source_idx
on public.commerce_categories(source_category)
where is_default_source = true and source_category is not null;

create table if not exists public.commerce_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  seo_title text,
  seo_description text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists commerce_brands_name_ci_uidx
on public.commerce_brands(lower(name));

create table if not exists public.commerce_series (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.commerce_categories(id) on delete restrict,
  brand_id uuid not null references public.commerce_brands(id) on delete restrict,
  name text not null,
  slug text not null,
  seo_title text,
  seo_description text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(category_id, brand_id, slug),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_series_brand_idx
on public.commerce_series(category_id, brand_id, is_active);

create table if not exists public.commerce_models (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.commerce_categories(id) on delete restrict,
  brand_id uuid not null references public.commerce_brands(id) on delete restrict,
  series_id uuid references public.commerce_series(id) on delete set null,

  model_name text not null,
  model_code text,
  slug text not null,
  launch_year integer,
  generation text,
  canonical_specs jsonb not null default '{}'::jsonb,

  seo_title text,
  seo_description text,
  seo_content text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(category_id, brand_id, slug),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_models_series_idx
on public.commerce_models(category_id, brand_id, series_id, is_active);

-- ------------------------------------------------------------
-- PRODUCT -> STOREFRONT LISTING METADATA
-- ------------------------------------------------------------
-- Price/specs/condition/images/status remain on Product Hub tables.
-- This table owns only stable public URL + SEO/catalog relationships.

create table if not exists public.commerce_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,

  category_id uuid references public.commerce_categories(id) on delete set null,
  brand_id uuid references public.commerce_brands(id) on delete set null,
  series_id uuid references public.commerce_series(id) on delete set null,
  model_id uuid references public.commerce_models(id) on delete set null,

  -- Immutable once generated. Canonical URL is /p/{slug}-{sku-lower}/
  slug text not null,

  seo_title text,
  seo_description text,
  index_policy text not null default 'INDEX'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),

  merchant_enabled boolean not null default false,
  google_product_category text,
  gtin text,
  mpn text,

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_listings_category_idx
on public.commerce_listings(category_id, updated_at desc);

create index if not exists commerce_listings_model_idx
on public.commerce_listings(model_id, updated_at desc);

create index if not exists commerce_listings_index_policy_idx
on public.commerce_listings(index_policy, updated_at desc);

-- ------------------------------------------------------------
-- INTERNAL HELPERS
-- ------------------------------------------------------------

create or replace function private.commerce_slug_base(input_title text, input_sku text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from lower(
        regexp_replace(
          regexp_replace(coalesce(input_title, ''), '[^A-Za-z0-9]+', '-', 'g'),
          '-+', '-', 'g'
        )
      )),
      ''
    ),
    'item'
  );
$$;

revoke all on function private.commerce_slug_base(text, text) from public;
revoke all on function private.commerce_slug_base(text, text) from anon;
revoke all on function private.commerce_slug_base(text, text) from authenticated;

create or replace function private.touch_commerce_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_commerce_row() from public;
revoke all on function private.touch_commerce_row() from anon;
revoke all on function private.touch_commerce_row() from authenticated;

drop trigger if exists commerce_categories_touch on public.commerce_categories;
create trigger commerce_categories_touch
before update on public.commerce_categories
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_brands_touch on public.commerce_brands;
create trigger commerce_brands_touch
before update on public.commerce_brands
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_series_touch on public.commerce_series;
create trigger commerce_series_touch
before update on public.commerce_series
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_models_touch on public.commerce_models;
create trigger commerce_models_touch
before update on public.commerce_models
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_listings_touch on public.commerce_listings;
create trigger commerce_listings_touch
before update on public.commerce_listings
for each row execute procedure private.touch_commerce_row();

-- Automatically create storefront metadata the first time Website is published.
-- Existing slug is NEVER rewritten on later product-title edits.
create or replace function private.ensure_commerce_listing_for_website()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_row public.products%rowtype;
  mapped_category_id uuid;
begin
  if new.channel <> 'website' or new.status <> 'published' then
    return new;
  end if;

  select *
    into product_row
    from public.products
   where id = new.product_id;

  if product_row.id is null then
    return new;
  end if;

  select c.id
    into mapped_category_id
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = product_row.category
     and (
       c.source_subtype = product_row.subtype
       or c.source_subtype is null
     )
   order by
     (c.source_subtype is not null) desc,
     c.is_default_source desc,
     c.sort_order asc
   limit 1;

  insert into public.commerce_listings (
    product_id,
    category_id,
    slug,
    seo_title,
    seo_description,
    index_policy,
    published_at
  )
  values (
    product_row.id,
    mapped_category_id,
    private.commerce_slug_base(product_row.title, product_row.sku),
    left(product_row.title || ' มือสอง | AMPHON TRADING', 180),
    left(
      concat_ws(
        ' ',
        product_row.title,
        case when product_row.brand is not null then 'แบรนด์ ' || product_row.brand end,
        'สินค้ามือสองพร้อมข้อมูลสภาพ ราคาและรายละเอียดสินค้าจริงจาก AMPHON TRADING'
      ),
      300
    ),
    'INDEX',
    coalesce(new.published_at, now())
  )
  on conflict (product_id) do update
    set category_id = coalesce(public.commerce_listings.category_id, excluded.category_id),
        published_at = coalesce(public.commerce_listings.published_at, excluded.published_at),
        updated_at = now();

  return new;
end;
$$;

revoke all on function private.ensure_commerce_listing_for_website() from public;
revoke all on function private.ensure_commerce_listing_for_website() from anon;
revoke all on function private.ensure_commerce_listing_for_website() from authenticated;

drop trigger if exists product_publications_ensure_commerce_listing on public.product_publications;
create trigger product_publications_ensure_commerce_listing
after insert or update of status, published_at on public.product_publications
for each row execute procedure private.ensure_commerce_listing_for_website();

-- Backfill listings for Website publications already live.
insert into public.commerce_listings (
  product_id,
  category_id,
  slug,
  seo_title,
  seo_description,
  index_policy,
  published_at
)
select
  p.id,
  (
    select c.id
      from public.commerce_categories c
     where c.is_active = true
       and c.source_category = p.category
       and (c.source_subtype = p.subtype or c.source_subtype is null)
     order by
       (c.source_subtype is not null) desc,
       c.is_default_source desc,
       c.sort_order asc
     limit 1
  ),
  private.commerce_slug_base(p.title, p.sku),
  left(p.title || ' มือสอง | AMPHON TRADING', 180),
  left(
    concat_ws(
      ' ',
      p.title,
      case when p.brand is not null then 'แบรนด์ ' || p.brand end,
      'สินค้ามือสองพร้อมข้อมูลสภาพ ราคาและรายละเอียดสินค้าจริงจาก AMPHON TRADING'
    ),
    300
  ),
  'INDEX',
  coalesce(pp.published_at, now())
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
 and (
   pp.status = 'published'
   or (pp.status = 'ended' and p.status = 'sold')
 )
on conflict (product_id) do nothing;

-- ------------------------------------------------------------
-- RLS / GRANTS
-- ------------------------------------------------------------

alter table public.commerce_categories enable row level security;
alter table public.commerce_brands enable row level security;
alter table public.commerce_series enable row level security;
alter table public.commerce_models enable row level security;
alter table public.commerce_listings enable row level security;

-- Storefront browser must never query these directly.
revoke all on public.commerce_categories from anon;
revoke all on public.commerce_brands from anon;
revoke all on public.commerce_series from anon;
revoke all on public.commerce_models from anon;
revoke all on public.commerce_listings from anon;

-- Staff can read taxonomy/listing metadata from Product Hub in future batches.
grant select on public.commerce_categories to authenticated;
grant select on public.commerce_brands to authenticated;
grant select on public.commerce_series to authenticated;
grant select on public.commerce_models to authenticated;
grant select on public.commerce_listings to authenticated;

-- Owner/Admin manage taxonomy; Owner/Admin/Sales may maintain listing metadata.
grant insert, update, delete on public.commerce_categories to authenticated;
grant insert, update, delete on public.commerce_brands to authenticated;
grant insert, update, delete on public.commerce_series to authenticated;
grant insert, update, delete on public.commerce_models to authenticated;
grant insert, update on public.commerce_listings to authenticated;

drop policy if exists commerce_categories_read_staff on public.commerce_categories;
drop policy if exists commerce_categories_write_admin on public.commerce_categories;
drop policy if exists commerce_brands_read_staff on public.commerce_brands;
drop policy if exists commerce_brands_write_admin on public.commerce_brands;
drop policy if exists commerce_series_read_staff on public.commerce_series;
drop policy if exists commerce_series_write_admin on public.commerce_series;
drop policy if exists commerce_models_read_staff on public.commerce_models;
drop policy if exists commerce_models_write_admin on public.commerce_models;
drop policy if exists commerce_listings_read_staff on public.commerce_listings;
drop policy if exists commerce_listings_insert_sales on public.commerce_listings;
drop policy if exists commerce_listings_update_sales on public.commerce_listings;

create policy commerce_categories_read_staff
on public.commerce_categories for select to authenticated
using (public.current_user_active());

create policy commerce_categories_write_admin
on public.commerce_categories for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_brands_read_staff
on public.commerce_brands for select to authenticated
using (public.current_user_active());

create policy commerce_brands_write_admin
on public.commerce_brands for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_series_read_staff
on public.commerce_series for select to authenticated
using (public.current_user_active());

create policy commerce_series_write_admin
on public.commerce_series for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_models_read_staff
on public.commerce_models for select to authenticated
using (public.current_user_active());

create policy commerce_models_write_admin
on public.commerce_models for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_listings_read_staff
on public.commerce_listings for select to authenticated
using (public.current_user_active());

create policy commerce_listings_insert_sales
on public.commerce_listings for insert to authenticated
with check (public.current_user_role() in ('owner','admin','sales'));

create policy commerce_listings_update_sales
on public.commerce_listings for update to authenticated
using (public.current_user_role() in ('owner','admin','sales'))
with check (public.current_user_role() in ('owner','admin','sales'));

-- ------------------------------------------------------------
-- SAFE SERVER-ONLY PROJECTION
-- ------------------------------------------------------------
-- security_invoker protects the view if grants are ever changed accidentally.
-- service_role still sees all intended rows; anon/authenticated are explicitly revoked.

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
  ) as images
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
-- CATEGORY SEED — SHOP-0 BASELINE
-- ------------------------------------------------------------

insert into public.commerce_categories (
  key, name_th, name_en, slug,
  source_category, source_subtype, source_query, is_default_source,
  seo_title, seo_description, index_policy, sort_order, is_active
)
values
  (
    'notebooks', 'โน้ตบุ๊กมือสอง', 'Used Notebooks', 'notebooks',
    'notebook', null, null, true,
    'โน้ตบุ๊กมือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อโน้ตบุ๊กมือสองจาก AMPHON TRADING ดูรูป สเปก ราคา สภาพและประกันของสินค้าจริงก่อนสั่งซื้อ',
    'INDEX', 10, true
  ),
  (
    'macbooks', 'MacBook มือสอง', 'Used MacBooks', 'macbooks',
    'notebook', null, 'MacBook', false,
    'MacBook มือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อ MacBook มือสอง ดูรูปจริง สเปก ราคา สภาพและประกันจาก AMPHON TRADING',
    'HOLD', 20, true
  ),
  (
    'desktop-pcs', 'คอมพิวเตอร์มือสอง', 'Used Desktop PCs', 'desktop-pcs',
    'pc', null, null, true,
    'คอมพิวเตอร์มือสอง พร้อมใช้งาน | AMPHON TRADING',
    'คอมพิวเตอร์ตั้งโต๊ะมือสองและชุด PC พร้อมดูสเปก ราคา รูปจริงและสถานะสินค้าก่อนสั่งซื้อ',
    'INDEX', 30, true
  ),
  (
    'gaming-pcs', 'คอมเกมมิ่งมือสอง', 'Used Gaming PCs', 'gaming-pcs',
    'pc', 'gaming', null, false,
    'คอมเกมมิ่งมือสอง สเปกคุ้ม | AMPHON TRADING',
    'เลือกซื้อ PC Gaming มือสอง ดู CPU การ์ดจอ RAM SSD ราคาและรูปสินค้าจริง',
    'HOLD', 40, true
  ),
  (
    'iphones', 'iPhone มือสอง', 'Used iPhones', 'iphones',
    'iphone', null, null, true,
    'iPhone มือสอง ดูเครื่องจริงและราคา | AMPHON TRADING',
    'เลือกซื้อ iPhone มือสอง ดูรุ่น ความจุ สภาพ ราคา รูปสินค้าจริงและรายละเอียดก่อนซื้อ',
    'INDEX', 50, true
  ),
  (
    'smartphones', 'มือถือมือสอง', 'Used Smartphones', 'smartphones',
    'smartphone', null, null, true,
    'มือถือมือสอง Android พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อมือถือ Android มือสองจากสินค้าจริง พร้อมสเปก ราคา สภาพและรูปประกอบ',
    'INDEX', 60, true
  ),
  (
    'tablets', 'iPad และ Tablet มือสอง', 'Used Tablets', 'tablets',
    'tablet', null, null, true,
    'iPad และ Tablet มือสอง | AMPHON TRADING',
    'เลือกซื้อ iPad และ Tablet มือสอง ดูรุ่น ความจุ สภาพ ราคาและรูปสินค้าจริง',
    'INDEX', 70, true
  ),
  (
    'monitors', 'จอคอมมือสอง', 'Used Monitors', 'monitors',
    'monitor', null, null, true,
    'จอคอมมือสอง พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อจอคอมมือสอง ดูขนาด ความละเอียด รีเฟรชเรต ราคาและรูปสินค้าจริง',
    'INDEX', 80, true
  ),
  (
    'cameras', 'กล้องมือสอง', 'Used Cameras', 'cameras',
    'camera', null, null, true,
    'กล้องมือสอง Mirrorless DSLR | AMPHON TRADING',
    'เลือกซื้อกล้องมือสอง ดูบอดี้ เลนส์ สภาพ ราคาและรูปสินค้าจริงจาก AMPHON TRADING',
    'INDEX', 90, true
  ),
  (
    'gaming-consoles', 'เครื่องเกมมือสอง', 'Used Game Consoles', 'gaming-consoles',
    'gaming', null, null, true,
    'เครื่องเกมมือสอง PS5 Nintendo Switch | AMPHON TRADING',
    'เลือกซื้อเครื่องเกมมือสอง ดูรุ่น อุปกรณ์ สภาพ ราคาและรูปสินค้าจริง',
    'INDEX', 100, true
  ),
  (
    'camera-lenses', 'เลนส์กล้องมือสอง', 'Used Camera Lenses', 'camera-lenses',
    'lens', null, null, true,
    'เลนส์กล้องมือสอง | AMPHON TRADING',
    'เลือกซื้อเลนส์กล้องมือสอง ดูรุ่น เมาท์ สภาพ ราคาและรูปสินค้าจริง',
    'HOLD', 105, true
  ),
  (
    'graphics-cards', 'การ์ดจอมือสอง', 'Used Graphics Cards', 'graphics-cards',
    'component', null, null, false,
    'การ์ดจอมือสอง NVIDIA AMD | AMPHON TRADING',
    'รวมการ์ดจอมือสองสำหรับคอมพิวเตอร์และเกมมิ่ง พร้อมดูรุ่น ราคาและสภาพจริง',
    'HOLD', 110, true
  ),
  (
    'pc-components', 'อุปกรณ์คอมมือสอง', 'Used PC Components', 'pc-components',
    'component', null, null, true,
    'อุปกรณ์คอมมือสอง | AMPHON TRADING',
    'เลือกซื้ออุปกรณ์คอมพิวเตอร์มือสองจากสินค้าจริง พร้อมราคา สเปกและสภาพสินค้า',
    'HOLD', 120, true
  ),
  (
    'accessories', 'อุปกรณ์ไอทีมือสอง', 'Used IT Accessories', 'accessories',
    'accessory', null, null, true,
    'อุปกรณ์ไอทีมือสอง | AMPHON TRADING',
    'รวมอุปกรณ์ไอทีมือสองจากสินค้าจริง พร้อมราคาและรายละเอียดก่อนสั่งซื้อ',
    'HOLD', 130, true
  ),
  (
    'other-it', 'สินค้าไอทีมือสองอื่น ๆ', 'Other Used IT', 'other-it',
    'other', null, null, true,
    'สินค้าไอทีมือสองอื่น ๆ | AMPHON TRADING',
    'สินค้าไอทีมือสองประเภทอื่นจากสต๊อกจริงของ AMPHON TRADING',
    'HOLD', 140, true
  )
on conflict (key) do update
set
  name_th = excluded.name_th,
  name_en = excluded.name_en,
  slug = excluded.slug,
  source_category = excluded.source_category,
  source_subtype = excluded.source_subtype,
  source_query = excluded.source_query,
  is_default_source = excluded.is_default_source,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  index_policy = excluded.index_policy,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

-- Backfill category_id again after seed for any listing created earlier in this migration.
-- Keep this as a correlated subquery so it is valid across supported PostgreSQL versions.
update public.commerce_listings cl
set category_id = (
      select c.id
      from public.products p
      join public.commerce_categories c
        on c.is_active = true
       and c.source_category = p.category
       and (c.source_subtype = p.subtype or c.source_subtype is null)
      where p.id = cl.product_id
      order by
        (c.source_subtype is not null) desc,
        c.is_default_source desc,
        c.sort_order asc
      limit 1
    ),
    updated_at = now()
where cl.category_id is null;
