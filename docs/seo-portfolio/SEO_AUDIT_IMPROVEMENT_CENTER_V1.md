# AMPHON SEO Audit & AI Improvement Center — Hub V1

## Purpose

Use existing SEO Control Tower / Growth Center / Content Evidence / AI Development to turn the first portfolio audit into an owner-controlled work queue. It is not a separate SEO product.

Source: https://github.com/noteroru2/amphon-product-hub-shop/issues/177, the first sampled Audit dated Nov 24 2026. P0=7, P1=10, P2=5. Retired pawn-iPhone property is excluded.

## How to use

1. Log in to https://hub.amphon.co.th with active Owner/Admin credentials.
2. Open SEO Control Tower → SEO Audit · สั่งงาน AI.
3. Select an active site or all, category and priority. The preview uses the 22-item catalog.
4. Click สร้างแผนงาน. This stores a GSC FINAL 28-day snapshot, preserving actual per-property start/end dates and a bounded work queue. It does NOT trigger a new crawl or ChatGPT, GitHub or deployment.
5. Open each task, read evidence, acceptance criteria and recommendation. Click เตรียม AI Work Order to mark the task BRIEF_READY and copy its scoped instructions; the readonly textarea is a fallback when clipboard permissions fail.
6. For CONTENT tasks whose site + query + exact URL match a fresh (<=4 days), OPEN GSC Opportunity, click สร้าง Content Job จริง. It invokes existing seo_lab_manage(create) role and evidence guards. Use Network Health → เนื้อหา / อนุมัติ to complete the draft and owner approval.
7. Use AI Development → Source Change Review for actual website source patches; Owner approval, Draft PR, CI, and separate release approval are mandatory.

## Architecture and security

- commerce_seo_audit_catalog: exactly 22 imported, sourced and category-labeled reviewed proposals.
- commerce_seo_audit_runs: idempotent authenticated owner/admin GSC snapshot and filters.
- commerce_seo_audit_tasks: per-run OPEN / BRIEF_READY / DISMISSED statuses and review notes.
- seo_audit_center_manage RPC: active owner/admin profiles only, scope validation and no website mutation.
- RLS enabled on all tables; anon no access; authenticated read only with owner/admin policies; RPC enforces role again; no direct authenticated INSERT/UPDATE/DELETE.
- Source Issue #177 is a reviewed plan, not an executed production fix. GSC average position is not Ubersuggest SERP. Website CTA clicks are not confirmed leads, sold units, or gross profit.
- Hub can create evidence-backed Content Jobs, not automatically write GitHub or deploy website source. All 13 active properties maintain independent website release gating.
- No made-up customer cases, reviews, pricing, shops in other provinces or privacy claims.

## CI and rollout

1. Run node --test tests/seo-audit-center.test.mjs tests/seo-rank-ledger.test.mjs.
2. Run npm run typecheck and npm run build. Verify PR diff and release SHA.
3. Apply additive SQL migration once; verify catalog 22 entries and role security, and read-back a real seeded run with 22 tasks.
4. Merge guarded PR after QA; deploy Hub to Cloudflare Workers (not Vercel) through authorized release process, verify deployed source SHA.
5. Smoke test real Owner/Admin and Staff/Anon denial, cross-site scope selection, exactly matching Content Job creation, mobile usability and no unintended website changes. Record rollback.
6. Compare the changed site's GSC FINAL page/query data in 7/14/28 day windows only after a verified site release.

V1 explicitly does not execute live ChatGPT jobs inside Hub, crawl every URL, bulk rewrite site pages or auto-merge/deploy.
