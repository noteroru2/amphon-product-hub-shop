import { readFile } from 'node:fs/promises'

const bridgePath = new URL('../config/amphon-one-bridge.json', import.meta.url)
const contractPath = new URL('../config/amphon-one-contract.json', import.meta.url)
const flowPath = new URL('../config/amphon-one-product-flow.json', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260912000000_amphon_shop61_full_setup.sql', import.meta.url)

const bridge = JSON.parse(await readFile(bridgePath, 'utf8'))
const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const flow = JSON.parse(await readFile(flowPath, 'utf8'))
const migration = await readFile(migrationPath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-1 FOUNDATION FAIL: ${message}`)
}

assert(contract.contractVersion === 'ONE-0R.1', 'ONE-1 must build on ONE-0R.1')
assert(['ONE-0R.1', 'ONE-3.0'].includes(flow.flowVersion), 'product flow version is unsupported')
if (flow.flowVersion === 'ONE-3.0') {
  assert(flow.availability?.masterAfterHubSync === 'amphon_system', 'ONE-3 flow must keep System as availability master')
  assert(flow.availability?.hubRole === 'projection', 'ONE-3 flow must keep Hub projection-only')
  assert(flow.availability?.shopRole === 'requester_only', 'ONE-3 flow must keep Shop requester-only')
  assert(flow.availability?.versionOwner === 'amphon_system', 'ONE-3 flow must keep System as availability version owner')
  assert(flow.availability?.hubBrowserMayMutateOneManagedAvailabilityDirectly === false, 'ONE-3 flow must forbid direct Hub browser availability mutation')
}
assert(bridge.contractVersion === 'ONE-1.0-draft', 'unexpected bridge contract version')
assert(bridge.status === 'FOUNDATION', 'bridge must remain FOUNDATION until endpoints/storage are accepted')
assert(bridge.transport === 'HTTPS_SERVER_TO_SERVER', 'bridge transport drifted')
assert(bridge.delivery === 'AT_LEAST_ONCE_IDEMPOTENT_CONSUMERS', 'delivery guarantee drifted')
assert(bridge.signature?.algorithm === 'HMAC-SHA256', 'HMAC-SHA256 is required')
assert(bridge.signature?.maxAgeSeconds === 300, 'signature max age drifted')
assert(bridge.events?.systemToHub?.includes('product.intake_created'), 'Hub must consume product.intake_created')
assert(bridge.events?.hubToSystem?.includes('product.shell_created'), 'Hub must emit product.shell_created')
assert(bridge.rules?.browserMayCallBridgeDirectly === false, 'browser must not call Bridge directly')
assert(bridge.rules?.duplicateEventMayRepeatSideEffects === false, 'Hub consumer must be idempotent')
assert(bridge.rules?.hubFailureMayRollbackSystemIntake === false, 'Hub failure must not roll back System intake')
assert(bridge.rules?.skuConflictMayAutoAllocateReplacement === false, 'Hub must not auto-replace conflicting SKU')
assert(flow.origin?.application === 'amphon_system', 'Hub product flow must originate from System')
assert(flow.hubEnrichment?.qcStage === false, 'Hub must not reintroduce QC gating')
assert(flow.hubEnrichment?.technicalInspectionStage === false, 'Hub must not reintroduce Technical Inspection')
assert(flow.hubEnrichment?.flagsMayCompleteInAnyOrder === true, 'photo/spec enrichment must remain non-linear')
assert(migration.includes('if new.sku is not null and length(trim(new.sku)) > 0 then'), 'current Hub schema must preserve supplied System SKU')

console.log(`AMPHON ONE-1 FOUNDATION: PASS — Hub bridge contract accepts System-first intake identity with product flow ${flow.flowVersion}`)
