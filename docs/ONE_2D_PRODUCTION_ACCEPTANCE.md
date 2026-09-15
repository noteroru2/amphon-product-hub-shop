# AMPHON ONE — ONE-2D Production Acceptance

Assessment date: 2026-09-15  
Contract: `ONE-2D-PROD.1`  
Overall result: `PARTIAL_PASS_BLOCKED_SYSTEM_RUNTIME`  
Production accepted: **NO**

## Product Hub / Supabase production gate — PASS

Project: `mfpdtlxwdbxitgfzdape` (`ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166` observed during acceptance).

Applied production migrations:

- `20260915153218` — `one2b_product_hub_shell_consumer`
- `20260915153319` — `one2c_product_hub_enrichment_workflow`
- `20260915153340` — `one2c_enrichment_hardening`
- `20260915153409` — `one2d_legacy_mapping_consumer`

Legacy catalog preservation after migration:

- 25 products remain 25 products;
- 24 remain `published`, 1 remains `ready_to_list`;
- `one_managed=true`: 0;
- non-null ONE readiness: 0;
- non-null simple battery grade: 0.

Both `one2b_consume_intake_event(uuid)` and `one2d_consume_legacy_link_event(uuid)` are `SECURITY INVOKER`; `anon` and `authenticated` cannot execute them, while `service_role` can.

Production ONE-2C triggers are present on `products` / `product_images`.

A rollback-only ONE-2D transactional smoke test passed:

- exact link -> `LINKED`
- retry -> `DUPLICATE`
- remap same System identity to a different Hub product -> `CONFLICT`
- conflict code -> `BRIDGE_LEGACY_MAPPING_CONFLICT`
- rollback left Inbox/Outbox/Links at zero test rows.

Security/performance advisors were rerun. Existing project findings remain; no new ONE-2B/ONE-2D RPC exposure warning was observed.

Backup/PITR state was not independently verifiable through the connected tool and remains an explicit gate.

## Overall production gate — BLOCKED

The Hub database is ready, but AMPHON ONE cross-system runtime is not accepted because:

- `api.amphontd.com` did not resolve during acceptance;
- Hetzner database migrations/verifiers were not run;
- `bridge.amphon.co.th` did not resolve during acceptance;
- Cloudflare Worker deployment was not verified;
- server-only HMAC/Supabase secrets were not verified;
- signed health/snapshot HTTP smoke was not possible;
- System reconciliation dry-run and owner queue review were not possible.

Source defaults remain OFF:

```text
ONE2B_SHELL_CONSUMER_ENABLED=false
ONE2D_RECONCILIATION_ENABLED=false
```

`productionAccepted` MUST remain false until System + Bridge + end-to-end gates are all verified and the blocker list is empty.

Machine-readable evidence is stored in `config/amphon-one2d-production-acceptance.json`. The repository verifier is `scripts/verify-one2d-production-acceptance.mjs`.
