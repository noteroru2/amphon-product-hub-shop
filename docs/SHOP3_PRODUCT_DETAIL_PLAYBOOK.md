# SHOP-3 Product Detail / Merchant / Trust Playbook

## Purpose

SHOP-3 turns each published SKU into a durable product-detail page for `shop.amphon.co.th` while keeping AMPHON Product Hub as the source of truth.

The storefront reads only the server-side Store API. Browser code never receives Supabase service credentials and never reads internal cost/profit/customer/employee data.

## Product URL

Canonical:

```text
/p/{stable-listing-slug}-{sku-lower}/
```

Legacy Product Hub links at `/product/{SKU}` continue to 301 to the canonical SKU URL.

## Used-product trust contract

Each SKU page surfaces only data already tied to that exact inventory item:

- public product images and their image roles
- SKU
- price
- condition percentage when present
- defect disclosure text when present
- public condition/test fields from `specs`
- accessory fields from `specs`
- warranty date and warranty evidence images when present
- current availability
- last-updated date
- deepest released Brand / Series / Model evergreen parent
- related in-stock inventory for recovery when a SKU is sold

The UI intentionally says “ข้อมูลที่บันทึก” instead of claiming every field was independently verified. Missing public defect text is not presented as “no defects”.

## Merchant condition

`commerce_listings.merchant_item_condition` is explicit per SKU:

```text
NEW
USED
REFURBISHED
DAMAGED
```

Current listings default to `USED` because the storefront is designed primarily for second-hand inventory. Change the value explicitly for new, refurbished or damaged stock.

Schema mapping:

```text
NEW          -> https://schema.org/NewCondition
USED         -> https://schema.org/UsedCondition
REFURBISHED  -> https://schema.org/RefurbishedCondition
DAMAGED      -> https://schema.org/DamagedCondition
```

## Merchant activation guardrail

SHOP-3 separates **product SEO readiness** from **merchant checkout readiness**.

The migration creates:

```text
commerce_store_settings.purchase_enabled = false
commerce_listings.merchant_enabled = false
```

A SKU gets an active `Offer` in JSON-LD only when BOTH are true:

```text
purchase_enabled = true
merchant_enabled = true
```

This is deliberate. Do not enable `purchase_enabled` merely because LINE or phone contact exists. Enable it when the storefront has a real site-owned order/checkout flow that lets the shopper purchase the product.

Until that point the page still has Product identity/schema, canonical SEO, images, condition, SKU, trust UX and conversion contact options, but does not claim merchant-listing purchase readiness.

## Merchant readiness audit

Use:

```sql
select *
from public.commerce_merchant_readiness_v
order by updated_at desc;
```

Important fields:

```text
data_ready
merchant_activation_ready
blockers[]
```

`PURCHASE_FLOW_DISABLED` is expected before checkout is implemented.

## Store-wide policy settings

SHOP-3 introduces `commerce_store_settings` with one row (`id = 1`).

It contains only public-safe merchant policy information. Never put API keys, bank data, customer data, supplier data or private notes in this table.

### Shipping

Shipping structured data is emitted only when:

```text
shipping_enabled = true
shipping_country is set
handling_min_days is set
handling_max_days is set
transit_min_days is set
transit_max_days is set
```

`shipping_rate` may be 0 for free shipping or a non-negative THB amount. Do not invent a value merely to satisfy schema.

Example after the owner has approved the real policy:

```sql
update public.commerce_store_settings
set
  shipping_enabled = true,
  shipping_country = 'TH',
  shipping_rate = 0,
  handling_min_days = 0,
  handling_max_days = 1,
  transit_min_days = 1,
  transit_max_days = 4,
  shipping_policy_url = 'https://shop.amphon.co.th/shipping/'
where id = 1;
```

The numbers above are examples only. Replace them with the actual operating policy before running the update.

### Returns

Return policy is disabled by default. Supported internal values:

```text
return_policy_category: FINITE | NOT_PERMITTED | UNLIMITED
return_method: MAIL | IN_STORE | MAIL_AND_IN_STORE
return_fees: FREE | CUSTOMER_RESPONSIBILITY
```

If an authoritative public return-policy page exists, `return_policy_url` can be used. Otherwise configure the structured fields completely. A FINITE policy requires `return_days`.

Do not enable or populate a policy that the business does not actually honor.

## Organization policy schema

Store-wide return policy is attached to `OnlineStore` / Organization rather than duplicated under every Offer. Product-level override can be added later only when a specific SKU genuinely differs from the store-wide policy.

## Product structured data

The product page can emit:

```text
Product
  name
  sku
  image[]
  description
  brand
  mpn (when configured)
  gtin (when configured)
  itemCondition
  additionalProperty[]
  offers (only when merchant activation gate is open)

Offer
  price
  priceCurrency
  availability
  itemCondition
  seller
  shippingDetails (only when complete and enabled)
```

Availability mapping:

```text
available    -> InStock
reserved     -> OutOfStock
out_of_stock -> SoldOut
```

Reserved inventory is not marked InStock because the same one-off used SKU should not be sold twice.

## GTIN / MPN

Do not fabricate identifiers.

- Populate `gtin` only when a genuine GTIN/EAN/UPC is known for that item/model.
- Populate `mpn` only when the manufacturer part number is known.
- SKU is always the AMPHON inventory SKU and remains separate.

## Images

The page uses Product Hub image roles such as:

```text
cover
front
back
side
defect
accessories
warranty
test
screen_on
pixel_test
ports
```

Image ALT text combines the actual product title with the image role. Defect/accessory/warranty image counts are surfaced in the trust section when available.

## Sold SKU behavior

A sold SKU is retained when its commerce listing remains indexable:

```text
availability = SoldOut
CTA purchase path = disabled by stock state
related in-stock stock = shown
canonical = unchanged
Evergreen ancestor links = preserved
```

Do not immediately 404 or redirect every sold SKU. Later lifecycle rules can retire low-value pages based on GSC/backlink/history evidence.

## Related-stock fallback hierarchy

SHOP-3 searches available stock in this order:

```text
same Model
→ same Series
→ same Brand
→ same Category
```

This is especially important for sold one-off used inventory.

## Contact CTA

Optional environment variables:

```env
PUBLIC_LINE_URL=https://line.me/R/ti/p/@YOUR_LINE_ID
PUBLIC_PHONE=
```

These are conversion/contact channels only. Their presence does **not** automatically make the page Merchant-ready.

## Migration order

```text
schema.sql
batch3_2.sql
batch3_3.sql
batch3_4.sql
batch4.sql
batch4_1.sql
shop_1.sql
shop_2.sql
shop_3.sql
```

Then run:

```sql
-- inspect results
supabase/shop_3_verify.sql
```

## Deployment QA

```bash
cd shop
npm install
npm run verify:foundation
npm run verify:shop2
npm run verify:shop3
npm run check
npm run build
```

Worker:

```bash
cd workers/r2-upload
npm install
npm run typecheck
```

Before enabling merchant purchase status, verify the real checkout/order flow and actual shipping/return policies in production.
