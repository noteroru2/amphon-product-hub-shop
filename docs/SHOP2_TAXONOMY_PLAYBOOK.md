# SHOP-2 Taxonomy Playbook

## Goal

Brand / Series / Model pages are durable SEO owners. Inventory units come and go; these pages must not depend on a single SKU staying in stock.

## URL ownership

- Category: `/notebooks/`
- Brand: `/notebooks/asus/`
- Series: `/notebooks/asus/tuf/`
- Model: `/notebooks/asus/tuf/tuf-gaming-f16/`
- Inventory SKU: `/p/{stable-listing-slug}-{sku}/`

A Model page may become INDEX only after it belongs to an active Series. This avoids ambiguous collisions between Series and Model slugs at the same path depth.

## Important SHOP-2 correction to SHOP-0

`commerce_brands` is a global identity table. SEO copy must **not** live only on that row because the same brand can own different intents in multiple categories (for example ASUS Notebook vs ASUS Monitor). SHOP-2 therefore adds `commerce_brand_pages`, keyed by `(category_id, brand_id)`, and makes it the SEO owner for Brand landing pages.

## Mapping policy

Product Hub remains the source of truth for stock. Mapping is deterministic:

1. Category: existing SHOP-1 source-category mapping.
2. Brand: exact case-insensitive canonical brand or explicit brand alias. Unknown brands are created automatically as HOLD identities.
3. Model: exact model name, exact model code, or explicit model alias within the resolved Category + Brand.
4. Series: inherited from the curated Model; a manually assigned Series is preserved only when it still belongs to the same Category + Brand.
5. No fuzzy string matching is used for SEO ownership.

After adding or changing Models/Aliases, Owner/Admin can call:

```sql
select public.refresh_commerce_taxonomy_mappings();
```

## Editorial release gate

Setting `index_policy = 'INDEX'` is necessary but not sufficient. `commerce_evergreen_page_v.effective_index_policy` becomes `INDEX` only when the release gate passes.

Current gate:

- active entity
- explicit `INDEX`
- title 20–180 characters
- description 60–320 characters
- H1 present
- intro content at least 120 characters
- at least one historical published listing
- either current stock exists **or** evergreen editorial content is at least 400 characters
- Series requires its Brand page to be ready
- Model requires its Brand + Series parents to be ready

This prevents accidental indexation of programmatic/thin taxonomy pages.

## Example curation workflow

Do not copy this example blindly; use the real canonical names/codes found in Product Hub.

```sql
-- 1) Find candidates from real inventory history
select *
from public.commerce_taxonomy_candidates_v
order by current_stock_count desc, historical_listing_count desc;

-- 2) Resolve category + brand IDs
select id, key, slug from public.commerce_categories where slug = 'notebooks';
select id, name, slug from public.commerce_brands where lower(name) = 'asus';

-- 3) Create a Series as HOLD first
insert into public.commerce_series (
  category_id, brand_id, name, slug,
  seo_title, seo_description, seo_h1,
  primary_keyword, intro_content, editorial_content,
  index_policy
)
values (
  '<category-uuid>', '<brand-uuid>', 'TUF Gaming', 'tuf',
  '...', '...', '...',
  'ASUS TUF มือสอง', '...', '...',
  'HOLD'
);

-- 4) Create a Model under that Series
insert into public.commerce_models (
  category_id, brand_id, series_id,
  model_name, model_code, slug,
  seo_title, seo_description, seo_h1,
  primary_keyword, intro_content, seo_content,
  index_policy
)
values (
  '<category-uuid>', '<brand-uuid>', '<series-uuid>',
  'TUF Gaming F16', 'FA608', 'tuf-gaming-f16',
  '...', '...', '...',
  'ASUS TUF Gaming F16 มือสอง', '...', '...',
  'HOLD'
);

-- 5) Add exact aliases only when Product Hub uses another stable label
insert into public.commerce_model_aliases(model_id, alias)
values ('<model-uuid>', 'ASUS TUF F16 FA608');

-- 6) Remap products
select public.refresh_commerce_taxonomy_mappings();

-- 7) Verify mapped stock + page readiness
select * from public.commerce_evergreen_page_v
where category_slug = 'notebooks' and brand_slug = 'asus';

-- 8) Promote parent -> child only after copy review
update public.commerce_brand_pages set index_policy = 'INDEX' where id = '<brand-page-uuid>';
update public.commerce_series set index_policy = 'INDEX' where id = '<series-uuid>';
update public.commerce_models set index_policy = 'INDEX' where id = '<model-uuid>';
```

## Structured data policy

Brand / Series / Model pages use `CollectionPage` + `ItemList` + `BreadcrumbList`. They intentionally do not output `Product` / `Offer` markup. Merchant Product structured data stays on individual SKU pages where a shopper is looking at one purchasable inventory item.

## Internal linking

Public discovery only links pages where `effective_index_policy = INDEX`:

`Category -> Brand -> Series -> Model -> SKU`

Individual SKU pages also link back toward the deepest released evergreen ancestor. HOLD pages therefore do not leak into normal crawl paths or sitemaps.

## Empty stock behavior

Evergreen pages do not automatically disappear when stock reaches zero. If evergreen editorial content is strong enough and the page has real listing history, it may remain INDEX and show that no unit is currently available. Thin pages without current stock fail the release gate and remain HOLD.
