import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/20260915115521_one1_integration_storage_foundation.sql', import.meta.url)
const bridgePath = new URL('../config/amphon-one-bridge.json', import.meta.url)

const migration = await readFile(migrationPath, 'utf8')
const bridge = JSON.parse(await readFile(bridgePath, 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-1 STORAGE FAIL: ${message}`)
}

for (const table of ['integration_event_inbox', 'integration_event_outbox', 'external_entity_links', 'integration_replay_nonces']) {
  assert(migration.includes(`create table if not exists public.${table}`), `missing ${table}`)
  assert(migration.includes(`alter table public.${table} enable row level security`), `${table} must have RLS enabled`)
  assert(migration.includes(`revoke all on table public.${table} from anon, authenticated`), `${table} browser grants must be revoked`)
  assert(migration.includes(`grant select, insert, update, delete on table public.${table} to service_role`), `${table} service_role grant missing`)
}

assert(migration.includes('unique (event_id)'), 'eventId uniqueness missing')
assert(migration.includes('unique (source, idempotency_key)'), 'Inbox idempotency uniqueness missing')
assert(migration.includes('unique (destination, idempotency_key)'), 'Outbox idempotency uniqueness missing')
assert(migration.includes('integration_event_outbox_retry_idx'), 'retry scheduling index missing')
assert(migration.includes('unique (key_id, nonce)'), 'replay nonce uniqueness missing')
assert(migration.includes("'DEAD'"), 'dead-letter state missing')
assert(migration.includes("'CONFLICT'"), 'external mapping conflict state missing')
assert(bridge.delivery === 'AT_LEAST_ONCE_IDEMPOTENT_CONSUMERS', 'storage must match Bridge delivery contract')
assert(bridge.rules?.duplicateEventMayRepeatSideEffects === false, 'duplicate event side effects must remain forbidden')

console.log('AMPHON ONE-1 STORAGE: PASS — Hub Inbox/Outbox/mapping/replay storage and RLS contract are locked')
