# SHOP-7.1 — FIRST REAL PRODUCT & ORDER READINESS REPORT

Date: 2026-09-13 (Asia/Bangkok)  
Verdict: **PASS_WITH_WARNING**  
SHOP-7.2 readiness: **READY_WITH_WARNING**

## Executive result

The owner published one real product through Product Hub's normal Website publication channel. Read-only production verification then proved the public Store API, PDP, media, sitemap, single-unit cart, and checkout UI through the safe pre-submit boundary. The selected product is `AT-PC-2609-000002`, Apple MacBook Neo, THB 21,900, `published` and `available`. SHOP-7.1 stopped before order creation and payment. Remaining warnings concern incomplete policy/legal URLs, unspecified product warranty, conversion instrumentation, performance measurement, and the portions of the authenticated Hub smoke not directly observed by Codex.

## 1. Safety baseline and after-state

Read-only checks were captured before work and rechecked by the verifier. No settings PATCH was made.

| Setting / endpoint | Before | After | Result |
|---|---:|---:|---|
| `purchase_enabled` | `true` | `true` | PASS — remained true |
| Stripe enabled | `true` | `true` | PASS |
| `stripe_promptpay_enabled` | `false` | `false` | PASS — remained false |
| Shipping enabled / rate | `true` / THB 100 | `true` / THB 100 | PASS |
| Handling / transit | 0–1 / 1–3 days | 0–1 / 1–3 days | PASS |
| Pickup enabled | `true` | `true` | PASS |
| Checkout Turnstile | enabled | enabled | PASS |
| Reservation | 60 minutes | 60 minutes | PASS |
| Document mode | `RECEIPT_ONLY` | `RECEIPT_ONLY` | PASS |
| Default warranty | 0 days | 0 days | PASS |
| Store API health | healthy | healthy | PASS |
| API Worker health | healthy | healthy | PASS |
| `shop.amphon.co.th` | HTTP 200 | HTTP 200 | PASS |
| `hub.amphon.co.th` | HTTP 200 login shell | HTTP 200 login shell | PASS |

## 2. Authenticated Product Hub smoke gate

Status: **PASS_WITH_WARNING (owner-confirmed publication)**

The canonical Hub domain loads correctly. The owner reported successful Website publication through Publish Center, which confirms the normal authenticated publication path was usable. Credentials were not requested or inspected. Codex did not directly observe Dashboard, Inventory, Orders, all authenticated images, or session-domain persistence, so those remaining authenticated smoke items retain an owner-verification warning.

## 3. Selected real product

| Field | Result |
|---|---|
| Sanitized product ID | SKU used as the sanitized identifier |
| SKU | `AT-PC-2609-000002` |
| Product name | Apple MacBook Neo |
| Price | THB 21,900 |
| Publication state | `published`; Website listing visible; `INDEX` |
| Availability | `available` |
| Public URL | `https://shop.amphon.co.th/p/apple-macbook-neo-at-pc-2609-000002/` |
| Readiness assessment | **READY_WITH_WARNING** |

No commercial facts were invented. Demo values in `src/lib/demo.ts` were not treated as production inventory.

## 4. Product data quality and publication workflow

Live assessment is **READY_WITH_WARNING**. Store API returned exactly one active public listing: category `notebook` / public category “โน้ตบุ๊กมือสอง”, brand Apple, model/title MacBook Neo, THB 21,900, condition 100%, 12 public images, description/specification fields, `published`, `available`, and `INDEX`. The PDP accurately says warranty is not specified. The normal architecture used for the action is:

- Product states: `draft`, `photo_ready`, `ready_to_list`, `published`, `reserved`, `sold`, `repair`, `consignment`, `returned`, `cancelled`.
- Publication states: `not_published`, `published`, `ended`.
- Website publication is permitted only for a product in `ready_to_list`, `published`, or `reserved` and is performed through Publish Center.
- Publishing updates the publication record and synchronizes the overall product status; it must not be bypassed with a manual DB write.
- Publish roles are owner/admin/sales. The owner performed the one authorized publication through Publish Center.

Publication result: **PASS**. Public SHOP result: **PASS** — canonical PDP HTTP 200, correct title/SKU/price/category/availability, 12 rendered product images, reasonable title/meta, and product present in `sitemap-products.xml`. The first three image URLs independently returned successfully. No duplicate public listing was found.

## 5. Product Hub ↔ SHOP sync matrix

