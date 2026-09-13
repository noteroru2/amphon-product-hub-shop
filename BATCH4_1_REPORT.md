# Batch 4.1 — Sales Website Integration Report

Status: `IMPLEMENTED_PENDING_ENVIRONMENT_BUILD`

## Implemented

- Website publication is now a real Product Hub → Store API gate.
- Website product URL uses `VITE_SALES_SITE_URL/product/{SKU}`.
- Safe `website_products` database projection.
- Public read-only Store API from the existing Cloudflare Worker.
- Product list/detail endpoints.
- Category, subtype, query and availability filtering.
- Pagination metadata.
- Public responses exclude cost, serial/IMEI, internal notes and employee data.
- Additional Worker-side spec-key filtering for sensitive-looking fields.
- Product price/spec/image edits are reflected through live Product Master reads.
- Reserved product availability support.
- Database trigger auto-unpublishes Website when product becomes sold/returned/cancelled.
- Auto-unpublish is written to product activity history.
- Publish Center Website UI has Publish/Unpublish, copy stable URL and open-page actions.
- No new npm dependencies.

## Deployment requirements

1. Run `supabase/batch4_1.sql` after Batch 4.
2. Add `VITE_SALES_SITE_URL` to the Product Hub `.env` when the sales domain is known.
3. Redeploy the existing Cloudflare Worker because its code now contains Store API routes.
4. Keep the existing `SUPABASE_SECRET_KEY` Worker secret from Batch 3.4.
5. Run frontend and Worker typechecks/builds on the development machine.

## Public API

- `GET /store/health`
- `GET /store/products`
- `GET /store/products/:sku`

The new sales website should consume the public Worker API. It should not use Supabase credentials directly.
