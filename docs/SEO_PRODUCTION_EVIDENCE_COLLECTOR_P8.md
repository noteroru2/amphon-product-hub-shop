# P8 — GitHub + Cloudflare Production Evidence Discovery

**Safe default:** read-only discovery. This is **NOT** a Production release attestation, an SEO measurement, or deployment automation. The collector intentionally ALWAYS reports `production_verified: false`.

## Why this is needed

Live cross-provider audit on 23 November 2026 found:
- **amphon.co.th**: Cloudflare `amphon-co-th-production` is on Worker version `0f1bcef1-a1b7-44d4-bc50-8196cae41e02` at 100%, but a Worker message only names GitHub commit prefix `cb55117d`. Registered Production branch `release/cloudflare-production` is at a different SHA than the commit the PR's message mentions.
- **winnerit.in.th**: `new-winnerit` has a 100% Worker deployment; `main` matches a prefix in the Worker annotation but source SHA/digest identity has not been established.
- **webuy.in.th**: `webuy` is serving a recent version, but its Wrangler deployment does not expose a full source SHA in the observed payload.

These are useful **provider deployment observations**, not proof that a given GitHub commit is what the public domain serves. A 200 homepage is useful as a smoke test but not a source build attestation.

## P8 code and user-safety model

`scripts/seo-production-evidence-core.mjs` enforces an approved-enabled site and a VERIFIED production Repo/Branch/Worker mapping with `central_deploy_allowed=false`.

`scripts/seo-production-evidence.mjs` performs only bounded **HTTP GETs**:
1. Read a single enabled site and its Production mapping from server-side Supabase (no credentials in HUB browser).
2. Resolve the full GitHub Production branch SHA; optionally compare an operator-supplied full **40-character** expected source SHA against approved Git branch ancestry. Never trust an eight-character SHA prefix.
3. Read latest Cloudflare Worker Deployment and its 100% traffic version, if any. A split deployment is explicitly recorded as unverified.
4. Read the actual registered public HTTPS homepage with a 1.5 MB limit, no cross-origin redirects or private-host/IP URLs. Hash the returned HTML bytes with SHA-256.

The report displays only allowlisted fields and evidence blockers. It never includes:
- OAuth tokens, Cloudflare token, Supabase service key, provider deployment notes, raw HTML, private customer data;
- any `PRODUCTION_VERIFIED` or GSC uplift claim;
- any PR creation, merge, SQL insert, Cloudflare Deploy, DNS change, or state mutation.

**Critical limitation:** A GitHub SHA on an approved branch, Cloudflare at 100%, and HTTP 200 together still **do not show that Hosting serves that GitHub SHA**. P8 records `EXACT_HOSTING_GITHUB_SHA_OR_ASSET_CHECKSUM_UNPROVEN` and `RELEASE_AFFECTED_URL_QA_NOT_ATTESTED` until independently verified artifact/source identity and affected-page QA exist.

### Manual execution after owner configuration

A GitHub Actions workflow `.github/workflows/seo-production-evidence-readonly.yml` is `workflow_dispatch` **only**. The job uses a separate **`seo-production-evidence-protected`** GitHub Environment, which must have explicit owner-required reviewer(s), with activation secret `SEO_EVIDENCE_ENVIRONMENT_APPROVED=YES_OWNER_ENABLED`.

Environment secrets, server-only (do not put in Vite or web UI):
- `AMPHON_SEO_SUPABASE_URL`
- `AMPHON_SEO_SERVICE_ROLE_KEY`
- `AMPHON_CLOUDFLARE_ACCOUNT_ID`
- `AMPHON_CLOUDFLARE_API_TOKEN` with **Workers Scripts/Deployments READ only** for the relevant account
- Optional `AMPHON_SEO_GITHUB_READ_TOKEN` with **Contents read** for required private repos; public repositories can use unauthenticated GET (subject to GitHub API rate limits)

Run: GitHub Actions → **SEO Production Evidence Discovery (manual, read only)** → Run workflow → select one verified Cloudflare-backed site (amphon, amphontd, notebook, shop, webuy, werab or winner), optionally supply a full approved SHA. It never accepts an arbitrary URL/repository. A failed/missing environment gate produces no remote writes.

The workflow runs P8 tests and uploads a **redacted, safe JSON report** as a 7-day artifact. It has `permissions: contents: read`. The user reviews the report and supplies external proof separately; P8 does **not** promote provider observations into the immutable Production Ledger.

You can run the same code manually from a trusted, server-only environment:

```bash
npm ci
npm run verify:seo-production-evidence
node scripts/seo-production-evidence.mjs --site-id amphon
node scripts/seo-production-evidence.mjs --site-id amphon --expected-sha <complete-40-hex-approved-sha>
```

Never run this script from a public browser or expose the service key.

## E2E acceptance steps after P8

- [ ] Configure the separate read-only GitHub Environment + owner-required reviewer and read-only Cloudflare token; **not automatically created by this PR**.
- [ ] Run one manual P8 evidence report on a real approved site without a short SHA; confirm no secrets in JSON, correct Worker version/deployment and honest blockers.
- [ ] Cross-check deployment source SHA or exact built/live asset digest, hosting routes, TLS, Canonical, Sitemap, redirects, real changed URLs and QA. Resolve branch mismatch for amphon.co.th.
- [ ] Only after independent proof, a separately owner-authorized audited process may record `PRODUCTION_VERIFIED`.
- [ ] Use P6 to read exact Google-Pacific FINAL before/after 7/14/28-day page/query/device/country data; do not infer causal ranking improvement.
- [ ] Configure the **separate** P3 protected GitHub App environment and obtain an actual approved Source Change Request for the first Draft PR (currently approved count **0**).

P8 does not close the user-approval or Release evidence obligations in Master Tracker #163.
