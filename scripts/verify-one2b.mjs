import { readFile } from 'node:fs/promises'

const migrationPath = new URL('../supabase/migrations/20260915125000_one2b_product_hub_shell_consumer.sql', import.meta.url)
const entryPath = new URL('../workers/one-bridge/src/one2b-entry.ts', import.meta.url)
const wranglerPath = new URL('../workers/one-bridge/wrangler.jsonc', import.meta.url)
const bridgePath = new URL('../config/amphon-one-bridge.json', import.meta.url)

const [migration, entry, wranglerText, bridgeText] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(entryPath, 'utf8'),
  readFile(wranglerPath, 'utf8'),
  readFile(bridgePath, 'utf8'),
])
const wrangler = JSON.parse(wranglerText)
const bridge = JSON.parse(bridgeText)

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-2B FAIL: ${message}`)
}

for (const token of [
  'battery_health_grade text',
  'one_managed boolean not null default false',
  'one_enrichment_started boolean not null default false',
  'one_photos_complete boolean not null default false',
  'one_specs_complete boolean not null default false',
  'one_listing_content_complete boolean not null default false',
  "when not one_enrichment_started then 'INTAKE_ONLY'",
  "then 'READY_TO_LIST'",
  'create or replace function public.one2b_consume_intake_event',
  'security invoker',
  "grant execute on function public.one2b_consume_intake_event(uuid) to service_role",
  "revoke all on function public.one2b_consume_intake_event(uuid) from public",
  "v_error := 'BRIDGE_SKU_CONFLICT'",
  "v_error := 'BRIDGE_MAPPING_CONFLICT'",
  "'product.shell_created'",
  "'product_intake_unit'",
  "'product-hub'",
  "'amphon-system'",
  "set status = 'PROCESSED'",
]) {
  assert(migration.toLowerCase().includes(token.toLowerCase()), `migration missing ${token}`)
}

assert(!migration.toLowerCase().includes('security definer'), 'ONE-2B RPC must not use SECURITY DEFINER in public schema')
assert(migration.includes("v_sku !~ '^AT-[A-Z0-9]{2,4}-[0-9]{4}-[0-9]{6}$'"), 'consumer must validate the System SKU format')
assert(migration.includes("where sku = v_sku"), 'consumer must detect pre-existing SKU before shell creation')
assert(migration.includes("'draft'"), 'legacy Product Hub status must remain draft for a new shell')
assert(migration.includes("v_ack_idempotency := 'product-shell:' || v_source_identity_id || ':created:v1'"), 'shell-created acknowledgement must have a stable idempotency key')
assert(!/generate[_a-z]*sku/i.test(migration), 'Hub consumer must never generate a replacement SKU')

assert(entry.includes("import baseBridge from './index'"), 'ONE-2B must preserve the existing signed Inbox handler as the first boundary')
assert(entry.includes('const baseResponse = await baseBridge.fetch(request, env)'), 'base HMAC/Inbox handler must execute before shell consumption')
assert(entry.includes("ONE2B_SHELL_CONSUMER_ENABLED"), 'consumer activation flag missing')
// ONE-2D refactors RPC transport into a shared helper. Verify the semantic call,
// not the old inline `rpc/...` string shape.
assert(entry.includes("callRpc(env, 'one2b_consume_intake_event', envelope.eventId)"), 'Worker must invoke the ONE-2B transactional RPC')
assert(entry.includes("envelope.eventType === 'product.intake_created'"), 'Worker must scope ONE-2B to intake-created events')
assert(entry.includes("BRIDGE_SHELL_CONSUMER_UNAVAILABLE"), 'retryable consumer failure response missing')
assert(entry.includes('markInboxFailed'), 'RPC infrastructure failures must leave the Inbox retryable')

assert(wrangler.main === 'src/one2b-entry.ts', 'Cloudflare Worker entrypoint must be ONE-2B wrapper')
assert(wrangler.vars?.ONE2B_SHELL_CONSUMER_ENABLED === 'false', 'ONE-2B must default OFF for safe production rollout')
assert(!('SUPABASE_SECRET_KEY' in (wrangler.vars || {})), 'Supabase secret must never be committed as a Worker var')
assert(!('SYSTEM_INTEGRATION_SECRET' in (wrangler.vars || {})), 'HMAC secret must never be committed as a Worker var')

const one2b = bridge.one2b?.productHubShellConsumer
assert(one2b?.sourceReady === true, 'ONE-2B sourceReady missing')
assert(one2b?.productionAccepted === false, 'source-only ONE-2B must not be production accepted')
assert(one2b?.activationFlag === 'ONE2B_SHELL_CONSUMER_ENABLED', 'ONE-2B activation flag drifted')
assert(one2b?.defaultEnabled === false, 'ONE-2B must default disabled')
assert(one2b?.inputEvent === 'product.intake_created', 'ONE-2B input event drifted')
assert(one2b?.outputEvent === 'product.shell_created', 'ONE-2B output event drifted')
assert(one2b?.rpcSecurity === 'SECURITY_INVOKER_SERVICE_ROLE_ONLY', 'RPC privilege boundary drifted')
assert(one2b?.legacyProductStatus === 'draft', 'legacy product status must remain draft')
assert(one2b?.initialListingReadiness === 'INTAKE_ONLY', 'initial ONE readiness must be INTAKE_ONLY')
assert(one2b?.systemProvidedSkuOnly === true, 'Hub must use System-provided SKU only')
assert(one2b?.adoptExistingSkuWithoutExactMapping === false, 'silent SKU adoption must remain forbidden')
assert(one2b?.replacementSkuOnConflict === false, 'replacement SKU allocation must remain forbidden')
assert(bridge.one2b?.readiness?.enrichmentMayOccurInAnyOrder === true, 'photo/spec/content enrichment must remain order-independent')
assert(bridge.one2b?.readiness?.qcStageAdded === false, 'QC stage must remain absent')
assert(bridge.one2b?.readiness?.technicalInspectionStageAdded === false, 'Technical Inspection stage must remain absent')

console.log('AMPHON ONE-2B: PASS — guarded Product Hub shell consumer, exact SKU mapping, transactional acknowledgement and independent readiness are locked')
