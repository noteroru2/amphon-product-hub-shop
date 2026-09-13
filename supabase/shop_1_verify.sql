-- AMPHON SHOP — SHOP-1 post-migration verification
-- Run after supabase/shop_1.sql in Supabase SQL Editor.

begin;

do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.commerce_categories') is null then missing := array_append(missing, 'commerce_categories'); end if;
  if to_regclass('public.commerce_brands') is null then missing := array_append(missing, 'commerce_brands'); end if;
  if to_regclass('public.commerce_series') is null then missing := array_append(missing, 'commerce_series'); end if;
  if to_regclass('public.commerce_models') is null then missing := array_append(missing, 'commerce_models'); end if;
  if to_regclass('public.commerce_listings') is null then missing := array_append(missing, 'commerce_listings'); end if;
  if to_regclass('public.commerce_public_listing_v') is null then missing := array_append(missing, 'commerce_public_listing_v'); end if;

  if cardinality(missing) > 0 then
    raise exception 'SHOP-1 missing objects: %', array_to_string(missing, ', ');
  end if;

  if has_table_privilege('anon', 'public.commerce_categories', 'SELECT')
     or has_table_privilege('anon', 'public.commerce_brands', 'SELECT')
     or has_table_privilege('anon', 'public.commerce_series', 'SELECT')
     or has_table_privilege('anon', 'public.commerce_models', 'SELECT')
     or has_table_privilege('anon', 'public.commerce_listings', 'SELECT')
     or has_table_privilege('anon', 'public.commerce_public_listing_v', 'SELECT') then
    raise exception 'SHOP-1 security gate failed: anon still has direct commerce SELECT privilege';
  end if;

  if exists (
    select source_category
    from public.commerce_categories
    where source_category is not null and is_default_source
    group by source_category
    having count(*) > 1
  ) then
    raise exception 'SHOP-1 taxonomy gate failed: more than one default category for a Product Hub source category';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commerce_public_listing_v'
      and lower(column_name) ~ '(cost|profit|margin|serial|imei|employee|customer|supplier|purchase)'
  ) then
    raise exception 'SHOP-1 public projection exposes a prohibited-looking column';
  end if;
end $$;

-- Expected: one row per active source category used by Product Hub.
select source_category, key, slug, index_policy
from public.commerce_categories
where is_default_source
order by sort_order;

-- Expected: 0 unmapped listings after seed/backfill, except deliberately unsupported future categories.
select p.category as source_category, count(*) as unmapped_listings
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
where cl.category_id is null
group by p.category
order by p.category;

-- Live + sold-page retention visibility for server-only Store API.
select status, count(*)
from public.commerce_public_listing_v
group by status
order by status;

-- Current route metadata coverage.
select
  count(*) as listing_count,
  count(*) filter (where slug is null or slug = '') as missing_slug,
  count(*) filter (where index_policy is null) as missing_index_policy,
  count(*) filter (where category_slug is null) as missing_category_mapping
from public.commerce_public_listing_v;

rollback;
