# SHOP-6.1 — Production Closeout & End-to-End Acceptance Gate

**Release state:** `LOCAL_STATIC_PASS / BUILD_AND_LIVE_ACCEPTANCE_REQUIRED`

The code package can pass static/regression closeout while production remains **closed**. Keep `purchase_enabled = false` until every live gate below passes on the target Supabase, Cloudflare Worker, Stripe test mode, and `shop.amphon.co.th` deployment.

## Gate A — Local package / regression

Run from `shop/`:

```bash
npm install
npm run verify:foundation
npm run verify:shop2
npm run verify:shop3
npm run verify:shop4
npm run verify:shop5
npm run verify:shop6
npm run verify:production-closeout
npm run check
npm run build
```

All commands must pass. If dependency installation or build is unavailable, release remains closed even if static verifiers pass.

## Gate B — Supabase target database

Apply in order:

```text
supabase/shop_6.sql
supabase/shop_6_verify.sql
supabase/shop_6_1_acceptance.sql
```

For `shop_6_1_acceptance.sql`, every `failures` result must be `0`; the direct-grants result for `anon/authenticated` must be empty. Review `SHOP61_STORE_SETTINGS` manually.

## Gate C — Cloudflare Worker configuration

From `workers/r2-upload/` set secrets interactively; never commit values:

```bash
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Deploy the Worker and ensure the reservation expiry Cron Trigger is enabled (`*/5 * * * *`). Cron execution time is UTC; the expiry RPC itself compares timestamps in the database.

Expected live health:

```text
GET /store/health -> ok=true, version>=6
GET /health       -> shopVersion>=6
```

## Gate D — Stripe test-mode webhook

Webhook endpoint:

```text
https://<worker-host>/webhooks/stripe
```

Subscribe at minimum to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
payment_intent.succeeded
payment_intent.payment_failed
refund.updated
charge.refunded
```

The webhook secret belongs only in `STRIPE_WEBHOOK_SECRET` on the Worker.

## Gate E — Live HTTP smoke

Set shell environment variables and run:

```bash
AMPHON_STORE_API=https://<worker-host>/store \
AMPHON_SHOP_URL=https://shop.amphon.co.th \
npm run acceptance:live
```

PowerShell:

```powershell
$env:AMPHON_STORE_API="https://<worker-host>/store"
$env:AMPHON_SHOP_URL="https://shop.amphon.co.th"
npm run acceptance:live
```

This checks health/settings/robots/sitemap only. It does **not** prove payment fulfillment.

## Gate F — End-to-end provider acceptance

Use dedicated test SKUs, never real customer inventory.

| Test | Expected result |
|---|---|
| Card payment success | Webhook marks PAID; SKU `reserved → sold`; Order `PROCESSING/PACKING` |
| PromptPay success | Async webhook marks PAID; no browser callback trust |
| Browser returns success without webhook | Order stays unpaid |
| Duplicate webhook/event retry | No duplicate payment/document/stock transition |
| Wrong amount | Event rejected; Order not PAID; SKU not SOLD |
| Wrong currency | Event rejected; Order not PAID; SKU not SOLD |
| Checkout expiry | Order EXPIRED; active reservation released; eligible SKU returns `published` |
| Manual bank transfer | Staff may confirm only non-Stripe Order |
| Stripe refund | Admin request → REFUND_PENDING → webhook REFUNDED; SKU becomes `returned` |
| Shipping | PACKING → SHIPPED → IN_TRANSIT → DELIVERED → COMPLETE |
| Pickup | PACKING → PICKUP_READY → COMPLETE |
| Receipt/invoice | Immutable document snapshot exists and token page is noindex/no-store |
| Warranty | Completed eligible SKU receives certificate using checkout-time warranty snapshot |

## Gate G — Before purchase activation

Only after Gates A–F pass:

1. Confirm real shipping/return policy.
2. Confirm Turnstile production site key/secret.
3. Confirm Stripe production keys + production webhook separately from test mode, and keep Stripe reservation duration at 45 minutes or more (Stripe session expires 10 minutes earlier).
4. Confirm seller document details and warranty terms.
5. Enable the intended payment methods.
6. Enable `purchase_enabled` from Product Hub Commerce Admin.
7. Place one low-risk production order and reconcile Product Hub stock, Stripe, Order, shipment, document and warranty records.

If any reconciliation differs, set `purchase_enabled=false` and investigate before accepting new orders.

## Rollback / emergency close

The first response to a checkout/payment incident is to disable `purchase_enabled`. This stops new public checkout while preserving existing orders, payment events, shipment history, documents and warranties for reconciliation. Do not delete provider events or manually republish refunded devices.
