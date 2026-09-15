# ONE-2B — Product Hub Shell Consumer

Status: SOURCE PASS / PRODUCTION ACTIVATION PENDING  
Date: 2026-09-15

## Purpose

ONE-2B turns a durable `product.intake_created` event from AMPHON System into one Product Hub shell for the same physical item. AMPHON System remains the source of intake and business SKU. Product Hub never allocates a replacement SKU for this flow.

This slice is intentionally source-only. The Supabase migration is committed but is not applied as part of this batch, the Cloudflare Worker is not activated, and the production flag remains off.

## Flow

```text
AMPHON System physical identity
  -> product.intake_created
  -> Hub Bridge HMAC + replay protection
  -> Hub Inbox
  -> ONE-2B transactional consumer
       -> products shell
       -> external_entity_links mapping
       -> product.shell_created Outbox
       -> Inbox PROCESSED
```

## Product shell

A new shell uses the exact System-provided SKU and keeps the existing Product Hub lifecycle compatible:

```text
products.status = draft
products.one_listing_readiness = INTAKE_ONLY
```

`INTAKE_ONLY` is deliberately not added to the legacy `products.status` constraint. AMPHON ONE listing readiness is a separate dimension so current Hub and Shop behavior is not broken.

The shell may receive sales-safe intake fields such as title, category, serial number, target price and simple battery health grade. Cost, seller identity and other internal acquisition data are not copied into public product fields.

## Independent enrichment readiness

ONE-2B adds independent AMPHON ONE flags:

```text
one_photos_complete
one_specs_complete
one_listing_content_complete
```

Photo work, specification work and listing-content work may happen in any order. There is no QC or Technical Inspection stage. ONE-2C will own the enrichment mutations.

## SKU conflict policy

The consumer may reuse a Hub shell only when the exact external mapping already proves that the same AMPHON System `product_intake_unit` maps to that Hub product.

If the incoming SKU already exists without that exact mapping:

```text
BRIDGE_SKU_CONFLICT
```

The Inbox event is stopped for reconciliation. Product Hub must not silently adopt that SKU and must not generate another SKU.

If an existing physical-identity mapping points to a missing product or a product with a different SKU:

```text
BRIDGE_MAPPING_CONFLICT
```

The mapping is marked `CONFLICT` and the event is stopped.

## Transaction boundary

The Postgres RPC `one2b_consume_intake_event(uuid)` uses `SECURITY INVOKER`. Execute permission is revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`.

For a successful new shell, one database transaction covers:

1. Product shell creation;
2. `external_entity_links` mapping;
3. durable `product.shell_created` Outbox acknowledgement;
4. inbound event marked `PROCESSED`.

A database error rolls back partial changes so the durable Inbox event can be retried.

## Acknowledgement

The acknowledgement back to AMPHON System is durable and idempotent:

```text
eventType: product.shell_created
idempotencyKey: product-shell:{systemProductIdentityId}:created:v1
```

The payload includes the Hub product UUID, System product identity ID, inventory item ID, SKU and initial listing readiness.

ONE-2B only queues this event. Hub-to-System Outbox delivery/activation remains a separate production concern.

## Safe rollout flag

Cloudflare Worker configuration defaults to:

```text
ONE2B_SHELL_CONSUMER_ENABLED=false
```

With the flag off, the existing ONE-1 Bridge continues to authenticate and durably receive events but does not create Product Hub shells.

## Deferred production activation

During the final AMPHON ONE production activation, perform these in order:

1. Complete backups and preflight checks.
2. Apply the Hub ONE-2B Supabase migration.
3. Verify new columns, RPC permissions and existing Hub/Shop compatibility.
4. Deploy `amphon-one-bridge` with the correct server-only secrets.
5. Keep `ONE2B_SHELL_CONSUMER_ENABLED=false` initially.
6. Activate and verify System ONE-2A and signed System -> Hub delivery.
7. Send one controlled intake event.
8. Set `ONE2B_SHELL_CONSUMER_ENABLED=true`.
9. Verify Product shell, external mapping, Inbox `PROCESSED` and `product.shell_created` Outbox row.
10. Test a duplicate event and confirm that no second product is created.
11. Test conflict handling before enabling continuous production flow.

Do not mark ONE-2B production accepted before these runtime checks pass.
