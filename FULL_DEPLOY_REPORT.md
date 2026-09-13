# AMPHON Product Hub + SHOP-6.1 — Full Deploy Bundle Report

Verdict: `FULL_BUNDLE_READY / PRODUCTION_ACCEPTANCE_STILL_REQUIRED`

Generated: 2026-09-12

## Added in this deploy bundle

- `INSTALL-ALL.bat` — Windows one-click installer/deployer.
- `DATABASE-ONLY.bat` — one-click Supabase link + full DB install/upgrade + acceptance assertion.
- `deployment/INSTALL-ALL.ps1` — install orchestration without storing secrets in source.
- `deployment/install.config.example.ps1` — public deployment configuration template.
- `deployment/INSTALLATION_GUIDE_TH.md` — Thai installation/deployment guide.
- `deployment/AFTER_INSTALL_CHECKLIST.md` — pre-live checklist.
- `supabase/FULL_DATABASE_SETUP.sql` — single SQL file containing base schema + Batch 3.2/3.3/3.4 + Batch 4/4.1 + SHOP-1..6.
- `supabase/migrations/20260912000000_amphon_shop61_full_setup.sql` — same setup as a Supabase CLI migration.
- `supabase/FULL_DATABASE_VERIFY.sql` — verification bundle.
- `supabase/SHOP61_ACCEPTANCE_ASSERT.sql` — read-only fail-fast database integrity/privacy assertion.

## Automated install flow

1. Node/npm preflight.
2. Supabase CLI auth and `link`.
3. `db push --include-all` for the one-shot migration.
4. SHOP-6 DB verification and SHOP-6.1 fail-fast assertion.
5. Root / Worker / Shop dependency installation.
6. Cloudflare auth, R2 bucket creation when missing.
7. Generate Worker Wrangler configuration.
8. Deploy Worker with encrypted runtime secrets.
9. Optional automatic Stripe webhook endpoint creation and signing-secret deployment.
10. Generate root/shop public `.env` files.
11. Product Hub typecheck/build.
12. SHOP-1 → SHOP-6.1 regression suite.
13. Astro check/build and Cloudflare deployment.
14. Live HTTP smoke test.

## Important production rule

The installer does **not** automatically enable `purchase_enabled`. Real shipping/returns, Turnstile site key, payment configuration, seller/document information, and warranty settings must be reviewed in Commerce Admin, followed by a real Stripe Test-mode E2E before production checkout is enabled.

## Static QA

- SHOP-1 foundation verifier: PASS
- SHOP-2 verifier: PASS
- SHOP-3 verifier: PASS
- SHOP-4 verifier: PASS
- SHOP-5 verifier: PASS
- SHOP-6 verifier: PASS
- SHOP-6.1 closeout verifier: PASS
- One-shot DB migration generated from canonical source SQL files: PASS
- Fail-fast DB acceptance assertion included: PASS
- Secret-pattern scan: 0 findings
- Generated dependency/build artifacts in release tree: 0
- PowerShell structural delimiter balance: PASS

Dependency-resolved install/build and target-infrastructure E2E cannot be executed inside this packaging environment and remain production acceptance requirements.

## Hotfix v4

- Fixed `max(uuid)` failure in `commerce_taxonomy_candidates_v`.
- Database password is now supplied through `SUPABASE_DB_PASSWORD` and is not printed as a CLI argument.
- Database verification uses `supabase db query -f`.
- Added migration SQL safety gate and closeout regression coverage.

## SHOP-6.2 upgrade

- Added migration `20260912090000_amphon_shop62_payment_e2e_gate.sql`.
- Added rollback-safe `shop_6_2_contract_test.sql`.
- Added isolated Stripe TEST provider E2E harness and temporary Cloudflare Worker workflow.
- Added database activation evidence/invalidation gate; public purchase remains disabled after install.
- Added refund -> RETURNED + warranty/document voiding hardening.
- Added `verify:shop62` to regression runs.
- Added Windows entrypoints `SHOP62-DB-UPGRADE-TEST.bat` and `SHOP62-PROVIDER-E2E.bat`.

SHOP-6.2 provider interaction is intentionally not auto-executed by `INSTALL-ALL.bat`; it requires the operator to use Stripe TEST mode and complete hosted Checkout interactions.
