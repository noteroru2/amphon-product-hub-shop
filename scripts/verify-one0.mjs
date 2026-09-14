import { readFile } from 'node:fs/promises'

const contractPath = new URL('../config/amphon-one-contract.json', import.meta.url)
const docPath = new URL('../docs/AMPHON_ONE_ARCHITECTURE_CONTRACT.md', import.meta.url)
const migrationPath = new URL('../supabase/migrations/20260912000000_amphon_shop61_full_setup.sql', import.meta.url)

const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const doc = await readFile(docPath, 'utf8')
const migration = await readFile(migrationPath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(`ONE-0 CONTRACT FAIL: ${message}`)
}

assert(contract.contractVersion === 'ONE-0.1', 'unexpected contract version')
assert(contract.status === 'ACTIVE', 'contract must be ACTIVE')
assert(contract.platform === 'AMPHON ONE', 'platform name drifted')

const expectedMasters = {
  owner_control: 'amphon_system',
  customer_crm: 'amphon_system',
  employee_hr: 'amphon_system',
  contracts: 'amphon_system',
  repairs: 'amphon_system',
  finance_ledger: 'amphon_system',
  sales_ledger: 'amphon_system',
  product_identity: 'product_hub',
  inventory_lifecycle: 'product_hub',
  product_specs_images: 'product_hub',
  product_cost_source: 'product_hub',
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

assert(contract.rules?.crossDatabaseBrowserWrites === false, 'browser cross-database writes must stay forbidden')
assert(contract.rules?.serverToServerMutationsOnly === true, 'cross-system mutations must be server-to-server')
assert(contract.rules?.idempotencyRequired === true, 'idempotency must be required')
assert(contract.rules?.eventIdRequired === true, 'eventId must be required')
assert(contract.rules?.lastWriteWinsAcrossSystems === false, 'cross-system last-write-wins is forbidden')
assert(contract.rules?.publicShopMayReceiveInternalFinancials === false, 'Shop must not receive internal financials')
assert(contract.rules?.implicitSourceOfTruthChangesAllowed === false, 'implicit source-of-truth changes are forbidden')

assert(migration.includes('create table if not exists public.products ('), 'Product Hub product master table missing')
assert(migration.includes('create table if not exists public.commerce_orders ('), 'Shop commerce order table missing')
assert(migration.includes('Product Hub remains inventory source of truth'), 'existing Shop inventory ownership statement drifted')

assert(doc.includes('Contract version: `ONE-0.1`'), 'human contract version does not match machine contract')
assert(doc.includes('Cross-system mutations MUST be server-to-server'), 'server-to-server rule missing from human contract')
assert(doc.includes('AMPHON System') && doc.includes('Product Hub') && doc.includes('AMPHON Shop'), 'human contract must describe all three applications')

console.log('AMPHON ONE-0: PASS — Product Hub/Shop ownership and cross-system boundaries are locked')
