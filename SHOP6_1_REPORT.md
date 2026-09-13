# SHOP-6.1 — Production Closeout & End-to-End Acceptance Gate

**Verdict:** `LOCAL_STATIC_PASS / PRODUCTION_GATE_CLOSED`

## What this batch closes

- Reconciles SHOP-6 database, Worker, Product Hub and Astro contracts.
- Fixes Commerce activation so Stripe/Bank/Pay-at-store are valid payment rails instead of requiring Bank transfer unconditionally.
- Blocks Stripe activation until Worker Stripe secrets exist.
- Adds PromptPay/THB, document-mode and warranty configuration guardrails.
- Connects Stripe Checkout redirect, Stripe-only webhook payment confirmation, public shipment tracking, token-only receipt/invoice and warranty pages.
- Disables manual “confirm payment” for Stripe orders in Product Hub.
- Adds production database acceptance SQL and live HTTP smoke script.
- Adds regression verifier for SHOP-6 and closeout verifier for SHOP-6.1.

## Release interpretation

`LOCAL_STATIC_PASS / PRODUCTION_GATE_CLOSED` means the source package/regression/security closeout passed locally, but dependency-resolved Astro/Cloudflare build could not be completed in this environment because `npm install` timed out. This package is **not a statement that production Stripe/Supabase/Cloudflare payment flow has been proven**. Production release stays closed until the target infrastructure passes the matrix in `docs/SHOP61_PRODUCTION_ACCEPTANCE.md`.

## Required final production sequence

1. Install dependencies and run all `verify:*`, `check`, and `build` commands.
2. Apply `shop_6.sql`, `shop_6_verify.sql`, then `shop_6_1_acceptance.sql` on target Supabase.
3. Configure Worker secrets and deploy Worker/Cron.
4. Configure Stripe test webhook and run Card + PromptPay + duplicate/mismatch/expiry/refund tests.
5. Deploy Shop and run `acceptance:live`.
6. Verify shipping, pickup, receipt/invoice and warranty flows.
7. Only then enable `purchase_enabled`.


## Local QA result

- SHOP-1 → SHOP-6.1 regression: PASS
- TypeScript/TSX + Astro frontmatter syntax: PASS
- SQL structural checks: PASS
- Secret scan: PASS (0 findings)
- Artifact hygiene: PASS
- Dependency-resolved `npm install / astro check / astro build`: NOT COMPLETED — install timed out in this environment; generated dependency artifacts were removed.
- Production DB acceptance: NOT EXECUTED
- Stripe E2E acceptance: NOT EXECUTED

The production gate therefore remains closed.
