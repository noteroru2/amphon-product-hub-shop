# SHOP-6.2 Provider E2E Report

Date: 2026-09-12 (Asia/Bangkok)  
Provider: Stripe Sandbox / TEST mode  
Harness: isolated `amphon-shop62-e2e` Workers.dev deployment

## Verdict

Historical SHOP-6.2 PROVIDER E2E: **PASS_WITH_WARNING**

The original applicable provider matrix passed. Its acceptance evidence was subsequently and intentionally invalidated when SHOP-6.3 changed critical production settings. The repaired isolated harness must be run again to record fresh evidence. Public purchasing remains disabled.

## Isolated route contract repair

The harness calls `POST /__shop62/checkout` with JSON fields `sku`, `providerMethod`, and `deliveryMethod`, plus `Content-Type: application/json` and the private `x-shop62-token` header. The Worker implements that exact route in `workers/r2-upload/src/index.ts`, and the generated isolated Wrangler config deploys that same entrypoint.

The previous harness began the matrix immediately after deployment and reduced any non-JSON 404 body to `{}`. It therefore could not distinguish an edge/version/token-binding propagation delay from a missing route. An authenticated, side-effect-free `GET /__shop62/readiness` contract is now compiled alongside checkout. Before creating fixtures, the harness verifies public health, rejection without a token, rejection with a wrong token, eventual acceptance of the current token, `purchase_enabled=false`, and that the probe creates no order. Checkout failures now include method, path, status, content type, bounded response body, and Worker URL without printing any credential.

Turnstile is reported as `SKIPPED_ISOLATED_TEST_ROUTE`: the isolated token route intentionally bypasses public activation and Turnstile, while the production `/store/checkout` Turnstile validation remains unchanged.

## Acceptance matrix

| Check | Status | Evidence |
|---|---|---|
| Card payment | PASS | Real Stripe TEST Checkout completed for THB 19.00 |
| Signed webhook | PASS | Two Stripe payment lifecycle events were signed, processed and linked to the order |
| Duplicate webhook | PASS | Same provider event replay remained idempotent |
| Amount mismatch | PASS | Signed mismatched test event rejected without payment transition |
| Currency mismatch | PASS | Signed non-THB test event rejected without payment transition |
| Reservation expiry | PASS | Controlled unpaid reservation expiry released inventory |
| Shipping lifecycle | PASS | PACKING → SHIPPED → DELIVERED completed |
| Pickup lifecycle | PASS | PAID → PICKUP_READY → PICKED_UP completed without shipping fields |
| Receipt snapshot | PASS | `AT-RCP-260912-000003`, opaque public token, immutable JSON snapshots |
| Warranty snapshot | PASS | Issued from order-item warranty snapshot after fulfillment |
| Refund | PASS | Stripe TEST refund webhook completed |
| Returned product | PASS | Refunded physical SKU transitioned to RETURNED, not PUBLISHED |
| Warranty void | PASS | Warranty transitioned to VOID after full refund |
| PromptPay | SKIPPED_NOT_ENABLED | `stripe_promptpay_enabled=false`; no PASS was fabricated |
| Turnstile | SKIPPED_NOT_ENABLED | `checkout_turnstile_enabled=false`; server verification path remains present statically |
| Cleanup | PASS | AT-TST fixtures, isolated Worker and temporary Stripe test webhook removed |
| purchase_enabled guard | PASS | `purchase_enabled=false` throughout and after acceptance |

## Card database evidence before cleanup

- Order: `ATSO-260912-000007`
- Payment/order state: `PAID` / `PROCESSING` / `PACKING`
- Currency and total: `THB 19.00`
- Checkout Session and Payment Intent: both linked
- Provider state: `PAID`
- Product: `AT-TST-CARD-MTYBLI1D9DFC0B`, transitioned to `sold`
- Active reservation rows after payment: zero
- Payment events: two distinct processed `PAYMENT_SUCCEEDED` Stripe lifecycle events, each `amount_minor=1900`, `currency=THB`
- Payment ledger: one Stripe transaction, `PAID`, THB 19.00
- Receipt: one `RECEIPT_ONLY` document with opaque UUID token and seller/customer/totals/items snapshots
- Public projection does not expose internal order/product UUIDs, payment IDs, cost, margin, serial or secrets. Buyer contact data is present only inside the capability-token receipt snapshot by design.

## Current commerce settings

| Setting | Current value |
|---|---:|
| purchase_enabled | false |
| stripe_enabled | true |
| stripe_promptpay_enabled | false |
| shipping_enabled | true |
| return_policy_enabled | true |
| checkout_turnstile_enabled | true |
| pickup_enabled | true |

Production Store Worker, Shop homepage, robots.txt and sitemap.xml returned HTTP 200 after E2E. Production Worker secret binding names for Supabase, Stripe, webhook signing and Turnstile are present; secret values were not read or exposed.

## Cleanup and activation safety

- Isolated Worker `amphon-shop62-e2e`: removed
- Temporary Stripe TEST webhook: removed
- Temporary local Wrangler/secrets files: removed
- SHOP62 DB test token: cleared by successful acceptance recording
- Production Worker `amphon-product-images`: untouched
- Production Stripe webhook: untouched
- No production activation was performed

Next run `SHOP62-PROVIDER-E2E.bat`. Only a genuine complete matrix may record fresh acceptance evidence. Then run the read-only `SHOP62-FINAL-ACTIVATION-CHECK.bat`.
