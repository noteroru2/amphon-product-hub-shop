import { readFile } from 'node:fs/promises'

const contractPath = new URL('../config/amphon-one-contract.json', import.meta.url)
const flowPath = new URL('../config/amphon-one-product-flow.json', import.meta.url)
const docPath = new URL('../docs/AMPHON_ONE_ARCHITECTURE_CONTRACT.md', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260912000000_amphon_shop61_full_setup.sql', import.meta.url)

const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const flow = JSON.parse(await readFile(flowPath, 'utf8'))
const doc = await readFile(docPath, 'utf8')
const migration = await readFile(migrationPath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-0R CONTRACT FAIL: ${message}`)
}

assert(contract.contractVersion === 'ONE-0R.1', 'unexpected contract version')
assert(contract.status === 'ACTIVE', 'contract must be ACTIVE')
assert(contract.supersedes === 'ONE-0.1', 'revised contract must supersede ONE-0.1')
assert(contract.platform === 'AMPHON ONE', 'platform name drifted')

const expectedMasters = {
  owner_control: 'amphon_system',
  product_intake: 'amphon_system',
  business_sku: 'amphon_system',
  acquisition_cost_source: 'amphon_system',
  customer_crm: 'amphon_system',
  employee_hr: 'amphon_system',
  contracts: 'amphon_system',
  repairs: 'amphon_system',
  finance_ledger: 'amphon_system',
  sales_ledger: 'amphon_system',
  hub_product_record: 'product_hub',
  inventory_availability: 'product_hub',
  product_specs_images: 'product_hub',
  listing_readiness: 'product_hub',
  publication_channels: 'product_hub',
  sold_cleanup_tasks: 'product_hub',
  storefront_seo_catalog: 'shop',
  online_orders: 'shop',
  online_payment_fulfillment: 'shop',
  warranty_cases: 'amphon_system'
}

for (const [domain, master] of Object.entries(expectedMasters)) {
  assert(contract.domains?.[domain]?.master === master, `${domain} must be owned by ${master}`)
}

assert(contract.productIdentity?.skuOwner === 'amphon_system', 'System must own business SKU')
assert(contract.productIdentity?.hubProductIdOwner === 'product_hub', 'Hub must own hub_product_id')
assert(contract.receiving?.preserveExistingSystemWorkflow === true, 'System receiving flow must remain unchanged')
assert(contract.receiving?.additionalTechnicalInspectionStage === false, 'Technical Inspection must not be introduced')
assert(contract.receiving?.additionalQcStage === false, 'QC must not be introduced')
assert(contract.listingReadiness?.qcRequired === false, 'QC must not gate listing readiness')
assert(contract.listingReadiness?.technicalInspectionRequired === false, 'Technical Inspection must not gate listing readiness')
assert(contract.rules?.allNewSellableProductsOriginateFromSystemIntake === true, 'new sellable products must originate from System intake')
assert(contract.rules?.hubMayForkSku === false, 'Hub must never fork System SKU')
assert(contract.rules?.photosAndSpecsMayCompleteInAnyOrder === true, 'photos/specs must be independently completable')
assert(contract.rules?.shopMayCreateInventory === false, 'Shop must never create inventory')

assert(JSON.stringify(contract.batteryHealth?.grades) === JSON.stringify(['LOW', 'GOOD', 'VERY_GOOD', 'UNKNOWN']), 'battery health grades drifted')
assert(contract.batteryHealth?.percentRequired === false, 'battery percentage must remain optional')

assert(contract.rules?.crossDatabaseBrowserWrites === false, 'browser cross-database writes must stay forbidden')
assert(contract.rules?.serverToServerMutationsOnly === true, 'cross-system mutations must be server-to-server')
assert(contract.rules?.idempotencyRequired === true, 'idempotency must be required')
assert(contract.rules?.eventIdRequired === true, 'eventId must be required')
assert(contract.rules?.lastWriteWinsAcrossSystems === false, 'cross-system last-write-wins is forbidden')
assert(contract.rules?.publicShopMayReceiveInternalFinancials === false, 'Shop must not receive internal financials')

assert(flow.flowVersion === 'ONE-0R.1' && flow.status === 'ACTIVE', 'product flow contract version/status drifted')
assert(flow.origin?.application === 'amphon_system', 'flow must originate in System')
assert(flow.origin?.skuAllocatedBeforeHubSync === true, 'SKU must exist before Hub sync')
assert(flow.origin?.hubSyncFailureDoesNotBlockReceiving === true, 'Hub outage must not block receiving')
assert(flow.hubEnrichment?.technicalInspectionStage === false, 'Hub must not add Technical Inspection')
assert(flow.hubEnrichment?.qcStage === false, 'Hub must not add QC')
assert(flow.hubEnrichment?.flagsMayCompleteInAnyOrder === true, 'Hub enrichment must be non-linear')
assert(flow.hubEnrichment?.readyExpression === 'photos_complete && specs_complete && listing_content_complete', 'readiness expression drifted')
assert(JSON.stringify(flow.batteryHealth?.grades) === JSON.stringify(['LOW', 'GOOD', 'VERY_GOOD', 'UNKNOWN']), 'flow battery grades drifted')
assert(flow.batteryHealth?.percentRequired === false, 'flow must not require battery percent')

assert(migration.includes('create table if not exists public.products ('), 'Product Hub product table missing')
assert(migration.includes('create table if not exists public.commerce_orders ('), 'Shop commerce order table missing')
assert(migration.includes('if new.sku is not null and length(trim(new.sku)) > 0 then'), 'Hub SKU trigger must preserve supplied System SKU')
assert(migration.includes('new.sku := '), 'legacy Hub SKU fallback must still exist during ONE-2B transition')

assert(doc.includes('Contract version: `ONE-0R.1`'), 'human contract version does not match machine contract')
assert(doc.includes('The product MUST originate from AMPHON System receiving'), 'System-first receiving principle missing')
assert(doc.includes('There is no `QC_PENDING` requirement'), 'no-QC readiness rule missing')
assert(doc.includes('Battery percentage') || doc.includes('battery percentage'), 'simple battery rule missing')

console.log('AMPHON ONE-0R: PASS — Hub accepts System SKU and owns async enrichment/publication without QC gating')
