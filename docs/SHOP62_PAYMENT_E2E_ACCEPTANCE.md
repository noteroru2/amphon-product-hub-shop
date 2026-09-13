# SHOP-6.2 — Payment & Fulfillment E2E Acceptance

SHOP-6.2 is the final provider/fulfillment test gate before public checkout can be considered for activation.
It deliberately keeps `commerce_store_settings.purchase_enabled = false` throughout the acceptance run.

## Safety model

- Uses Stripe **TEST** keys only (`sk_test_...`). `sk_live_...` is rejected by the runner.
- Uses a temporary Cloudflare Worker named `amphon-shop62-e2e`; the production API Worker is not overwritten.
- Creates only `AT-TST-*` products and removes test orders/products after the run.
- Stores only a SHA-256 hash of the short-lived E2E token in Supabase.
- Public `/store/checkout` remains disabled. The isolated Worker uses `/__shop62/*` endpoints protected by the test token.
- The database acceptance evidence is invalidated automatically when payment/fulfillment-critical settings change.
- SHOP-6.2 never turns on `purchase_enabled` automatically.

## Run order

### 1. Database upgrade + rollback-safe contract test

Run from Windows:

```bat
SHOP62-DB-UPGRADE-TEST.bat
```

Expected final result:

```text
SHOP-6.2 DATABASE UPGRADE + CONTRACT ACCEPTANCE: PASS
```

The SQL contract test runs inside `BEGIN ... ROLLBACK`, so its fixtures/evidence are not retained.

### 2. Configure intended production Commerce settings

In Product Hub Commerce Admin, configure the settings you intend to use in production while keeping:

```text
purchase_enabled = false
```

Important fields include Stripe on/off, PromptPay on/off, shipping rate/timing, pickup, returns, Turnstile, document mode and warranty defaults. Changing these later invalidates SHOP-6.2 acceptance by design.

### 3. Provider E2E

Run:

```bat
SHOP62-PROVIDER-E2E.bat
```

You will be asked for:

- Supabase server Secret key (`sb_secret_...` or equivalent service-role server key)
- Stripe **TEST** Secret key (`sk_test_...`)

The runner will deploy a temporary Workers.dev endpoint, create a temporary Stripe TEST webhook, run the matrix, then attempt to delete both.

For the real hosted Checkout card step, use Stripe's test card:

```text
4242 4242 4242 4242
future expiry
any 3-digit CVC
```

If `stripe_promptpay_enabled=true`, a second hosted Checkout interaction is required for PromptPay TEST acceptance.

## Required PASS matrix

- Real Stripe TEST hosted card Checkout
- Verified Stripe webhook signature -> PAID
- Duplicate provider event idempotency
- Signed webhook amount mismatch rejection
- Signed webhook currency mismatch rejection
- Reservation expiry -> SKU released
- Shipping -> delivered lifecycle
- Pickup -> picked-up lifecycle
- Receipt/document snapshot
- Warranty snapshot
- Stripe TEST refund -> order REFUNDED + SKU RETURNED
- Warranty VOID after full refund
- PromptPay provider flow when enabled
- Public purchase remains disabled after acceptance

## Acceptance evidence

On provider PASS, Supabase records only non-secret evidence in `commerce_store_settings`:

- `shop62_acceptance_version = SHOP-6.2`
- `shop62_accepted_at`
- `shop62_acceptance_evidence`

No Stripe key, Supabase key, webhook signing secret or plaintext E2E token is written to the database.

## Activation rule

Even after SHOP-6.2 PASS, do **not** activate checkout until the production LIVE Stripe secret/webhook, shipping/return policy, Turnstile and seller/document settings have been reviewed.

Activation must be a separate explicit update of `purchase_enabled=true`. The database constraint will reject activation if SHOP-6.2 evidence is absent or has been invalidated.
