# SHOP-7.2 — First Controlled Real Order Runbook

Status: **NOT AUTHORIZED FOR EXECUTION BY SHOP-7.1**  
Prerequisite: SHOP-7.1 has a selected, published, verified real product and the owner explicitly approves one controlled live transaction.

Selected SHOP-7.1 product: `AT-PC-2609-000002` — Apple MacBook Neo — THB 21,900. Reconfirm all three values and `available` status immediately before the controlled order.

## Safety boundary

- Use exactly one real available product and one intentional customer checkout.
- The owner, not automation, enters payment details and approves the live charge.
- Keep `purchase_enabled=true`, Stripe cards enabled, and PromptPay disabled.
- Never use Stripe test cards or test keys against production.
- Do not change secrets, webhooks, migrations, or unrelated products.
- Capture only sanitized IDs: order number, SKU, Stripe object suffixes, timestamps, and status. Never capture card data, cookies, customer secrets, or credentials.
- `SHOP64-EMERGENCY-CLOSE.bat` is the authorized kill switch only for a genuine critical incident and only when the owner explicitly directs its use.

## Controlled transaction procedure

1. **Confirm availability.** In Product Hub, authenticate as owner/authorized staff, open Products and Inventory, locate the SHOP-7.1 SKU, and confirm it remains `published`/`available`, is not sold, and has no active reservation.
2. **Confirm price.** Compare the Hub selling price, Store API/PDP price, and cart price. Stop on any mismatch.
3. **Confirm health.** Check `https://shop.amphon.co.th`, Store API `/store/health`, and API Worker `/health`; all must return healthy HTTP 2xx responses.
4. **Confirm commerce controls.** Read Store settings and confirm `purchaseEnabled=true`, `checkout.enabled=true`, `stripeEnabled=true`, `promptPayEnabled=false`, Turnstile enabled, and the reservation window is 60 minutes. Do not patch settings.
5. **Create one controlled checkout.** From the public PDP add the selected SKU once, verify the cart has one unit, choose shipping or pickup deliberately, enter truthful controlled-customer details, pass Turnstile, and submit once. Record the sanitized order number and reservation expiry.
6. **Owner performs payment.** Verify the Stripe Checkout host and exact total. The owner manually enters their own permitted card details and explicitly confirms the one live charge. No automation handles card data.
7. **Verify Stripe LIVE payment.** In Stripe Dashboard, verify mode is LIVE, amount/currency/order metadata match, payment succeeded exactly once, and capture only sanitized payment/session identifiers.
8. **Verify webhook delivery.** Confirm the signed production webhook event was delivered successfully to the configured endpoint. Record event type, timestamp, HTTP result, and sanitized event suffix; do not replay unless the documented idempotent recovery requires it.
9. **Verify order state.** In Hub Orders, confirm the same order is `PROCESSING` (or current paid equivalent), payment is `PAID`, and provider status matches Stripe.
10. **Verify reservation conversion.** Confirm the temporary reservation is no longer an expiring unpaid hold and is attached to the paid order lifecycle.
11. **Verify inventory transition.** Confirm the selected product is `sold`/unavailable and cannot be reserved by another checkout.
12. **Verify storefront state.** Reload PDP, category, home, cart, and Store API. The product must no longer be presented as available or purchasable; stale cart checkout must be blocked.
13. **Verify receipt snapshot.** Open the order document using its public token path from the order UI. Confirm `RECEIPT_ONLY`, seller/customer snapshot, SKU, price, shipping, total, and issue timestamp. Do not claim e-Tax/e-Receipt.
14. **Verify warranty snapshot.** Confirm warranty certificate/snapshot uses the product-specific warranty or the configured default (currently 0 days) without inventing coverage.
15. **Verify fulfillment workflow.** For shipping, move only through PACKING → SHIPPED → IN_TRANSIT → DELIVERED with real tracking data. For pickup, move to PICKUP_READY, verify identity at handoff, then complete. Do not mark future steps early.
16. **Verify no duplicate.** Search Hub Orders and Stripe for the order number/idempotency metadata. Confirm one order, one successful payment, one sold inventory item, and duplicate webhook processing did not duplicate side effects.
17. **Record evidence.** Save timestamps, sanitized IDs, status screenshots, totals, fulfillment mode, document/warranty results, and any warnings in the SHOP-7.2 report. Redact personal and secret information.
18. **Close or recover.** If all checks pass, record SHOP-7.2 PASS/PASS_WITH_WARNING. If any invariant fails, stop fulfillment, preserve evidence, follow the matching recovery path below, and do not run speculative DB commands.

## Failure and recovery matrix

| Failure boundary | Safe response |
|---|---|
| Payment succeeds, webhook delayed | Do not charge again. Keep the order/product untouched, verify Stripe event delivery and Worker health, wait for normal reconciliation, then use the established idempotent webhook/reconciliation path. |
| Payment succeeds, order not updated | Treat Stripe as payment evidence, preserve IDs/timestamps, block duplicate payment, escalate for reconciliation through the existing verified-provider event contract. Never mark paid from a browser redirect. |
| Order paid, stock still available | Treat as critical oversell risk. Stop additional checkout for that SKU through the normal publication/inventory workflow; if site-wide exposure is critical, ask the owner whether to run the emergency close kill switch. Reconcile the paid order before resuming. |
| Inventory reserved, payment abandoned | Do not delete rows. Allow the configured 60-minute reservation and scheduled expiry path to release stock; confirm order becomes `EXPIRED` and product returns to available only after expiry. |
| Duplicate webhook | Confirm the provider event ID is recognized as duplicate and creates no second payment transition, document, warranty, or inventory mutation. Escalate only if side effects differ. |
| Duplicate checkout attempt | Reuse/inspect the established idempotency result; do not submit repeatedly. Confirm there is one order/reservation for the SKU and cancel only through the Hub action if unpaid and owner-authorized. |
| Shipping state incorrect | Stop fulfillment action, compare real carrier state, then use only supported Hub transitions and truthful tracking fields. Record correction evidence. |
| Pickup state incorrect | Do not hand over until the paid order and customer identity are verified. Use supported PICKUP_READY/completion actions only. |
| Product purchasable after sale | Treat as an oversell incident. Confirm source inventory is sold, publication/store read model is current, and prevent further checkout for the SKU. Consider emergency close only with explicit owner direction. |
| Receipt/document fails | Do not invent or manually alter the snapshot in DB. Preserve the paid order data, inspect document-generation status/Worker logs, and repair through the existing order/document contract. |
| Warranty snapshot missing | Do not promise coverage. Preserve product/order settings at sale time, inspect snapshot generation, and repair through the existing warranty/order workflow with owner-approved truthful terms. |

## Completion evidence checklist

- One sanitized SKU and order number
- One Stripe LIVE successful payment and one webhook event
- Hub order/payment/fulfillment states
- Inventory sold/unavailable and public storefront result
- Receipt-only document snapshot and accurate warranty snapshot
- No duplicate order, payment, webhook side effect, or active listing
- Production settings after the run, explicitly showing PromptPay remains disabled
