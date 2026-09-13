# SHOP-6.2 REPORT — Payment & Fulfillment E2E Acceptance

Verdict: `IMPLEMENTED_WITH_PROVIDER_INTERACTION_REQUIRED`

## Implemented

- Database-level SHOP-6.2 activation gate; `purchase_enabled` stays false.
- Provider acceptance version/timestamp/evidence state.
- Automatic invalidation when payment/fulfillment-critical Commerce settings change.
- Short-lived SHA-256 E2E token; plaintext token is never stored in Supabase.
- `create_commerce_test_order()` service-role/postgres-only wrapper using the normal atomic order engine and `AT-TST-*` fixtures.
- Rollback-safe database contract test.
- Full-refund trigger that voids warranties, cancels unresolved claims and voids documents.
- Refund webhook/API race hardening.
- Isolated Cloudflare Worker test routes protected by the E2E token.
- Temporary Stripe TEST webhook deployment/cleanup.
- Real hosted Checkout card test and optional PromptPay TEST flow.
- Signed webhook mismatch tests, duplicate-event test, expiry, shipping, pickup, documents, warranty and refund checks.
- Static `verify:shop62` regression gate.

## Required run order

```text
SHOP62-DB-UPGRADE-TEST.bat
        |
        v
Configure intended Commerce settings
(purchase_enabled=false)
        |
        v
SHOP62-PROVIDER-E2E.bat
        |
        v
SHOP-6.2 provider acceptance PASS
        |
        v
Review production LIVE Stripe/Turnstile/shipping/returns
        |
        v
Explicit purchase activation
```

Until provider interaction is completed, release state remains:

`IMPLEMENTED_WITH_PROVIDER_INTERACTION_REQUIRED`

## v17 token-hash portability hotfix
- Replaced extension-schema-dependent `digest()` calls in SHOP-6.2 security-definer token functions with PostgreSQL built-in `pg_catalog.sha256(bytea)`.
- Added forward migration `20260912103000_amphon_shop62_token_hash_portability.sql` for databases where `20260912090000` is already applied.
- No migration repair/reset is required; public checkout remains disabled.
