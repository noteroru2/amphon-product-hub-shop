# AMPHON Google Rank Checker V1 — Production closeout receipt (2026-11-24)

Status: **ENGINEERING RELEASE SHIPPED AND VERIFIED**. Full external SERP/real-deal outcome observations are **pending by design**; this is not a claim of all 25 keywords ranking or SEO ROI.

## Evidence of live release

- PR: https://github.com/noteroru2/amphon-product-hub-shop/pull/176
- Source: `main` merge SHA `7d583b86a003f103a856c62c7cea0b0c3c94665a`.
- Isolated rank contracts + full Hub build: https://github.com/noteroru2/amphon-product-hub-shop/actions/runs/45345440594 — SUCCESS.
- Hub + Shop UX QA on PR: https://github.com/noteroru2/amphon-product-hub-shop/actions/runs/45345440494 — SUCCESS.
- SEO AI Development QA on PR: https://github.com/noteroru2/amphon-product-hub-shop/actions/runs/45345439823 — SUCCESS.
- Hub Production Deploy including live JS bundle SHA256 verification: https://github.com/noteroru2/amphon-product-hub-shop/actions/runs/45345744265 — SUCCESS for exact merge SHA.
- Post-merge UX QA: https://github.com/noteroru2/amphon-product-hub-shop/actions/runs/45345744337 — SUCCESS.
- Live Worker: `amphon-product-hub`, deployment `2f43b0a6-2f94-4341-9ec3-81584a5c90ef`, version `883de3e8-cf45-4c2b-ba51-608b8fd7fc6d`, 100% traffic. Cloudflare Build UUID `99d26077-6769-4b75-aa35-7c471b135f2b` carries the same full Git SHA.
- Live Supabase `seo-gsc` Edge Function **version 10**, deployed with unchanged authentication model (`verify_jwt=false` only because public callback has one-use OAuth state and POST actions check active owner/admin token).
- Migration `seo_portfolio_rank_ledger_20261124` applied to Supabase project `mfpdtlxwdbxitgfzdape`. RLS confirmed enabled: `anon` SELECT=false, `authenticated` SELECT=false, `service_role` SELECT/INSERT=true; no anonymous rank API.
- Authenticated Hub SEO Portfolio now has a separate **Google Rank Checker · Ubersuggest SERP** view with true collection dates and no GSC-average-as-rank fallback.

## Ubersuggest verified ingest on 24 November 2026

- Project `e0e35163c7012e8cbb50d3a952ee5daa6f781c731eaf69c3225f17ef09d465c4`: domain amphon.co.th, Thai `th`, Thailand `2764`, desktop, 25/25 positions. Original 8 keywords preserved, 17 added.
- Real `project_position_info` response `done=true`: **3 NOT_RANKING_TOP_100** with SERP collection date `2026-11-23`, **22 PENDING**, **0 RANKED**. Do not extrapolate pending to not ranking.
- 25 exact rows inserted for `checked_on=2026-11-24`, read back counts exactly matched the source. No synthetic SERP data, no fake transactions.
- Ubersuggest next advertised collection date 2026-11-30. First result cannot be fabricated in advance.
- Scheduled ongoing rank sync uses **existing** AMPHON Google+GSC task `6b050a7635348191b2cb9be83e549bec`, Mondays+Thursdays at 10:00 Asia/Bangkok starting 2026-11-30; scoped DB upsert permission to **rank_snapshots table only**, atomic 25/25 validation, read-back required. The task is configured but first future run has not yet been observed; it is **not** a verified completed future ingest.

## Fix for double-deploy race

Before: GitHub Actions and Cloudflare Workers Builds both ran `wrangler deploy` on `main` pushes, causing two deployments of the same commit.
After: Cloudflare Builds trigger `3949bbd4-3429-4878-aa58-54b25bd1285b` deploy command changed **only** to `npx wrangler versions upload` (Cloudflare-supported upload without promoting to live). GitHub Actions retains sole Production deploy; source branch and build command unchanged. The live Worker 100% version is unchanged after patch. This setting is reversible by restoring `npx wrangler deploy`; do not modify DNS.

## Portfolio guardrails and outstanding acceptance dependencies

- **13 active SEO sites**, all report GSC ready and site health OK at inspection; the 14th project is a discontinued pawn-iPhone site and must not be reactivated.
- **12/13 live production repository mappings VERIFIED**. The active iPhone buyback Worker source is still `CANDIDATE` because a historical Wrangler deployment lacks an exact linked Git commit; tracked at https://github.com/noteroru2/amphon-product-hub-shop/issues/175. Do not mark VERIFIED without provider/source evidence or blindly redeploy an older site.
- Keyword Ownership: 26 APPROVED, 0 PROPOSED, 2 REJECTED (incorrect Winner intent and discontinued pawn site).
- Real purchase and sale proof, verified deal count, business attribution: **zero confirmed records**, so no SEO-to-profit attribution can honestly be reported yet. Require actual owner-provided transactions via https://hub.amphon.co.th/; no fake data and no LINE identity guessing.
- Owner-authenticated visual browser end-to-end session and **first scheduled rank sync** remain future acceptance checks. Server code/CI, database RBAC and exact published SHA have been verified; do not claim an actual human-admin click test was performed.
- GSC after-release 7/14/28-day observations need completed future FINAL windows; no retrospective instant uplift claims.
- SEO Portfolio remains **read-only for deployment**, and ranks are not automatically edited by the frontend.

## Closeout determination

**Close the V1 development/release implementation** as shipped and tested. Keep future external evidence observation and owner real-trade validation explicitly open as operating checks, not as a reason to invent an inflated completion percentage.

Owner: AMPHON TRADING.
