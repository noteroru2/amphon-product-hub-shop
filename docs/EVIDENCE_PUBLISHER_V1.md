# AMPHON Evidence Publisher — no-additional-paid-services architecture (P0 / Draft PR #181)

**Status:** All code in the unmerged Draft PR. No Production deploy, no Supabase Production SQL, no public image. Supabase paid development branch is **not** created or required.

## Runtime split

1. **Hub UI** (Owner only): choose individually approved evidence image and 1–14 enabled target site/page paths. No secrets in browser.
2. **Cloudflare Worker** (metadata-only): `POST /api/stage` authenticates Owner using Supabase Auth and server-side profile; rechecks evidence APPROVED, consent/privacy flags, individual image approval, VERIFIED site mapping. Stores one private **queue** row per target URL; responds `QUEUED_PRIVATE_ONLY, media_staged:false, media_public:false`. The Worker **never downloads, re-encodes, reads, serves or uploads customer image bytes**. Its private R2 binding is for cancellation cleanup only. Public media GET remains 404. There is no Cloudflare Images binding.
3. **GitHub Actions, Node 22 + Sharp 0.35.4** (after owner protected Environment approval only): `.github/workflows/evidence-draft-pr-execute.yml` runs read-only queue/target dry-run and image dry-run, then downloads the APPROVED original from **Supabase private Storage using server-only secret**, performs a bounded Sharp WebP re-encode (metadata removed; no visible-content redaction), uploads to private **Cloudflare R2** `amphon-evidence-staged-private` through the authenticated Cloudflare R2 Objects REST API, then creates a text-only Draft PR using a scoped short-lived GitHub App token. Never inserts image URLs into PRs. One workflow job per queue item / site-page (batch up to 14 queued).
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
- Workflow needs `AMPHON_SEO_SUPABASE_URL`, `AMPHON_SEO_SERVICE_ROLE_KEY`, `AMPHON_CLOUDFLARE_ACCOUNT_ID`, `AMPHON_CLOUDFLARE_R2_API_TOKEN` **as protected secrets** (never in Vite or Git). API token must be narrowly scoped to private R2 object access where possible.
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
