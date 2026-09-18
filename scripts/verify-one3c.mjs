import { readFile } from 'node:fs/promises'

const migrationPath = 'supabase/migrations/20260916104009_one3c_hub_stock_projection.sql'
const initMigrationPath = 'supabase/migrations/20260916104824_one3c_new_product_availability_init.sql'
const workerPath = 'workers/one-bridge/src/one2b-entry.ts'
const wranglerPath = 'workers/one-bridge/wrangler.jsonc'
const deployPath = 'scripts/deploy-one3c-production.mjs'
const contractPath = 'config/amphon-one3.json'
const hubBackendPath = 'src/lib/backend.ts'
const hubAppPath = 'src/App.tsx'

const [migration, initMigration, worker, wrangler, deploy, contractRaw, hubBackend, hubApp] = await Promise.all([
  readFile(new URL(`../${migrationPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${initMigrationPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${workerPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${wranglerPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${deployPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${contractPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${hubBackendPath}`, import.meta.url), 'utf8'),
  readFile(new URL(`../${hubAppPath}`, import.meta.url), 'utf8'),
])

const contract = JSON.parse(contractRaw)
const failures = []
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) failures.push(`${label}: missing ${needle}`)
}
const forbidText = (text, needle, label) => {
  if (text.includes(needle)) failures.push(`${label}: forbidden ${needle}`)
}

if (contract?.authority?.inventoryAvailability !== 'amphon_system') failures.push('contract: System must own inventory availability')
if (contract?.authority?.hubAvailabilityRole !== 'projection') failures.push('contract: Hub must remain projection-only')
if (contract?.authority?.hubBrowserMayMutateOneManagedAvailabilityDirectly !== false) failures.push('contract: Hub browser direct availability mutation must remain disabled')
if (contract?.featureFlags?.hubStockConsumer !== 'ONE3_STOCK_CONSUMER_ENABLED') failures.push('contract: Hub feature flag name drifted')

for (const state of ['IN_STOCK','RESERVED','SOLD','REPAIR','RETURNED','WRITTEN_OFF']) {
  requireText(migration, `'${state}'`, 'migration states')
}

for (const column of ['one_availability','one_availability_version','one_availability_updated_at','one_availability_last_event_id','one_availability_last_reason']) {
  requireText(migration, column, 'migration projection columns')
}

requireText(migration, 'ONE3_BASELINE', 'migration baseline')
requireText(migration, 'private.one3c_guard_one_managed_availability', 'browser mutation guard')
requireText(migration, 'ONE_MANAGED_AVAILABILITY_SYSTEM_OWNED', 'browser mutation guard')
requireText(migration, "current_setting('amphon.one3_projection', true)", 'projection transaction marker')
requireText(migration, "current_user = 'service_role'", 'server-only projection marker')

requireText(initMigration, 'private.one3c_initialize_availability', 'new shell initializer')
requireText(initMigration, "new.one_availability := 'IN_STOCK'", 'new shell initial availability')
requireText(initMigration, 'new.one_availability_version := 0', 'new shell initial version')
requireText(initMigration, 'ONE3_INITIALIZED', 'new shell initialization reason')
requireText(initMigration, 'before insert or update of one_managed on public.products', 'new shell initializer trigger')
requireText(initMigration, 'security invoker', 'new shell initializer security')

requireText(migration, 'public.one3c_consume_stock_event', 'consumer RPC')
requireText(migration, 'security invoker', 'consumer RPC security')
requireText(migration, 'revoke all on function public.one3c_consume_stock_event(uuid) from anon, authenticated', 'consumer RPC browser revoke')
requireText(migration, 'grant execute on function public.one3c_consume_stock_event(uuid) to service_role', 'consumer RPC service-role grant')

for (const eventType of ['product.reserve_requested','product.release_requested','product.mark_sold_requested']) {
  requireText(migration, `'${eventType}'`, 'consumer command contract')
  requireText(worker, `'${eventType}'`, 'worker command routing')
}

