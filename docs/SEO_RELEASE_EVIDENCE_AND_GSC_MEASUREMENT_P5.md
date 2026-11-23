# AMPHON P5 — Production release evidence gate & dated GSC measurement plan

**Status: stacked code PR only. Not merged, not deployed, no new database schema, no write actions.** Depends on #160 → #161 → #162 → #164.

## What the live HUB data currently proves (2026-11-23)

From `commerce_seo_portfolio_release_events`:
- **137** `COMMIT_OBSERVED` rows with environment UNKNOWN and QA NOT_VERIFIED.
- **13** `DEPLOY_SUCCEEDED` rows in environment PRODUCTION, QA NOT_VERIFIED (5 have full 40-char SHA; 8 do not).
- **0** `PRODUCTION_VERIFIED` rows.
- At least one Cloudflare deployment has an external version ID and verified worker/domain mapping but `github_sha_verified=false`.
- A Vercel READY deploy had `apex_route_verified=false`. Neither is sufficient proof the public apex served the expected GitHub SHA.

GSC 7/14-day windows currently show `GSC_FINAL_DAILY_ROLLUP` and 28-day windows `GSC_FINAL_PROPERTY_TOTAL`, last ending 18–19 Nov 2026. These are rolling/property totals, not comparable date-anchored URL-level pre/post measurements.

## P5 code addition

`supabase/functions/seo-connector/releaseMeasurement.ts` is the shared deterministic read-only policy.
It receives the site's enabled registry, verified Repo mapping and Release Ledger. For each recorded event:

- A `COMMIT_OBSERVED` means a GitHub commit was seen — **not** a deploy.
- A `DEPLOY_SUCCEEDED` from Cloudflare/Vercel means the provider reported a deployment — **not** proof of live apex, canonical URL, GitHub SHA or QA.
- `PRODUCTION_VERIFIED` is graded **complete only** when the recorded event is PRODUCTION, QA PASS, 40-hex SHA, repository matching an approved mapping, nonempty deployment ID and **all** these provider evidence flags are confirmed: `github_sha_verified=true`, `apex_route_verified=true` or `domain_worker_mapping_verified=true`, `live_response_verified=true`, and a valid `live_verified_at` after the release event.
- The policy does **not** itself probe hosting or attest the evidence flags. It refuses to transform a partial ledger record into an independent live attestation.

The HUB and `seo_portfolio` OAuth tool return only **sanitized** release proof booleans, known release IDs, verified relevant URLs and `release_gates`. Raw provider evidence JSON (which may contain sensitive provider data) is **not** sent to the browser or AI connector.

The new UI under **SEO Control Tower → AI Development → Production Release Verification** lists evidence gaps for all enabled sites, latest recorded provider, SHA when available, and a site-specific read-only verification work order.

## Date-scoped GSC after release

Measurement clock starts from the **Google Search Console Pacific reporting date** (`America/Los_Angeles`) of an eligible Production-verified event, not the Bangkok operational date. These can differ for a release occurring near midnight. Release day `D` is excluded to avoid partial-day contamination.

| Horizon | Before (baseline) | After (measurement) | First eligible finality checkpoint |
| --- | --- | --- | --- |
| 7 days | D−7 through D−1 | D+1 through D+7 | D+10 |
| 14 days | D−14 through D−1 | D+1 through D+14 | D+17 |
| 28 days | D−28 through D−1 | D+1 through D+28 | D+31 |

The D+3 checkpoint is conservative guidance, **not a guarantee** Google Search Console data are final. Every actual GSC fetch must explicitly match the same Site, URL, Query, Device, Country, Search Type, and two non-overlapping complete calendar ranges. Preserve row truncation/provenance and treat zero rows as *unknown* unless the underlying response confirms completeness. The UI does **not** calculate uplift from existing rolling property snapshots or claim a live SERP ranking.

Status fields:
- `PRODUCTION_NOT_VERIFIED` — no eligible release; cannot attribute change.
- `URL_SCOPE_UNKNOWN` — release accepted at site level, but affected URLs absent.
- `WAITING_FINAL_GSC` — minimum finality checkpoint not reached.
- `DATE_SCOPED_GSC_REQUIRED` — request a new, explicit before/after GSC extraction; outcome is **still unmeasured** until that happens.

This stage creates **no** automatic Merge/Deploy or state-writing "Verify" controls. A separate future step must verify production directly using Hosting+HTTP and then record an audited owner-approved `PRODUCTION_VERIFIED` event with evidence.

## Technical test / QA

```bash
npm run verify:seo-release-verification
node --test tests/seo-connector.test.mjs
npm run typecheck
npm run build
```

Tests verify that provider-ready rows remain unverified, missing SHA/QA/live HTTP proof is rejected, cross-repo mappings fail, unrelated URLs and secret keys are filtered out, Bangkok date calculations are correct, and no SEO uplift is reported from rolling snapshots.

## Required live rollout gates (not complete)

- [ ] Review and sequentially merge #160, #161, #162, #164 and this P5 PR, following project policy.
- [ ] Test P2/P3 migrations in real Supabase staging, including PostgREST, Auth and owner/admin/staff RLS.
- [ ] Deploy new `seo-gsc` and `seo-connector` Edge code separately and verify live OAuth + HUB permissions.
- [ ] Confirm **real** provider deployment ID, mapped apex route, GitHub SHA and URL-level HTTP evidence for an approved release.
- [ ] Add an audited `PRODUCTION_VERIFIED` event **only** after corroborating actual live provider and HTTP evidence.
- [ ] Fetch and store date-scoped before/after GSC URL/query/device/country rows, with complete finality receipts.
- [ ] Independently verify post-release outcome and a rollback route. Do not claim Google rank #1 from GSC average position.

The P5 gate is advisory and read-only; it does not satisfy a production acceptance review by itself.
