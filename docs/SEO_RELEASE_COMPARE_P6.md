# AMPHON P6 — Exact-date final Search Console before/after comparisons

**Status: code in stacked GitHub PR; not merged, no new Supabase migration, no production deployment.**

P6 builds on #160 → #161 → #162 → #164 → #165. It adds **read-only, on-demand Google Search Console observations** comparing the *same verified page and optional query/segment* before and after a Production-verified release.

## What this does

**HUB:** SEO Control Tower → AI Development → Production Release Verification. Once a release's GitHub SHA, Hosting deployment ID, apex route, live HTTP evidence and post-deploy QA are all verified **in the existing ledger**, select:
- exactly one URL from `confirmed_affected_urls`
- 7 / 14 / 28-day comparison
- optional **APPROVED** Keyword Ownership query (must point to the same page)
- optional ISO-3166 alpha-3 country, e.g. `tha`
- optional Desktop, Mobile, Tablet.

HUB calls the authenticated `seo-gsc` Edge action `release_compare` to retrieve **two live reads** from Google's Search Analytics API through the previously connected read-only OAuth token. ChatGPT can request the same through the **`seo_release_compare` read-only MCP tool**; neither endpoint creates database receipts, edits websites, schedules background work or deploys.

If Production verification is incomplete, the page was not in the verified release, the requested keyword is not approved, or the *after* range is not yet final, both endpoints **refuse before contacting Google**.

## Correct Google reporting dates

Google Search Console's query API uses Pacific reporting dates, not Bangkok operational dates. P6 also corrects P5's calendar labels to `America/Los_Angeles`.

For Pacific release date `D`, the matched windows are:
- Before: `D−N ... D−1` (N days).
- After: `D+1 ... D+N` (N days).
- Release date `D` is excluded to avoid partially rolled-out data.
- End-of-after must be at least **three Pacific calendar days** before current Pacific date; do not treat this cushion as a guarantee of total Google data coverage.
- Baseline cannot be older than the supported ~480-day API history.

For example, `2026-11-15T03:00:00Z` is **November 14 in Los Angeles**, although it is November 15 in Bangkok. A 7-day comparison is Nov 7–13 (before) vs Nov 15–21 (after), not Nov 8–14 vs Nov 16–22.

The request sends `type=web`, `dataState=final`, `aggregationType=auto`, `dimensions=[]`, `rowLimit=1`, and **identical exact `page`, optional `query`, `country`, `device` filters** in both calls.

## What is calculated

When both Google responses contain one valid aggregate row with nonzero impressions:
- clicks and impressions before/after; absolute change and percent change (percent null if baseline is zero);
- CTR change in percentage points;
- **average GSC position improvement** as before-position minus after-position; a positive value means the average moved numerically lower (generally better).

When either response has no row, ambiguous rows, malformed metrics or zero impressions:
- status `INSUFFICIENT_VISIBLE_DATA`; **no changes/uplift calculation**;
- missing data must not display as zero clicks, zero ranking or business inactivity.

This is a **descriptive comparison, not causal attribution**. A change may reflect SERP changes, seasonality, competition, search demand or other code changes. Position is an average across surfaced results, **not live Google rank**. Google anonymizes and caps some queries. The response always includes:
- `google_query_anonymization_possible=true`;
- `full_data_coverage_confirmed=false`;
- `live_serp_position=false`;
- `causal_impact_proven=false`;
- `automatic_release_approval=false`.

No single comparison is considered a complete SEO experiment or a closed-loop Release.

## Authorization and security

- Same HUB owner/admin authenticated `seo-gsc` Edge route; no new public unauthenticated endpoint.
- Same registered-site GSC context and read-only OAuth as `seo_gsc_query`.
- Same existing `seo:read` MCP scope; `seo_release_compare` is annotated read-only and requires no draft permission.
- Every request re-reads and sanitizes latest site/project/Release Ledger evidence; **a newer unverified provider deployment invalidates a prior verification**.
- Exact page URL must be HTTPS, normalized, the registered origin, and present in verified `affected_urls`. No arbitrary page, unapproved keyword, client-selected repository or client-selected release SHA.
- No Google token in output or URL. No database writes, Github access, Merge, Deploy or DNS operations.

## Validation

```bash
npm run verify:seo-release-comparison
npm run verify:seo-release-verification
node --test tests/seo-connector.test.mjs
node --test tests/seo-gsc.test.mjs
npm run typecheck
npm run build
```

Full PR CI must pass including HUB/Shop stock, PriceBook and AI Buyer regression.

## Remaining gaps after P6

- All five predecessor PRs and this PR must be reviewed and released sequentially with rollback.
- P2/P3 migrations and real Supabase Auth/PostgREST/RLS acceptance in Staging remain pending.
- No Production website has a complete `PRODUCTION_VERIFIED` event in the live ledger yet; **no real GSC before/after comparison has been executed**.
- A persistent, immutable experiment observation/receipt and recurring read-only scheduled comparisons are **not** in scope of this P6 implementation.
- A licensed Live SERP provider and cross-check of conversions against purchased goods / realized gross profit are still separate workstreams.

**Do not mark the entire project Completed from CI alone.**
