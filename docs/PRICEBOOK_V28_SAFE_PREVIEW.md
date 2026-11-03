# PriceBook V2.8 — Safe Preview Foundation

This branch is deliberately **non-production**. The pure function `previewPriceV28` in `src/lib/pricebookV28.ts` computes a conservative buy ceiling; it does not query Supabase, approve an offer, send LINE messages, or move money.

## Production audit (2026-11-03)
- Existing active PriceBook is V2.7 (45 active, two review-only).
- PriceBook versions and entry tables already exist: DO NOT replace or re-seed them.
- Existing AI Buyer uses external Worker `amphon-ai-buyer.noteroru2.workers.dev`; source for the LINE pricing runtime was not found in this repository's tracked Worker paths.
- Approval UI already exists; all category rollout modes were APPROVAL during audit.
- Need server-side authorization verification. A browser-side guard is not an authorization boundary.
- Price labels and verified actual resale are too sparse for automatic calibration.

## Design contract
1. Source version, exact model, ownership, condition and verified costs are required.
2. Repairs and residual market value loss must be recorded separately and only where each applies; duplicate defect codes are rejected.
3. Provincial parcel/pickup quotes must be verified, including insurance and handling.
4. Maximum purchase price is min(profit-based ceiling, market ceiling when supplied), floor to whole baht, never below zero.
5. Draft/Testing/Archived cannot produce approval-ready output.
6. Even an ACTIVE version returns only READY_FOR_APPROVAL, never direct send permission. External Worker must independently enforce approvals.
7. Missing entry means BLOCKED, not AI-invented money.

## Verification
Node 22: `node --experimental-strip-types --test scripts/verify-pricebook-v28.test.mjs`.
No database changes, customer messaging or deployment in this PR.

## Integration prerequisites before enabling production
- Locate and audit the external AI Buyer Worker source, especially /webhook and offer-send route.
- Add server-side guard and idempotent approval transaction in that runtime (not frontend only).
- Add validated schema/migrations for logistics and condition policy only if existing fields are insufficient.
- Run historical replay across representative categories and 143 flagged rows; assert no excess ceiling.
- Verify Amphon System cost/sale source and cross-system SKU mapping.
- Observe in SHADOW, then owner approval; never flip AUTO without a separate promotion review.
