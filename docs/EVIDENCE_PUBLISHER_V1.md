# AMPHON Evidence Publisher — no-additional-paid-services architecture (P0 / Draft PR #181)

**Status:** All code in the unmerged Draft PR. No Production deploy, no Supabase Production SQL, no public image. Supabase paid development branch is **not** created or required.

## Runtime split

1. **Hub UI** (Owner only): choose individually approved evidence image and 1–14 enabled target site/page paths. No secrets in browser.
2. **Cloudflare Worker** (metadata-only): `POST /api/stage` authenticates Owner using Supabase Auth and server-side profile; rechecks evidence APPROVED, consent/privacy flags, individual image approval, VERIFIED site mapping. Stores one private **queue** row per target URL; responds `QUEUED_PRIVATE_ONLY, media_staged:false, media_public:false`. The Worker **never downloads, re-encodes, reads, serves or uploads customer image bytes**. Its private R2 binding is for cancellation cleanup only. Public media GET remains 404. There is no Cloudflare Images binding.
3. **GitHub Actions, Node 22 + Sharp 0.35.4** (after owner protected Environment approval only): `.github/workflows/evidence-draft-pr-execute.yml` runs read-only queue/target dry-run and image dry-run, then downloads the APPROVED original from **Supabase private Storage using server-only secret**, performs a bounded Sharp WebP re-encode (metadata removed; no visible-content redaction), uploads to private **Cloudflare R2** `amphon-evidence-staged-private` through the S3-compatible PutObject API authenticated by AWS Signature V4 and a token restricted to that private R2 bucket, then creates a text-only Draft PR using a scoped short-lived GitHub App token. Never inserts image URLs into PRs. One workflow job per queue item / site-page (batch up to 14 queued).
4. **Database**, only when separately approved: migration `supabase/migrations/20261124_evidence_publisher.sql` creates private queue and reviewed page mappings, RLS enabled and no anon/authenticated grants. All destinations require verified mapping and full production SHA; disabled by default.
5. **Future owner review:** Review Draft PR, image visual privacy, copyright/consent, site SEO metadata, links and release checks. Public media production publisher with separate consent/revocation/CDN purge mechanism is **not part of this PR**.

## Existing free/no-new-bill components

- PostgreSQL 17 **ephemeral GitHub Actions service**, with synthetic Supabase-like tables and RLS tests; no paid Supabase branch. This is schema integration testing, not a full self-hosted Supabase Auth/Storage simulator.
- Sharp 0.35.4 already present in the repository npm lockfile and now pinned as a direct **devDependency**. Runs only in Node GitHub Actions, not Workers.
- Private R2 bucket `amphon-evidence-staged-private` already provisioned in APAC. Managed r2.dev domain **disabled**, zero custom domains. A synthetic 68-byte WebP was uploaded, read back and deleted; bucket was empty afterward.
- GitHub Actions usage and R2 resource usage remain subject to the account's actual free/remaining quotas. **No promise of unlimited free processing.**
- No usage of Cloudflare Images: earlier Images API returned 403.

## Security conditions

- Worker checks Owner server-side; non-Owners denied. GitHub protected Environment `evidence-draft-pr-protected` must have owner required reviewers.
- Workflow needs `AMPHON_SEO_SUPABASE_URL`, `AMPHON_EVIDENCE_SUPABASE_SECRET_KEY`, `AMPHON_CLOUDFLARE_ACCOUNT_ID`, `AMPHON_R2_ACCESS_KEY_ID`, `AMPHON_R2_SECRET_ACCESS_KEY` **as protected secrets** (never in Vite or Git). R2 token MUST be restricted to **Object Read & Write** for the single bucket `amphon-evidence-staged-private`; do not use an account-wide REST API token or deploy/zone/DNS permissions.
- GitHub App credentials are separate protected secrets, scoped at execution to only one verified repository. Worker optional Actions dispatch defaults **OFF** via `EVIDENCE_PR_DISPATCH_ENABLED=false`.
- A cancelled queue item cannot be newly staged/PR-created. Rechecking approval/Owner/mapping and exact production branch SHA happens at action execution, not trusting initial UI or queued fields.
- Sharp rejects SVG, input greater than 8 MiB, images above 25 megapixels, unsupported formats and malformed pixels. It removes EXIF/GPS/ICC/XMP metadata on re-encode; **not** face, labels, payments slips, serials or other visible PII. These require separate human visual inspection.
- Do not allow raw source image, signed private URL, request token, system log or original binary in any GitHub PR/artifact. Responses include only request IDs, SHA256 digest, sanitized status and byte count.
- No Merge/Deploy/Production SQL/Domain/DNS mutations or public image publication in this workflow. Protected owner authorization is required again before any real staging image operation and site Draft PR action.

