# P7 — Branch-specific Production provenance and source-artifact integrity

**Status:** evidence-only safety patch, not an attestation service. No automatic deploy, no database writes, no claim of Google ranking uplift.

## Verified live inventory, 23 Nov 2026

The central DB currently has **13 enabled sites** and **zero** `PRODUCTION_VERIFIED` ledger entries. The historical ledger records 137 `COMMIT_OBSERVED` and 13 `DEPLOY_SUCCEEDED`, with none of the latter satisfying full QA+Git SHA+HTTP proof.

Independent live checks with connected GitHub and Cloudflare accounts established:

| Site | Cloudflare live 100% Worker deployment | GitHub reference evidence | Reason not yet VERIFIED |
|---|---|---|---|
| amphon.co.th | `amphon-co-th-production` deployment `cc175707-9e96-427f-9569-591254f4524b`, Worker version `0f1bcef1-a1b7-44d4-bc50-8196cae41e02`, 22 Nov 16:19 UTC | Deployment note calls out PR #74 **prefix** `cb55117d`; [PR #74](https://github.com/noteroru2/amphon.co.th/pull/74) has full source HEAD `cb55117d641ea76cfa0e5d1cc9e55a8deb724caa`, but registry says Production ref `release/cloudflare-production` currently at `58a9627fa2446e56bb3ec6df4377ce300454f42c` | Source branch differs; note is only an 8-character prefix and no independently matched live build checksum. PR merged to `main` after this Worker was promoted |
| winnerit.in.th | `new-winnerit` deployment `2e86c847-04e1-4ebb-bda5-807a28247f3d`, Worker version `81d7b5d5-c5f6-4f37-ba24-3891a5920f84`, 22 Nov 17:17 UTC | Note refers to `c91b4943`, which matches prefix of [GitHub main](https://github.com/noteroru2/new-winnerit/commit/c91b4943458612e14dc512d6d50b561414a8bb9c), but Worker metadata only exposes a version alias `main` | Prefix match is useful context **not** proof of full source identity or reproducible live artifact digest |
| webuy.in.th | `webuy` deployment `50b58081-7c76-40c5-8d51-c9eae900fab6`, Worker version `a36b7954-1b11-41c7-a920-f4e50f2f11da`, 22 Nov 14:51 UTC | [GitHub main](https://github.com/noteroru2/webuy/commit/a4c908a147e80c654a24ceb8f5a1981a6cee78bc), latest deployment is Wrangler with no Git source SHA annotation | Can't correlate live Worker binary with the GitHub commit |

The public homepages of amphon.co.th, winnerit.in.th, webuy.in.th and HUB all responded successfully during independent browser read checks. A 200 response alone does not prove a given GitHub commit or Worker version was served.

### P7 code policy

The existing P5/P6 gate already requires `PRODUCTION_VERIFIED` ledger entry, valid 40-hex `commit_sha`, QA PASS, matching repository, Hosting Deployment ID, correct public domain mapping, and live HTTP response proof after release. P7 **tightens** this contract:

1. Registry `production_branch` must exist and have a verified mapping (per-site). The ledger proof must supply both **`github_ref` equal to that production branch** and `github_ref_verified: true`. This flag must be set only after actually checking the SHA belongs to that Git ref's history; merely quoting a branch label is not enough.
2. Hosting-to-Git source identity needs **one** independently corroborated path:
   - Provider exposes the **full 40-hex source SHA**: `hosting_commit_sha` must equal the ledger `commit_sha` and `hosting_commit_verified:true`.
   - Or reproducible built-vs-live asset checksums: `github_artifact_sha256` and `live_artifact_sha256` must be full matching 64-hex SHA-256 digests, with `artifact_checksum_verified:true` only after fetching the actual public asset and comparing it against the exact approved build artifact.
3. Short source prefixes in Worker deployment notes (`cb55117d`, `c91b4943`) **never** pass either path.
4. The shared deterministic policy applies in HUB `seo-gsc`, ChatGPT `seo_portfolio`, and development milestone status. Raw Cloudflare provider JSON or tokens are not returned to the frontend.
5. Existing protections (latest unverified deployment invalidates older attestation; no inferred GSC uplifts; central deploy disabled) remain unchanged.

The ledger remains **empty of confirmed Production events** until an external, independently checked attestation explicitly records valid provenance. This PR does **not** manufacture evidence or insert such events.

### Real-world acceptance checklist, in order

- Determine the actual deployed source branch and full SHA from GitHub **and** verified build artifact, not the Worker alias alone.
- Confirm exact Cloudflare Worker script, active deployment/version ID, expected production-domain route and TLS.
- Compare SHA of at least one deterministically built asset against bytes served at the real Production origin, or retrieve a provider-attested 40-char source SHA.
- Verify post-deploy QA on affected URLs including expected canonical, sitemap, robots, redirect preservation, LINE links and HTTP statuses.
- Capture the actual changed URL list; avoid attribute uplift to a whole site when only a few pages changed.
- Record an auditable `PRODUCTION_VERIFIED` event **only** after all prerequisites have been corroborated.
- Then request two exact matched GSC Final query/page/device/country windows for 7, 14, 28 days (P6); this is descriptive, not proof of causality.

### Test gates
```bash
npm run verify:seo-release-verification
npm run verify:seo-release-comparison
node --test tests/seo-development-status.test.mjs
node --test tests/seo-connector.test.mjs
node --test tests/seo-gsc.test.mjs
npm run typecheck
npm run build
```

## Remaining operational gap

The connected ChatGPT AMPHON SEO app currently exposes its established `seo_sites` / `seo_gsc_query` and draft tools, but the newly implemented `seo_portfolio` and `seo_release_compare` are not yet surfaced among its callable tools. Backend code and frontend deployment alone do **not** update the plugin's published tool schema. Update/refresh the app's MCP tool registration and test the new tool names after owner-approved app configuration; do not claim conversational use is complete solely from backend deployment.
