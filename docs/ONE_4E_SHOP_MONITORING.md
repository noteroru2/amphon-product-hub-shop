# ONE-4E Shop Monitoring

ONE-4E begins after the ONE-4D cutover is ACCEPTED and Shop purchase is enabled.

## Authority

**System remains canonical** for physical inventory, reservation, sale and finance. Hub/Shop is projection and commerce orchestration only. Monitoring must never turn Hub product status into a second stock authority.

## Hub observer

Run with the production Supabase service secret available only in the local environment:

```bash
npm run one4e:observe
```

The observer reads only operational fields. It deliberately does not select customer name, phone, email or address.

It checks:
- activation remains ACCEPTED and `activationAllowed=true`;
- Shop purchase remains intentionally enabled;
- command queue has no DEAD work;
- ONE-managed products have availability/version projections;
- Hub integration inbox has no DEAD events;
- expired ONE orders become terminal after the configured grace window;
- the Store Worker remains configured for System stock authority.

## Real-order gate

The production-mature gate is still owned by the System observer: at least **10 real Shop orders** must be consumed after cutover with canonical stock and finance evidence intact. Hub order counts alone never satisfy this gate.

## Incident response

If a critical Shop-side signal is found:

1. Set `purchase_enabled=false` first.
2. Keep or set `ONE4_SYSTEM_STOCK_ENABLED` only according to the recovery runbook; do not invent a second stock path.
3. On System, run the ONE-4E observer and canonical snapshot.
4. If integrity may be affected, set System ONE-4 runtime flags off using the documented recovery command.
5. Resolve queue/drift/root cause, reconcile, run the rollback-only recovery drill, and only then reopen purchase.

Do not bypass the activation guard, command idempotency, HMAC boundary, or System canonical postconditions.
