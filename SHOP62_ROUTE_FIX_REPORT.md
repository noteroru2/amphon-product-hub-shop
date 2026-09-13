# SHOP-6.2 Isolated E2E Route Fix

## Root cause

The harness already called the correct contract: `POST /__shop62/checkout`, and the Worker already exposed that exact route.
The observed `404 {}` was therefore not a pathname mismatch. In this Worker, the SHOP-6.2 handler deliberately returns plain-text `404 Not found` before route dispatch when `SHOP62_TEST_TOKEN` is missing or does not match. The harness then attempted JSON parsing and collapsed that plain-text response to `{}`, hiding the actual failure class.

The static source cannot prove why the deployed secret/header diverged in that one live run, so this patch removes transport ambiguity and makes the contract observable before any Stripe order is created.

## Changes

- Generate SHOP62 token as 64-character lowercase hex rather than base64url.
- Add `SHOP62_TEST_MODE=isolated-e2e` to the temporary Worker only.
- Require both isolated mode and the short-lived token for every `__shop62` route.
- Add authenticated, side-effect-free `GET /__shop62/readiness`.
- Harness probes Worker health, no-token 404, wrong-token 404, and valid-token readiness before seeding checkout fixtures.
- Readiness response declares the canonical checkout route and harness validates it.
- Checkout/refund failures now report method, pathname, status, content type, Worker URL, and sanitized response body.
- Remove legacy `sb_secret_` Bearer usage when still present; server secret remains an API key only.
- No migration. No production Worker deployment. No production webhook change. No `purchase_enabled` change.

## Readiness verifier robustness follow-up

The readiness implementation was side-effect-free, but the first route-fix verifier incorrectly treated the presence of the exact source text `tokenVerified: true` as proof of that property. This was a brittle response-shape check, not side-effect analysis. The hotfix also left two independent pre-matrix probes in the harness; the second expected a different response contract and would have been the next deterministic failure.

The route now has one canonical response contract and the harness has one canonical probe. The verifier parses the Worker with the TypeScript AST, identifies the actual `GET /__shop62/readiness` branch, confirms it precedes the mutating checkout branch, requires a direct return contract, and rejects mutation/payment/order helper calls in that branch.

The runtime probe takes before/after snapshots of AT-TST products, publications, listings, orders, order items, reservations, payment events/transactions, documents, warranties, acceptance metadata, temporary-token state, settings timestamp, and `purchase_enabled`. Any difference aborts the matrix before checkout.

Current verification: `SHOP-6.2 ROUTE FIX VERIFY: PASS`.

## Expected next command

`SHOP62-PROVIDER-E2E.bat`

The provider run must still use `sk_test_...` only. `purchase_enabled` must remain `false`.
