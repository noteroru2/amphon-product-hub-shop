# SHOP-4 — Commerce Admin & Publish Center Playbook

## Purpose

SHOP-4 makes `shop.amphon.co.th` operable from the existing AMPHON Product Hub. Staff no longer need to edit Commerce SQL rows for normal publishing work.

The source-of-truth boundary remains:

```text
AMPHON Product Hub
  products / product_images / product_publications
        ↓
commerce listing metadata
        ↓
Store API
        ↓
shop.amphon.co.th
```

The Storefront never receives product cost, profit, serial/IMEI, customer, supplier, employee or credential data.

## Roles

### Owner / Admin

Can:

- edit Store / Shipping / Return configuration
- create Series and Model taxonomy records
- inspect taxonomy candidates
- remap commerce taxonomy
- edit product taxonomy/SEO/Merchant metadata
- publish/unpublish Website listings

### Sales

Can:

- prepare a commerce listing
- map a product to existing Category / Brand / Series / Model
- edit product SEO metadata
- edit per-SKU Merchant metadata
- publish/unpublish Website listings

Sales cannot create taxonomy entities or alter global merchant policies.

### Technician

Can view publication status and resolved Shop URL/readiness where RLS permits, but cannot mutate commerce listing metadata or Website publication state.

## Website publish workflow

```text
Product = ready_to_list / published / reserved
        ↓
Publish Center
        ↓
Website → Publish
        ↓
prepare_commerce_listing(product_id)
        ↓
stable commerce_listings.slug
        ↓
canonical /p/{slug}-{sku-lower}/
        ↓
product_publications.website = published
```

The legacy `/product/{SKU}` URL remains only as a compatibility redirect in the Storefront.

## Product Commerce editor

Each SKU has a Commerce editor with four groups.

### 1. Taxonomy

Map:

```text
Category → Brand → Series → Model
```

Database hierarchy validation rejects mismatches such as:

- Series from another Category
- Series from another Brand
- Model from another Category/Brand
- Model whose Series differs from the selected Series

New Series/Model created by Owner/Admin starts as `HOLD`. This prevents accidental index expansion from raw stock labels.

### 2. Product SEO

Controls:

- SEO title
- meta description
- index policy: `INDEX`, `NOINDEX`, `HOLD`, `RETIRED`

The stable slug is not edited in normal UI. A title correction must not silently move an already published product URL.

### 3. Merchant item data

Supported Merchant condition values:

```text
NEW
USED
REFURBISHED
```

Second-hand products with scratches, dents, missing accessories or disclosed defects remain `USED`; the defect belongs in visible product condition/defect data.

`REFURBISHED` should only be selected when the product has actually been professionally restored to working order and the shop can support the associated claim/warranty.

Optional identifiers:

- Google product category
- GTIN
- MPN

GTIN is validated for supported length and check digit before save. If the used item has no verified manufacturer GTIN, leave it blank rather than inventing one.

### 4. Readiness

The UI separates:

- `dataReady`: product/listing data is ready
- `merchantActivationReady`: checkout + merchant + website + product availability gates all pass

Typical blockers:

```text
TITLE
PRICE
IMAGE
ITEM_CONDITION
INDEX_POLICY
GTIN_INVALID
PURCHASE_FLOW_DISABLED
MERCHANT_DISABLED
WEBSITE_NOT_PUBLISHED
PRODUCT_NOT_AVAILABLE
```

## SHOP-4 purchase lock

SHOP-4 intentionally adds a database CHECK that keeps:

```text
commerce_store_settings.purchase_enabled = false
```

The Worker also hard-codes `purchase_enabled: false` when saving global merchant settings.

This is intentional. SHOP-5 must explicitly drop the lock only after Order / Reservation / Checkout is implemented and production-tested.

Until then, Product identity structured data may exist, but active Merchant Offer markup remains gated by:

```text
settings.purchaseEnabled && product.merchantEnabled
```

## Merchant condition migration

SHOP-3 allowed a `DAMAGED` internal condition. SHOP-4 migrates existing `DAMAGED` values to `USED` and removes `DAMAGED` from the Merchant allowlist.

Visible defects remain available through:

- condition percent
- defect text
- inspection fields
- defect evidence images

This avoids losing customer-facing condition detail while keeping Google Merchant condition values valid.

## Global Merchant configuration

Owner/Admin can manage these fields from Publish Center → Shop settings.

### Merchant identity

- merchant name
- legal name
- canonical Shop URL

Currency/country remain controlled by the commerce settings record.

### Shipping

Shipping structured data is emitted only when Shipping is enabled and real delivery-time inputs are complete.

Fields:

- country
- shipping rate
- handling min/max days
- transit min/max days
- policy URL

Min must not exceed max. SHOP-4 validates this both in Worker and database constraints.

### Returns

Return policy is emitted only from configured policy data.

The Storefront supports either:

1. a structured policy with country + category (+ days for a finite window), or
2. a real `merchantReturnLink` policy URL.

Optional fields include return method and return fees.

Never enter a policy merely to satisfy schema validation. The displayed store policy and the real customer process must match.

## Taxonomy candidates

`commerce_taxonomy_candidates_v` surfaces raw Brand/Model labels observed from actual inventory history.

Use candidates to decide whether a new permanent taxonomy entity is justified. Do not automatically create a Model page for every raw model string.

Owner/Admin can run **Remap** after:

- adding aliases
- adding Series/Model taxonomy
- correcting source product Brand/Model data

## Canonical URL ownership

Canonical product path:

```text
/p/{stable-slug}-{sku-lower}/
```

SHOP-4 keeps the Website publication URL aligned using:

- app-side canonical URL returned by Commerce API
- database canonical publication URL synchronization when the listing slug exists/changes
- migration backfill for existing Website publication rows

## Install / upgrade

Apply migrations in order:

```text
supabase/shop_1.sql
supabase/shop_2.sql
supabase/shop_3.sql
supabase/shop_4.sql
```

Then inspect:

```text
supabase/shop_4_verify.sql
```

Redeploy the existing R2 / Store API Worker because SHOP-4 adds authenticated `/commerce/*` routes.

Product Hub environment still uses:

```dotenv
VITE_R2_UPLOAD_API=https://<worker-domain>
VITE_SALES_SITE_URL=https://shop.amphon.co.th
```

The Commerce API can also return canonical URLs from `commerce_store_settings.site_url`, so the backend remains the authoritative URL source after a listing is prepared.

## Production gate

Before production release:

```bash
# root Product Hub
npm install
npm run typecheck
npm run build

# Store API Worker
cd workers/r2-upload
npm install
npm run typecheck

# Shop
cd ../../shop
npm install
npm run verify:foundation
npm run verify:shop2
npm run verify:shop3
npm run verify:shop4
npm run check
npm run build
```

Also validate representative live product pages with Google Rich Results Test after deployment, and confirm that Merchant condition, price, availability and visible product state agree.
