-- AMPHON SHOP — SHOP-2 Brand / Series / Model Evergreen SEO Architecture
-- Run after supabase/shop_1.sql
-- Safe to re-run.
--
-- Principles:
-- 1) Brand identity is global, but Brand SEO pages are category-specific.
-- 2) Series and Model pages are curated evergreen assets, never auto-indexed from raw product text.
-- 3) Raw stock fields may create HOLD taxonomy candidates, but INDEX remains an explicit editorial decision.
-- 4) Product listing mappings are deterministic and exact/alias-based; no fuzzy SEO taxonomy assignment.
-- 5) Public storefront reads only server-side views through the Store API.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- CONTENT FIELDS FOR EVERGREEN ENTITIES
-- ------------------------------------------------------------

alter table public.commerce_brands add column if not exists sort_order integer not null default 100;

alter table public.commerce_series add column if not exists seo_h1 text;
alter table public.commerce_series add column if not exists intro_content text;
alter table public.commerce_series add column if not exists editorial_content text;
alter table public.commerce_series add column if not exists faq jsonb not null default '[]'::jsonb;
alter table public.commerce_series add column if not exists primary_keyword text;
alter table public.commerce_series add column if not exists sort_order integer not null default 100;

alter table public.commerce_models add column if not exists seo_h1 text;
alter table public.commerce_models add column if not exists intro_content text;
alter table public.commerce_models add column if not exists faq jsonb not null default '[]'::jsonb;
alter table public.commerce_models add column if not exists primary_keyword text;
alter table public.commerce_models add column if not exists sort_order integer not null default 100;

-- SHOP-1 kept SEO fields on commerce_brands. Those columns remain for backward
-- compatibility, but category-specific SEO ownership moves to commerce_brand_pages.
create table if not exists public.commerce_brand_pages (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.commerce_categories(id) on delete cascade,
  brand_id uuid not null references public.commerce_brands(id) on delete cascade,

  seo_title text,
  seo_description text,
  seo_h1 text,
  primary_keyword text,
  intro_content text,
  editorial_content text,
  faq jsonb not null default '[]'::jsonb,

  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  sort_order integer not null default 100,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(category_id, brand_id)
);

create index if not exists commerce_brand_pages_category_idx
on public.commerce_brand_pages(category_id, index_policy, sort_order);

-- Explicit aliases allow Product Hub labels to map to canonical identities
-- without risky fuzzy matching. Example: "Hewlett Packard" -> HP.
create table if not exists public.commerce_brand_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.commerce_brands(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists commerce_brand_aliases_alias_ci_uidx
on public.commerce_brand_aliases(lower(alias));

create table if not exists public.commerce_model_aliases (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.commerce_models(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  unique(model_id, alias)
);

create unique index if not exists commerce_model_aliases_model_alias_ci_uidx
on public.commerce_model_aliases(model_id, lower(alias));

create index if not exists commerce_model_aliases_lookup_idx
on public.commerce_model_aliases(lower(alias));

-- ------------------------------------------------------------
-- TOUCH TRIGGERS
-- ------------------------------------------------------------

drop trigger if exists commerce_brand_pages_touch on public.commerce_brand_pages;
create trigger commerce_brand_pages_touch
before update on public.commerce_brand_pages
for each row execute procedure private.touch_commerce_row();

-- ------------------------------------------------------------
-- SAFE ASCII SLUG + BRAND BOOTSTRAP
-- ------------------------------------------------------------

create or replace function private.commerce_ascii_slug(input_value text)
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
          regexp_replace(coalesce(input_value, ''), '[^A-Za-z0-9]+', '-', 'g'),
          '-+', '-', 'g'
        )
      )),
      ''
    ),
    'item'
  );
$$;

revoke all on function private.commerce_ascii_slug(text) from public;
revoke all on function private.commerce_ascii_slug(text) from anon;
revoke all on function private.commerce_ascii_slug(text) from authenticated;

