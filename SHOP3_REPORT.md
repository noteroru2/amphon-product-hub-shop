# SHOP-3 — Product Detail SEO + Merchant Listing Schema + Used Product Trust UX

Status: `IMPLEMENTED_WITH_BUILD_ENVIRONMENT_WARNING`

## Scope completed

- Product-detail trust UX for one-off used inventory
- Explicit merchant item condition per commerce listing
- Product detail schema builder with Used/New/Refurbished/Damaged condition mapping
- OnlineStore merchant identity schema
- Shipping structured-data configuration with no-fabrication guardrails
- Return-policy structured-data configuration with no-fabrication guardrails
- Merchant activation gate (`purchase_enabled` + per-SKU `merchant_enabled`)
- Merchant readiness staff audit view with blockers
- Store API v3 `/store/settings`
- Store API product response enriched with merchant condition / GTIN / MPN / Merchant category metadata
- Product social metadata with primary product image
- Public trust grouping of condition/test fields and accessories
- Explicit defect disclosure UI and defect evidence image count
- Warranty information/evidence UI
- Shipping/return disclosure UI when real policy data exists
- Optional LINE/phone CTA, explicitly separate from Merchant eligibility
- Related in-stock SKU fallback for both live and sold pages
- Sold product schema maps to `SoldOut`
- Reserved SKU schema does not claim `InStock`
- Stable canonical Product URL remains unchanged
- Existing Brand / Series / Model breadcrumb and internal-link hierarchy retained

## Merchant activation design

Google Merchant Listing eligibility expects a product page where the shopper can purchase the product. SHOP-3 therefore does not automatically activate merchant Offer markup just because a price is shown or a LINE link exists.

Default state:

```text
commerce_store_settings.purchase_enabled = false
commerce_listings.merchant_enabled = false
```

Active Offer schema requires both flags to be true. `commerce_merchant_readiness_v` reports blockers including `PURCHASE_FLOW_DISABLED` and `MERCHANT_DISABLED`.

This prepares the schema now without falsely representing SHOP-5 checkout functionality before it exists.

## Public privacy boundary

The Store API and `commerce_public_listing_v` do not expose:

- cost
- margin/profit
- serial number / IMEI
- supplier data
- previous owner/customer data
- employee data
- internal notes
- Supabase credentials

`commerce_public_store_settings_v` is also server-only and contains public merchant policy data only.

## Database migration

Run after SHOP-2:

```text
supabase/shop_3.sql
```

Then inspect:

```text
supabase/shop_3_verify.sql
```

## Store API

New endpoint:

```text
GET /store/settings
```

Store API health version:

```text
3
```

Product payload additions are backward compatible:

```text
merchantEnabled
merchantItemCondition
googleProductCategory
gtin
mpn
```

## Storefront UX

Product detail now contains:

1. canonical breadcrumb hierarchy
2. real-image gallery with image-role captions
3. status + used-condition label
4. price / SKU / condition / warranty / last-update summary
5. optional contact CTA
6. reserved/sold guardrails
7. Used Product Trust section
8. defect disclosure
9. inspection/condition fields
10. accessories fields
11. warranty evidence
12. shipping/return disclosure
13. detailed core specifications
14. used-product buying disclosure
15. related available inventory

## Verification status

Completed in this execution environment:

- SHOP-1 foundation verifier: PASS
- SHOP-2 hierarchy/release verifier: PASS
- SHOP-3 verifier: PASS
- Storefront TypeScript libraries: PASS
- Store API Worker TypeScript compile with local Cloudflare type shim: PASS
- Product Astro frontmatter TypeScript parse: PASS
- Secret assignment/token scan: PASS (0 findings)
- Temp/junk artifact scan: PASS (0 findings)
- Partial `node_modules` / accidental shop lockfile after failed install: 0

Static architecture verifiers are included:

```bash
npm run verify:foundation
npm run verify:shop2
npm run verify:shop3
```

A dependency-resolved `npm install` was attempted but timed out in this execution environment before dependencies were installed. No partial `node_modules` or generated shop lockfile remains. `astro check` / `astro build` must still pass on a normal network-connected development machine before Production PASS is declared.

## Next recommended batch

`SHOP-4 — App Publish Center ↔ Shop Commerce Integration + Merchant Configuration UI`

Focus:

- staff-facing taxonomy/listing metadata controls
- merchant condition and identifier editing
- merchant readiness visible in Publish Center
- store shipping/return policy admin UI
- canonical Product URL returned directly to Product Hub
- sitemap/merchant feed handoff readiness before cart/order work