| Field | Product Hub | SHOP | Result |
|---|---|---|---|
| Listing association | Website publication owner-confirmed | one active Store listing | PASS |
| SKU | `AT-PC-2609-000002` | `AT-PC-2609-000002` | PASS |
| Publication | `published` (owner-confirmed) | visible / `published` / `INDEX` | PASS |
| Price | THB 21,900 publication source | THB 21,900 on API, PDP, cart, checkout | PASS |
| Stock | available publication source | `available`, purchasable | PASS |
| Title/category | Apple MacBook Neo / notebook | Apple MacBook Neo / โน้ตบุ๊กมือสอง | PASS |
| Image | 12 publication images | 12 PDP images; sampled URLs resolve | PASS |
| Warranty | no item expiry specified | PDP says warranty not specified; default 0 days | PASS_WITH_WARNING |
| Public URL | Website channel | canonical `/p/apple-macbook-neo-at-pc-2609-000002/` | PASS |

## 6. Cart verification

Static contract: **PASS**. Live selected-product check: **PASS**.

- Cart stores normalized SKU values in `amphon_shop_cart_v1` using a `Set`; one unique item cannot have quantity greater than one.
- Cart persistence and remove behavior are implemented in localStorage.
- Cart reloads each product from Store API and excludes missing/reserved/sold products from purchasable subtotal.
- Price shown in cart comes from the current Store API response, not a price saved in frontend state.
- Checkout link is disabled if any cart item is unavailable.
- Live cart showed exactly one Apple MacBook Neo at THB 21,900 with subtotal THB 21,900. Clicking Add to Cart a second time did not increase the item count.

## 7. Checkout, shipping, pickup, and Turnstile readiness

Static/settings and live pre-submit result: **PASS**.

- Checkout page loads and dynamically revalidates product price/availability from Store API.
- Shipping fields are required for shipping and hidden for pickup. Pickup is enabled.
- Production shipping rate is THB 100; authoritative subtotal/shipping/total and reservation are created server-side.
- Turnstile is enabled with a public site key and is verified server-side before order creation.
- Stripe cards are presented. PromptPay is absent while `promptPayEnabled=false`.
- A session idempotency UUID is sent with checkout; DB order creation locks products and rejects unavailable/reserved races.
- **Safe stop boundary:** submitting `POST /store/checkout` creates a production order, reserves stock, and may create a Stripe Checkout Session. SHOP-7.1 stopped before form submit.
- Live checkout showed the correct product and THB 21,900 subtotal, card-only Stripe choice, Turnstile security area, and enabled Shipping/Pickup controls. Selecting Pickup hid shipping address fields; selecting Shipping restored them.

No reservation, Stripe Checkout Session, or order was intentionally created.

## 8. Warranty, document, policy, and legal readiness

| Item | Current state | Classification | Impact |
|---|---|---|---|
| Shipping fee/timeframe | THB 100; handling 0–1, transit 1–3 days | PASS | Operational values are configured. |
| Return window/method/fees | 7 days; mail and in-store; customer responsibility | PASS_WITH_WARNING | Values are configured but policy URL is absent. |
| Pickup | enabled | PASS | Checkout offers pickup. |
| Warranty basis | item expiry unspecified; default 0 days | WARNING | PDP accurately says warranty is not specified; no coverage is implied. Owner should confirm this is intentional before payment. |
| Payment method | Stripe cards; PromptPay disabled | PASS | Checkout copy correctly says card only. |
| Document mode | `RECEIPT_ONLY`; e-Tax not claimed | PASS | Must remain receipt-only. |
| Shipping policy URL | missing | WARNING | Operational values exist, but no detailed linked policy. |
| Return policy URL | missing | WARNING | Operational values exist, but no detailed linked policy. |
| Checkout terms URL | missing | WARNING | No linked checkout terms are rendered. |
| Warranty policy URL | missing | WARNING | Warranty basis needs product-specific confirmation. |
| Legal name | missing in public settings | WARNING | Business identity should be completed truthfully by owner; do not invent it. |

These warnings do not justify inventing policy pages or legal claims, but they should be resolved before broader commercial rollout. The first order should proceed only after the owner confirms the displayed operational information and business identity are adequate.

## 9. Order-management readiness

Static contract: **PASS**. Authenticated UI smoke: **OWNER_VERIFICATION_REQUIRED**.

Actual order states are `AWAITING_PAYMENT`, `PAYMENT_REVIEW`, `PROCESSING`, `SHIPPED`, `COMPLETED`, `CANCELLED`, `EXPIRED`, and `REFUNDED`; payment and fulfillment have separate state machines including `UNPAID/REVIEW/PAID/REFUND_PENDING/REFUNDED` and `UNFULFILLED/PACKING/SHIPPED/IN_TRANSIT/DELIVERED/PICKUP_READY/PICKED_UP/CANCELLED`.

