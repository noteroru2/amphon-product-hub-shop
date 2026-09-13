-- SHOP-4 verification. Run after shop_4.sql.
-- Every query should return the intended state described in comments.

-- 1) Merchant condition must contain only Google-supported values.
select merchant_item_condition, count(*)
from public.commerce_listings
group by merchant_item_condition
order by merchant_item_condition;

-- Expected: only NEW / USED / REFURBISHED (normally USED for second-hand stock).

-- 2) SHOP-4 checkout activation guard must be locked.
select id, purchase_enabled
from public.commerce_store_settings
where id = 1;
-- Expected: purchase_enabled = false.

-- 3) No invalid listing hierarchy.
select cl.product_id, p.sku, cl.category_id, cl.brand_id, cl.series_id, cl.model_id
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
left join public.commerce_series s on s.id = cl.series_id
left join public.commerce_models m on m.id = cl.model_id
where (cl.series_id is not null and (s.id is null or s.category_id is distinct from cl.category_id or s.brand_id is distinct from cl.brand_id))
   or (cl.model_id is not null and (m.id is null or m.category_id is distinct from cl.category_id or m.brand_id is distinct from cl.brand_id or (m.series_id is not null and m.series_id is distinct from cl.series_id)));
-- Expected: 0 rows.

-- 4) Canonical Website URLs must match stable Shop listing URL where publication exists.
select p.sku, pp.status, pp.external_url,
       s.site_url || '/p/' || cl.slug || '-' || lower(p.sku) || '/' as expected_url
from public.product_publications pp
join public.products p on p.id = pp.product_id
join public.commerce_listings cl on cl.product_id = p.id
cross join public.commerce_store_settings s
where pp.channel = 'website'
  and pp.external_url is distinct from s.site_url || '/p/' || cl.slug || '-' || lower(p.sku) || '/';
-- Expected: 0 rows.

-- 5) Staff editor view should contain one row per commerce listing.
select
  (select count(*) from public.commerce_listings) as listing_count,
  (select count(*) from public.commerce_listing_editor_v) as editor_count;
-- Expected: equal counts.

-- 6) Readiness must work for prepared-but-not-yet-published products too.
select sku, website_status, data_ready, merchant_activation_ready, blockers
from public.commerce_listing_editor_v
order by updated_at desc
limit 20;

-- 7) Public store projection still excludes private/financial identifiers.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('commerce_public_listing_v','commerce_public_store_settings_v')
  and column_name ~* '(cost|profit|serial|imei|supplier|employee|customer|bank|token|secret|password)';
-- Expected: 0 rows.

-- 8) Required SHOP-4 routines/views exist.
select routine_schema, routine_name
from information_schema.routines
where routine_schema in ('public','private')
  and routine_name in ('prepare_commerce_listing','validate_commerce_listing_hierarchy','sync_website_publication_canonical_url')
order by routine_schema, routine_name;

select table_name
from information_schema.views
where table_schema = 'public'
  and table_name in ('commerce_listing_editor_v','commerce_merchant_readiness_v','commerce_public_store_settings_v')
order by table_name;

-- 9) Enabled Shipping must have complete enhancement data.
select id, shipping_country, shipping_rate, handling_min_days, handling_max_days, transit_min_days, transit_max_days
from public.commerce_store_settings
where shipping_enabled = true
  and (
    shipping_country is null or shipping_rate is null
    or handling_min_days is null or handling_max_days is null
    or transit_min_days is null or transit_max_days is null
  );
-- Expected: 0 rows.

-- 10) Enabled Return policy must have either structured category or a real policy URL.
select id, return_policy_category, return_policy_url
from public.commerce_store_settings
where return_policy_enabled = true
  and return_policy_category is null
  and nullif(btrim(return_policy_url), '') is null;
-- Expected: 0 rows.
