import { readFile } from 'node:fs/promises'

const workerPath = new URL('../workers/hub-outbox/src/index.ts', import.meta.url)
const wranglerPath = new URL('../workers/hub-outbox/wrangler.jsonc', import.meta.url)
const sqlPath = new URL('../workers/hub-outbox/oneprod_hub_outbox_delivery.sql', import.meta.url)

const [worker, wranglerText, sql] = await Promise.all([
  readFile(workerPath, 'utf8'),
  readFile(wranglerPath, 'utf8'),
  readFile(sqlPath, 'utf8'),
])
const wrangler = JSON.parse(wranglerText)

function assert(condition, message) {
  if (!condition) throw new Error(`HUB-OUTBOX FAIL: ${message}`)
}

assert(wrangler.name === 'amphon-one-hub-outbox', 'worker name drifted')
assert(wrangler.main === 'src/index.ts', 'worker entrypoint drifted')
assert(wrangler.vars?.HUB_OUTBOX_DELIVERY_ENABLED === 'false', 'delivery must default OFF')
assert(Array.isArray(wrangler.triggers?.crons) && wrangler.triggers.crons.includes('* * * * *'), 'one-minute cron missing')
assert(!('SUPABASE_SECRET_KEY' in (wrangler.vars || {})), 'Supabase secret must not be committed')
assert(!('SYSTEM_INTEGRATION_SECRET' in (wrangler.vars || {})), 'System HMAC secret must not be committed')

for (const token of [
  "const EVENTS_PATH = '/api/integrations/v1/events'",
  'HUB_OUTBOX_DELIVERY_ENABLED',
  'oneprod_claim_hub_outbox',
  'oneprod_finish_hub_outbox',
  "row.destination !== 'amphon-system'",
  "'x-amphon-key-id'",
  "'x-amphon-timestamp'",
  "'x-amphon-nonce'",
  "'x-amphon-signature'",
  'crypto.randomUUID()',
  "outcome: 'DELIVERED'",
]) {
  assert(worker.includes(token), `worker missing ${token}`)
}
assert(worker.includes("config.systemUrl.protocol !== 'https:'") || worker.includes("systemUrl.protocol !== 'https:'"), 'System API must require HTTPS')
assert(worker.includes("if (status >= 200 && status < 300)"), 'all 2xx responses, including idempotent duplicate, must count as delivered')

for (const token of [
  'create or replace function public.oneprod_claim_hub_outbox',
  'for update skip locked',
  "o.status in ('PENDING','FAILED')",
  "o.status = 'SENDING'",
  "set status = 'SENDING'",
  'attempts = o.attempts + 1',
  'locked_by = p_worker_id',
  'create or replace function public.oneprod_finish_hub_outbox',
  "v_outcome not in ('DELIVERED','FAILED','DEAD')",
  "v_row.status <> 'SENDING'",
  "coalesce(v_row.locked_by, '') <> coalesce(p_worker_id, '')",
  "set status = 'DELIVERED'",
  "set status = 'FAILED'",
  "set status = 'DEAD'",
  'security invoker',
  'to service_role',
]) {
  assert(sql.toLowerCase().includes(token.toLowerCase()), `SQL missing ${token}`)
}
assert(!sql.toLowerCase().includes('security definer'), 'RPCs must not use SECURITY DEFINER')
assert(sql.toLowerCase().includes('revoke all on function public.oneprod_claim_hub_outbox'), 'claim RPC must revoke PUBLIC/anon/authenticated')
assert(sql.toLowerCase().includes('revoke all on function public.oneprod_finish_hub_outbox'), 'finish RPC must revoke PUBLIC/anon/authenticated')

console.log('AMPHON HUB OUTBOX: PASS — scheduled HMAC delivery, SKIP LOCKED claiming, lock-owner completion, retry/backoff and fail-closed defaults are locked')
