-- SHOP-2 read-only verification queries.
-- Expected: objects exist, public browser grants remain absent, and no INDEX page
-- reports seo_ready=false after editorial release.

select to_regclass('public.commerce_brand_pages') as commerce_brand_pages;
select to_regclass('public.commerce_brand_aliases') as commerce_brand_aliases;
select to_regclass('public.commerce_model_aliases') as commerce_model_aliases;
select to_regclass('public.commerce_evergreen_page_v') as commerce_evergreen_page_v;
select to_regclass('public.commerce_taxonomy_candidates_v') as commerce_taxonomy_candidates_v;

select
  page_type,
  effective_index_policy,
  count(*) as pages,
  sum(current_stock_count) as current_stock,
  sum(historical_listing_count) as historical_listings
from public.commerce_evergreen_page_v
group by page_type, effective_index_policy
order by page_type, effective_index_policy;

select
  page_type,
  canonical_path,
  index_policy,
  effective_index_policy,
  seo_ready,
  current_stock_count,
  historical_listing_count
from public.commerce_evergreen_page_v
where index_policy = 'INDEX' and seo_ready = false
order by page_type, canonical_path;

select *
from public.commerce_taxonomy_candidates_v
where mapped_model_id is null and source_model is not null
order by current_stock_count desc, historical_listing_count desc, last_seen_at desc
limit 100;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('commerce_brand_pages','commerce_brand_aliases','commerce_model_aliases','commerce_evergreen_page_v')
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;
