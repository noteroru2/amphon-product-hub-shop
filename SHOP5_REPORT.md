# SHOP-5 — Cart + Atomic Reservation + Checkout + Order Management

**Status:** `IMPLEMENTED_WITH_BUILD_ENVIRONMENT_WARNING`

## Implemented
- Astro customer Cart / Checkout / Order status pages
- Product-page Add to Cart when store checkout is enabled
- PostgreSQL atomic checkout with deterministic `FOR UPDATE` locking
- one active reservation per physical SKU
- UUID checkout idempotency + advisory transaction lock for concurrent retries
- Cloudflare Turnstile client challenge + mandatory Worker Siteverify validation before stock reservation
- stale reservation release before availability re-check
- scheduled order/reservation expiry
- bank-transfer payment notification and extended payment-review hold
- pickup + pay-at-store option
- Product Hub Online Orders UI for Owner/Admin/Sales
- staff actions: confirm payment, cancel unpaid, packing/shipping/tracking, pickup ready, complete, refund
- sold/expired/cancelled inventory transitions integrated with existing publication lifecycle
- public order lookup through opaque UUID token
- order/customer PII isolated from anonymous Supabase access
- checkout configuration added to Commerce Admin
- SHOP-4 purchase lock removed only in SHOP-5 migration
- Store API health marker advanced to v5

## Core safety properties
1. Inventory availability is revalidated server-side during checkout; cart state is not trusted.
2. Requested product rows are locked in deterministic SKU order.
3. Every requested SKU must pass Website publication + price + `published` checks; partial cart validation is rejected.
4. `commerce_reservations.product_id` is a primary key, so a physical unit cannot hold two active reservations.
5. Order creation and reservations occur in one PostgreSQL transaction.
6. Checkout uses a UNIQUE idempotency key and transaction advisory lock, so simultaneous retries with the same key serialize.
7. Public checkout requires a server-validated Turnstile token before the order RPC can run.
8. Anonymous/authenticated clients do not read order tables directly.
9. Paid orders require explicit refund workflow rather than silently returning inventory to sale.

## Payment baseline
SHOP-5 deliberately implements `BANK_TRANSFER` and optional `PAY_AT_STORE` only. No third-party gateway credential or unverified webhook flow is embedded. The data model is ready for a provider adapter in a later batch.

## QA status
Static/regression gates are included through `npm run verify:shop5`. A dependency-resolved Astro/Vite build must still be run on an internet-connected development/CI environment before production release; this execution environment cannot reliably complete package installation.

## Deployment order
1. Apply `supabase/shop_5.sql`.
2. Run `supabase/shop_5_verify.sql` and require zero integrity mismatches/public grants.
3. Redeploy `workers/r2-upload`; confirm its cron schedule is installed.
4. Configure Worker secret `TURNSTILE_SECRET_KEY`, then rebuild AMPHON Product Hub.
5. Rebuild/deploy `shop/`.
6. Configure live shipping/return/bank-transfer values and a Turnstile site key before turning on `purchase_enabled`.
7. Run concurrency/expiry/payment lifecycle smoke tests before public launch.

See `docs/SHOP5_CHECKOUT_ORDER_PLAYBOOK.md` for the state machine and operating procedure.
