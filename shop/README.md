# AMPHON SHOP — through SHOP-3

Astro SSR storefront for `https://shop.amphon.co.th`, connected to AMPHON Product Hub through the server-side Store API.

## Current architecture

- Product master: AMPHON Product Hub / Supabase
- Public transport: Cloudflare Worker Store API v3
- Storefront: Astro SSR on Cloudflare Workers
- Product images: existing Cloudflare R2 URLs
- Canonical SKU route: `/p/{stable-slug}-{sku-lower}/`
- Legacy Product Hub route: `/product/{SKU}` → 301 canonical
- Evergreen SEO: Category → Brand → Series → Model → SKU
- Browser does not receive a Supabase service key

## Store API

```text
GET /store/products
GET /store/products/:sku
GET /store/seo-pages
GET /store/seo-pages/resolve
GET /store/settings
```

## Database migration order

On the same Supabase project used by AMPHON Product Hub, apply existing migrations first, then:

```text
supabase/shop_1.sql
supabase/shop_2.sql
supabase/shop_3.sql
```

Inspect SHOP-3 with:

```text
supabase/shop_3_verify.sql
```

## SHOP-3 product detail

Individual SKU pages now include:

- stable self-canonical URL
- Product identity structured data
- explicit USED / NEW / REFURBISHED / DAMAGED condition
- real product image gallery with image-role captions
- defect disclosure and defect-image evidence
- public inspection/condition fields
- accessories fields and accessory-image evidence
- warranty date/evidence
- shipping and return disclosure only when configured with real policy data
- sold/reserved status guardrails
- related live inventory fallback
- Brand / Series / Model hierarchy links
- product Open Graph image/price metadata
- optional LINE/phone CTA

## Merchant activation safety

Merchant purchase readiness is OFF by default:

```text
commerce_store_settings.purchase_enabled = false
commerce_listings.merchant_enabled = false
```

Active `Offer` JSON-LD requires both flags. Do not enable `purchase_enabled` simply because LINE/phone contact exists; enable it only after the storefront has a real site-owned purchase/order flow.

Shipping and return schema is never invented. It is emitted only from configured `commerce_store_settings` values.

See:

```text
docs/SHOP3_PRODUCT_DETAIL_PLAYBOOK.md
```

## Environment

Copy:

```bash
cp .env.example .env
```

Configure:

```dotenv
PUBLIC_SITE_URL=https://shop.amphon.co.th
PUBLIC_AMPHON_STORE_API=https://YOUR-R2-WORKER.workers.dev/store
PUBLIC_LINE_URL=https://line.me/R/ti/p/@YOUR_LINE_ID
PUBLIC_PHONE=
```

## QA before production

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

Do not call production deployment complete until dependency-resolved Astro and Worker builds pass.
