# Shopee Seller Integration Discovery — AMPHON ONE

Status: discovery / foundation only. No Shopee listing is published by this document.

## Seller eligibility update — 2026-09-19

The current Shopee Seller Identification flow rejects this shop because it is neither a Managed Seller nor a Mall Seller. Therefore the direct Open Platform adapter is **disabled by default** in production.

The direct runtime remains installed behind the Channel Architecture boundary for future eligibility. Until then, Shopee may later be connected through an approved partner adapter. Website publishing continues natively and Facebook remains assisted/manual. AMPHON System remains the inventory authority in every mode.

## Goal

Publish unique used products from AMPHON Product Hub to Shopee without making Shopee the inventory authority.

Authority remains:

1. AMPHON System — stock / availability / sale authority.
2. Product Hub — enrichment + channel publication orchestration.
3. Shopee — external sales channel projection.
4. AMPHON SHOP — storefront/requester only.

For one-of-one used inventory, Shopee stock should normally be 1 only while System availability is IN_STOCK; otherwise the Shopee projection must be reduced to zero / made unavailable.

## Current official Shopee Open Platform findings

Official sources checked 2026-09-19:

- Authorization: https://open.shopee.com/developer-guide/20
- Push/webhooks: https://open.shopee.com/developer-guide/18
- Add item: https://open.shopee.com/documents/v2/v2.product.add_item?module=89&type=1
- Update item: https://open.shopee.com/documents/v2/v2.product.update_item?module=89&type=1
- Upload image: https://open.shopee.com/documents/v2/v2.media_space.upload_image?module=91&type=1
- Category tree: https://open.shopee.com/documents/v2/v2.product.get_category?module=89&type=1
- Attribute tree: https://open.shopee.com/documents/v2/v2.product.get_attribute_tree?module=89&type=1
- Logistics channels: https://open.shopee.com/documents/v2/v2.logistics.get_channel_list?module=95&type=1
- Update stock: https://open.shopee.com/documents/v2/v2.product.update_stock?module=89&type=1

Important current platform behavior:

- Seller authorization is required for non-public APIs.
- Shopee authorization can last up to 365 days.
- Access token lifetime is 4 hours.
- Refresh token lifetime is 30 days.
- API signatures use HMAC-SHA256 with the partner key.
- Shopee Push Mechanism is the webhook system; push messages tell us data changed and the corresponding API should then be called for authoritative details.
- Shopee image publishing requires uploading image files to Shopee media space; remote AMPHON image URLs cannot simply be passed as the upload request.
- Shopee provides item creation, item update, stock update, category/attribute lookup and logistics-channel APIs.

## Recommended Phase S0 — credentials + sandbox

Prerequisites from Shopee Open Platform:

- Developer account.
- App suitable for the seller's own shop; prefer Seller In-house System if available for this account/use case.
- partner_id.
- partner_key stored only server-side.
- live + sandbox redirect domains.
- shop authorization to obtain shop_id, access_token and refresh_token.
- webhook callback URL with HMAC verification.

Never store partner_key/access_token/refresh_token in browser-local Hub code.

## Recommended Phase S1 — listing-only projection

Add server-side tables:

### shopee_connections

- id
- shop_id
- merchant_id nullable
- authorization_expires_at
- access_token_encrypted
- access_token_expires_at
- refresh_token_encrypted
- refresh_token_expires_at
- active
- created_at / updated_at

### shopee_product_mappings

- product_id (AMPHON)
- shop_id
- shopee_item_id
- seller_sku = AMPHON SKU
- category_id
- published_title
- published_price
- projection_stock
- status (pending | published | failed | ended)
- last_error
- last_synced_at

Unique (shop_id, product_id) and unique (shop_id, shopee_item_id).

### shopee_publish_queue

- id
- product_id
- shop_id
- action (CREATE | UPDATE | STOCK_ZERO | END)
- idempotency_key
- status
- attempt_count
- publish_after
- locked_at
- last_error

Use the same durable queue / FOR UPDATE SKIP LOCKED approach as AMPHON Website auto-publish.

## Product publication pipeline

System says IN_STOCK
→ Hub listing readiness READY_TO_LIST
→ Website auto-publish completes
→ Shopee eligibility check
→ map AMPHON category → Shopee category
→ resolve required Shopee attributes
→ get enabled logistics channels
→ download AMPHON public images server-side
→ upload files to Shopee media space
→ receive Shopee image IDs
→ call v2.product.add_item
→ store shopee_item_id
→ set seller SKU = AMPHON SKU
→ set Shopee stock = 1

Initial scope should be single-SKU items only. Do not create Shopee variations for used one-of-one items in S1.

## Required mapping layer

Do not hard-code Shopee category IDs into product records.

Create:

### shopee_category_mappings

- AMPHON category
- AMPHON subtype
- Shopee category_id
- mapping_version
- active
- reviewed_at

### shopee_attribute_mappings

For required Shopee attributes that can be derived safely from Hub specs.

If a required Shopee attribute cannot be confidently mapped, product enters SHOPEE_HOLD and must not publish automatically.

## Images

AMPHON retains R2 as image source-of-record.

Shopee publisher:

1. reads public AMPHON image;
2. validates file/type/dimensions;
3. uploads file through v2.media_space.upload_image;
4. stores returned Shopee media/image IDs;
5. calls add/update item using Shopee media references.

Never treat Shopee-hosted images as the master copy.

## Price

Add channel pricing policy instead of overwriting Hub price:

- base Shop price from AMPHON listing;
- optional Shopee markup / fee buffer;
- min margin guard;
- final Shopee price stored as a projection snapshot.

Suggested setting:

shopee_markup_type = PERCENT | FIXED | NONE

No automatic price increase should be enabled until the owner chooses the policy.

## Stock and oversell protection

This is the critical rule.

Shopee must **never** become master stock.

- IN_STOCK → Shopee projection stock may be 1.
- RESERVED → push Shopee stock to 0 immediately.
- SOLD → push Shopee stock to 0 and end/unlist according to chosen policy.
- REPAIR / RETURNED / WRITTEN_OFF → Shopee stock 0.

Use v2.product.update_stock for the Shopee projection.

For later order integration, a Shopee order must create a command toward AMPHON System; Hub must not directly decide final inventory availability.

## Phase S2 — webhook + order sync

Shopee Push Mechanism supports order-status and tracking updates.

Webhook handler requirements:

- validate Shopee HMAC authorization header;
- persist raw webhook idempotently;
- return 2xx + empty body quickly;
- enqueue processing;
- call Shopee order-detail API to obtain current authoritative order details;
- map order to AMPHON SKU;
- send reservation/sale command to AMPHON System.

Do not mark AMPHON stock sold merely from an unverified webhook body.

## Phase S3 — bidirectional projection

After S1/S2 are proven:

- System SOLD/RESERVED → Shopee stock 0.
- Hub title/spec/image edits → Shopee item update.
- Hub price change → Shopee price update subject to margin policy.
- Shopee banned-item/product push → mapping flagged for staff review.
- authorization expiry push → owner/admin alert.

## Hub UX

Publish Center should eventually show:

- Website: Auto
- Google Merchant: Auto
- Shopee: Off / Connected / Ready / Published / Error

Per product:

- Shopee readiness blockers
- mapped category
- required attributes missing
- projected Shopee price
- published item ID / URL
- last sync
- retry
- end listing

## Go-live gates

Do not enable Shopee auto-publish until all are true:

- valid seller authorization
- sandbox add/update/stock calls pass
- category mappings reviewed
- image upload succeeds
- logistics channel mapping succeeds
- seller SKU round-trips correctly
- System SOLD → Shopee stock 0 test passes
- duplicate/idempotency test passes
- webhook HMAC validation passes
- retry/dead-letter behavior passes

## Suggested implementation order

S0: Open Platform app + credentials + sandbox authorization  
S1A: server-side auth/token store  
S1B: category / attribute / logistics discovery cache  
S1C: image upload adapter  
S1D: add-item queue + mapping table  
S1E: manual Publish to Shopee pilot for 1 item  
S1F: stock-zero projection from System authority  
S2: webhooks + order projection  
S3: auto-publish after confidence window

The first production Shopee pilot should remain manual, even though Website publishing is automatic. After 10–20 clean listings and stock-zero tests, Shopee can move to auto-publish.
