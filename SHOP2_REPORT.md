# SHOP-2 — Brand / Series / Model Evergreen SEO Architecture

Status: `IMPLEMENTED_WITH_BUILD_ENVIRONMENT_WARNING`

## Scope completed

- Category-specific Brand SEO ownership via `commerce_brand_pages`
- Curated Brand aliases and Model aliases
- Deterministic Product -> Category / Brand / Series / Model mapping
- Automatic HOLD brand bootstrap from real Product Hub inventory labels
- Admin remapping RPC after taxonomy curation
- Brand / Series / Model evergreen server-only projection
- Editorial SEO Release Gate with parent hierarchy validation
- Empty-stock evergreen retention only when editorial content is sufficient
- Taxonomy candidate view for unmapped real-stock models
- Store API v2 endpoints for SEO page list + resolve
- Store API catalog-slug product filters
- Astro routes:
  - `/{category}/{brand}/`
  - `/{category}/{brand}/{series}/`
  - `/{category}/{brand}/{series}/{model}/`
- Category -> Brand discovery
- Brand -> Series discovery
- Series -> Model discovery
- Model -> live SKU discovery
- SKU -> deepest released evergreen ancestor backlink
- Evergreen sitemap separated from SKU/category sitemaps
- CollectionPage + ItemList + BreadcrumbList schema on evergreen hubs
- Product/Offer schema remains only on individual SKU pages

## Architecture correction from SHOP-0

`commerce_brands` is a global identity and cannot safely own one SEO title/copy for every category. SHOP-2 adds `commerce_brand_pages(category_id, brand_id)` so intents such as ASUS Notebook and ASUS Monitor can remain distinct.

## SEO Release Gate

`index_policy='INDEX'` does not automatically make a route indexable. Runtime `effective_index_policy` becomes INDEX only when:

- parent category is INDEX
- entity is active and explicitly INDEX
- title length 20–180
- description length 60–320
- H1 is present
- intro content >= 120 chars
- at least one historical published listing exists
- current stock > 0 OR evergreen editorial content >= 400 chars
- Series parent Brand is ready
- Model parent Brand + Series are ready

HOLD pages do not enter sitemap or normal internal discovery.

## Taxonomy mapping safety

No fuzzy mapping is used. Product mappings use:

1. exact category mapping
2. exact case-insensitive brand / explicit brand alias
3. exact model name, exact model code, or explicit model alias
4. Series inherited from the curated Model

Unknown brands may be created as HOLD identities. Models are never auto-created as INDEX pages from raw inventory text.

## Database migration

Run after SHOP-1:

```sql
-- Supabase SQL Editor
supabase/shop_2.sql
```

Then inspect:

```sql
supabase/shop_2_verify.sql
```

After adding/changing Series, Models or aliases, Owner/Admin can run:

```sql
select public.refresh_commerce_taxonomy_mappings();
```

## Store API additions

- `GET /store/seo-pages`
- `GET /store/seo-pages/resolve`
- `/store/products` filters:
  - `categorySlug`
  - `brandSlug`
  - `seriesSlug`
  - `modelSlug`

Existing SHOP-1 Store API product response remains backward compatible; SHOP-2 only appends catalog identity IDs.

## Verification performed

PASS:

- SHOP-1 foundation verifier
- SHOP-2 hierarchy/release verifier
- Worker TypeScript static compile using local Cloudflare type shims
- Store API/config/SEO TypeScript static compile
- Relative import resolution
- Astro frontmatter fence checks
- Evergreen schema policy check (no Product schema on collection hubs)
- Public-view private-field structural scan

## Environment warning

A dependency-resolved Astro build was attempted, but `npm install` timed out in this execution environment before dependencies were installed. No partial `node_modules` or generated lockfile remains in the package.

Before production deployment run on a normal internet-connected machine:

```bash
cd shop
npm install
npm run verify:foundation
npm run verify:shop2
npm run check
npm run build
```

And Worker:

```bash
cd workers/r2-upload
npm install
npm run typecheck
```

Do not call production deployment complete until those dependency-resolved checks pass.

## Recommended next batch

`SHOP-3 — Product Detail SEO + Merchant Listing Schema + Used Product Trust UX`

This should harden individual SKU pages with shipping/returns/warranty/trust data, Merchant listing validation, sold-product related-stock UX, and conversion-ready product detail components.
