# SHOP-1 — Astro Storefront Foundation + Supabase Commerce Schema

**Status:** `IMPLEMENTED_WITH_BUILD_ENVIRONMENT_WARNING`

**Target:** `https://shop.amphon.co.th`

**Source baseline:** AMPHON Product Hub Batch 4.1 Sales Website Integration

## Implemented

### Astro storefront

- Added standalone `shop/` Astro SSR application.
- Cloudflare Workers adapter and current Workers server entrypoint configuration.
- Homepage connected to Product Hub Store API.
- Dynamic category pages with INDEX/HOLD policy.
- Canonical product route: `/p/{stable-slug}-{sku-lower}/`.
- Backward-compatible `/product/{SKU}` -> `301` canonical route.
- Product SSR page with real price/spec/condition/images/status.
- Product + Offer structured data.
- Breadcrumb structured data.
- Self canonical metadata and robots policy.
- `robots.txt` with faceted-query crawl blocks.
- Sitemap index, category sitemap and product sitemap.
- Sold product detail retention using `OutOfStock` instead of immediate 404.
- Responsive storefront foundation for desktop/mobile.

### Commerce database foundation

Added `supabase/shop_1.sql` with:

- `commerce_categories`
- `commerce_brands`
- `commerce_series`
- `commerce_models`
- `commerce_listings`
- Stable immutable listing slug creation at first Website publication.
- Product Hub -> commerce listing trigger.
- Backfill for already published products and previously published sold products.
- RLS and least-privilege grants.
- Server-only `commerce_public_listing_v` using `security_invoker=true`.
- Public projection excludes cost/profit/serial/IMEI/internal/customer/employee data.
- SHOP-0 taxonomy seed with INDEX/HOLD lifecycle.
- Source-category coverage including notebook, pc, iphone, smartphone, tablet, monitor, camera, lens, gaming, component, accessory and other.

Added `supabase/shop_1_verify.sql` for post-migration verification.

### Store API upgrade

The existing Cloudflare Worker Store API now:

- Reads `commerce_public_listing_v` instead of the older Batch 4.1 projection.
- Preserves all existing Store API response fields.
- Adds stable listing slug + SEO/taxonomy fields.
- Uses database-level pagination/count instead of loading a fixed 500-row set.
- Queries product detail directly by SKU.
- Keeps sold products reachable at detail endpoints with `availability: out_of_stock`.
- Excludes sold products from normal product lists unless explicitly requested.
- Supports `availability=all` for sitemap generation.

## URL contract

Canonical:

```text
https://shop.amphon.co.th/p/{stable-listing-slug}-{sku-lower}/
```

Compatibility route retained for Product Hub Batch 4.1:

```text
https://shop.amphon.co.th/product/{SKU}
                  301
                   ↓
https://shop.amphon.co.th/p/{stable-listing-slug}-{sku-lower}/
```

## Security boundary

The public browser does **not** receive a Supabase key and does not query Supabase directly.

```text
Browser / Googlebot
       ↓
Astro SSR — shop.amphon.co.th
       ↓
Cloudflare Public Store API
       ↓
server-only commerce_public_listing_v
       ↓
Supabase Product Hub
```

Private Product Hub data remains outside the public projection.

## Verification completed

- `shop/scripts/verify-foundation.mjs`: **PASS**
- Storefront pure TypeScript modules with strict compiler: **PASS**
- Worker TypeScript with isolated Cloudflare type shims: **PASS**
- Astro frontmatter syntax extraction check: **PASS**
- Secret/private-key pattern scan: **PASS — 0 findings**
- Required foundation files: **12/12**
- Sold-page retention invariant: **PASS**
- Canonical + legacy redirect invariant: **PASS**
- Public projection forbidden-column static audit: **PASS**

## Build warning

A dependency-resolved `npm install` inside `shop/` could not finish in this execution environment before the network timeout, so a real `astro check && astro build` could not be completed here.

Do not call production deployment complete until the following succeeds on the development/deployment machine:

```bash
cd shop
npm install
npm run verify:foundation
npm run check
npm run build
```

And for the Worker:

```bash
cd workers/r2-upload
npm install
npm run typecheck
```

## Deployment order

1. Run existing Product Hub migrations through Batch 4.1.
2. Run `supabase/shop_1.sql`.
3. Run `supabase/shop_1_verify.sql` and review expected zero/mapped results.
4. Redeploy `workers/r2-upload`.
5. Set Product Hub `VITE_SALES_SITE_URL=https://shop.amphon.co.th`.
6. Set Shop `PUBLIC_AMPHON_STORE_API=https://<worker>/store`.
7. Build/deploy `shop/` to Cloudflare Workers.
8. Attach custom domain `shop.amphon.co.th`.
9. Verify live robots, sitemap, category route, canonical product route and legacy 301.

## Deferred intentionally

- SHOP-2: Brand / Series / Model evergreen SEO architecture and generated hubs.
- SHOP-3: Full product-page conversion UX / warranty / trust / related items.
- SHOP-4: Update Product Hub Publish Center to generate canonical `/p/.../` links directly and richer SEO controls.
- SHOP-5+: Cart, reservation transaction, checkout and order synchronization.
