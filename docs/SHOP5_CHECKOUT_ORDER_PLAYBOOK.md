# SHOP-5 Checkout & Order Playbook

## Scope
SHOP-5 makes `shop.amphon.co.th` transaction-capable without coupling AMPHON to one payment gateway. The AMPHON Product Hub remains the inventory source of truth.

## Customer flow
1. Product page → Add to cart.
2. Cart re-fetches current public product state; stale, sold, or reserved SKUs cannot continue.
3. Checkout requires a Cloudflare Turnstile challenge; the Worker validates the single-use token server-side before any stock lock is attempted.
4. Checkout submits 1–10 distinct SKUs plus a UUID idempotency key.
6. `create_commerce_order()` locks all product rows in deterministic SKU order with `FOR UPDATE`, releases stale reservations, verifies every requested SKU is still Website-published, priced, and `published`, then creates the order/reservations in one transaction.
5. Each physical product has at most one active `commerce_reservations` row because `product_id` is the primary key.
6. Product state becomes `reserved` until payment confirmation, expiry, or cancellation.

## Initial payment methods
- `BANK_TRANSFER`: customer gets bank instructions only inside the opaque-token order page. Customer may submit a payment reference; order becomes `PAYMENT_REVIEW` and the reservation is extended for staff review.
- `PAY_AT_STORE`: only allowed with `PICKUP` when both pickup and pay-at-store are enabled.

No card/QR gateway is hard-coded in this batch. Future providers should be adapters that update the same order/payment state machine; they must not bypass reservation ownership.

## State model
### Order
`AWAITING_PAYMENT → PAYMENT_REVIEW → PROCESSING → SHIPPED → COMPLETED`

Terminal alternatives: `CANCELLED`, `EXPIRED`, `REFUNDED`.

### Payment
`UNPAID → REVIEW → PAID → REFUNDED`

### Fulfillment
`UNFULFILLED → PACKING → SHIPPED → DELIVERED`

Pickup path: `UNFULFILLED → PACKING → PICKUP_READY → PICKED_UP`.

## Reservation expiry
- Default reservation: 60 minutes, configurable 10–240 minutes.
- Cloudflare Worker cron calls `expire_commerce_reservations()` every 5 minutes.
- Expired unpaid orders release reservation rows and return product status from `reserved` to `published`.
- A bank-transfer payment notification changes status to `PAYMENT_REVIEW` and extends the hold (default 24 hours) to prevent automatic release while staff verifies payment.

## Payment confirmation
Only authenticated Product Hub staff use the admin action RPC through the Worker. `CONFIRM_PAYMENT` changes every reserved product to `sold`, removes active reservations, marks the order paid/processing, and lets the existing publication lifecycle end the live sale while preserving the sold SEO product page.

## Cancellation and refunds
- Unpaid orders can be cancelled and stock is returned to `published`.
- Paid orders cannot use normal CANCEL; they require `REFUND` (Owner/Admin only).
- Refund moves sold products to `returned`. Reinspection/relisting remains an explicit inventory workflow; SHOP-5 does not silently republish returned goods.

## Privacy boundary
Customer name, phone, email and address live only in order tables protected by RLS. `anon` and normal `authenticated` database roles receive no direct SELECT. Product Hub retrieves PII through the authenticated Worker with role checks. Public order lookup requires a random UUID `public_token`; bank details are returned only for that specific unpaid bank-transfer order, not from `/store/settings`.

Treat an order-status URL as sensitive. Do not put its token in analytics dimensions, logs intended for third parties, or Merchant structured data.

## Idempotency
Every checkout request has a UUID `idempotency_key` stored UNIQUE. Browser retry/double-click with the same key returns the already-created order rather than creating another order. A new checkout attempt after a deliberate cart change should use a new key.

## Merchant activation
`purchase_enabled` can be enabled only after real Shipping, Bank Transfer, Return Policy, and Cloudflare Turnstile settings are complete. The Turnstile site key is public configuration; `TURNSTILE_SECRET_KEY` lives only as a Worker secret. Per-SKU `merchant_enabled` remains a separate readiness gate. This keeps product availability/Offer claims aligned with an actually purchasable storefront.

## Production rollout
1. Apply SHOP-1 → SHOP-5 migrations in order.
2. Run `supabase/shop_5_verify.sql`.
3. Set `TURNSTILE_SECRET_KEY` with `wrangler secret put TURNSTILE_SECRET_KEY`, then redeploy `workers/r2-upload` with the scheduled cron trigger.
4. Configure real shipping, returns and bank-transfer settings in Product Hub.
5. Test with a non-production/controlled SKU before enabling checkout store-wide.
6. Verify two simultaneous checkout attempts for the same SKU: exactly one must succeed.
7. Verify expiry returns a reserved SKU to published.
8. Verify payment notification extends reservation and staff confirmation marks the SKU sold.
9. Verify cancellation/refund states before opening public checkout.

## Hardening backlog
SHOP-5 implements Turnstile server-side challenge validation to reduce automated reservation abuse. It does not claim these are implemented: payment-gateway webhook verification, fraud scoring beyond Turnstile, SMS/email notifications, shipping-carrier API, automated refund disbursement, or additional edge/KV rate limiting. Add them as separate controlled integrations rather than weakening the order transaction.
