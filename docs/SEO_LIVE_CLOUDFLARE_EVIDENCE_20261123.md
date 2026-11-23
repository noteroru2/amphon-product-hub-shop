# AMPHON — Cloudflare/GitHub read-only deployment inventory

**Observed 2026-11-23 19:xx Asia/Bangkok.** Independent read-only checks from the connected Cloudflare and GitHub accounts. This is a timestamped **observation**, NOT a `PRODUCTION_VERIFIED` claim, post-release SEO result, rollback authorization, or full source attestation.

All seven registered Cloudflare Workers have a latest deployment reporting **one Worker version with 100% traffic**, but Cloudflare's deployment read results do **not** provide an independently verified **full GitHub commit SHA** or a reproducible deployed build SHA-256. Thus **0 of these 7 pass full GitHub/hosting source correlation**.

| Site id | GitHub Production branch → SHA observed | Cloudflare Worker | Latest Deployment ID | 100% Worker Version |
| --- | --- | --- | --- | --- |
| `amphon` | `noteroru2/amphon.co.th` / `release/cloudflare-production` → `58a9627fa2446e56bb3ec6df4377ce300454f42c` | `amphon-co-th-production` | `cc175707-9e96-427f-9569-591254f4524b` | `0f1bcef1-a1b7-44d4-bc50-8196cae41e02` |
| `amphontd` | `noteroru2/amphontd` / `main` → `3aed11e5b1adedb25aa36f48b1599611a9bc93cd` | `amphontd` | `6f2c8266-b4fa-4307-8608-0e37800d1b87` | `b6852faa-3952-4f7c-a2d8-ef1ba4221f86` |
| `notebook` | `noteroru2/shopbuynotebook-thai` / `main` → `321e7a7c34d0e199af8ff725f7575440c2adaff2` | `shopbuynotebook-thai` | `3c64d9c5-dea3-4ae9-bcf4-9b53d178e8a9` | `309d89c7-d8e0-4bf0-95f8-19e5214c0251` |
| `shop` | `noteroru2/amphon-product-hub-shop` / `main` → `4540fa4ccaaa3a045cba6c001f67d9e7de83ae3a` | `amphon-shop` | `a44e3bf4-a473-4dfe-aa3c-fcaf84ae3ae2` | `9ac5ef23-be4b-44b3-8773-ed3cc442fca5` |
| `webuy` | `noteroru2/webuy` / `main` → `a4c908a147e80c654a24ceb8f5a1981a6cee78bc` | `webuy` | `50b58081-7c76-40c5-8d51-c9eae900fab6` | `a36b7954-1b11-41c7-a920-f4e50f2f11da` |
| `werab` | `noteroru2/werab-v2` / `main` → `1e9a5d50100b4492196dee2b7d9cf9fc2b083848` | `werab-v2` | `0d9dcaee-285c-44ab-a149-07a46df95dff` | `f796fc54-3f2b-4102-87cb-8799247b92d4` |
| `winner` | `noteroru2/new-winnerit` / `main` → `c91b4943458612e14dc512d6d50b561414a8bb9c` | `new-winnerit` | `2e86c847-04e1-4ebb-bda5-807a28247f3d` | `81d7b5d5-c5f6-4f37-ba24-3891a5920f84` |

## Interpretation and prioritized blockers

**P0 — amphon.co.th Source Branch:** Worker annotation cites PR #74, whose HEAD was `cb55117d641ea76cfa0e5d1cc9e55a8deb724caa`, but the central registered Production ref `release/cloudflare-production` currently points to `58a9627...`. A provider note may reference a commit, a rollback, a preview or a tag and cannot prove an exact deployed build. Verify which branch actually generated the Worker version with the build pipeline's immutable GitHub SHA before changing the central registry. **Do not change the registry to match an annotation without evidence.**

**P0 — all seven sites:** Need an independently verifiable full source Git SHA or a known GitHub-built asset digest matching the **LIVE** public bytes, route/domain mapping, affected-URL post-deploy QA, and a separately authorized audited `PRODUCTION_VERIFIED` record. No central Deploy or automatic Release approval is permitted.

**P1 — `shop` is not the Hub:** The `amphon-shop` Worker is `shop.amphon.co.th`, whereas `hub.amphon.co.th` is deployed by **Hub Production Deploy** using the same GitHub repository. The table above records the Shop Worker; **do not** interpret its Worker version as verification of the HUB Deployment. HUB had a separate GitHub Actions live bundle checksum check on merge SHA `4540fa4cc...`.

**P1 — Google Search Console:** A separate live AMPHON SEO read returned `final` query data for `amphon`, but a GSC receipt is **not** proof the current page's recent source release improved rank. P6 7/14/28-day release comparisons must stay gated until independent approved full release evidence and matching page/period data exist.

**P1 — GitHub Draft PR:** Production Source Change Request table currently contains **0** owner-approved requests. A read-only evidence check must never create fake approval, and the new P8 workflow is separate from the P3 `seo-draft-pr-protected` privileged workflow.

## Repeatable collection

Source-controlled P8 collector: `scripts/seo-production-evidence.mjs`. Owner-only, read-only Actions entry: `.github/workflows/seo-production-evidence-readonly.yml`. Its JSON fields intentionally never assert `production_verified=true`. Until actual external evidence has been supplied, all seven sites remain **UNVERIFIED**.

**Do not treat this document's dated snapshot as a live monitoring service.**
