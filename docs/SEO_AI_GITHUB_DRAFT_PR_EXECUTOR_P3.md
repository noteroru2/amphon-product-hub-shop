# AMPHON SEO Draft PR Executor — P3

**Stage:** code PR only. Not deployed, not attached to Cron, webhook, HTTP endpoint or the OAuth MCP. Must not run without an owner-approved request.

## Design goal

Make the *approved* SEO Source Change → GitHub Draft PR transition programmatically executable, deterministic and auditable, **without** granting auto-merge or deploy privileges to the HUB, ChatGPT, or an always-on worker.

The previous PRs must land first:
- [#160](https://github.com/noteroru2/amphon-product-hub-shop/pull/160) — portfolio/GSC/SEO Development UI + OAuth MCP
- [#161](https://github.com/noteroru2/amphon-product-hub-shop/pull/161) — owner-reviewed Source Change Request table and MCP tools
- This PR — bounded, operator-invoked GitHub Draft PR executor and immutable PR-receipt ledger

## Approved structured change format

The `seo_source_propose` tool in #161 can accept freeform prose for manual review, but **automatic execution deliberately rejects it**. For executable changes, `proposed_change` must be a JSON **string** whose entire content matches:

```json
{
  "schema": "amphon.seo.literal-edits.v1",
  "edits": [
    {
      "path": "src/pages/services/notebook.astro",
      "expected_blob_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "find": "<h1>รับซื้อโน๊ตบุ๊ค</h1>",
      "replace": "<h1>รับซื้อโน๊ตบุ๊คมือสอง</h1>"
    }
  ]
}
```

This is a **shape example, not a production patch**. Never reuse the example SHA. A real proposal must capture the current target file's GitHub blob SHA and the production branch HEAD SHA before the owner approves. Reviewers must inspect the exact old and new snippets.

Executor restrictions:
- exact list/order of files must equal `requested_paths` (max 8);
- `find` must occur **exactly once** in the specific file at the verified base SHA;
- only text SEO content paths `src/pages`, `src/content`, `src/components`, `src/layouts`, `pages`, `content` with `.astro`, `.md`, `.mdx`, `.html`;
- no arbitrary script execution, `.js`, `.tsx`, workflow, secret, package, DNS or Cloudflare config paths;
- no regex/template/command substitution, GitHub force push, Merge or Deploy.

## Execution steps

1. Server operator supplies one approved request UUID; default mode is **dry-run**.
2. Executor reads its request, site, production mapping, owner review, SEO Job, captured public URL evidence, specific approved Keyword Ownership, and same actor's GSC receipt from Supabase **again**.
3. It rejects if any approval or evidence is invalid/stale, including missing 7-day exact GSC receipt.
4. It reads **live GitHub** production branch HEAD and refuses mismatch with owner-approved SHA.
5. It checks that deterministic `seo/owner-reviewed-<uuid>` branch does not exist.
6. It fetches all requested files **at that exact commit** and validates each blob SHA and unique literal replacement.
7. Dry-run stops with summarized hash/path evidence, **without any write**.
8. Explicit execution writes one new Git tree and commit, rechecks production HEAD, creates a new branch and **Draft PR only**.
9. It records immutable receipt in `commerce_seo_source_change_pr_runs`. Retry returns existing receipt, never duplicates a PR. A partial external write failure requires manual reconciliation, not an automated retry/overwrite.
10. HUB Source Change Queue shows PR number/link and commit SHA from the audit ledger.

**Important:** GitHub CI may run on the created Draft PR, but this executor does not approve or merge it; owner review remains necessary.

## Runtime secrets (server-only)

- `AMPHON_SEO_SUPABASE_URL` — validated `https://<project>.supabase.co` URL
- `AMPHON_SEO_SERVICE_ROLE_KEY` — server-only. Never add to any `VITE_*` value or browser env.
- `AMPHON_SEO_GITHUB_TOKEN` — **fine-grained** GitHub token or installation token restricted to a single verified target repository with Contents: read/write and Pull Requests: read/write only. Do not grant Workflows, Administration, or Deployments.

These secrets are **not** configured by this PR. The CLI is intentionally not an always-on endpoint and is never run automatically in CI.

```bash
npm run verify:seo-draft-pr-executor
npm run seo:draft-pr -- --request-id 00000000-0000-4000-8000-000000000000 --dry-run
# Only after approved request, successful dry run, and explicit operator approval:
npm run seo:draft-pr -- --request-id <approved-request-uuid> --execute --owner-authorized
```

The first dry-run command uses a **dummy UUID placeholder** and will fail without a real approved request and server credentials. It is not an integration smoke test of Production.

## Database rollout

Migration staged as `supabase/migrations/20261123103000_seo_source_change_pr_runs.sql`. Requires #161 migration first.

- Immutable PR run per source request (PK request UUID)
- Owner/Admin read-only RLS; authenticated/anon cannot insert
- Service-role insertion only; trigger rechecks Owner approval and exact repo, branch, base SHA, requested paths and PR URL identity
- No direct frontend writes or Cloudflare Deploy permissions

Do not apply to Production before staging DB smoke tests with Owner/Admin/Staff/Anon, including direct INSERT denial and duplicate request replay.

## Acceptance / remaining production work

- [x] Pure engine and testable GitHub/Supabase adapters implemented
- [x] Dry-run + owner execution command implemented; default is no write
- [x] Exact blob SHA and branch HEAD check, allowlist, owner/evidence and repeated approval checks
- [x] One commit and **Draft PR only** interface (no merge/deploy API)
- [x] Immutable PR receipt migration, RLS and review trigger code
- [x] HUB PR receipt read/display code
- [ ] Staging DB migration + Owner/Admin/Staff RLS tests
- [ ] Deploy dependencies in order (#160 → #161 → #162), separately confirming Supabase Edge and Cloudflare
- [ ] Configure narrowly scoped GitHub App/token in a secret manager with repo allowlist
- [ ] Run live dry-run on an owner-approved request
- [ ] Create and verify first real Draft PR with CI pass; verify receipt in HUB
- [ ] Explicit owner Merge/Production deploy approval and rollback
- [ ] Verify release SHA from hosting and GSC 7/14/28-day measured outcomes
- [ ] Optional licensed SERP data source for true live Google rank

Success means verified end-to-end results, **not** merely CI green on code PR.
