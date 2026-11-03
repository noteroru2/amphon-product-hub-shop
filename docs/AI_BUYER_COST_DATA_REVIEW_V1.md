# AMPHON AI Buyer Cost Data Review V1

## Goal
Source files from Hetzner contain 532 inventory records, 111 sale events, 3 field purchases. 159 inventory rows have an empty category, and some source categories conflict with obvious device types. The AI Buyer cost learning engine must never guess actual device specs or treat a model-category inference as verified.

## Owner workflow
Open Product Hub → AI Buyer → **คิวตรวจข้อมูลต้นทุนและสเปก — Owner Review**.
- Priority queue: uncategorized items, obvious category conflicts (e.g. notebook classified as tablet), stale reviews, sold products, or damage descriptions.
- Category inferred from source text is a **hint only**. Owner must inspect reliable original listing/device evidence, check model and specs, select one of seven normalized categories, and explicitly check certification.
- Only **reviewed_name** and **reviewed_category** are overlaid on Learning. Original acquisition costs, sale prices, profits, quantities, accounting type, and stock id are untouched.
- All review saves/revisions/revocations are audited, with actor and before/after snapshots.
- A review becomes **stale** if the source product name or category changes in a later import. Stale reviews are ignored by Learning until renewed.
- Data quality warnings and initial source damage markers are preserved after normalization; no damaged device can qualify for automated proposed prices simply by removing the defect from the reviewed title.

## Security and persistence
`supabase/ai_buyer_cost_spec_review.sql` defines isolated owner-only review and audit tables, RLS read policies, and tightly authenticated write/revoke RPC. Both RPCs check `auth.uid()` against active owner/admin profiles. No direct authenticated or anonymous DML on review/audit. This schema change does not modify active PriceBook tables or existing AI Buyer LINE Worker.

Review save is guarded by optimistic source-name-and-category matching against the current cost-history row. A later source change invalidates previous approval without discarding the audit.

## CI and verification
`scripts/verify-ai-buyer-cost-review.test.mjs`: validates missing category prioritization, review-only metadata overlay, stale rejection, category conflict, original cost preservation, damaged source failure-to-qualify, and excluding field/sale events from review targets.

SQL rollback verification exercises owner save/revise/revoke/audit and rejects sales-role access. Production has no artificial QA rows or approved reviews created by this test.

## Limits
The category classifier is deterministic and deliberately incomplete. Some Thai/English product titles, custom desktop builds, Apple devices, and uncommon brands need explicit manual correction. Review of a category does not prove pricing accuracy or make the input an approved customer quote.

Next stages: monitor category corrections and matcher false-positive rate, acquire independent sold examples of same full spec, calibrate actual margins/repair cost, protect Worker E2E before any LINE pricing integration.
