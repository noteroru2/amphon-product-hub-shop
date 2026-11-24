# AMPHON Google Rank Checker — Production Closeout V1 (24 Nov 2026)

## Goal and trust boundary

Make **Ubersuggest exact SERP rank** query history visible in the authenticated Hub SEO Portfolio, separately from Google Search Console's impression-weighted average position. All production writes to the rank ledger are server-to-server **service_role only**; the Hub can only read after checking the existing active owner/admin profile through `seo-gsc`.

- Source project: `e0e35163c7012e8cbb50d3a952ee5daa6f781c731eaf69c3225f17ef09d465c4` (`amphon.co.th`).
- Locale: Thailand `loc_id=2764`; `language_code=th`; device `DESKTOP`.
- Provider limit 25 tracked positions; current eight originals preserved, seventeen additions 2026-11-24.
- `status=PENDING` means the provider has no collected SERP result yet; `status=NOT_RANKING_TOP_100` requires provider `status=ok` **and** dated null position, not a pending state.
- `RANKED` requires integer 1..100 and provider SERP collection date.
- `checked_on` is **the day we queried the provider** in Thailand, distinct from the provider `serp_date`. Do not substitute `checked_on` for `serp_date`.
- The database does not accept GSC rows as SERP observations; no guessed ranks and no fabricated revenue.

## Schema/implementation

- Private `commerce_seo_portfolio_rank_snapshots` table with RLS, no grants to anonymous or browser authenticated users. One snapshot per keyword/project/locale/device/check date. Server-only upserts.
- `seo-gsc` Portfolio action (already owner/admin only) includes a bounded set of exact rank snapshots for the selected site.
- `SeoPortfolioDashboard` renders the latest checked snapshot per keyword; pending and not-in-top-100 remain distinct; latest provider observation date appears separately from checked date.
- New `tests/seo-rank-ledger.test.mjs` enforces rank semantics, SQL ACL and private endpoint read path, in addition to the full build QA.

## Safe weekly refresh using connected Ubersuggest + Supabase

1. Read the Ubersuggest project with `get_project` and assert **active**, domain `amphon.co.th`, exactly one `{lang:'th',loc_id:2764}` location, 25 unique tracked keywords. Do not call keyword metrics or run paid keyword updates.
2. Read `project_position_info` for Desktop, Thailand, Thai, with the current date range. Require `done=true`; the data may legitimately contain `pending` rows. Do not treat provider `not_ranking` aggregate (which counts pending as unranked) as individual keyword positions.
3. For **each exact tracked keyword**:
   - provider `status=pending` and `new_position=null` -> `PENDING`, `serp_date=NULL`, `position=NULL`.
   - provider `status=ok` and a dated `new_position.position=null` -> `NOT_RANKING_TOP_100`, `serp_date=new_position.date`.
   - provider `status=ok` and numeric integer `new_position.position` in 1..100 + valid date -> `RANKED`.
   - any unknown/untrusted structure -> **abort all**; never write partial or guessed rows.
4. Upsert **all 25** using `service_role` server-side account connection to `public.commerce_seo_portfolio_rank_snapshots`. `checked_on` must be the current Asia/Bangkok date; `checked_at=now()`. Do not write at all if the project or rows don't match the registered 25 keywords or if the tool report is not finalized.
5. Read back 25 exact rows for the date/project/locale/device and verify status bucket counts; confirm Hub dashboard shows the same numbers.
6. Report historical trends only when the provider has 2 or more dated SERP results for that exact keyword; never compare a pending row to an actual position or claim SEO growth from provider absence.

## Acceptance / explicitly deferred

| Area | Gate |
| --- | --- |
| 13 active website properties, 7/14/28d GSC Final | Already present |
| Keyword Ownership | 26 APPROVED, 2 REJECTED (one retired pawn site), 0 PROPOSED |
| Repo mapping | 12/13 active mapped; iPhone buyback Worker source SHA remains **CANDIDATE** [issue #175](https://github.com/noteroru2/amphon-product-hub-shop/issues/175) |
| Rank tracking | 25/25 Ubersuggest tracked. Newly added SERP data may be pending until provider's Nov 30 refresh |
| Conversion | Trade evidence and proof-aware economics shipped, **zero real deals currently verified**; cannot force fake production transactions |
| Release governance | Central remains read-only for deployment; site releases require source SHA, provider READY, smoke checks and authorized owner approval |

**Technical delivery complete** can be achieved after schema deploy, authenticated Hub deployment, tested rank snapshot ingestion, endpoint verification, and automated weekly refresh. **Business outcome measurement** is an ongoing operating process requiring real deals and future Google data; do not represent it as already verified.
