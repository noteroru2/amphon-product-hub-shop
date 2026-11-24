# AMPHON SEO — Conversion attribution P1 (24 Nov 2026)

## What was actually verified

The production Supabase database already stores **click events**, not confirmed conversations: `commerce_seo_contact_events` has 1,008 records for `amphon` (894 tagged ORGANIC_SEARCH, 96 UNKNOWN, 18 OTHER) and 176 for `shop` (160 UNKNOWN, 12 OTHER, 3 ORGANIC_SEARCH, 1 AI_REFERRAL). **Zero owner-confirmed leads, zero linked sale IDs, zero rows in `commerce_seo_portfolio_attributions`, zero verified purchases and zero realized-profit evidence** at inspection time. No claim can be made that a click became a LINE conversation or income.

These metrics are deliberately kept separate:

| Stage | System of record | Rule for counting |
|---|---|---|
| Website contact click | `commerce_seo_contact_events` | Count a click, not a customer; `source_channel` is capture-side classification, not independent attribution proof |
| Owner-confirmed lead | `confirmed_lead` plus `lead_reference` | Human/authorized system evidence that LINE conversation or intake actually occurred |
| Matched AI buyer case | `ai_buyer_case_id` in portfolio attribution | UUID must belong to `ai_buyer_valuation_cases` and match the identified conversation; never guess customer identity from timestamp |
| Verified purchase | `PURCHASE_VERIFIED` and purchase time | Actual store purchase or inventory reference plus durable `evidence_ref`, `verification_source`; no price estimate substitutes |
| Verified sold + profit | `SOLD_VERIFIED`, sold time, quantity, acquisition cost, sale revenue, realized gross profit | Actual sale evidence, not stock-list price or assumed mark-up; do not double count the same transaction |

## New production-safe reporting surface (read only)

`commerce_seo_portfolio_attribution_readiness_v` groups by site, exposes aggregate-only click counts, confirmed leads and conservatively evidence-verified purchases/sales/profit; reports `CLICK_ONLY_NO_CONFIRMED_LEAD` while links are absent. `commerce_seo_portfolio_contact_source_daily_v` groups by site/day/channel to visualize trends. Neither view includes customer identifiers, raw click tokens, session identifiers or LINE details. Both are PostgreSQL `security_invoker=true`, SELECT only to `service_role`, NOT to `anon` or browser `authenticated`.

No production website, LINE webhook, payment or AI Buyer automation is altered in this phase. No synthetic data is inserted into Production.

## Operator matching contract for next admin integration

1. A session generates a random opaque contact `token` with page/site/day and source classification. **Click is never a confirmed lead**.
2. The LINE conversation must carry that opaque token explicitly (e.g. user sends a prefilled message voluntarily), or the owner/admin must identify and confirm the same conversation through existing AMPHON evidence. If the token is not present, do **not** join on phone number, IP address, timestamp proximity or other guessed identity.
3. An authorized owner/admin reviews the real intake and attaches its `lead_reference` / AI Buyer case ID to the click using audited workflow; otherwise keep `PENDING` / `MATCHED_UNVERIFIED`.
4. When AMPHON System confirms purchase, save inventory reference, actual acquisition cost, quantity, immutable proof and `PURCHASE_VERIFIED` timestamp. Staff cannot auto-finalize price or cash payout.
5. When a sale actually completes, save sale revenue, actual realized gross profit, sold timestamp, source and receipt; **only then** transition to `SOLD_VERIFIED`. Preserve evidence references, prevent duplicate counting by business transaction ID, flag mismatched site links.
6. Display **organic clicks**, **confirmed leads**, **purchase units** and **realized gross profit** in distinct stages. Do not derive keyword-level profit attribution without a measured query/page-to-lead token mapping and consent-safe evidence; GSC query rows are aggregated, anonymized and cannot be deterministically joined to a buyer.

## Guardrails

- **Never expose `service_role` or a raw token in public frontend code.** Server checks owner/admin identity against trusted `app_metadata` or existing authorization.
- Never infer that all traffic tagged `ORGANIC_SEARCH` came from Google; GSC is separate property-level aggregate.
- Do not publish names, telephone numbers, LINE IDs, device serials or deal prices in SEO reporting.
- Only actual purchase/sale proof can increase confirmed purchase or profit totals. Use owner approval and audit logs for state transitions.
- Disabled `pawn` site remains excluded from active optimization. The active iPhone-buyback site is different and is not automatically re-enabled/disabled.
- No automatic deployments, secrets, DNS updates, SEO ranking changes or edits to user-facing pages are part of the view-only release.

## QA and rollback

Disposable PostgreSQL 16 fixture `tests/fixtures/seo_portfolio_attribution_readiness_contract.sql` validates: click-only must report zero leads/profit; PENDING never creates profit; a complete SOLD_VERIFIED synthetic row is counted; missing evidence cannot inflate realized profit; cross-site links are flagged; anon/authenticated have no SELECT; views use `security_invoker=true`. View-only DB rollback: `DROP VIEW IF EXISTS public.commerce_seo_portfolio_contact_source_daily_v; DROP VIEW IF EXISTS public.commerce_seo_portfolio_attribution_readiness_v;` after verifying no consumers; existing source tables and ledger unaffected.

## Remaining production integrations

Owner/admin matching screen, exact opaque LINE token handoff, matching case to Product Hub inventory cost and verified sale outcome, audit receipts, and end-to-end flow using **real explicitly authorized** transaction evidence. These are separate deployments and require privacy, permission, and regression review; do not claim they are complete solely because the read-only views exist.
