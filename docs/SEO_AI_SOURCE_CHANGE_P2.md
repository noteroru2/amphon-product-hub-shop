# AMPHON SEO Source Change Requests — P2

**Status:** Stacked code PR; **not deployed**. Depends on [HUB P0/P1 PR #160](https://github.com/noteroru2/amphon-product-hub-shop/pull/160). All website source edits, GitHub mutations and deployments remain disabled in HUB.

## What this increment makes real

1. **Source Change Request storage:** audited, immutable-once-created metadata for an intended SEO content/source change, with a strict status transition from `REVIEW_REQUIRED` to either `APPROVED_FOR_DRAFT_PR` or `REJECTED`.
2. **OAuth MCP:** `seo_source_propose` requires existing `seo:draft` scope and verified, recent page/GSC/keyword evidence before saving a *proposal*. `seo_source_requests` is read-only.
3. **Review UI:** Existing SEO Control Tower → AI Development contains a Source Change queue, full proposed change explanation, intended file paths, target production repo/branch, SHA and owner-only approve/reject actions.
4. **Approval RPC:** a single owner-only, row-lock-protected review transition; before approval it **rechecks** enabled site, Repo mapping/branch, approved Keyword Ownership, same URL/job/evidence and recent GSC receipt.
5. **Safety tests:** deny unsafe files, unrelated URLs, cross-site and stale evidence, unverified Repository/branch, unapproved keyword, old/foreign GSC receipts and bypass of reviewer permissions.

## Evidence protocol

ChatGPT should first call `seo_sites` and `seo_portfolio`, then identify a real target URL and existing SEO content job with `seo_jobs` and `seo_job_evidence`. Call `seo_gsc_query` with the **exact** `site_id`, `page` and `query` to obtain a new `receipt_id`. Read GitHub for the verified production branch HEAD SHA and source content (this SHA is *not* trusted as GitHub-verified by the HUB proposal tool itself). Submit `seo_source_propose` for only allowed content paths and a scoped change rationale.

The source proposal API rejects requests unless:
- the site is enabled and Repository mapping is VERIFIED;
- the captured page evidence is for the same job and is no more than 30 days old;
- the target page belongs to the registered site's HTTPS origin;
- Keyword Ownership for the exact focus query is APPROVED;
- the GSC receipt belongs to the same OAuth actor, site, exact page and exact query and is no more than 7 days old;
- the supplied GitHub SHA is 40 hex characters and target paths are restricted to content-oriented files. **No GitHub SHA verification occurs here; the agent must check it again at PR creation.**

Both the API and SQL review enforce fail-closed guards. Untrusted proposed change text is displayed for review, never executed as commands.

## Database and launch sequence

- Additive migration: `supabase/migrations/20261123094500_seo_source_change_requests.sql`
- Enable RLS; Owner/Admin authenticated read only, no direct browser insert/update/delete.
- Service-role only creation from the authenticated OAuth Edge Function; only OWNER may review through `review_seo_source_change_request` RPC.
- Test the migration on a **staging database** and security advisories before applying to Production.
- Merge the prerequisite #160 first after approval; follow project migration procedure and deploy `seo-connector` Edge Function separately. Run production OAuth and RLS checks. Deploy Cloudflare HUB frontend after QA and approval. Never deploy just because a PR was opened.
- New MCP tools do **not** extend OAuth scopes. Existing owner consent remains `seo:read` or `seo:draft`.

## Owner-approved ChatGPT Draft PR handoff

An OWNER reviewing an `APPROVED_FOR_DRAFT_PR` request in the HUB can now copy
an AI GitHub handoff packet. This contains request ID, approved scope, repo,
branch, recorded SHA and allowed content-file paths. The handoff explicitly
instructs ChatGPT to re-check the request's status through `seo_source_requests`,
read the current `seo_portfolio` mapping, independently verify HEAD SHA on
GitHub, and refuse changes on mismatch. It may then create a branch and
**Draft PR** using the user's connected GitHub tool and report the QA result.
The copied packet itself is **not** an authorization credential. No merge or
deploy action is included, and the HUB retains no GitHub credentials.

This is a manual/ChatGPT-assisted bridge, not an autonomous GitHub executor.
A fully automatic executor with provider-validated SHA and audited PR links
remains a separate milestone.

## Acceptance checklist

- [ ] New migration applies and rolls back cleanly on staging database.
- [ ] Owner can read queue; Admin can read but cannot approve/reject; Staff/Anon cannot read.
- [ ] Direct INSERT/UPDATE/DELETE by authenticated browser roles denied.
- [ ] Service-role proposal creation only after all exact evidence guards pass.
- [ ] Unapproved keyword or stale GSC receipt cannot create or approve requests.
- [ ] Repeated review is blocked with `SEO_SOURCE_ALREADY_REVIEWED`.
- [ ] Approved proposal still cannot edit GitHub, Merge, Deploy, change DNS or change customer data.
- [ ] Frontend typecheck and full regression suite pass.
- [ ] OAuth `tools/list` shows `seo_source_requests` and `seo_source_propose` after deployment.

## Work that remains after P2

The next separate milestone is the **GitHub Draft PR executor**: after OWNER approval, verify current Repo/production branch SHA and file diff, create one scoped branch + Draft PR with exact evidence references, run per-Repo CI + SEO regression, then return PR link to Hub. No automatic merging or Production Deploy. Add receipt for GitHub PR and its SHA, compare with production provider events, and track final GSC 7/14/28-day outcomes.

Project completion is not declared until this E2E test passes on an actual approved website and the release/outcome stages are verified.