## Synthetic E2E and QA

- `npm ci`
- `npm run verify:evidence-publisher`
- `npm run verify:evidence-image-sharp`
- `npm run verify:evidence-draft-pr`
- `npm run typecheck && npm run build`
- `npx wrangler deploy --config workers/evidence-publisher/wrangler.jsonc --dry-run` (**dry-run only**)
- GitHub Actions workflow `Evidence Publisher Draft QA (NO DEPLOY)` also launches disposable PostgreSQL 17 service, creates **synthetic** credentials and trade evidence, applies migration inside that service, and checks RLS, queue uniqueness, mapping approval and release status checks.
- Synthetic image E2E: generates a JPG with Sharp, queues a synthetic approved case through a mocked Worker/Supabase API, re-encodes to WebP in a mocked Node protected step, validates metadata stripping and private R2 upload, and ensures the Worker never reads customer photos. **No real private-photo or live Supabase Production connection.**

## Lenovo Job #22 / SEO release branch

- Approved real-world case is **ASSESSMENT_ONLY** because `transaction_verified=false`; do not present as a completed purchase.
- Old Draft PR #82 based on `main`; new Draft PR #83 `https://github.com/noteroru2/amphon.co.th/pull/83` is based on registered `release/cloudflare-production`, exactly one file +17/−0 lines, same approved text. Do not merge both.
- Both PRs remain unmerged and undeployed. Original image remains private.

## Activation blockers (NO changes to Production without separate owner approval)

1. Review/activate protected GitHub Environment + needed server secrets and App permissions.
2. Apply reviewed SQL to an isolated independently authorized database or staged Supabase Local Docker, **not live Supabase**.
3. Run owner-gated private image E2E only with a synthetic noncustomer object in isolated environment. Real image requires explicit separate privacy and media-stage approval.
4. Further public image publication requires an independent, auditable publish/revoke/CDN cache purge workflow.


## Free local Auth/Storage integration test (2026-11-25)

- The main `supabase/config.toml` and Production SQL are **never used as a development target**. The isolated test project is under `tests/evidence-local-supabase/supabase`, listening on 127.0.0.1 port 55321 with database port 55322. It is disposable and has no link to the live Supabase project.
- `.github/workflows/evidence-publisher-qa.yml` has a dedicated `local-supabase` job using `supabase/setup-cli@v1`. It copies the exact proposed Evidence Publisher migration into the isolated fixture migrations, starts **real Supabase Local Auth, PostgREST, Storage and Postgres** on Docker, creates synthetic Owner and Admin users, uploads a synthetic image to the local private Storage bucket, and tests the real Worker API against loopback HTTP through an explicit test-only URL proxy.
- The integration verifies Admin rejection, two registered site queues, no anon/authenticated access to private queue tables, actual local private Storage download via service role, Sharp metadata-stripped WebP, fake R2 upload, and **simulated** GitHub text-only Draft PRs whose receipts are recorded **only in disposable local Postgres**.
- No real Cloudflare R2 API, GitHub PR endpoint, live Supabase host, live photograph, or Production URL can be accessed by that job. The test script refuses any Supabase URL that is not local loopback and intercepts every would-be Cloudflare call.
- CI's existing `ephemeral-sql` job separately tests service_role explicit grants against revoked anon/authenticated privileges and release constraints. The local Supabase test is additional E2E evidence, not a substitute for release gates.

## Protected Environment safety and hard stop

