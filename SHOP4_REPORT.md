# SHOP-4 — App Publish Center ↔ Shop Commerce Integration + Merchant Configuration UI

Status: `IMPLEMENTED_WITH_BUILD_ENVIRONMENT_WARNING`

## Scope completed

- Product Hub Commerce client using the existing authenticated Cloudflare Worker
- Product-level Commerce editor embedded in Publish Center
- Global Merchant / Shipping / Return settings UI for Owner/Admin
- Taxonomy candidate review + deterministic remap UI
- Quick-create Series / Model workflow with HOLD-by-default lifecycle
- Category / Brand / Series / Model product mapping controls
- Product SEO title / description / index-policy controls
- Per-SKU Merchant enable flag, condition, Google product category, GTIN and MPN controls
- GTIN check-digit validation in both app helper and Worker
- Stable canonical Product URL returned to Product Hub
- Website publish now prepares the Commerce listing before publication
- Website publication stores the canonical `/p/{slug}-{sku}/` URL
- Database trigger/backfill keeps existing Website publication URLs canonical
- Staff-safe `commerce_listing_editor_v`
- Pre-publish-aware Merchant readiness view
- Database hierarchy validation for Category / Brand / Series / Model
- Authenticated `/commerce/*` Worker API
- Merchant condition correction to `NEW / USED / REFURBISHED` only
- Existing `DAMAGED` values migrated to `USED`; visible defect data stays separate
- SHOP-4 database/Worker lock keeps checkout activation disabled until SHOP-5
- Return policy builder supports a structured policy or a real policy link without fabricated values

## App workflow

```text
Publish Center
  ↓
Product → Website
  ↓
Prepare Commerce Listing
  ↓
Edit taxonomy / SEO / Merchant data
  ↓
Stable canonical Shop URL
  ↓
Publish Website
```

The `website` publication channel remains backward compatible with the legacy `/product/{SKU}` route, but new publication records use the canonical SHOP-1+ product path after Commerce preparation.

## Permissions

- Owner/Admin: global merchant settings, taxonomy creation/remap, per-SKU Commerce, Website publishing
- Sales: per-SKU Commerce and Website publishing using existing taxonomy
- Technician: read-only publication workflow; cannot mutate Commerce metadata

## Merchant condition correction

SHOP-3 carried a `DAMAGED` option because Schema.org exposes a damaged condition. Google Merchant product data accepts only:

```text
NEW
REFURBISHED
USED
```

SHOP-4 therefore:

1. migrates existing `DAMAGED` to `USED`
2. removes `DAMAGED` from DB/API/UI types
3. keeps actual damage in visible defect / condition / evidence fields

This is safer for a second-hand inventory business because wear or defects do not by themselves turn an item into a separate Google Merchant condition value.

## Checkout / Merchant activation safety

SHOP-4 does not claim that checkout is ready.

Database invariant:

```text
commerce_store_settings.purchase_enabled = false
```

Worker invariant:

```text
PATCH /commerce/settings always writes purchase_enabled = false
```

Product Offer schema remains gated by:

```text
settings.purchaseEnabled && product.merchantEnabled
```

SHOP-5 must explicitly remove the database lock after Order / Reservation / Checkout is implemented and tested.

## Worker API additions

Authenticated employee routes:

```text
GET   /commerce/settings
PATCH /commerce/settings
GET   /commerce/catalog
GET   /commerce/candidates
POST  /commerce/remap
POST  /commerce/series
POST  /commerce/models
GET   /commerce/products/:id
POST  /commerce/products/:id/prepare
PATCH /commerce/products/:id
```

Store API health marker is now:

```text
shopVersion: 4
```

No new secrets are required.

## Database migration

Run after SHOP-3:

```text
supabase/shop_4.sql
```

Then inspect:

```text
supabase/shop_4_verify.sql
```

Key database additions/changes:

- Merchant condition constraint corrected
- GTIN format constraint
- SHOP-4 purchase activation lock
- Shipping day-order constraints
- finite-return-window validation
- taxonomy hierarchy trigger
- `prepare_commerce_listing(uuid)` RPC
- canonical Website publication URL sync trigger/backfill
- pre-publish Merchant readiness view
- `commerce_listing_editor_v`

## Security boundary

SHOP-4 does not expose or place into its editor projection:

- cost
- gross/net profit
- product financial rows
- serial / IMEI
- supplier
- customer / previous owner
- employee payroll/commission data
- bank data
- Supabase or R2 secrets

The Shop browser continues to use public server projections through Store API rather than a service-role key in the browser.

## Verification status

Completed in this execution environment:

- SHOP-1 verifier: PASS
- SHOP-2 verifier: PASS
- SHOP-3 verifier: PASS
- SHOP-4 verifier: PASS
- modified TypeScript / TSX syntax transpilation: PASS
- SQL structural/invariant audit: PASS
- active Merchant condition allowlist audit: PASS
- private-field projection token audit: PASS
- artifact/secret hygiene scan: PASS

A dependency-resolved install/build is still required before declaring Production PASS. Run on a normal development machine:

```bash
# Product Hub
npm install
npm run typecheck
npm run build

# Worker
cd workers/r2-upload
npm install
npm run typecheck

# Storefront
cd ../../shop
npm install
npm run verify:foundation
npm run verify:shop2
npm run verify:shop3
npm run verify:shop4
npm run check
npm run build
```

## Next recommended batch

`SHOP-5 — Cart + Atomic Reservation + Checkout + Order Management`

That batch is the correct point to remove the SHOP-4 purchase lock and activate Merchant Offer markup only after real checkout can atomically reserve a one-off used SKU.
