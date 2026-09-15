import { readFile } from 'node:fs/promises'

const workerPath = new URL('../workers/one-bridge/src/index.ts', import.meta.url)
const wranglerPath = new URL('../workers/one-bridge/wrangler.jsonc', import.meta.url)
const bridgePath = new URL('../config/amphon-one-bridge.json', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260915115521_one1_integration_storage_foundation.sql', import.meta.url)

const [worker, wrangler, migration] = await Promise.all([
  readFile(workerPath, 'utf8'),
  readFile(wranglerPath, 'utf8'),
  readFile(migrationPath, 'utf8'),
])
const bridge = JSON.parse(await readFile(bridgePath, 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-1 SECURITY FAIL: ${message}`)
}

assert(bridge.security?.hubBridge?.workerName === 'amphon-one-bridge', 'dedicated Bridge worker name drifted')
assert(bridge.security?.hubBridge?.path === '/v1/events', 'Hub Bridge event path drifted')
assert(bridge.security?.rawBodyRequired === true, 'raw body verification must remain required')
assert(bridge.security?.replayProtection === 'PERSISTENT_NONCE', 'persistent replay protection contract drifted')
assert(bridge.security?.hubBridge?.productionAccepted === false, 'source-only worker must not be marked production accepted')

for (const token of [
  "crypto.subtle.digest('SHA-256'",
  "crypto.subtle.verify(",
  'SYSTEM_INTEGRATION_SECRET',
  'integration_replay_nonces',
  'integration_event_inbox',
  'BRIDGE_REPLAY_DETECTED',
  'BRIDGE_SOURCE_MISMATCH',
  'SYSTEM_EVENT_ALLOWLIST',
  "status: 'RECEIVED'",
]) {
  assert(worker.includes(token), `Bridge worker missing ${token}`)
}

assert(worker.includes("return response({ ok: true, accepted: true, duplicate: false"), 'new event 202 response missing')
assert(worker.includes("return response({ ok: true, accepted: false, duplicate: true"), 'duplicate idempotent response missing')
assert(!worker.includes("products?"), 'ONE-1 Bridge must not mutate product records yet')
assert(!worker.includes("commerce_orders?"), 'ONE-1 Bridge must not mutate Shop orders yet')
assert(!wrangler.includes('SYSTEM_INTEGRATION_SECRET'), 'HMAC secret must never be committed in Wrangler config')
assert(!wrangler.includes('SUPABASE_SECRET_KEY'), 'Supabase secret must never be committed in Wrangler config')
assert(wrangler.includes('"name": "amphon-one-bridge"'), 'Wrangler worker name missing')
assert(wrangler.includes('"SYSTEM_INTEGRATION_KEY_ID": "amphon-system-v1"'), 'non-secret peer key ID missing')

assert(migration.includes('integration_replay_nonces'), 'persistent nonce table migration missing')
assert(migration.includes('integration_event_inbox'), 'Inbox migration missing')
assert(migration.includes('revoke all on table public.integration_event_inbox from anon, authenticated'), 'browser roles must remain blocked from Inbox')

console.log('AMPHON ONE-1 SECURITY: PASS — dedicated Worker HMAC, nonce replay protection and Inbox-only endpoint are locked')
