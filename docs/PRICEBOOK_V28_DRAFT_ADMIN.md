# PriceBook V2.8 Draft Admin — Operations and Security

## User journey
Product Hub → AI Buyer (Owner/Admin only) → **PriceBook V2.8 — จัดการร่างราคา**.
Create an empty Draft or explicitly clone the current active V2.7 book. Save/edit/delete an individual item; edit multiple selected items by a fixed THB delta with a visible preview; import CSV into a draft only after local validation and confirmation; export CSV; inspect actor/time/before/after audit; rename, Freeze, Reopen or Archive a draft.

## Data design
**Isolated** from original `ai_buyer_price_book_versions` and `ai_buyer_price_book_entries`. New tables:
- `ai_buyer_pb28_drafts`: status DRAFT, FROZEN or ARCHIVED; never ACTIVE
- `ai_buyer_pb28_entries`: retail estimate/opening/target/hard maximum, per-category/brand/model/spec/condition variant, preserves `aliases`, `spec_match`, `adjustments`.
- `ai_buyer_pb28_audit`: actor, action, before/after JSON, time.

No publish/activate function, no LINE action, no money transfer, no change to V2.7.
Draft list and audit readable only by active `profiles.role` owner/admin, behind RLS and SELECT grants. No direct browser INSERT/UPDATE/DELETE grants. Authenticated mutations use `ai_buyer_pb28_*` RPC with server-side `auth.uid()` and active owner/admin verification, `SECURITY DEFINER SET search_path=''`, explicit `REVOKE PUBLIC` and `GRANT authenticated`; no use of client-supplied role.
Bulk edit and CSV import are atomic in a single DB transaction, validating price order and duplicate model-spec identity. Import limited to 250 per action and CSV upload to 1MB.

## Reproducible database setup
The following SQL scripts are applied in order (do NOT run the older AI Buyer PriceBook import endpoint to create a draft):
1. `supabase/pricebook_v28_draft_admin.sql`
2. `supabase/pricebook_v28_draft_lifecycle.sql`
3. `supabase/pricebook_v28_preserve_matching.sql`
4. `supabase/pricebook_v28_spec_variant_identity.sql`

These scripts were executed against the connected Supabase project on November 3, 2026 and tested inside transaction rollbacks. They are intentionally **not** auto-run by frontend deployment, and do not rewrite the original pricebook tables. Before an additional environment setup, review and register the scripts into that environment's migration workflow.

## Tested database behavior (transaction ROLLBACK)
- Owner/Admin create/edit/delete, bulk editing, CSV import and audit ledger
- Explicit cloning of 47 rows from active V2.7, preserving alias/spec/adjustments JSON
- Freeze/Reopen/Archive transitions with audited changes; frozen edits fail
- Sales role cannot create a Draft
- Two different spec variants of the same model allowed
- Invalid bulk edit rolls back without partial update

## Release gates
- Check Hub CI TypeScript/build, then deploy Hub only by merging the branch to main.
- Verify authenticated Owner/Admin UI and Supabase REST response in the browser; do not test with real sale negotiations.
- Check legacy V2.7 is still ACTIVE; `ai_buyer_category_automation_modes` stays APPROVAL.
- Before ANY actual V2.8 pricing promotion, separately create validated publish + rollback with versioned category rules and worker approval E2E. Server-side guard PR #126 remains Draft and is NOT part of this deployment.
