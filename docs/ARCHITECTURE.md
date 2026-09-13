# AMPHON Product Hub Architecture — Batch 2

## Principle

There is one Product Master. The future sales website and Amphon System must not maintain separate copies of stock as their source of truth.

```text
iPhone / iPad / Android PWA
           |
           | Supabase Auth session
           v
+-------------------------------+
| AMPHON Product Hub (React PWA)|
+-------------------------------+
       |                 |
       | CRUD / Realtime | authenticated binary image requests
       v                 v
+---------------+   +--------------------------+
| Supabase      |   | Cloudflare Worker        |
| Postgres/RLS  |   | validates Supabase user  |
+---------------+   +-------------+------------+
                                  |
                                  | R2 binding
                                  v
                         +------------------+
                         | Cloudflare R2    |
                         | product images   |
                         +------------------+
```

## Database ownership

- `products`: shared product master and sellable state
- `product_images`: R2 object metadata and cover ordering
- `product_financials`: cost/margin, Owner/Admin only
- `profiles`: staff role and active state
- `activity_logs`: audit trail

## SKU

A PostgreSQL trigger generates SKU on insert so two phones cannot race while generating IDs locally.

Format:

```text
AT-{CATEGORY}-{YYMM}-{GLOBAL_SEQUENCE}
```

Example:

```text
AT-NB-2609-000001
```

## Mobile resilience

Dexie/IndexedDB keeps the working draft including compressed image blobs. The remote product ID and every completed upload are written back into the draft. If the network drops halfway through 15 photos, retry continues the remaining photos instead of creating a second product.

## Upload path

The browser does not use S3/R2 credentials and does not require direct R2 CORS configuration.

```text
PWA
  -> Authorization: Bearer <Supabase token>
  -> POST Worker /upload
  -> Worker calls Supabase /auth/v1/user
  -> Worker checks product via Supabase REST + RLS
  -> env.IMAGES.put(...) through R2 binding
  -> Worker returns objectKey + publicUrl
  -> PWA inserts product_images row
```

## Realtime

`products` and `product_images` are added to the Supabase Realtime publication. Connected devices subscribe to changes and refresh inventory when another device adds or edits a product.

## Failure semantics

When new photos are being uploaded, the product is temporarily saved as `draft`. Only after all new images are registered does the client move the product to the desired status. A partial image failure therefore cannot accidentally expose a half-finished item as Ready to List/Published.

## Integration boundary for later batches

Future consumers should integrate through Product Hub APIs/adapters rather than writing their own product database:

```text
Product Master
   |-- Sales Website adapter
   |-- Amphon System adapter
   |-- Facebook/Marketplace workflow
   |-- Reporting/commission workflow
```
