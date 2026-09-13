# SHOP-6.4 Owner Activation Report

- Timestamp: 2026-09-13T11:39:34.6487621+07:00
- Result: ACTIVATED
- Live Stripe owner confirmation received: True
- Owner activation phrase received: True
- Final purchase_enabled: True

## Preflight

| Check | Status | Detail |
|---|---|---|
| purchase_enabled is closed before activation | PASS | purchase_enabled=False |
| SHOP-6.2 acceptance version | PASS | SHOP-6.2 |
| Provider evidence: provider | PASS | STRIPE |
| Provider evidence: mode | PASS | test |
| Provider evidence: harness | PASS | isolated-workers-dev |
| Provider evidence: card | PASS | PASS |
| Provider evidence: signedWebhook | PASS | PASS |
| Provider evidence: duplicateEvent | PASS | PASS |
| Provider evidence: amountMismatch | PASS | PASS |
| Provider evidence: currencyMismatch | PASS | PASS |
| Provider evidence: reservationExpiry | PASS | PASS |
| Provider evidence: shippingLifecycle | PASS | PASS |
| Provider evidence: pickupLifecycle | PASS | PASS |
| Provider evidence: documentSnapshot | PASS | PASS |
| Provider evidence: warrantySnapshot | PASS | PASS |
| Provider evidence: refundReturned | PASS | PASS |
| Provider evidence: warrantyVoided | PASS | PASS |
| Provider evidence: promptPay | PASS | SKIPPED_DISABLED |
| No active AT-TST fixtures | PASS | active=0; products(all states)=0; historical orderItems=0 |
| No DB SHOP62 test token | PASS | Token hash/expiry must be null. |
| Stripe enabled | PASS | stripe_enabled=True |
| PromptPay disabled | PASS | stripe_promptpay_enabled=False |
| Shipping configuration complete | PASS | enabled=True; TH; rate=100.00; handling=0-1; transit=1-3 |
| Return policy complete | PASS | FINITE; days=7; method=MAIL_AND_IN_STORE; fees=CUSTOMER_RESPONSIBILITY |
| Turnstile browser configuration | PASS | Enabled with public site key. |
| Pickup enabled | PASS | pickup_enabled=True |
| Reservation protects Stripe Checkout | PASS | reservation_minutes=60 |
| Document mode | PASS | document_mode=RECEIPT_ONLY |
| Warranty configuration | PASS | default_warranty_days=0 |
| Production Store Worker health | PASS | HTTP 200 |
| Production API Worker health | PASS | HTTP 200 |
| Shop HTTP / | PASS | HTTP 200 |
| Shop HTTP /robots.txt | PASS | HTTP 200 |
| Shop HTTP /sitemap.xml | PASS | HTTP 200 |
| Shop HTTP /sitemap-products.xml | PASS | HTTP 200 |
| Production Worker secret: SUPABASE_SECRET_KEY | PASS | Binding name only; value was not read. |
| Production Worker secret: STRIPE_SECRET_KEY | PASS | Binding name only; value was not read. |
| Production Worker secret: STRIPE_WEBHOOK_SECRET | PASS | Binding name only; value was not read. |
| Production Worker secret: TURNSTILE_SECRET_KEY | PASS | Binding name only; value was not read. |
| No production SHOP62 test secret | PASS | Production Worker must not expose test token. |
| No production SHOP62 mode | PASS | Production Wrangler config contains no test mode/token. |
| Temporary E2E Worker removed | PASS | amphon-shop62-e2e must not exist. |

## Configuration snapshot (no secrets)

- stripe_cards: ENABLED
- promptpay: DISABLED
- shipping_country: TH
- shipping_rate_thb: 100.00
- handling_days: 0-1
- transit_days: 1-3
- return_category: FINITE
- return_days: 7
- return_method: MAIL_AND_IN_STORE
- return_fees: CUSTOMER_RESPONSIBILITY
- turnstile: ENABLED
- pickup: ENABLED
- reservation_minutes: 60
- document_mode: RECEIPT_ONLY
- default_warranty_days: 0
- turnstile_site_key_configured: True

## HTTP results

- Production Store Worker health: HTTP 200 - https://amphon-product-images.noteroru2.workers.dev/store/health
- Production API Worker health: HTTP 200 - https://amphon-product-images.noteroru2.workers.dev/health
- Shop /: HTTP 200 - https://shop.amphon.co.th/
- Shop /robots.txt: HTTP 200 - https://shop.amphon.co.th/robots.txt
- Shop /sitemap.xml: HTTP 200 - https://shop.amphon.co.th/sitemap.xml
- Shop /sitemap-products.xml: HTTP 200 - https://shop.amphon.co.th/sitemap-products.xml
- Post-activation Store API health: HTTP 200 - https://amphon-product-images.noteroru2.workers.dev/store/health
- Post-activation Store settings: HTTP 200 - https://amphon-product-images.noteroru2.workers.dev/store/settings
- Post-activation Shop /: HTTP 200 - https://shop.amphon.co.th/
- Post-activation Shop /robots.txt: HTTP 200 - https://shop.amphon.co.th/robots.txt
- Post-activation Shop /sitemap.xml: HTTP 200 - https://shop.amphon.co.th/sitemap.xml
- Post-activation Shop /sitemap-products.xml: HTTP 200 - https://shop.amphon.co.th/sitemap-products.xml