for (const exactGuard of [
  "source_system = 'amphon-system'",
  "source_entity_type = 'product_intake_unit'",
  'source_entity_id = v_identity_id',
  "target_system = 'product-hub'",
  "target_entity_type = 'product'",
  'target_entity_id = v_hub_product_id::text',
  "sync_status = 'LINKED'",
  "upper(coalesce(business_key,'')) = v_sku",
]) requireText(migration, exactGuard, 'exact mapping guard')

for (const guard of [
  'BRIDGE_AVAILABILITY_VERSION_CONFLICT',
  'BRIDGE_AVAILABILITY_VERSION_GAP',
  'BRIDGE_AVAILABILITY_FROM_MISMATCH',
  'BRIDGE_AVAILABILITY_TRANSITION_INVALID',
  "'outcome','STALE'",
  "'outcome','DUPLICATE'",
]) requireText(migration, guard, 'version/state guard')

requireText(migration, "perform set_config('amphon.one3_projection','on',true)", 'projection marker activation')
requireText(migration, "'product.availability_changed'", 'Hub acknowledgement event')
requireText(migration, "destination = 'amphon-system'", 'Hub acknowledgement destination')

requireText(worker, 'ONE3_STOCK_CONSUMER_ENABLED?: string', 'worker environment contract')
requireText(worker, "callRpc(env, 'one3c_consume_stock_event'", 'worker RPC call')
for (const outcome of ['APPLIED','DUPLICATE','STALE','CONFLICT','DEAD']) requireText(worker, `'${outcome}'`, 'worker outcome contract')
requireText(worker, "markInboxFailed(env, envelope.eventId, 'ONE3C_CONSUMER'", 'worker retry path')

requireText(wrangler, '"ONE3_STOCK_CONSUMER_ENABLED": "false"', 'fail-closed source flag')
forbidText(wrangler, '"ONE3_STOCK_CONSUMER_ENABLED": "true"', 'fail-closed source flag')

requireText(
  hubBackend,
  ".or('one_availability.is.null,one_availability.neq.SOLD')",
  'Hub inventory must hide System SOLD products',
)
forbidText(hubApp, 'active={filter === "sold"}', 'Hub sold inventory filter must stay removed')
forbidText(hubApp, 'label="ขายแล้ววันนี้"', 'Hub home must not derive sold-today from hidden inventory')
requireText(hubApp, 'label="กำลังขาย"', 'Hub home replacement inventory metric')

for (const runtimeFlag of [
  "ONE2B_SHELL_CONSUMER_ENABLED: 'true'",
  "ONE2D_RECONCILIATION_ENABLED: 'true'",
  "ONE3_STOCK_CONSUMER_ENABLED: 'true'",
]) requireText(deploy, runtimeFlag, 'production activation helper')

const dryRunCommand = "['wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars', '--dry-run']"
const deployCommand = "['wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars']"
requireText(deploy, dryRunCommand, 'production activation dry-run')
requireText(deploy, deployCommand, 'production activation deploy')
requireText(deploy, "process.argv.includes('--runner-smoke')", 'Windows/runner smoke gate')
requireText(deploy, 'wrangler deploy dry-run accepted', 'runner smoke CLI validation')
requireText(deploy, "await run(npm, ['run', 'verify:one3c'])", 'production activation preflight')
requireText(deploy, 'await rm(tempConfigPath, { force: true })', 'temporary config cleanup')
forbidText(deploy, "'--yes'", 'Wrangler v4 unsupported deploy flag')
forbidText(deploy, "writeFile(sourceConfigPath", 'source config immutability')

const writePosition = deploy.indexOf('await writeFile(tempConfigPath')
const firstDryRunPosition = deploy.indexOf(dryRunCommand)
if (writePosition < 0 || firstDryRunPosition < 0 || writePosition > firstDryRunPosition) {
  failures.push('production activation helper: temporary config must exist before Wrangler dry-run')
}

if (failures.length) {
  console.error('AMPHON ONE-3C: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('AMPHON ONE-3C: PASS — versioned Hub projection, new-shell IN_STOCK v0 initialization, exact mapping, stale/gap guards, server-only RPC, browser mutation guard and Wrangler-v4-safe fail-closed production activation are locked')
