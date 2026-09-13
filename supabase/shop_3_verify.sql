-- AMPHON SHOP — SHOP-3 verification queries

-- 1) Store policy settings (values should be reviewed by Owner/Admin before enabling).
select * from public.commerce_store_settings where id = 1;

-- 2) Merchant readiness. PURCHASE_FLOW_DISABLED is EXPECTED until checkout/order exists.
select sku, title, product_status, website_status, merchant_enabled,
       merchant_item_condition, data_ready, merchant_activation_ready, blockers
from public.commerce_merchant_readiness_v
order by updated_at desc
limit 100;

-- 3) Public projection must expose only public-safe commerce/product fields.
select sku, title, price, status, merchant_item_condition, merchant_enabled,
       google_product_category, gtin, mpn, category_slug,
       catalog_brand_slug, series_slug, catalog_model_slug,
       jsonb_array_length(images) as image_count
from public.commerce_public_listing_v
order by publication_updated_at desc
limit 20;

-- 4) No anonymous direct grants on server-only views/settings.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'commerce_public_listing_v',
    'commerce_public_store_settings_v',
    'commerce_store_settings',
    'commerce_merchant_readiness_v'
  )
order by table_name, grantee, privilege_type;

-- 5) Condition distribution for current website history.
select merchant_item_condition, count(*)
from public.commerce_listings
group by merchant_item_condition
order by count(*) desc;
