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
  'SUPABASE_SECRET_KEY',
  'integration_replay_nonces',
  'integration_event_inbox',
  'BRIDGE_REPLAY_DETECTED',
  'BRIDGE_SOURCE_MISMATCH',
  'BRIDGE_IDEMPOTENCY_CONFLICT',
  'SYSTEM_EVENT_ALLOWLIST',
  'findExistingInbox',
  'exactDuplicate',
  "status: 'RECEIVED'",
]) {
  assert(worker.includes(token), `Bridge worker missing ${token}`)
}

assert(worker.includes("return response({ ok: true, accepted: true, duplicate: false"), 'new event 202 response missing')
assert(worker.includes("return response({ ok: true, accepted: false, duplicate: true"), 'duplicate idempotent response missing')

// ONE-1 originally prohibited any Product Hub product access from the Bridge.
// ONE-2D adds a signed server-to-server READ snapshot only. Keep the original
// mutation guard by proving the product query is select-only and has no write
// method attached to its Supabase request.
const productReadStart = worker.indexOf('products?select=')
if (productReadStart >= 0) {
  const productReadWindow = worker.slice(productReadStart, productReadStart + 550)
  assert(!/method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i.test(productReadWindow), 'Bridge product snapshot must remain read-only')
  assert(worker.includes("'/v1/reconciliation/products'"), 'product reads are only allowed for the ONE-2D reconciliation endpoint')
  assert(bridge.one2d?.snapshot?.serverToServerOnly === true, 'ONE-2D snapshot must remain server-to-server only')
} else {
  assert(!worker.includes('products?'), 'unexpected product access outside approved snapshot')
}
assert(!worker.includes("commerce_orders?"), 'ONE-1 Bridge must not mutate Shop orders yet')
assert(!wrangler.includes('SYSTEM_INTEGRATION_SECRET'), 'HMAC secret must never be committed in Wrangler config')
assert(!wrangler.includes('SUPABASE_SECRET_KEY'), 'Supabase secret must never be committed in Wrangler config')
assert(wrangler.includes('"name": "amphon-one-bridge"'), 'Wrangler worker name missing')
assert(wrangler.includes('"SYSTEM_INTEGRATION_KEY_ID": "amphon-system-v1"'), 'non-secret peer key ID missing')

assert(migration.includes('integration_replay_nonces'), 'persistent nonce table migration missing')
assert(migration.includes('integration_event_inbox'), 'Inbox migration missing')
assert(migration.includes('revoke all on table public.integration_event_inbox from anon, authenticated'), 'browser roles must remain blocked from Inbox')

console.log('AMPHON ONE-1 SECURITY: PASS — HMAC/replay protection stays locked; ONE-2D product access is signed read-only snapshot only')
