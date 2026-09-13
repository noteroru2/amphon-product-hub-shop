# AMPHON Sales Website Integration — Batch 4.1

Batch 4.1 keeps **AMPHON Product Hub as the single product master**. The sales website does not maintain a second inventory database.

## Data flow

```text
Employee phone/tablet
      |
      v
AMPHON Product Hub
      |
      +--> Supabase products / images / publication state
      |
      v
Cloudflare Worker Public Store API
      |
      v
New Sales Website (Astro / Next.js / any frontend)
```

## Publish behavior

In Publish Center → Website:

- **เผยแพร่ขึ้นเว็บไซต์** sets the website publication to `published`.
- The public Store API immediately exposes the product.
- Price, specs, condition and images are read live from Product Master, so edits do not need a second manual sync.
- `reserved` stays visible with `availability: "reserved"`.
- `sold`, `returned`, or `cancelled` automatically ends the Website publication at database level and removes the item from Store API results.
- Re-publishing after a sold/returned/cancelled workflow is always a deliberate manual action after the product is returned to an eligible inventory state.

## Public API

The same Cloudflare Worker now exposes public read-only endpoints:

```text
GET /store/health
GET /store/products
GET /store/products/:sku
```

Examples:

```text
/store/products?limit=24
/store/products?category=notebook&limit=24
/store/products?q=ROG
/store/products?availability=available
/store/products/AT-NB-2609-000123
```

List response:

```json
{
  "products": [
    {
      "sku": "AT-NB-2609-000123",
      "title": "ASUS TUF Gaming A17",
      "category": "notebook",
      "subtype": "gaming",
      "brand": "ASUS",
      "model": "TUF Gaming A17",
      "price": 22900,
      "conditionPercent": 90,
      "warrantyUntil": "2027-08-20",
      "defects": "มีรอยใช้งานเล็กน้อย",
      "specs": {},
      "status": "published",
      "availability": "available",
      "images": [],
      "publishedAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 24,
    "offset": 0,
    "hasMore": false
  }
}
```

## Data that is never sent to the sales website

The Store API deliberately excludes:

- Cost / margin
- Serial number / IMEI
- Internal notes
- Employee identities
- Auth/session data
- R2 credentials
- Supabase secret key

Top-level spec keys that look like serial, IMEI, cost, supplier, purchase or internal fields are also removed by the Worker before responding.

## Sales website environment

The new sales website should use only the public Worker URL, for example:

```dotenv
PUBLIC_AMPHON_STORE_API=https://YOUR-R2-WORKER.workers.dev/store
```

Product Hub itself should additionally set:

```dotenv
VITE_SALES_SITE_URL=https://shop.amphon.co.th
```

SHOP-1 canonical product ownership is:

```text
https://shop.amphon.co.th/p/{stable-listing-slug}-{sku-lower}/
```

The Batch 4.1 Product Hub link remains supported during the transition:

```text
https://shop.amphon.co.th/product/{SKU}
```

The storefront returns a permanent redirect from that legacy path to the canonical `/p/.../` route. This avoids breaking Publish Center links before SHOP-4 updates the Product Hub URL generator.

## Caching

- List API: browser/CDN cache ~30 seconds.
- Product detail API: ~15 seconds.
- Images remain long-lived immutable R2 URLs.

This gives near-real-time price/status updates without forcing the sales website to query Supabase directly.

## Recommended website rendering

For SEO, render product/category pages server-side or at request time (Astro SSR, Next.js, Cloudflare Pages/Workers, etc.) using the Store API. Avoid copying products into a second database unless a future external platform absolutely requires it.


## SHOP-1 additive commerce metadata

After `supabase/shop_1.sql` and the updated Worker are deployed, product responses can additionally include `listingSlug`, SEO title/description, index policy, category key/name/slug, and catalog Brand/Series/Model references. Existing response fields remain unchanged.
