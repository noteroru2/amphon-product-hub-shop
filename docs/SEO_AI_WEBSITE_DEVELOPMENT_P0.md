# AI Website Development — HUB Portfolio MCP P0

## Target

This change is made in **noteroru2/amphon-product-hub-shop**, the codebase routed to
`https://hub.amphon.co.th` by `wrangler.jsonc`. It extends the EXISTING SEO
Control Tower and OAuth MCP connector instead of creating a competing SEO app.

## New ChatGPT tool

`seo_portfolio({ site_id?: string, window_days?: 7 | 14 | 28 })`

- Read-only, granted by the existing OAuth `seo:read` permission.
- Uses enabled sites in `commerce_seo_sites`. Disabled/retired sites are excluded.
- Uses the existing Hub portfolio DB: `commerce_seo_portfolio_projects`,
  `commerce_seo_portfolio_keyword_roles`,
  `commerce_seo_portfolio_gsc_windows_v`,
  `commerce_seo_portfolio_release_events`,
  `commerce_seo_portfolio_funnel_v` and
  `commerce_seo_portfolio_gsc_ingest_runs`.
- Returns bounded, explicit fields, assembly timestamp, data source labels and
  an evidence-rules object. No secrets, customer PII or untrusted page HTML.
- For site-specific analysis, request `site_id` and a window. For a network
  summary, omit `site_id`. Limits protect both modes.
- Does not make a live Google search, trigger a GSC refresh, call OpenAI,
  approve content, modify a GitHub repository, or deploy.
- `mapping_status=VERIFIED` still requires matching checked production
  repository and commit before a source edit. Do not treat a candidate as verified.
- `approval_status=PROPOSED` is not approved Keyword Ownership.
- Recorded commits are not proof that Production contains those commits.
- GSC average Position is not a SERP snapshot; check the recorded window and
  ingest completeness. Shop measurements must remain page-host scoped.

## Hub UX

The **SEO Control Tower → Portfolio** screen now has
**คัดลอก AI Development Brief**. It exports current site selection, window,
keyword ownership, release, GSC ingest and aggregated conversion data as a
JSON brief for review in ChatGPT. Clipboard export is an interim workflow;
the new MCP tool is preferred once the new Edge Function code is deployed.

## How to verify before rollout

1. `npm run verify:seo-portfolio-mcp`
2. `npm run typecheck`
3. `npm run build`
4. With a preview, confirm OWNER/ADMIN can view Portfolio, copy the selected
   brief, and no raw personal/customer data or secrets are present.
5. Deploy the `seo-connector` Edge Function **separately only after approval**.
   Test with an OAuth `seo:read` connection:
   - `tools/list` exposes `seo_portfolio`.
   - Missing site or a disabled site is rejected.
   - 7/14/28 window values succeed, other values are rejected.
   - No write, auto-merge, or deploy effects are possible.
6. Compare one site/window payload against the existing Portfolio dashboard.
   Confirm GSC dates and mapping statuses line up.
7. Do not promote Hub frontend/Cloudflare or Edge Function automatically on
   merge unless the approved deployment process explicitly permits it.

## Next milestone

Use the evidence from `seo_portfolio`, `seo_gsc_query`,
`seo_url_inspection` and `seo_job_evidence` to prepare narrowly scoped
GitHub branches and PRs under owner-approved mappings. Add an explicit
approval-gated source patch tool and SHA-based deploy verification separately.
Do not expand OAuth scopes to production-write capabilities by default.


## P1 — AI Development readiness + project completion dashboard

Added to the **same PR #160**, still draft and not deployed:

- **SEO Control Tower → AI Development · ความคืบหน้า**: shows 12 explicitly
  defined workstreams with `COMPLETE / PARTIAL / PENDING_RELEASE / PLANNED`
  results. There is no fabricated "90% finished" score. Data-driven steps
  re-evaluate on every authenticated portfolio load.
- Per-site readiness evaluates VERIFIED production Repo, approved Keyword
  Ownership, matching final GSC window and successful complete 7/14-day
  Query/Page ingestion receipt. Only then the next permitted stage is
  **PAGE_EVIDENCE_REVIEW**, NOT source mutation.
- **คัดลอก AI Work Order** creates a bounded context packet for ChatGPT and
  the existing GitHub connector, including source mapping, GSC date, receipt,
  ownership, evidence URLs and release data from the selected site.
- The `seo_portfolio` OAuth tool returns `site_readiness`,
  `project_milestones` and `project_completion` calculated from the same
  pure advisory policy, with `connectorVerifiedLive=true` only when the
  connector actually serves the request after deployment.
- Development readiness policy is in
  `supabase/functions/seo-connector/developmentStatus.ts`.
  Tests require that a VERIFIED repo does not by itself authorize patching,
  unapproved roles fail closed, missing/incomplete/stale GSC blocks review,
  and a Commit does not equal a verified production release.
- GSC 28-day **aggregate** exists, but current detail ingestion receipts are
  only for 7/14 days. The readiness gate therefore checks recent 7/14-day
  receipts for the selected site's latest GSC end date. This is deliberately
  stricter than displaying a 28-day average position.
- Site counts and review statuses are taken from the live portfolio, NOT
  from hard-coded 13/14-site lists.

### P1 verification

```sh
npm run verify:seo-portfolio-mcp
npm run verify:seo-development-status
node --test tests/seo-connector.test.mjs
npm run typecheck
npm run build
```

### Not yet complete (do not label as finished)

1. Merge PR #160 and separately deploy HUB UI + `seo-connector` Edge Function.
2. Verify live OAuth tools/list and an authorized `seo_portfolio` response
   with no sensitive data.
3. Approve primary keyword ownership and verify any still-candidate production
   repo mappings.
4. Check individual URL-level technical/content evidence and target SHA for
   each real SEO code change.
5. Build/approve narrow source patch → Draft PR → CI/SEO regression, with a
   separate human gate for Merge/Deploy and SHA-aware rollback.
6. Verify Production release/URL coverage and 7/14/28-day outcomes.
7. Add a budgeted, independently verified Live SERP data provider if exact
   current Google rankings are still required.

The dashboard reports prerequisites as they exist, not authorization to act
on them. `central_deploy_allowed` is never changed by this feature.
