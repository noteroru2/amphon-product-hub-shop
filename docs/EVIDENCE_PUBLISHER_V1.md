# AMPHON Evidence Publisher V1 — P0 security / multi-site Draft PR (NOT DEPLOYED)

**Gate:** No Production SQL, no Worker/Hub deployment, no public image, no site merge or deployment. This is an owner-reviewed DRAFT implementation only.

## Actual designed flow
1. Owner/Admin add evidence and images via existing HUB form and Supabase `trade-evidence-private`.
2. Owner approves trade_evidence and the individually privacy-reviewed image. This approval permits **private staging**, not public publication. Reconfirm visible PII redaction before proceeding.
3. Owner chooses 1–14 enabled, VERIFIED site IDs and exact page paths in Hub's `EvidencePublisherPanel`.
4. Owner-only Worker `POST /api/stage` rechecks approval/permission/privacy, existence of a VERIFIED production mapping, and the **false** `central_deploy_allowed` flag. It reads the image server-side from private storage, re-encodes WebP via Cloudflare Images and saves into **private R2**. There is **no public media GET route or public URL**.
5. One idempotent, private `PENDING_SOURCE_PR` request is recorded per site/page in `commerce_evidence_publication_requests`. A queued image can be cancelled before PR creation with owner-only `POST /api/cancel`. If all active refs are cancelled, its staged derivative is removed.
6. Optional **owner-initiated dispatch**: after the private queue is committed, the Worker may send one `workflow_dispatch` for each selected site using a token scoped to **Actions:write on the central Hub repository only**. Default configuration `EVIDENCE_PR_DISPATCH_ENABLED=false` means the Worker **does not** dispatch automatically. When separately enabled, the protected Environment still requires owner review before a Draft PR write.
7. A separate, owner-protected GitHub Actions workflow `.github/workflows/evidence-draft-pr-execute.yml` takes **one approved queue ID per run**, resolves an existing reviewed mapping for that site/page, and uses a **repo-scoped GitHub App token**. Its default script `scripts/evidence-draft-pr.mjs` is **dry-run**; actual branch + Draft PR only needs `--execute --owner-authorized` and the protected environment gate. Select multiple websites by creating multiple queue IDs and executing one protected job per site.
8. The code edits only the exact, reviewed `*.md|*.mdx|*.astro` source file on the **registered production branch** pinned to its approved full SHA. Inserts text-only, privacy-filtered case; no image/media URL is inserted, no automatic Merge/Deploy.
9. Separately review each PR's diff, canonical, H1/title, schema, links, mobile LINE CTA, CI, live deployment evidence, then specifically approve Merge & Cloudflare Deployment. Public media publication is a **separate future step** that will need a dedicated approval, revocation, privacy and CDN purge mechanism.

## Key safety decisions
- `source_site_id/source_page_path` on trade_evidence are **acquisition attribution**, not publication destinations. Selected destinations are independent.
- Evidence `transaction_verified=false` must produce **ASSESSMENT_ONLY**; a pending quote is never presented as a completed purchase.
- RLS enabled, `anon` and `authenticated` have no grants on queue/mapping tables. Supabase service secret and GitHub App private key are **server-side only**.
- No automatic public image URLs, signed URL embedding, public bucket changes, or preview of private photos on GitHub.
- Fail closed on unknown site, disabled/CANDIDATE mapping, unreviewed page path/source path, wrong owner, approval revoked, branch SHA changed, missing unique insertion anchor, duplicate marker, unsafe Markdown, or repeat branch.
- If the owner later revokes evidence, do not merge related Draft PR. Close it and delete the staged private derivative; separately revoke and purge any asset made public by a future service.
- Side-effect caveat: a GitHub PR may be created before a database receipt write fails. Branch existence stops duplicate automated creation; reconciliation needs deliberate owner review.

## Required separate owner setup (NOT performed in this PR)
- Review and **manually approve** SQL file `supabase/migrations/20261124_evidence_publisher.sql` and staging database migration; no change was made to Production.
- Provision private R2 bucket `amphon-evidence-staged-private`, configure Cloudflare Images binding and optional isolated hostname, and verify the Cloudflare plan/pricing.
- Configure Worker secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; R2 `STAGED_IMAGES`; CORS `ALLOWED_ORIGINS=https://hub.amphon.co.th`. Nothing in frontend gets private keys.
- If automatic workflow dispatch is separately approved, configure only `GITHUB_DISPATCH_TOKEN` with **Actions:write on the central Hub repo**, set `EVIDENCE_PR_DISPATCH_ENABLED=true`, and ensure the `evidence-draft-pr-protected` Environment has required owner reviewers. No target repository write token lives in the Worker.
- Hub may set `VITE_EVIDENCE_PUBLISHER_API` only **after separate owner approval and controlled deployment**.
- For **each** site/page, enter `commerce_evidence_page_source_mappings` with exact `site_id, page_path, source_path, insert_before, expected_base_sha, reviewed_by, reviewed_at, enabled`. **No mapping is enabled by default**.
- Configure `evidence-draft-pr-protected` GitHub Environment with required owner reviewers and environment activation `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=YES_OWNER_ENABLED`; secrets `AMPHON_SEO_SUPABASE_URL`, `AMPHON_SEO_SERVICE_ROLE_KEY`, `AMPHON_SEO_GITHUB_APP_ID`, `AMPHON_SEO_GITHUB_APP_PRIVATE_KEY`. **Never paste credentials in ChatGPT**.
- Run `npm ci && npm run verify:evidence-publisher && npm run verify:evidence-draft-pr && npm run typecheck && npm run build` and `npx wrangler deploy --config workers/evidence-publisher/wrangler.jsonc --dry-run` (dry run only).

## Job #22 Lenovo IdeaPad Gaming E2E boundary
- Evidence UUID `dd8cbc49-1caf-477c-b579-955007517b61`, image UUID `8ebfb3f2-1d13-404f-9cfa-93ef40672f16`; trade status APPROVED, privacy and use permissions confirmed, transaction **not verified**.
- Existing `amphon.co.th` Draft PR #82 contains approved **text-only assessment** but targets `main`, whereas the Hub Production branch is `release/cloudflare-production`. A corrected **Draft PR #83** is based on the registered release branch and contains identical approved text with a single-file +17/−0 diff. **Do not merge PR #82 and #83 both.**
- E2E tests use a fully simulated file/DB/GitHub and no real private image bytes. Tests verify that an approved Lenovo *assessment* creates a text-only Draft PR on the registered branch, retains source frontmatter, and refuses unsafe claims/paths.
- No live test of R2 private image bytes or Production Worker can be executed without the separately approved staging setup/deployment. A green Build is **not live E2E evidence**.