create or replace function private.ensure_commerce_brand(input_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(trim(input_name), '');
  found_id uuid;
  base_slug text;
  chosen_slug text;
begin
  if cleaned is null then
    return null;
  end if;

  select b.id into found_id
    from public.commerce_brands b
   where lower(b.name) = lower(cleaned)
      or exists (
        select 1 from public.commerce_brand_aliases ba
         where ba.brand_id = b.id and lower(ba.alias) = lower(cleaned)
      )
   order by (lower(b.name) = lower(cleaned)) desc
   limit 1;

  if found_id is not null then
    return found_id;
  end if;

  base_slug := private.commerce_ascii_slug(cleaned);
  chosen_slug := base_slug;

  if exists (select 1 from public.commerce_brands b where b.slug = chosen_slug) then
    chosen_slug := base_slug || '-' || substr(md5(lower(cleaned)), 1, 6);
  end if;

  insert into public.commerce_brands(name, slug, index_policy)
  values (cleaned, chosen_slug, 'HOLD')
  on conflict do nothing
  returning id into found_id;

  if found_id is null then
    select b.id into found_id
      from public.commerce_brands b
     where lower(b.name) = lower(cleaned)
     limit 1;
  end if;

  return found_id;
end;
$$;

revoke all on function private.ensure_commerce_brand(text) from public;
revoke all on function private.ensure_commerce_brand(text) from anon;
revoke all on function private.ensure_commerce_brand(text) from authenticated;

-- ------------------------------------------------------------
-- DETERMINISTIC PRODUCT -> TAXONOMY MAPPING
-- ------------------------------------------------------------

create or replace function private.sync_commerce_listing_taxonomy(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  cl public.commerce_listings%rowtype;
  resolved_category uuid;
  resolved_brand uuid;
  resolved_model uuid;
  resolved_series uuid;
begin
  select * into p from public.products where id = target_product_id;
  if p.id is null then return; end if;

  select * into cl from public.commerce_listings where product_id = target_product_id;
  if cl.id is null then return; end if;

  select c.id into resolved_category
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = p.category
     and (c.source_subtype = p.subtype or c.source_subtype is null)
   order by (c.source_subtype is not null) desc, c.is_default_source desc, c.sort_order asc
   limit 1;

  resolved_category := coalesce(resolved_category, cl.category_id);
  resolved_brand := private.ensure_commerce_brand(p.brand);

  if resolved_category is not null and resolved_brand is not null then
    insert into public.commerce_brand_pages(category_id, brand_id, index_policy)
    values (resolved_category, resolved_brand, 'HOLD')
    on conflict (category_id, brand_id) do nothing;
  end if;

  if resolved_category is not null and resolved_brand is not null and nullif(trim(p.model), '') is not null then
    select m.id, m.series_id
      into resolved_model, resolved_series
      from public.commerce_models m
     where m.is_active = true
       and m.category_id = resolved_category
       and m.brand_id = resolved_brand
       and (
         lower(m.model_name) = lower(trim(p.model))
         or (m.model_code is not null and lower(m.model_code) = lower(trim(p.model)))
         or exists (
           select 1 from public.commerce_model_aliases ma
            where ma.model_id = m.id and lower(ma.alias) = lower(trim(p.model))
         )
       )
     order by
       (lower(m.model_name) = lower(trim(p.model))) desc,
       (m.model_code is not null and lower(m.model_code) = lower(trim(p.model))) desc,
       m.updated_at desc
     limit 1;
  end if;

  -- Keep a manually assigned series only when it still belongs to the resolved
  -- category + brand. A resolved model always owns the series relationship.
  if resolved_model is null and cl.series_id is not null and exists (
    select 1 from public.commerce_series s
     where s.id = cl.series_id
       and s.category_id = resolved_category
       and s.brand_id = resolved_brand
       and s.is_active = true
  ) then
    resolved_series := cl.series_id;
  end if;

  update public.commerce_listings
     set category_id = resolved_category,
         brand_id = resolved_brand,
         series_id = resolved_series,
         model_id = resolved_model,
         updated_at = now()
   where product_id = target_product_id;
end;
$$;

revoke all on function private.sync_commerce_listing_taxonomy(uuid) from public;
revoke all on function private.sync_commerce_listing_taxonomy(uuid) from anon;
revoke all on function private.sync_commerce_listing_taxonomy(uuid) from authenticated;

create or replace function private.product_sync_commerce_taxonomy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_commerce_listing_taxonomy(new.id);
  return new;
end;
$$;

revoke all on function private.product_sync_commerce_taxonomy_trigger() from public;
revoke all on function private.product_sync_commerce_taxonomy_trigger() from anon;
revoke all on function private.product_sync_commerce_taxonomy_trigger() from authenticated;

drop trigger if exists products_sync_commerce_taxonomy on public.products;
create trigger products_sync_commerce_taxonomy
after update of category, subtype, brand, model on public.products
for each row execute procedure private.product_sync_commerce_taxonomy_trigger();

create or replace function private.listing_sync_commerce_taxonomy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_commerce_listing_taxonomy(new.product_id);
  return new;
end;
$$;

revoke all on function private.listing_sync_commerce_taxonomy_trigger() from public;
revoke all on function private.listing_sync_commerce_taxonomy_trigger() from anon;
revoke all on function private.listing_sync_commerce_taxonomy_trigger() from authenticated;

drop trigger if exists commerce_listings_sync_taxonomy_after_insert on public.commerce_listings;
create trigger commerce_listings_sync_taxonomy_after_insert
after insert on public.commerce_listings
for each row execute procedure private.listing_sync_commerce_taxonomy_trigger();

-- Admin RPC for remapping after creating/editing Series, Models or aliases.
create or replace function public.refresh_commerce_taxonomy_mappings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  affected integer := 0;
begin
  if public.current_user_role() not in ('owner','admin') then
    raise exception 'FORBIDDEN';
  end if;

  for item in select product_id from public.commerce_listings loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
    affected := affected + 1;
  end loop;

  return affected;
end;
$$;

revoke all on function public.refresh_commerce_taxonomy_mappings() from public;
revoke all on function public.refresh_commerce_taxonomy_mappings() from anon;
grant execute on function public.refresh_commerce_taxonomy_mappings() to authenticated;

-- Bootstrap and map every listing that already existed before SHOP-2.
do $$
declare
  item record;
begin
  for item in select product_id from public.commerce_listings loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- RLS / GRANTS FOR NEW TABLES
-- ------------------------------------------------------------

alter table public.commerce_brand_pages enable row level security;
alter table public.commerce_brand_aliases enable row level security;
alter table public.commerce_model_aliases enable row level security;

revoke all on public.commerce_brand_pages from anon;
revoke all on public.commerce_brand_aliases from anon;
revoke all on public.commerce_model_aliases from anon;

grant select, insert, update, delete on public.commerce_brand_pages to authenticated;
grant select, insert, update, delete on public.commerce_brand_aliases to authenticated;
grant select, insert, update, delete on public.commerce_model_aliases to authenticated;

drop policy if exists commerce_brand_pages_read_staff on public.commerce_brand_pages;
drop policy if exists commerce_brand_pages_write_admin on public.commerce_brand_pages;
drop policy if exists commerce_brand_aliases_read_staff on public.commerce_brand_aliases;
drop policy if exists commerce_brand_aliases_write_admin on public.commerce_brand_aliases;
drop policy if exists commerce_model_aliases_read_staff on public.commerce_model_aliases;
drop policy if exists commerce_model_aliases_write_admin on public.commerce_model_aliases;

create policy commerce_brand_pages_read_staff
on public.commerce_brand_pages for select to authenticated
using (public.current_user_active());

create policy commerce_brand_pages_write_admin
on public.commerce_brand_pages for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_brand_aliases_read_staff
on public.commerce_brand_aliases for select to authenticated
using (public.current_user_active());

create policy commerce_brand_aliases_write_admin
on public.commerce_brand_aliases for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_model_aliases_read_staff
on public.commerce_model_aliases for select to authenticated
using (public.current_user_active());

create policy commerce_model_aliases_write_admin
on public.commerce_model_aliases for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

-- ------------------------------------------------------------
-- EVERGREEN SEO SERVER-ONLY VIEW
-- ------------------------------------------------------------
-- Effective INDEX requires both editorial readiness and valid hierarchy.
-- HOLD/NOINDEX entities can exist in the database without becoming crawl targets.

create or replace view public.commerce_evergreen_page_v
with (security_invoker = true)
as
with listing_state as (
  select
    cl.category_id,
    cl.brand_id,
    cl.series_id,
    cl.model_id,
    p.id as product_id,
    p.status,
    pp.status as publication_status,
    (pp.status = 'published' and p.status in ('published','reserved')) as is_current
  from public.commerce_listings cl
  join public.products p on p.id = cl.product_id
  join public.product_publications pp
    on pp.product_id = p.id and pp.channel = 'website'
),
brand_rows as (
  select
    'BRAND'::text as page_type,
    bp.id as entity_id,
    c.id as category_id,
    c.key as category_key,
    c.name_th as category_name,
    c.slug as category_slug,
    c.index_policy as category_index_policy,
    b.id as brand_id,
    b.name as brand_name,
    b.slug as brand_slug,
    null::uuid as series_id,
    null::text as series_name,
    null::text as series_slug,
    null::uuid as model_id,
    null::text as model_name,
    null::text as model_code,
    null::text as model_slug,
    bp.seo_title,
    bp.seo_description,
    bp.seo_h1,
    bp.primary_keyword,
    bp.intro_content,
    bp.editorial_content,
    bp.faq,
    bp.index_policy,
    bp.is_active,
    bp.sort_order,
    '/' || c.slug || '/' || b.slug || '/' as canonical_path,
    (select count(*)::int from listing_state ls where ls.category_id = c.id and ls.brand_id = b.id and ls.is_current) as current_stock_count,
    (select count(*)::int from listing_state ls where ls.category_id = c.id and ls.brand_id = b.id) as historical_listing_count,
    bp.updated_at
  from public.commerce_brand_pages bp
  join public.commerce_categories c on c.id = bp.category_id and c.is_active = true
  join public.commerce_brands b on b.id = bp.brand_id and b.is_active = true
),
series_rows as (
  select
    'SERIES'::text as page_type,
    s.id as entity_id,
    c.id as category_id,
    c.key as category_key,
    c.name_th as category_name,
    c.slug as category_slug,
    c.index_policy as category_index_policy,
    b.id as brand_id,
    b.name as brand_name,
    b.slug as brand_slug,
    s.id as series_id,
    s.name as series_name,
    s.slug as series_slug,
    null::uuid as model_id,
    null::text as model_name,
    null::text as model_code,
    null::text as model_slug,
    s.seo_title,
    s.seo_description,
    s.seo_h1,
    s.primary_keyword,
    s.intro_content,
    s.editorial_content,
    s.faq,
    s.index_policy,
    s.is_active,
    s.sort_order,
    '/' || c.slug || '/' || b.slug || '/' || s.slug || '/' as canonical_path,
    (select count(*)::int from listing_state ls where ls.series_id = s.id and ls.is_current) as current_stock_count,
    (select count(*)::int from listing_state ls where ls.series_id = s.id) as historical_listing_count,
    s.updated_at
  from public.commerce_series s
  join public.commerce_categories c on c.id = s.category_id and c.is_active = true
  join public.commerce_brands b on b.id = s.brand_id and b.is_active = true
  join public.commerce_brand_pages bp
    on bp.category_id = s.category_id and bp.brand_id = s.brand_id and bp.is_active = true
),
model_rows as (
  select
    'MODEL'::text as page_type,
    m.id as entity_id,
    c.id as category_id,
    c.key as category_key,
    c.name_th as category_name,
    c.slug as category_slug,
    c.index_policy as category_index_policy,
    b.id as brand_id,
    b.name as brand_name,
    b.slug as brand_slug,
    s.id as series_id,
    s.name as series_name,
    s.slug as series_slug,
    m.id as model_id,
    m.model_name,
    m.model_code,
    m.slug as model_slug,
    m.seo_title,
    m.seo_description,
    m.seo_h1,
    m.primary_keyword,
    m.intro_content,
    m.seo_content as editorial_content,
    m.faq,
    m.index_policy,
    m.is_active,
    m.sort_order,
    '/' || c.slug || '/' || b.slug || '/' || s.slug || '/' || m.slug || '/' as canonical_path,
    (select count(*)::int from listing_state ls where ls.model_id = m.id and ls.is_current) as current_stock_count,
    (select count(*)::int from listing_state ls where ls.model_id = m.id) as historical_listing_count,
    m.updated_at
  from public.commerce_models m
  join public.commerce_categories c on c.id = m.category_id and c.is_active = true
  join public.commerce_brands b on b.id = m.brand_id and b.is_active = true
  join public.commerce_series s on s.id = m.series_id and s.is_active = true
  join public.commerce_brand_pages bp
    on bp.category_id = m.category_id and bp.brand_id = m.brand_id and bp.is_active = true
),
all_rows as (
  select * from brand_rows
  union all
  select * from series_rows
  union all
  select * from model_rows
),
readiness as (
  select
    r.*,
    (
      r.is_active
      and r.category_index_policy = 'INDEX'
      and r.index_policy = 'INDEX'
      and nullif(trim(r.seo_title), '') is not null
      and char_length(trim(r.seo_title)) between 20 and 180
      and nullif(trim(r.seo_description), '') is not null
      and char_length(trim(r.seo_description)) between 60 and 320
      and nullif(trim(r.seo_h1), '') is not null
      and coalesce(char_length(trim(r.intro_content)), 0) >= 120
      and r.historical_listing_count >= 1
      and (
        r.current_stock_count > 0
        or coalesce(char_length(trim(r.editorial_content)), 0) >= 400
      )
    ) as base_seo_ready
  from all_rows r
)
select
  r.*,
  case
    when r.page_type = 'BRAND' then r.base_seo_ready
    when r.page_type = 'SERIES' then r.base_seo_ready and exists (
      select 1 from readiness parent
       where parent.page_type = 'BRAND'
         and parent.category_id = r.category_id
         and parent.brand_id = r.brand_id
         and parent.base_seo_ready
    )
    when r.page_type = 'MODEL' then r.base_seo_ready and exists (
      select 1 from readiness parent
       where parent.page_type = 'SERIES'
         and parent.series_id = r.series_id
         and parent.base_seo_ready
    ) and exists (
      select 1 from readiness parent
       where parent.page_type = 'BRAND'
         and parent.category_id = r.category_id
         and parent.brand_id = r.brand_id
         and parent.base_seo_ready
    )
    else false
  end as seo_ready,
  case
    when r.index_policy = 'NOINDEX' then 'NOINDEX'
    when r.index_policy = 'RETIRED' then 'RETIRED'
    when (
      case
        when r.page_type = 'BRAND' then r.base_seo_ready
        when r.page_type = 'SERIES' then r.base_seo_ready and exists (
          select 1 from readiness parent
           where parent.page_type = 'BRAND'
             and parent.category_id = r.category_id
             and parent.brand_id = r.brand_id
             and parent.base_seo_ready
        )
        when r.page_type = 'MODEL' then r.base_seo_ready and exists (
          select 1 from readiness parent
           where parent.page_type = 'SERIES'
             and parent.series_id = r.series_id
             and parent.base_seo_ready
        ) and exists (
          select 1 from readiness parent
           where parent.page_type = 'BRAND'
             and parent.category_id = r.category_id
             and parent.brand_id = r.brand_id
             and parent.base_seo_ready
        )
        else false
      end
    ) then 'INDEX'
    else 'HOLD'
  end as effective_index_policy
from readiness r;

revoke all on public.commerce_evergreen_page_v from anon;
revoke all on public.commerce_evergreen_page_v from authenticated;
grant select on public.commerce_evergreen_page_v to service_role;

-- ------------------------------------------------------------
-- STAFF CANDIDATE VIEW
-- ------------------------------------------------------------
-- Shows raw brand/model labels seen in real published history that have not yet
-- been mapped to a curated model. It is intentionally NOT public storefront data.

create or replace view public.commerce_taxonomy_candidates_v
with (security_invoker = true)
as
select
  c.id as category_id,
  c.key as category_key,
  c.slug as category_slug,
  p.brand as source_brand,
  p.model as source_model,
  count(*)::int as historical_listing_count,
  count(*) filter (where pp.status = 'published' and p.status in ('published','reserved'))::int as current_stock_count,
  max(p.updated_at) as last_seen_at,
  case when count(distinct cl.brand_id) = 1
       then max(cl.brand_id::text)::uuid
       else null
  end as mapped_brand_id,
  case when count(distinct cl.model_id) = 1
       then max(cl.model_id::text)::uuid
       else null
  end as mapped_model_id
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website'
left join public.commerce_categories c on c.id = cl.category_id
where nullif(trim(p.brand), '') is not null
   or nullif(trim(p.model), '') is not null
group by c.id, c.key, c.slug, p.brand, p.model;

revoke all on public.commerce_taxonomy_candidates_v from anon;
grant select on public.commerce_taxonomy_candidates_v to authenticated;
grant select on public.commerce_taxonomy_candidates_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC LISTING VIEW: keep SHOP-1 contract, expose IDs for exact filtering.
-- ------------------------------------------------------------

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

  -- SHOP-2 appended columns. Appending preserves CREATE OR REPLACE VIEW compatibility.
  c.id as category_id,
  b.id as catalog_brand_id,
  s.id as series_id,
  m.id as catalog_model_id
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
