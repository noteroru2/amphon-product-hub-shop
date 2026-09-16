# AMPHON ONE-3 — Unified Sale / Stock State Integration

Contract version: `ONE-3.0`  
Effective date: 2026-09-16  
Status: `SOURCE_LOCKED_FAIL_CLOSED`

## 1. Explicit authority amendment

This is the explicit authority migration required by ONE-0R.1. For inventory availability it supersedes the earlier rule that Product Hub is the availability source of truth after Hub synchronization.

From ONE-3 onward:

- **AMPHON System is the canonical authority for physical-unit availability and sale commitment.**
- **AMPHON System remains the authority for sales ledger, cashbook, profit and commission.**
- Product Hub owns product content, enrichment, listing readiness, publication state and sold-cleanup workflow, while availability is a projection of System state.
- AMPHON Shop is an order/reservation requester and never mutates stock directly.
- Product Hub browser actions must not directly write `reserved` or `sold` for `one_managed=true` products after ONE-3 runtime activation.

No QC or Technical Inspection stage is introduced.

## 2. Canonical unit availability states

`IN_STOCK | RESERVED | SOLD | REPAIR | RETURNED | WRITTEN_OFF`

Allowed transitions:

- `IN_STOCK -> RESERVED | SOLD | REPAIR | WRITTEN_OFF`
- `RESERVED -> IN_STOCK | SOLD`
- `SOLD -> RETURNED`
- `REPAIR -> IN_STOCK | WRITTEN_OFF`
- `RETURNED -> IN_STOCK | REPAIR | WRITTEN_OFF`
- `WRITTEN_OFF` has no automatic outbound transition.

Listing readiness remains independent from availability.

## 3. Projection command direction

After System commits a canonical transition it projects the state to Hub using the durable Bridge:

- `product.reserve_requested`
- `product.release_requested`
- `product.mark_sold_requested`

Hub applies only an exact linked identity/SKU/Hub product transition and emits `product.availability_changed` back to System as projection acknowledgement.

The acknowledgement never overrides a newer System availability version.

Future Shop reservation in ONE-4 must request System first. Only after System commits `RESERVED` may the state be projected to Hub.

## 4. Ordering and replay safety

System owns a monotonically increasing `availabilityVersion` per physical identity. Every projection command carries event/idempotency identity, immutable SKU, exact Hub product ID, from/to availability and version.

Hub must be idempotent by event/idempotency key, refuse identity/SKU/Hub mapping conflicts, and ignore stale versions rather than rolling the projection backwards.

## 5. Product Hub browser boundary

Current legacy Hub screens mix listing state and availability in `products.status`. ONE-3 migrates this additively.

For `one_managed=true` products after runtime activation:

- browser direct `reserved`/`sold` writes are prohibited;
- server-side Bridge projection is the only path that changes canonical availability projection;
- existing listing/editor states remain usable for content/readiness;
- legacy non-ONE products remain untouched during rollout.

## 6. Fail-closed rollout

Runtime feature flags:

- System `ONE3_SALE_SYNC_ENABLED=false` by default.
- Hub `ONE3_STOCK_CONSUMER_ENABLED=false` by default.

ONE-3A locks contract/source only. ONE-3B/3C/3D add System hook, Hub projection consumer and acknowledgement/drift guard. No fabricated production sale is required for acceptance.

## 7. Boundaries

- ONE-managed and exact-linked products only.
- Unresolved legacy products remain excluded.
- Shop checkout/order integration remains ONE-4.
- No automatic reconciliation cron is enabled by ONE-3.
