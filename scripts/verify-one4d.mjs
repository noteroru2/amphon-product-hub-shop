import { readFile } from 'node:fs/promises'

const files = {
  migration: 'supabase/migrations/20260917161000_one4d_production_activation_guard.sql',
  evidence: 'config/one4d-production-acceptance.json',
  wrangler: 'workers/r2-upload/wrangler.jsonc',
  entry: 'workers/r2-upload/src/one4c-entry.ts',
  one4c: 'supabase/migrations/20260917130327_one4c_payment_sale_outbox.sql',
}

const text = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
))
const evidence = JSON.parse(text.evidence)
const failures = []
const need = (key, token, label) => {
  if (!text[key].includes(token)) failures.push(`${label}: missing ${token}`)
}
const forbid = (key, token, label) => {
  if (text[key].includes(token)) failures.push(`${label}: forbidden ${token}`)
}
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

for (const token of [
  'private.one4d_activation_state',
  'private.one4d_guard_purchase_enable',
  'trg_one4d_guard_purchase_enable',
  'public.one4d_activation_readiness',
  "status in ('PENDING','ACCEPTED','REVOKED')",
  "message = 'ONE4D_ACTIVATION_NOT_ACCEPTED'",
  "message = 'ONE4D_COMMAND_OUTBOX_NOT_CLEAR'",
  'grant execute on function public.one4d_activation_readiness() to service_role',
  'set purchase_enabled = false',
]) need('migration', token, 'ONE-4D activation guard')

for (const role of ['public, anon, authenticated']) {
  need('migration', `revoke all on function public.one4d_activation_readiness() from ${role}`, 'ONE-4D RPC security')
}
forbid('migration', 'grant execute on function public.one4d_activation_readiness() to authenticated', 'browser must not inspect private ONE-4D acceptance state')
forbid('migration', 'grant execute on function public.one4d_activation_readiness() to anon', 'anonymous browser must not inspect private ONE-4D acceptance state')

for (const token of [
  'one4_claim_shop_stock_commands',
  'one4_complete_shop_stock_command',
  'one4_fail_shop_stock_command',
]) need('entry', token, 'ONE-4D durable Worker path')
for (const token of [
  'private.one4_shop_stock_command_outbox',
  "'CONFIRM_SOLD'",
  "'RELEASE'",
]) need('one4c', token, 'ONE-4C prerequisite')

assert(evidence.contractVersion === 'ONE-4D-PROD.1', 'unexpected ONE-4D production acceptance contract version')
assert(typeof evidence.cutoverComplete === 'boolean', 'ONE-4D evidence must declare cutoverComplete')
assert(evidence.hubDatabase?.projectRef === 'mfpdtlxwdbxitgfzdape', 'wrong production Supabase project')
assert(evidence.hubDatabase?.outboxRetryDeliveredSmokePassed === true, 'production retry-to-delivered outbox smoke must pass')
assert(evidence.hubDatabase?.outboxDeadAuditSmokePassed === true, 'production non-retryable DEAD/audit outbox smoke must pass')
assert(evidence.hubDatabase?.outboxSmokeCleanupPassed === true, 'production outbox smoke fixtures must be fully cleaned up')
assert(evidence.hubDatabase?.referenceStockUnchanged === true, 'production outbox smoke must leave reference stock unchanged')
assert(evidence.safety?.realCustomerCheckoutOpened === false || evidence.cutoverComplete === true,
  'real customer checkout cannot open before cutover completion')
assert(evidence.safety?.realInventoryUsedForSoldSmoke === false,
  'ONE-4D acceptance must never consume arbitrary real inventory for sold smoke')
assert(evidence.safety?.syntheticFinancialEntriesCreated === false,
  'ONE-4D acceptance must not leave synthetic finance entries')

const blockers = Array.isArray(evidence.blockers) ? evidence.blockers : []
const acceptedGates = [
  evidence.hubDatabase?.activationGuardApplied === true,
  evidence.hubDatabase?.guardRejectsPrematureEnable === true,
  evidence.hubDatabase?.readinessRpcServiceRoleOnly === true,
  evidence.hubDatabase?.outboxRetryDeliveredSmokePassed === true,
  evidence.hubDatabase?.outboxDeadAuditSmokePassed === true,
  evidence.hubDatabase?.outboxSmokeCleanupPassed === true,
  evidence.hubDatabase?.referenceStockUnchanged === true,
  evidence.hubDatabase?.nonterminalCommands === 0,
  evidence.hubDatabase?.deadCommands === 0,
  evidence.systemRuntime?.signedHealthPassed === true,
  evidence.systemRuntime?.one3SaleSyncEnabled === true,
  evidence.systemRuntime?.one4ShopAuthorityEnabled === true,
  evidence.systemRuntime?.one4PaymentSaleEnabled === true,
  evidence.systemRuntime?.reserveDuplicateReleaseE2EPassed === true,
  evidence.systemRuntime?.confirmSoldE2EPassed === true,
  ['ROLLBACK_ONLY_FIXTURE', 'DESIGNATED_SMOKE_FIXTURE'].includes(evidence.systemRuntime?.confirmSoldTestIsolation),
  evidence.storeWorker?.systemStockEnabled === true,
  evidence.storeWorker?.productionDeploymentVerified === true,
  evidence.storeWorker?.scheduledDrainVerified === true,
  evidence.reconciliation?.projectionConverged === true,
  evidence.reconciliation?.zeroUnresolvedDrift === true,
]

if (evidence.storeWorker?.systemStockEnabled === true) {
  need('wrangler', '"ONE4_SYSTEM_STOCK_ENABLED": "true"', 'ONE-4D Worker source/runtime evidence')
} else {
  need('wrangler', '"ONE4_SYSTEM_STOCK_ENABLED": "false"', 'ONE-4D Worker source/runtime evidence')
}

if (evidence.productionAccepted === true) {
  assert(evidence.activationAllowed === true, 'accepted production must allow activation')
  assert(blockers.length === 0, 'accepted production must have zero blockers')
  assert(acceptedGates.every(Boolean), 'accepted production requires every runtime/E2E gate')
  if (evidence.cutoverComplete === true) {
    assert(evidence.hubDatabase?.purchaseEnabled === true,
      'completed cutover must have Shop purchase enabled')
    assert(evidence.safety?.realCustomerCheckoutOpened === true,
      'completed cutover must record customer checkout as opened')
  } else {
    assert(evidence.hubDatabase?.purchaseEnabled === false,
      'pre-cutover acceptance must keep Shop purchase disabled until DB gate is ACCEPTED')
    assert(evidence.safety?.realCustomerCheckoutOpened === false,
      'pre-cutover acceptance must keep real customer checkout closed')
  }
} else {
  assert(evidence.activationAllowed === false, 'blocked production must fail closed')
  assert(evidence.cutoverComplete === false, 'blocked production cannot be marked cutover complete')
  assert(blockers.length > 0, 'blocked production must list explicit blockers')
  assert(evidence.hubDatabase?.purchaseEnabled === false, 'blocked production must keep Shop purchase disabled')
  assert(evidence.safety?.realCustomerCheckoutOpened === false, 'blocked production must keep real customer checkout closed')
}

forbid('wrangler', 'SHOP_INTEGRATION_SECRET', 'HMAC secret must remain remote only')

if (failures.length) {
  console.error('AMPHON ONE-4D SHOP: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`AMPHON ONE-4D SHOP: PASS — activation evidence is internally consistent; status=${evidence.status}; productionAccepted=${evidence.productionAccepted}; cutoverComplete=${evidence.cutoverComplete}; blockers=${blockers.length}`)
