import { readFile } from 'node:fs/promises'

const evidence = JSON.parse(await readFile('config/amphon-one2d-production-acceptance.json', 'utf8'))
const contract = JSON.parse(await readFile('config/amphon-one2d.json', 'utf8'))
const wrangler = JSON.parse(await readFile('workers/one-bridge/wrangler.jsonc', 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-2D PROD ACCEPTANCE FAIL: ${message}`)
}

assert(evidence.contractVersion === 'ONE-2D-PROD.1', 'unexpected acceptance contract version')
assert(contract.contractVersion === 'ONE-2D.1', 'ONE-2D source contract drifted')
assert(evidence.hubDatabase?.schemaGate === 'PASS', 'Hub production schema gate must be recorded PASS')
assert(evidence.hubDatabase?.projectRef === 'mfpdtlxwdbxitgfzdape', 'wrong Hub production project')
assert(evidence.hubDatabase?.legacyCatalogBefore?.productCount === evidence.hubDatabase?.legacyCatalogAfter?.productCount, 'Hub migration changed legacy product count')
assert(evidence.hubDatabase?.legacyCatalogAfter?.oneManagedCount === 0, 'legacy products must not be silently converted to ONE-managed')
assert(evidence.hubDatabase?.legacyCatalogAfter?.listingReadinessNonNullCount === 0, 'legacy products must retain null ONE readiness')
assert(evidence.hubDatabase?.transactionalSmoke?.exactLinkOutcome === 'LINKED', 'exact-link smoke evidence missing')
assert(evidence.hubDatabase?.transactionalSmoke?.duplicateOutcome === 'DUPLICATE', 'duplicate smoke evidence missing')
assert(evidence.hubDatabase?.transactionalSmoke?.conflictingRemapOutcome === 'CONFLICT', 'conflict smoke evidence missing')
assert(evidence.hubDatabase?.transactionalSmoke?.conflictingRemapError === 'BRIDGE_LEGACY_MAPPING_CONFLICT', 'conflict code evidence drifted')
assert(evidence.hubDatabase?.transactionalSmoke?.rolledBack === true, 'production smoke must be rollback-only until full runtime acceptance')
assert(Object.values(evidence.hubDatabase?.transactionalSmoke?.testRowsRemaining || {}).every((value) => value === 0), 'transactional smoke left test integration rows')
assert(evidence.hubDatabase?.rpcSecurity?.one2bConsumeIntakeEvent?.securityInvoker === true, 'ONE-2B RPC must remain SECURITY INVOKER')
assert(evidence.hubDatabase?.rpcSecurity?.one2dConsumeLegacyLinkEvent?.securityInvoker === true, 'ONE-2D RPC must remain SECURITY INVOKER')
assert(evidence.hubDatabase?.rpcSecurity?.one2dConsumeLegacyLinkEvent?.anonExecute === false, 'anon must not execute ONE-2D RPC')
assert(evidence.hubDatabase?.rpcSecurity?.one2dConsumeLegacyLinkEvent?.authenticatedExecute === false, 'authenticated browser role must not execute ONE-2D RPC')
assert(evidence.hubDatabase?.rpcSecurity?.one2dConsumeLegacyLinkEvent?.serviceRoleExecute === true, 'service_role must execute ONE-2D RPC')
assert(evidence.hubDatabase?.advisorGate?.newOne2bOrOne2dSecurityWarningObserved === false, 'ONE migrations introduced a new security advisor warning')
assert(wrangler.vars?.ONE2D_RECONCILIATION_ENABLED === 'false', 'source must keep ONE-2D Bridge flag OFF while production is blocked')
assert(wrangler.vars?.ONE2B_SHELL_CONSUMER_ENABLED === 'false', 'source must keep ONE-2B consumer OFF while runtime acceptance is incomplete')

const runtimeGates = [
  evidence.systemRuntime?.dnsResolvedDuringAcceptance,
  evidence.systemRuntime?.apiHealthVerified,
  evidence.systemRuntime?.apiReadyVerified,
  evidence.systemRuntime?.hetznerDatabaseMigrationsApplied,
  evidence.systemRuntime?.one1StorageDatabaseVerified,
  evidence.systemRuntime?.one2aDatabaseVerified,
  evidence.systemRuntime?.one2dDatabaseVerified,
  evidence.bridgeRuntime?.dnsResolvedDuringAcceptance,
  evidence.bridgeRuntime?.workerDeploymentVerified,
  evidence.bridgeRuntime?.hmacSecretsMatchVerified,
  evidence.bridgeRuntime?.signedHealthSmokePassed,
  evidence.bridgeRuntime?.signedSnapshotSmokePassed,
  evidence.endToEnd?.hubSnapshotHttpVerified,
  evidence.endToEnd?.systemDryReconciliationRunPassed,
  evidence.endToEnd?.ownerQueueReviewed,
  evidence.endToEnd?.legacyProposalConfirmRoundTripPassed,
]
const everyRuntimeGatePassed = runtimeGates.every(Boolean)
const blockersEmpty = Array.isArray(evidence.blockers) && evidence.blockers.length === 0

if (evidence.productionAccepted) {
  assert(everyRuntimeGatePassed, 'productionAccepted=true requires every runtime gate')
  assert(blockersEmpty, 'productionAccepted=true requires no blockers')
  assert(evidence.activationAllowed === true, 'accepted production must allow activation')
  assert(contract.productionAccepted === true, 'source contract must mirror accepted production state')
} else {
  assert(evidence.activationAllowed === false, 'blocked acceptance must fail closed')
  assert(!blockersEmpty, 'productionAccepted=false must explain at least one blocker')
  assert(contract.productionAccepted === false, 'source contract must remain production pending while acceptance is blocked')
}

console.log(`AMPHON ONE-2D PROD: PASS — evidence is internally consistent; overall status=${evidence.status}; productionAccepted=${evidence.productionAccepted}`)