- The production-use workflow includes a read-only GitHub Environment verification step `scripts/evidence-protected-env-preflight.mjs` before any image processing or PR write. It **rejects** an Environment with no `required_reviewers` rule or zero reviewers. If GitHub denies the environment metadata read (403/404), it fails closed. Unit tests exercise those denials.
- **GitHub limitation:** `workflow_dispatch` cannot be triggered while its workflow file exists only in Draft PR #181. GitHub requires the workflow file to exist on the default branch. Do not try to bypass this by merging without owner authorization. The code and synthetic tests can pass while the execution workflow remains inactive.
- The connected GitHub app in this chat does not expose an Environment/Secrets management API. Required reviewers and protected credentials therefore **cannot be asserted to be configured** until read back in a user-approved GitHub setup step. Never paste secrets into a chat or commit them to Git.
- On the GitHub public repository, navigate Settings → Environments → `evidence-draft-pr-protected`, enable Required Reviewers, then add only the narrowly-scoped secrets to that Environment. Environment activation must be tested before any real protected job; **do not run it as part of this no-deploy PR**.
- No fees from Supabase Preview Branch are incurred. GitHub Actions and Cloudflare R2 must remain within their actual free allocations; do not assume usage is always unlimited/free.

## Owner action, protected credentials (NO ACTIVATE)

After CI verification, user may add only the following GitHub Environment secrets to `evidence-draft-pr-protected`:
- `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED`: **DISABLED** (leave unchanged, never enter `YES_OWNER_ENABLED` at this stage)
- `AMPHON_SEO_SUPABASE_URL`: existing API URL (not a private key)
- `AMPHON_CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID (account-scoped identifier, not a secret)
- `AMPHON_R2_ACCESS_KEY_ID` and `AMPHON_R2_SECRET_ACCESS_KEY`: S3-compatible credentials **generated for a token with Object Read & Write permission and Apply to specific bucket only → `amphon-evidence-staged-private`**; store as Environment secrets, never in chat, browser frontend or source files
- `AMPHON_SEO_SERVICE_ROLE_KEY` and GitHub App ID/private key: only after independent review of permissions and necessity; service role bypasses RLS and must not be put in public client.

Older `AMPHON_CLOUDFLARE_R2_API_TOKEN` is NOT USED by this architecture and should not be created. The Cloudflare REST API does not accept the narrowly bucket-scoped S3 Object Read & Write credentials; code uses AWS4-HMAC-SHA256 signing against `https://<account_id>.r2.cloudflarestorage.com/<bucket>/<key>`. The signed request is server-only and sends no image to GitHub artifacts.

GitHub Environment secrets alone do NOT start the workflow. `workflow_dispatch` is unavailable until an explicit later owner-approved merge of the workflow file into the default branch. A subsequent protected job still requires the Environment reviewer and correct config. Do not initiate it now.

Cloudflare official docs: https://developers.cloudflare.com/r2/api/tokens/ ; https://developers.cloudflare.com/r2/get-started/s3/ .

## New Supabase secret keys security (added 2026-11-25)

Supabase now recommends project-scoped `sb_secret_...` backend keys instead of legacy JWT `service_role` keys. **Do not create or put any live secret in GitHub yet.** A new secret key still authorizes the elevated `service_role` with BYPASSRLS and must be treated as full-project access, not an evidence-table-only credential.

The protected Evidence-only workflow reads `AMPHON_EVIDENCE_SUPABASE_SECRET_KEY` (a future dedicated named key) and passes it to the Node backend as `AMPHON_SEO_SERVICE_ROLE_KEY` for compatibility. Never reuse an unrelated SEO or Hub secret unnecessarily. Server adapters `scripts/evidence-draft-pr.mjs`, `scripts/evidence-image-sharp.mjs` and Worker `workers/evidence-publisher/index.mjs` now use `apikey` **without** `Authorization: Bearer sb_secret_...` for new secret keys; they preserve legacy JWT headers for local regression tests. Publishable keys are rejected as privileged credentials.

No new secret is needed until all remaining release gates and a **separate owner approval** to configure live credentials. Supabase reference: https://supabase.com/docs/guides/getting-started/api-keys ; https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys .
