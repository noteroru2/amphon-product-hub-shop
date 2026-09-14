# AMPHON ONE — Architecture Contract & Source of Truth

Contract version: `ONE-0.1`
Status: `ACTIVE`
Effective date: 2026-09-14
Canonical control-plane repository: `noteroru2/amphon-system`
Product/commerce repository: `noteroru2/amphon-product-hub-shop`

## 1. Purpose

AMPHON ONE is one business platform implemented as three applications with explicit ownership boundaries:

- **AMPHON System** — Owner Control Plane. The owner should be able to supervise and operate the business primarily from this application.
- **Product Hub** — Product Operations Engine. Owns physical product identity, SKU, product details, images, inventory lifecycle and publication/channel state.
- **AMPHON Shop** — Customer Storefront. Owns storefront SEO/catalog presentation and online commerce orders/reservations/payment/fulfillment workflow.

The systems may expose projections of another system's data, but a projection MUST NOT become a second source of truth.

## 2. Non-negotiable architecture rules

1. Every business domain has exactly one authoritative writer/source of truth.
2. Browser clients MUST NOT write directly into another application's database.
3. Cross-system mutations MUST be server-to-server through the AMPHON Bridge introduced in ONE-1 or through an explicitly approved adapter.
4. Cross-system commands/events MUST carry an `eventId` and `idempotencyKey`; retries must be safe.
5. Conflict resolution always follows the domain owner, never `last write wins` across databases.
6. No distributed transaction is required across PostgreSQL/Supabase. Local commit first, then durable event/outbox/retry in ONE-1+.
7. Public Shop code never receives internal cost, profit, seller, employee, contract, payroll or private customer data.
8. Existing production data is preserved during ONE-0. Ownership migration is additive and staged.
9. No new feature may create a second product master, second customer master, second employee master or second finance ledger.
10. Internal Product Hub (`hub.amphon.co.th`) is not a public customer destination; Shop is the customer storefront.

## 3. Source of Truth matrix

| Domain | Source of Truth | Read/Control surface | Notes |
|---|---|---|---|
| Owner dashboard / command center | AMPHON System | AMPHON System | System is the owner's primary application. |
| Customer master / CRM | AMPHON System | AMPHON System | Shop identity/order customer data is an acquisition/commerce edge until reconciled to System. |
| Employee master / payroll / commission policy | AMPHON System | AMPHON System | Hub `profiles` is an auth/permission projection, not HR master. |
| Contracts / deposit / consignment business | AMPHON System | AMPHON System | Financial/legal operational records remain in System. |
| Repairs | AMPHON System | AMPHON System | Product linkage may reference Hub product identity. |
| Finance / cashbook / P&L / business profit | AMPHON System | AMPHON System | Shop/Hub emit events; they do not own the company ledger. |
| Sale ledger (completed business sale) | AMPHON System | AMPHON System | Formal normalized Sale engine is ONE-3. Legacy sale recording remains temporarily. |
| Physical product identity | Product Hub | Hub + System projection | Canonical keys are `hub_product_id` (UUID) and `sku`. |
| SKU / Serial / Specs / Images | Product Hub | Hub + System projection | System must reference, not fork, these fields after ONE-2. |
| Inventory lifecycle / availability | Product Hub | Hub + System control | `draft/photo_ready/ready_to_list/published/reserved/sold/...` is canonical. |
| Product cost/margin source record | Product Hub | Owner/Admin; System projection | Financial reporting still belongs to System. |
| Publication/channel state | Product Hub | Hub + System projection/control | Facebook/Marketplace/WINNER/Website/LINE tracking belongs to Hub. |
| Sold cleanup tasks | Product Hub | Hub + System projection/control | Shop unpublish is automatic; manual channels produce tasks. |
| Storefront SEO taxonomy / canonical public product URL | Shop commerce layer | Shop | Evergreen categories/brands/series/models/listing metadata are commerce concerns. |
| Online order | Shop commerce layer | Shop + System control | `commerce_orders` remains the order source of truth. |
| Online reservation | Shop commerce layer + Hub inventory lock | Shop + System control | Shop order owns reservation transaction; Hub product status reflects reserved/sold availability. |
| Payment/fulfillment state for online order | Shop commerce layer | System control via Bridge | System receives events and owner actions; Shop keeps order state. |
| Warranty case / after-sales case | AMPHON System | AMPHON System | Planned normalization in ONE-8. |

## 4. Product identity contract

A physical sellable unit has one canonical Hub product identity:

```text
hub_product_id = UUID from Product Hub `products.id`
sku            = server-generated AMPHON SKU, e.g. AT-NB-2609-000123
serial_number  = product identifier attribute, not a cross-system primary key
```

Rules:

- `hub_product_id` is the immutable cross-system identity.
- `sku` is the human/scanner/business identity and must remain unique.
- AMPHON System may retain a legacy integer `InventoryItem.id`, but it becomes a local legacy/projection key after ONE-2.
- Do not generate a second SKU for the same physical item in System or Shop.
- Serial/IMEI may re-enter inventory after historical sale/return; it must not be used as the global immutable key.

## 5. Transitional legacy rules

### AMPHON System `InventoryItem`

