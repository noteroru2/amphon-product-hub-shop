# AMPHON Evidence Publisher — production release gate (NOT AUTHORIZED)

**Scope:** Evidence Publisher Draft PR #181. This is a release checklist and audit record, NOT permission to merge, deploy, access real customer photos, or alter live SQL. The owner requires a separate explicit authorization for each operation. This project must remain within existing free quotas; do not create a paid Supabase preview branch.

## Verified READ-ONLY on 2026-11-25

- Existing Supabase project has `profiles`, `trade_evidence`, `trade_evidence_images`, `commerce_seo_sites`, `commerce_seo_portfolio_projects`.
- These five tables have RLS enabled. They may still allow authorized users or privileged services to read data; RLS is not a guarantee against `service_role`.
- `commerce_evidence_publication_requests` and `commerce_evidence_page_source_mappings` DO NOT EXIST in live Production. Thus the Publisher must remain disabled.
- `trade-evidence-private` storage bucket is `public=false`.
- 14 sites are registered, 12 have `mapping_status=VERIFIED`, non-null repo/branch and `central_deploy_allowed=false`. This does NOT mean any site/page source mapping has been reviewed or enabled for Publisher.
- Separate private Cloudflare R2 bucket `amphon-evidence-staged-private`: no public custom domain or managed r2.dev. Worker code now has no R2 binding or delete access.
- The sandbox GitHub App was validated using a single private repo and a synthetic Draft PR, which was closed unmerged. The owner reported removal of four temporary sandbox secrets. This report cannot be independently verified by the connected repository tools.
- The owner previously set `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=DISABLED`; this value is user-reported and cannot be read from GitHub Environment Secrets.

## Required GO / NO-GO gates

**Gate A: Code & CI — DO NOT ASSUME PASS UNTIL THE LATEST HEAD CI IS GREEN.**
- Review only the exact head SHA of Draft PR #181, full Hub build, Worker `wrangler --dry-run`, owner/consent image tests, R2 S3 SigV4 key scope, cancellation race guard, GitHub Environment API preflight, synthetic Supabase Local Auth/Storage and disposable Postgres17 RLS/migration.
- The GitHub Environment preflight needs `GITHUB_TOKEN` `actions: read` in addition to `contents: read`, per GitHub's GET /environments documentation. It must fail closed on inaccessible or missing reviewers.

**Gate B: Supabase schema — requires separate Production SQL approval.**
- Audit exact SQL `supabase/migrations/20261124_evidence_publisher.sql` against the live table/column types and foreign keys.
- Before *any* live DDL, establish a real backup/PITR recovery plan appropriate to the existing plan (not an assumed entitlement), take a migration receipt, agree rollback/forward-fix procedure and designate an owner-approved execution window.
- Apply proposed migration only after explicit approval, then read-back row-level security, grants and exact 2-table existence; never use `service_role` from a browser; ensure no newly enabled page mapping or queued requests. **Do not perform this step now.**
- If rollback is needed, do NOT blindly `DROP TABLE CASCADE`; preserve transaction/queue audit and use an owner-reviewed forward-fix or restore plan.

**Gate C: Service secrets — separate explicit authorization.**
- Existing protected GitHub Environment has `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=DISABLED` and GitHub App/R2 Secrets user-installed (values uninspectable). Keep disabled.
- New dedicated `AMPHON_EVIDENCE_SUPABASE_SECRET_KEY` is NOT authorized yet. A `sb_secret_...` key has elevated `service_role` authority and bypasses RLS across the project even if named "evidence"; naming does not limit privileges.
- Check key handling, scope, rotation, no logs, exact GitHub secret target and possible safer service-side endpoint before adding it. No live credential is necessary for synthetic QA.

**Gate D: GitHub App installation & source review — requires separate approval.**
- The app has not been authorized for the real website repositories. Install on a single target repo only after review, never "all repositories".
- Owner reviews one target site's source path, insert anchor, release branch, exact base SHA, actual service claims, individual photo consent and PII redaction before enabling the page mapping.
- A real transaction must have `transaction_verified=true`; otherwise use `ASSESSMENT_ONLY`. Never claim storefronts/branches not operated by AMPHON.

**Gate E: Real private media — requires separate approval.**
- No real customer image use until explicit approval. Review faces, serial numbers, documents, ID cards, payment receipts and visible PII; Sharp strips metadata only and cannot hide visible PII.
- No public R2 domain/GET route in this release. There is no public image publication workflow.
- On cancellation the Worker only updates queue metadata; R2 cleanup remains `DEFERRED_LOCKED_REVIEW` until an separately approved retention design protects shared keys.

**Gate F: Merge, Deploy and public release — each requires new owner approval.**
- `workflow_dispatch` on default branch cannot run the new protected workflow while it is only present in Draft PR #181. Do not bypass this through an unapproved merge.
- Hub/Worker Deploy, Production DDL, website Draft PR creation, website Merge/Deploy and any public image publication are independent decisions and require independent owner authorization. None are authorized by this checklist.

## Explicit hard-stop

On any unavailable CI evidence, unreviewed mapping, insufficient privileges, missing owner approval, unexpected repository, live secret leakage, revoked consent or SHA mismatch: **STOP**. Keep all production services unchanged and keep `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=DISABLED`.
