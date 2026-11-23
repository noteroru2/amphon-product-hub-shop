# P4 — Recovery of an existing owner-approved SEO Draft PR

**Status: stacked development PR only; NOT deployed.** Depends on #160 → #161 → #162.

## Why reconciliation exists

An external GitHub Draft PR can be created successfully even when the subsequent Supabase PR-receipt insert fails. Prior behavior stopped on the already-existing deterministic branch; that protected against duplication but left the owner without a verified PR entry in HUB.

This P4 change gives operators a **non-destructive** recovery procedure. It does **not** merge, deploy, create a branch, create a second PR, reset a commit, or change a website.

## Recovery algorithm

1. Re-read the original Source Change Request, OWNER approval, active site, VERIFIED source repository/production branch, approved keyword owner, original page evidence and the exact actor/page/query GSC receipt from Supabase.
2. Require recent evidence (page ≤30 days; GSC receipt ≤7 days) even when a ledger entry already exists. If evidence expired, stop for manual review; recovery may require a new approved request.
3. Require the target production branch HEAD still matches the approved base commit SHA.
4. Read the deterministic `seo/owner-reviewed-<request-uuid>` branch and verify its commit has **exactly one parent**, equal to the approved base SHA.
5. Read GitHub's commit-file list and require that exactly the approved 1–8 content files changed, all with status `modified`.
6. For each file, read the original **at the approved base SHA**, confirm its blob SHA, perform the previously approved exactly-once literal replacement in memory, then verify the Draft branch contains **exactly the resulting file content**.
7. Search GitHub for the existing PR by repo, branch and base branch. Require **exactly one open Draft PR** on the correct repository with the same head SHA, matching request ID and base SHA embedded in the PR body. A merged, closed, ready-for-review, renamed, modified, or ambiguous PR is rejected.
8. If an audit receipt is already stored, compare request/repo/branch/commit/digest/files/PR number and URL before reporting it verified.
9. If the receipt is absent:
   - `--reconcile --dry-run`: report the validated PR without any writes.
   - `--reconcile --execute --owner-authorized`: **only INSERT** the original PR receipt into the immutable Supabase ledger. No GitHub write endpoints are available in this module.

No blind retry, force-push, automatic PR re-creation, automatic merge, or deployment.

## Manual CLI

Only after prerequisites, owner-reviewed code and approved Production rollout:

```bash
npm run seo:draft-pr -- --request-id <approved-uuid> --reconcile --dry-run

# Only after the independent review above:
npm run seo:draft-pr -- --request-id <approved-uuid> --reconcile --execute --owner-authorized
```

For convenience a separate `workflow_dispatch`-only workflow is provided at
`.github/workflows/seo-draft-pr-reconcile.yml`. It uses the same **protected** GitHub Environment as the creator, a single-repository GitHub App token with **Contents:read and Pull Requests:read only**, and the same request-specific concurrency group. A separate boolean `write_audit_receipt` controls whether the verified receipt may be written. It defaults to **false**.

Protected-environment reviewers, secret activation, and GitHub App installation must be configured by the owner. The workflow has no scheduled trigger.

## Acceptance

- [x] Existing Draft PR state, repo, branch, parent SHA and exact changed file set are checked.
- [x] Current content must exactly equal approved replacements; extra changes fail closed.
- [x] Stored receipt is independently verified rather than blindly trusted.
- [x] Dry Run has no writes; only explicit recovery can append the missing PR receipt.
- [x] No calls to GitHub `POST`, `PATCH`, `PUT`, or `DELETE` in recovery.
- [x] Mock tests cover failed receipt writes, replay, stale approvals/evidence, foreign repos, changed files and PRs.
- [ ] Rollout is still blocked by P2/P3 staging Supabase Auth/PostgREST checks, protected GitHub environment, and live owner-approved Draft PR verification.
- [ ] No Production Merge/Deploy or live SERP measurement is performed by P4.

If any check fails, investigate manually. Do not change an approved source request or PR to make it pass.