Current status: `LEGACY_ACTIVE_UNTIL_ONE-2`.

It remains operational so production is not broken in ONE-0. Starting now:

- Do not expand it as an independent product master.
- New integration work must plan to map it to `hub_product_id` + `sku`.
- Product title/spec/image/status edits should migrate to Hub ownership in ONE-2.
- Financial sale history, customer relation and commission history must be preserved during migration.

### Product Hub `profiles`

Current status: `AUTH_PROJECTION_UNTIL_ONE-9`.

Hub may continue to authenticate/authorize its users. Employee HR truth (name/active employment/role policy/payroll/commission) belongs to AMPHON System. ONE-9 will define employee sync and disable behavior.

### Shop customer identity

Current status: `COMMERCE_IDENTITY_EDGE_UNTIL_ONE-7`.

Shop may maintain login/account/order identity required for ecommerce. It must not become the company CRM master. ONE-7 will reconcile customers into AMPHON System Customer 360.

## 6. Command and event direction

The following directions are authoritative. Exact HTTP schemas are ONE-1 work.

```text
Product Hub -> AMPHON System
  product.created
  product.updated
  product.status_changed
  publication.changed
  cleanup_task.changed

AMPHON System -> Product Hub
  product.reserve_requested
  product.release_requested
  product.mark_sold_requested
  product.price_change_requested
  publication.end_requested

Shop -> AMPHON System
  order.created
  order.payment_notified
  order.payment_confirmed
  order.cancelled
  order.shipped
  order.completed

AMPHON System -> Shop
  order.owner_action_requested
  order.fulfillment_update_requested
  customer_link_applied

AMPHON System -> Hub/Shop
  employee.access_changed       (ONE-9)
  customer.master_link_changed  (ONE-7)
```

A request to change a domain owned by another system is a **command**, not a direct database write. The owner system validates and applies it, then emits the resulting event.

## 7. Minimum integration envelope

ONE-1 must implement an envelope equivalent to:

```json
{
  "eventId": "uuid",
  "eventType": "product.status_changed",
  "version": 1,
  "source": "product-hub",
  "occurredAt": "2026-09-14T12:00:00Z",
  "idempotencyKey": "stable-retry-key",
  "entity": { "type": "product", "id": "uuid", "sku": "AT-NB-2609-000123" },
  "actor": { "type": "user|system", "id": "optional" },
  "payload": {}
}
```

Required behavior:

- duplicate `eventId` or `idempotencyKey` must not duplicate side effects;
- receivers record integration audit state;
- failed delivery is retryable;
- events must be safe to replay;
- secrets remain server-only;
- timestamps are ISO-8601; business display uses `Asia/Bangkok`.

## 8. Owner UX contract

AMPHON System is the primary owner-facing control plane. The owner should eventually be able to do the following without opening Hub or Shop admin screens for routine work:

- view unified stock and product status;
- reserve/release/mark sold;
- approve or adjust sale price;
- view and act on Shop orders;
- confirm payment/fulfillment actions;
- see publication status and sold-cleanup exceptions;
- see finance, profit, commission, customer, repair and contract context.

Hub remains a specialized staff workspace for product intake, photos, specs, QC, QR and publication operations. Shop remains the customer-facing storefront.

## 9. Failure and conflict policy

- If System and Hub disagree on product availability, **Hub wins**.
- If System and Shop disagree on an online order/payment/fulfillment state, **Shop commerce order wins** for that order, then System reconciles its projection/ledger.
- If Shop and System disagree on canonical customer CRM data, **System wins** after reconciliation.
- If Hub and System disagree on employee HR/active-employment truth, **System wins**; Hub may temporarily deny access more strictly for security.
- If finance values disagree, **System ledger wins**; source events must be investigated, never silently overwritten.
- Integration outage must not corrupt local source data. Queue/retry and show reconciliation warnings instead.

## 10. Security boundary

- Product Hub browser -> Supabase/R2 Worker only within existing Hub security model.
- Shop browser -> Shop server/Worker; browser never receives Supabase service-role credentials.
- AMPHON System browser -> AMPHON System API.
- System <-> Hub/Shop cross-system communication is server-to-server only.
- ONE-1 must use signed requests (HMAC or equivalent), timestamp/replay protection, secret rotation support, rate limiting and audit logs.

## 11. ONE-0 acceptance criteria

ONE-0 is PASS when:

- this contract exists in both repositories at the same contract version;
- machine-readable contract declares the same domain owners;
- repository verification scripts reject accidental ownership drift;
- no production table is deleted or rewritten;
- no checkout/payment behavior is changed;
- no existing AMPHON System inventory workflow is disabled yet;
- future ONE batches can reference one stable ownership model.

## 12. Next batches

- **ONE-1** — AMPHON Bridge, signed server-to-server contract, idempotency/event audit/retry.
- **ONE-2** — Product Hub <-> System inventory mapping and migration from legacy System inventory master behavior.
- **ONE-3** — Unified Sale engine in AMPHON System.
- **ONE-4** — Shop Orders surfaced and controlled from AMPHON System.
- **ONE-5** — Owner Control Room 2.0.

Any architecture change that moves a Source of Truth to another system requires an explicit new contract version and migration plan. It must never happen implicitly inside a feature batch.
