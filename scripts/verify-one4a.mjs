import { readFile } from 'node:fs/promises'

const contract = JSON.parse(await readFile('config/amphon-one4.json', 'utf8'))
const worker = await readFile('workers/r2-upload/src/index.ts', 'utf8')
const failures = []
const eq = (actual, expected, label) => { if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
const has = (values, value, label) => { if (!Array.isArray(values) || !values.includes(value)) failures.push(`${label}: missing ${value}`) }

eq(contract.contractVersion, 'ONE-4.0', 'contract version')
eq(contract.authority?.inventoryAvailability, 'amphon_system', 'inventory authority')
eq(contract.authority?.reservationAuthority, 'amphon_system', 'reservation authority')
eq(contract.authority?.saleAuthority, 'amphon_system', 'sale authority')
eq(contract.authority?.orderAuthority, 'shop', 'order authority')
eq(contract.authority?.hubAvailabilityRole, 'projection', 'Hub availability role')
eq(contract.authority?.shopAvailabilityRole, 'requester_only', 'Shop availability role')
eq(contract.authority?.shopMayMutateOneManagedInventoryDirectly, false, 'Shop direct stock mutation')
eq(contract.authority?.shopMayCreatePaymentBeforeSystemReservation, false, 'payment-before-reserve policy')
eq(contract.checkoutFlow?.reserve, 'SYNCHRONOUS_SYSTEM_AUTHORITY_BEFORE_ORDER_CREATE', 'reserve flow')
eq(contract.checkoutFlow?.orderCreate, 'ONLY_AFTER_SYSTEM_RESERVE_ACCEPTED', 'order creation flow')
eq(contract.checkoutFlow?.hubProjection, 'ASYNC_SYSTEM_OUTBOX_AFTER_CANONICAL_COMMIT', 'Hub projection flow')
eq(contract.reservationContract?.atomicAllOrNothing, true, 'atomic reservation')
eq(contract.reservationContract?.checkoutIdempotencyKeyRequired, true, 'checkout idempotency')
eq(contract.reservationContract?.exactLinkedIdentityRequired, true, 'exact link requirement')
eq(contract.reservationContract?.canonicalInStockRequired, true, 'canonical stock requirement')
eq(contract.reservationContract?.maxSkus, 10, 'max SKUs')
eq(contract.security?.hmacRequired, true, 'HMAC requirement')
eq(contract.security?.source, 'shop', 'HMAC peer source')
eq(contract.security?.dedicatedShopKeyRequired, true, 'dedicated Shop key')
eq(contract.security?.browserMayCallSystemStockRoute, false, 'browser direct System stock access')
eq(contract.featureFlags?.systemShopAuthority, 'ONE4_SHOP_AUTHORITY_ENABLED', 'System ONE-4 flag')
eq(contract.featureFlags?.shopSystemStock, 'ONE4_SYSTEM_STOCK_ENABLED', 'Shop ONE-4 flag')
eq(contract.featureFlags?.purchaseEnabledMustRemainFalseUntilOne4d, true, 'purchase activation guard')
eq(contract.scope?.technicalInspectionStage, false, 'technical inspection stage')
eq(contract.scope?.qcStage, false, 'QC stage')

for (const command of ['shop.reserve_requested','shop.release_requested','shop.sale_confirm_requested']) has(contract.shopToSystemCommands, command, 'Shop command contract')
for (const command of ['product.reserve_requested','product.release_requested','product.mark_sold_requested']) has(contract.systemToHubCommands, command, 'System projection command contract')

if (!worker.includes("if (!settings?.purchase_enabled) return storeJson({ error: 'Checkout ยังไม่เปิดใช้งาน' }, 503")) {
  failures.push('worker: purchase_enabled fail-closed checkout guard missing')
}

if (failures.length) {
  console.error('AMPHON ONE-4A: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('AMPHON ONE-4A: PASS — Shop is requester-only, System owns reservation/sale state, purchase remains gated and rollout is fail-closed')
