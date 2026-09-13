# SHOP-6 — Payment Gateway + Shipping / Tracking + Invoice / Warranty Fulfillment

**Verdict:** `IMPLEMENTED_WITH_BUILD_ENVIRONMENT_WARNING`

## Implemented

- Stripe hosted Checkout adapter with Card and optional PromptPay for THB. Stripe-enabled orders require at least a 45-minute DB reservation, while the Stripe Session expires 10 minutes earlier to leave a webhook/reconciliation grace window.
- Worker-only `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- Raw-body Stripe signature verification before payment state mutation.
- Idempotent provider-event ledger and immutable order amount/currency verification.
- Payment success transitions the reserved physical SKU to `sold` through the database RPC.
- Stripe refund request from Product Hub; provider webhook finalizes refund.
- Full successful refund moves sold SKU to `returned`, never directly to `published`.
- Shipment lifecycle with carrier, tracking number, tracking URL, SHIPPED → IN_TRANSIT → DELIVERED.
- Immutable receipt/invoice snapshots and token-only `noindex/no-store` public document route.
- Store-wide warranty defaults plus per-SKU warranty overrides snapshotted at checkout.
- Warranty certificate issued after completed fulfillment, with token-only public warranty route.
- Product Hub Commerce settings UI for Stripe, PromptPay, documents, seller document data, and warranty defaults.
- Product Hub Order Management disables manual payment confirmation for Stripe orders and exposes shipping/refund state.
- Store API marker upgraded to v6.

## Security boundary

No Stripe secret, webhook secret, Supabase service secret, cost, margin, serial/IMEI, employee data or customer PII is added to the public catalog projection. Order/document/warranty access uses opaque public tokens and `no-store` responses; database tables remain RLS-protected and direct anon/authenticated grants are revoked.

## Build warning

Regression/static verification can be executed from this package. Dependency-resolved Astro/Cloudflare build still requires normal package installation on the deployment machine. Do not interpret static PASS as production-payment PASS.