The authenticated Orders UI displays order number, creation time, customer name/phone, SKU/title/unit price, total, fulfillment method, payment provider/status, reservation expiry, address, tracking, document, and warranty. Owner/admin are required for refunds; all order API access requires a Supabase bearer session. Provider event IDs are idempotent, Stripe browser redirects are not payment evidence, and verified webhooks drive Stripe payment transitions.

## 10. Conversion instrumentation

Status: **MISSING**.

No application-owned events equivalent to `product_view`, `add_to_cart`, `checkout_start`, `shipping_selected`, `pickup_selected`, `payment_redirect`, or `order_success` were found outside dependencies/build output. GA4 remains intentionally deferred. A later SHOP-7.x task should define a privacy-conscious first-party event contract before choosing a destination.

## 11. Performance observation

No broad performance rewrite was performed. Chrome DevTools performance tracing was unavailable in this environment, so no Core Web Vitals claims are made.

- Hub build advisory: `index-DvLPf39t.js` 829.07 kB minified / 228.26 kB gzip; `esm-DYs0CSMs.js` 435.65 kB / 115.11 kB gzip; CSS 55.95 kB / 9.93 kB gzip.
- Vite reports chunks larger than 500 kB.
- Barcode scanning is dynamically imported, but most Hub routes remain in the main React bundle.
- SHOP is server-rendered and its largest emitted browser JavaScript asset in this build is approximately 3.55 kB; no obvious duplicated critical SHOP dependency was observed from the build output.
- Recommendation for SHOP-7.x Performance / Code Splitting: lazy-load major Hub screens (Products, Inventory, Publish Center, Orders, Commerce settings), measure route-level dependencies, and obtain a real browser trace before prioritizing changes.

This is an optimization warning, not the current product-readiness blocker.

## 12. Production mutations

Exactly one authorized normal business mutation was performed by the owner: Website publication of real SKU `AT-PC-2609-000002` through Publish Center. Codex performed no production mutation. Commerce settings, secrets, Stripe webhook, PromptPay, migrations, orders, reservations, and unrelated inventory were not changed.

## 13. Payment statement

**NO successful Stripe payment was created.**  
**NO card was charged.**  
**NO controlled real order was completed.**

## 14. Verification, build, and secret scan

The read-only verifier is `scripts/verify-shop71.mjs`. It performs GET-only production checks, static contract checks, product checks when `--sku` is supplied, and a repository secret-pattern scan.

QA results are recorded after execution below:

- `node --check scripts/verify-shop71.mjs`: PASS
- `npm run verify:shop71 -- --sku AT-PC-2609-000002`: PASS_WITH_WARNING; product/public/cart contracts PASS and policy readiness is WARNING
- `npm run typecheck`: PASS
- `npm run build`: PASS; Vite chunk-size advisory remains
- `shop/npm run build`: PASS, 0 errors (4 pre-existing hints)
- `shop/npm run verify:shop62`: PASS
- `shop/npm run verify:production-closeout`: PASS
- Verifier secret-pattern scan: PASS

## 15. Files changed

- `SHOP7_1_FIRST_REAL_PRODUCT_READINESS_REPORT.md`
- `SHOP7_2_FIRST_REAL_ORDER_RUNBOOK.md`
- `scripts/verify-shop71.mjs`
- `package.json` (adds `verify:shop71` only)

No production deployment is required for these read-only readiness artifacts.

## 16. Remaining warnings and exact owner action

Remaining warnings: parts of the authenticated HUB-1 smoke were not directly observed by Codex; shipping/return/checkout-terms/warranty policy URLs and public legal name are missing; item warranty is unspecified/default 0 days; conversion instrumentation is missing; browser performance trace was unavailable; Hub bundle advisory remains.

**Exact owner action required next:**

1. Confirm the product intentionally has no stated warranty; if it has real warranty coverage, update only the truthful item-specific data before taking payment.
2. Review the missing policy/legal fields and decide whether to complete them before the first order. Do not invent URLs or claims.
3. Confirm Hub Orders loads for the authorized staff member who will monitor the transaction.
4. Read `SHOP7_2_FIRST_REAL_ORDER_RUNBOOK.md` and choose Shipping or Pickup for the controlled order.
5. If ready to make one real charge, give separate explicit approval to start **SHOP-7.2**. The owner must manually enter and confirm payment details. Do not press the currently open “สร้างคำสั่งซื้อและล็อกสินค้า” button before that approval.
