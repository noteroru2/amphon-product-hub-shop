# Batch 3.2 — Product Schema & Smart Form

Status: `IMPLEMENTED_WITH_ENVIRONMENT_WARNING`

## Implemented

- Structured `category + subtype + dynamic specs` architecture
- 12 main product categories
- Category-specific subtype choices
- Required / Recommended / Optional field metadata
- Mobile smart form grouped into Main / Specs / Condition / Accessories
- Notebook, Desktop PC, iPhone, Android, Tablet, Camera, Lens, Monitor, Gaming Console, Component and Accessories schemas
- Component form changes again by subtype (CPU/GPU/RAM/SSD/HDD/PSU/etc.)
- Data Completeness Score
- Ready-to-list validation in UI and backend
- Minimum 80% score plus all required fields for Ready/Published
- Image role metadata and mobile image-role selector
- Schema-aware content/spec labels
- Role-aware ZIP filenames (`01-cover.jpg`, `02-screen.jpg`, etc.)
- Supabase migration `supabase/batch3_2.sql`
- Full `supabase/schema.sql` updated for fresh projects and re-runs
- No R2 Worker API changes

## Database changes

- `products.subtype text`
- category constraint expanded with `lens`, `monitor`, `accessory`
- `product_images.image_role text`
- SKU prefixes: Lens `LNS`, Monitor `MON`, Accessories `AC`

Existing rows are preserved and backfilled with compatible subtype/image-role values.

## Verification

- TypeScript/TSX parser check using TypeScript compiler API: `PASS`
- Strict app type/static check using temporary dependency shims: `PASS`
- SQL migration reviewed for idempotent re-run: `PASS`
- `npm install` in this execution environment: `TIMEOUT` while reaching npm registry

Because dependencies could not be resolved in this environment, run the final real checks on the normal internet-connected development PC:

```bash
npm install
npm run typecheck
npm run build
```

Do not call the deployment final until those commands pass.

## Upgrade order from Batch 3.1

1. Keep the working `.env` from the previous project.
2. In Supabase SQL Editor run `supabase/batch3_2.sql`.
3. Replace/update the frontend with Batch 3.2.
4. Run `npm install`.
5. Run `npm run typecheck`.
6. Run `npm run build`.
7. Run `npm run dev` and test one product from each important category.

No Cloudflare R2 Worker redeploy is required.
