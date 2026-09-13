# SHOP-6 — Payment Gateway + Shipping / Tracking + Invoice / Warranty Fulfillment

## Release contract

SHOP-6 extends SHOP-5 without replacing its atomic reservation model. A physical SKU is still reserved transactionally in PostgreSQL before payment begins. Stripe/browser redirects are never proof of payment. Only the verified server-side provider event can move the order to PAID and the product from `reserved` to `sold`.

## Payment adapters

Supported baseline payment methods are `BANK_TRANSFER`, `PAY_AT_STORE`, and `STRIPE`. Stripe is the first hosted-gateway adapter. Card is always requested when Stripe is enabled; PromptPay is optional and only exposed for THB. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are Cloudflare Worker secrets and must never be stored in Product Hub, Supabase settings, Astro public env, or source control.

Stripe webhook endpoint: `/webhooks/stripe`.

Handled events include `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.updated`, and full `charge.refunded`.

When Stripe is enabled, the DB reservation must be at least 45 minutes. The Stripe Checkout Session is configured to expire 10 minutes before the DB reservation, leaving a reconciliation/webhook grace window. The Worker verifies the `Stripe-Signature` against the raw request body before normalizing the event into the database payment-event ledger. Provider event IDs are unique, so retries are idempotent. Before PAID, the database verifies amount and currency against the immutable order snapshot.

## Refund safety

Stripe refund is initiated from Product Hub, but the order is not marked REFUNDED from the browser/admin request. The provider webhook finalizes the refund. A full successful refund moves sold physical SKUs to `returned`, never directly to `published`; the device must be inspected before re-listing.

## Shipping and tracking

A shipment record stores carrier, tracking number, tracking URL and lifecycle. Staff actions cover shipped, in-transit and delivered. Public order tracking only exposes the safe shipment fields needed by the buyer.

## Documents

`commerce_documents` stores an immutable seller/customer/totals/items snapshot. Public access is token-only through `/store/documents/:token` and the storefront `/document/:token/` route. These routes are `noindex`, `noarchive`, and `no-store`.

`VAT_TAX_INVOICE` mode requires seller name, tax ID and address. The generated document is an application record/snapshot; it does not claim automatic integration with Thailand e-Tax Invoice/e-Receipt.

## Warranty

Store settings provide default warranty days/terms. Each SKU can override them in Product Commerce Editor. The effective warranty is snapshotted into the order item at checkout, so later configuration changes cannot alter the customer’s historical entitlement. Warranty certificates are issued only after successful fulfillment completion.

## Deployment secrets

From `workers/r2-upload`:

```bash
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Never paste secret values into source, SQL, `.env.example`, Product Hub settings, screenshots, or support logs.

## Required provider configuration

Create a Stripe webhook pointing at:

```text
https://<YOUR-WORKER>/webhooks/stripe
```

Subscribe to the SHOP-6 event set listed above. Test first with Stripe test mode. Do not enable `purchase_enabled` on production until card/PromptPay success, duplicate webhook, expiry, refund and amount-mismatch rejection have passed the live acceptance matrix.

## Fulfillment acceptance scenarios

1. Card payment success → verified webhook → PAID → SKU SOLD → PACKING.
2. PromptPay success → async verified webhook → PAID → SKU SOLD.
3. Browser success redirect without webhook → must remain unpaid.
4. Duplicate provider event → no duplicate stock/document/payment transition.
5. Wrong amount/currency event → reject; SKU must not become SOLD.
6. Checkout expires → order EXPIRED and reserved SKU returns to published when eligible.
7. Full refund → REFUND_PENDING → provider success → REFUNDED + SKU RETURNED.
8. Shipping → SHIPPED → IN_TRANSIT → DELIVERED → COMPLETE.
9. Pickup → PICKUP_READY → COMPLETE.
10. Receipt/invoice snapshot remains unchanged after later store-setting changes.
11. Warranty certificate reflects checkout-time SKU/default warranty snapshot.
