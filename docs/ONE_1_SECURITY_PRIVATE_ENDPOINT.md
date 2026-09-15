# ONE-1 — Security + Private Bridge Endpoint

Status: SOURCE READY / PRODUCTION NOT ACCEPTED  
Date: 2026-09-15

## Dedicated Bridge Worker

AMPHON ONE integration traffic is isolated in a separate Cloudflare Worker:

```text
workers/one-bridge/
worker name: amphon-one-bridge
```

It is intentionally separate from `amphon-product-images`. The Bridge must not share deployment blast radius with image R2, Shop APIs, Stripe or Commerce admin routes.

Planned production hostname:

```text
bridge.amphon.co.th
```

The hostname is not considered active until an explicit deployment/cutover acceptance gate passes.

## Routes

```text
GET  /v1/health
POST /v1/events
```

Both are private server-to-server routes. There is no browser CORS API for the Bridge.

## Request authentication

Required headers:

```text
X-Amphon-Key-Id
X-Amphon-Timestamp
X-Amphon-Nonce
X-Amphon-Signature
```

Canonical request:

```text
timestamp
nonce
METHOD
/path
sha256(raw-body)
```

The Worker uses Web Crypto HMAC-SHA256 verification against the exact raw body. Default signature age is 300 seconds and request bodies are capped at 1 MiB.

A retry keeps the same `eventId` and `idempotencyKey`, but creates a new timestamp, nonce and signature.

## Replay protection

After HMAC verification, `(keyId, nonce)` is persisted in:

```text
integration_replay_nonces
```

A nonce collision returns:

```text
409 BRIDGE_REPLAY_DETECTED
```

If replay storage is unavailable, the Worker fails closed with `503` rather than bypassing replay protection.

## Inbox behavior

Valid events are written only to:

```text
integration_event_inbox
```

This ONE-1 slice performs no `products`, Shop order or publication mutation.

Responses:

- new event -> `202`, `accepted: true`;
- exact retry -> `200`, `duplicate: true`;
- event identity collision -> `409 BRIDGE_IDEMPOTENCY_CONFLICT`;
- source/key mismatch -> `403 BRIDGE_SOURCE_MISMATCH`;
- unknown event type -> `422 BRIDGE_EVENT_NOT_ALLOWED`.

A harmless duplicate must match `eventId`, `source`, `eventType` and `idempotencyKey`. A collision on only one unique key is a reconciliation error, not a duplicate.

## Supabase boundary

ONE-1 integration tables are already protected by RLS and are not granted to browser `anon` or `authenticated` roles. The Worker accesses them with a server-only Supabase secret.

Required Worker secrets:

```text
SUPABASE_SECRET_KEY
SYSTEM_INTEGRATION_SECRET
```

Non-secret Worker vars:

```text
SUPABASE_URL
SYSTEM_INTEGRATION_KEY_ID
INTEGRATION_SIGNATURE_MAX_AGE_SECONDS
```

Never place the secret values in `wrangler.jsonc`, frontend `VITE_*`, source code, issues or chat.

## Deployment acceptance

Do not mark the Worker production accepted until all of the following pass:

1. System PostgreSQL ONE-1 storage migration is deployed and verified.
2. A matching System/Hub HMAC key pair is configured server-side.
3. `SUPABASE_SECRET_KEY` and `SYSTEM_INTEGRATION_SECRET` are installed as Worker secrets.
4. Worker source verification and TypeScript checks pass.
5. Worker is deployed to a preview/workers.dev endpoint first.
6. Signed health request succeeds.
7. Invalid signature and stale timestamp are rejected.
8. Reusing the same nonce is rejected.
9. A new event is accepted once.
10. An exact retry is deduplicated.
11. A mismatched event/idempotency collision returns 409.
12. Only after these gates may `bridge.amphon.co.th` be attached.

## Deliberately deferred

This slice does NOT:

- create Product Shells;
- connect AMPHON System `/api/intake` to Outbox;
- deliver Outbox events;
- mutate Shop orders;
- change DNS;
- enable public access to integration tables.

Those actions belong to the next ONE-1/ONE-2 slices after security acceptance.
