# AMPHON ONE-4 — Shop Reservation / Checkout → System Stock Authority

## Goal

AMPHON System is the only authority that can reserve, release, or sell a ONE-managed physical unit. Product Hub remains the content/availability projection. Shop remains the customer order, payment-provider, fulfillment, document, and warranty surface.

## Required checkout sequence

1. Shop validates the checkout request and Turnstile/member requirements.
2. Shop server calls the HMAC-protected AMPHON System reservation endpoint.
3. System atomically accepts all requested exact SKUs or rejects the whole reservation.
4. Only after System accepts may Shop create its commerce order.
5. System projects RESERVED to Hub asynchronously through the existing durable outbox.
6. If Shop order creation fails after reserve, Shop requests System release before any payment session is created.
7. ONE-4C moves payment-confirmed → SOLD and expiry/cancel → RELEASE through System authority.

## Fail closed

- `ONE4_SYSTEM_STOCK_ENABLED=false` in source/runtime until ONE-4B activation.
- `ONE4_SHOP_AUTHORITY_ENABLED=false` in System until controlled activation.
- `purchase_enabled=false` remains mandatory until ONE-4D final activation.
- Existing checkout/order/payment code is preserved behind these gates during migration.
- No QC or technical-inspection stage is introduced.
