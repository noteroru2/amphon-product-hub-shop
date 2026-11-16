# AMPHON SEO Portfolio Control — implementation record (2026-11-16)

Scope: 14 independent site projects, **one central read-only SEO/attribution control plane**.

## Current state verified in connected Supabase

Existing authoritative tables (not replaced):
- `commerce_seo_sites` (14 enabled sites)
- `commerce_seo_keyword_owners` (22 prior proposed ownership rows)
- `commerce_seo_network_snapshots` (final GSC property totals + daily metrics + sampled query/page records)
- `commerce_gsc_sync_jobs` (active Google OAuth sync jobs)
- `commerce_gsc_site_change_audit` (GitHub commit observations, not confirmed deploys)
- `commerce_seo_contact_events` (CTA events, not by themselves confirmed conversations or sales)

Added with Supabase migrations `amphon_seo_portfolio_control_v1`, `amphon_seo_portfolio_gsc_date_key_fix`, and `amphon_seo_portfolio_gsc_granular_windows`:
- `commerce_seo_portfolio_projects`: per-site repository candidates; mapping state is *not verified* unless actual provider deployment SHA is checked.
- `commerce_seo_portfolio_keyword_roles`: PRIMARY/SUPPORTING/LOCAL/COMMERCE with proposed/approved status. The owner-confirmed notebook example is approved; others remain proposals.
- `commerce_seo_portfolio_release_events`: append-only evidence ledger; `COMMIT_OBSERVED` is **not** `PRODUCTION_VERIFIED`.
- `commerce_seo_portfolio_attributions`: allows verified purchase, verified units and realized gross profit only with explicit source evidence. Starts empty.
- `commerce_seo_portfolio_gsc_query_pages`, `commerce_seo_portfolio_gsc_ingest_runs`: storage for *direct* 7/14-day page+query final GSC evidence.
- Views `commerce_seo_portfolio_gsc_windows_v` (7/14/28 from latest final GSC snapshot), `commerce_seo_portfolio_query_page_28d_v` (Google-disclosed 28-day sample), `commerce_seo_portfolio_query_page_all_v` (7/14 direct + 28 snapshot), and `commerce_seo_portfolio_funnel_v` (CTA vs explicitly verified deals).

All new tables have RLS enabled and are **service-role only**. Views use `security_invoker=true`; no new grants to `anon` or browser `authenticated`. No tokens, private user identifiers, or customer chats are copied into a public surface. Site repositories and deployment credentials remain independent. `central_deploy_allowed` is constrained to **false** at the database level.

## What is automatic right now

The existing `seo-gsc` scheduler refreshes source snapshots; the 7/14/28 **property-level** view reads latest finalized daily and aggregate data without a second copy. The 28-day page/query view uses the existing Google-disclosed sample and reports truncation.

**Not yet automatic**: Google final 7/14-day per-page/per-query ingestion, provider-verified release webhooks, and verified LINE→purchase→sale matching. Those must not be represented as completed until their event sources, credentials and end-to-end tests are in place. Blank or zero verified-sale metrics are not evidence of zero business sales.

## Evidence semantics (never conflate)

| Status | Source of truth |
| --- | --- |
| Proposed keyword owner | Local SEO governance, not Google ranking |
| COMMIT_OBSERVED | GitHub audit; not a production release |
| PRODUCTION_VERIFIED | Hosting provider deployment SHA + verification |
| Contact event | CTA action, not confirmed LINE chat |
| PURCHASE_VERIFIED | Explicit AMPHON System purchase proof and line item count |
| SOLD_VERIFIED | Completed sale with verified cost, revenue and realized profit |

## Safe next integration steps

1. Identify production project/repository/SHA for WEBUY (two candidates), Winner IT (two candidates), Shop (one unverified candidate), and the pawn domain (none). Do not auto-select a candidate.
2. Extend the existing OAuth-backed GSC job to fetch final page+query observations for 7 and 14 days with pagination; upsert into `commerce_seo_portfolio_gsc_query_pages`; record `commerce_seo_portfolio_gsc_ingest_runs`. Maintain GSC anonymized-query and pagination caveats.
3. Accept release events only after verifying hosted project/site mapping, environment, SHA, and provider deployment result; never treat a Git push alone as a production release. The portfolio ingest service must have no deployment-write scopes.
4. Match CTA references only to verified LINE conversations and authoritative AMPHON System purchase records; mark sold/profit only once sale and cost evidence exist.
5. Expose read-only portfolio UI to owner/admin with explicit authorization and regression tests; no public/client service-role keys.
6. Run `supabase/tests/seo_portfolio_control_assert.sql` after migrations/updates. Each website keeps its own PR approvals, QA and rollback.

## Read-only sample queries

```sql
select s.label, w.window_days, w.start_date,w.end_date,
       w.clicks,w.impressions,round((w.ctr*100)::numeric,2) as ctr_percent,
       w.dates_present,w.provenance
from public.commerce_seo_portfolio_gsc_windows_v w
join public.commerce_seo_sites s on s.id=w.site_id
order by w.window_days,w.clicks desc;

select * from public.commerce_seo_portfolio_funnel_v order by contact_events desc;
select site_id,repo_candidates,mapping_status,central_deploy_allowed
  from public.commerce_seo_portfolio_projects order by site_id;
```

This file documents *live, additive database changes*. Review migration history before reapplying any DDL; do not conflate source-control PR creation with production deployment.
