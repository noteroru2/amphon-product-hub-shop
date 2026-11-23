# P9 — amphon.co.th raw HTTP / TLS read-only QA

Purpose: add the independent numeric HTTP status, Location and TLS checks which a browser following redirects cannot prove. No release attestation, automatic deploy, DNS edit, SQL write, merge or Google ranking claim.

## Current evidence checkpoint, 23 Nov 2026

- Cloudflare Worker: amphon-co-th-production, active version 0f1bcef1-a1b7-44d4-bc50-8196cae41e02 (100% traffic), Deployment cc175707-9e96-427f-9569-591254f4524b.
- Independent Cloudflare Builds source: Build da846848-ad1c-47ff-8bdf-ea6051bcf528 succeeded for full GitHub SHA cb55117d641ea76cfa0e5d1cc9e55a8deb724caa, branch release/cloudflare-unified-astro7-20261118.
- Registered central Production branch release/cloudflare-production is 39 commits behind the release source branch. **Owner branch/source exception remains unapproved. Do not silently change the registry.**
- Independently read 42/42 changed PR #74 content pages: self-canonical, indexable, title/description, @webuy. All 42 also appeared in the live sitemap. This is not numeric HTTP redirect certification.

## Protected manual run

After CI succeeds and owner separately reviews/merges the PR, use GitHub Actions -> SEO P9 Production HTTP and TLS QA (manual, read only) -> Run workflow. It uses the already configured Environment seo-production-evidence-protected, with SEO_EVIDENCE_ENVIRONMENT_APPROVED=YES_OWNER_ENABLED. No additional Cloudflare secret is needed.

Download artifact seo-p9-production-http-qa (7-day retention) and review any critical failures or advisories. All requests are public-only, fixed to amphon.co.th / www.amphon.co.th; no arbitrary URL input; only GET with redirects disabled, max response 1.5 MB. TLS uses SNI with certificate-chain and expiry validation.

Checks: home and five important service pages: 200/self-canonical/indexability/title/description/LINE; WWW must return **301** preserving encoded path and query; three legacy camera typos must return 301/308 to the canonical page; robots.txt; both sitemap files; TLS; Google Reviews status advisory.

**Green means HTTP/TLS sample QA only.** To close P0, separately re-check the active Worker version and Cloudflare Builds source SHA at the time of manual run, handle owner branch exception, verify full changed URLs and the 263 original redirects, review API/sitemap/asset evidence, then obtain owner-approved immutable PRODUCTION_VERIFIED evidence via a separately audited process. This workflow cannot do that.

P6 comparison for 22 Nov release: Google Pacific before 2026-11-15..21, after 2026-11-23..29, conservative Final check 2026-12-02; do not infer causality or live SERP position.

Tracking: https://github.com/noteroru2/amphon-product-hub-shop/issues/163 and https://github.com/noteroru2/amphon.co.th/issues/54
