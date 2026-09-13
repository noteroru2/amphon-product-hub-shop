# Batch 4 — Publish Center Report

Status: `IMPLEMENTED_WITH_ENVIRONMENT_WARNING`

## Implemented

- New `product_publications` Supabase table with one row per product/channel.
- Channels: Facebook, Marketplace, WINNER IT, Website.
- States: not published, published, ended.
- Publisher/ender name + timestamp snapshots.
- Listing URL storage.
- RLS: all active staff can read; Owner/Admin/Sales can write; Owner/Admin can delete.
- Supabase Realtime publication updates.
- Publish Center work queues: waiting, partial, complete and sold-listing cleanup.
- Per-product 4-channel progress.
- Mobile publication detail sheet.
- Copy channel content and share images from the same workflow.
- Overall product status synchronization with active publication state.
- Sold-item cleanup workflow: sold products stay visible only while a live listing remains.
- Activity log entry for publication changes.
- Home and Inventory shortcuts into Publish Center.
- Website channel schema is intentionally ready for Batch 4.1 automatic sales-site integration.

## Guardrails

- Draft/photo-only/repair/cancelled/returned products cannot be marked published from Publish Center.
- Technician is read-only for publication state.
- Listing URL accepts only HTTP/HTTPS when present.
- Publish Center never contains product cost.
- Publish Center does not claim or attempt automatic Facebook/Marketplace posting.
- Sold/reserved product status is not downgraded by publication cleanup.

## Deployment

Run once:

```text
supabase/batch4.sql
```

Then keep the existing `.env` and Worker. No Worker redeploy and no new npm dependency are required.

Final machine gate:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Verification performed here

- New Batch 4 files strict static type audit with temporary dependency shims: `PASS`.
- TS/TSX syntax transpilation audit: `PASS` (0 syntax diagnostics).
- Batch 4 feature presence audit: `PASS`.
- `npm install` attempted in this environment but registry access timed out, so dependency-resolved build must still run on the user's normal internet-connected machine.
