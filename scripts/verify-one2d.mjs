import { readFile } from 'node:fs/promises'

const files = {
  contract: 'config/amphon-one2d.json',
  bridge: 'config/amphon-one-bridge.json',
  migration: 'supabase/migrations/20260915214500_one2d_legacy_mapping_consumer.sql',
  worker: 'workers/one-bridge/src/index.ts',
  entry: 'workers/one-bridge/src/one2b-entry.ts',
  wrangler: 'workers/one-bridge/wrangler.jsonc',
}

const entries = await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, 'utf8')]))
const source = Object.fromEntries(entries)
const contract = JSON.parse(source.contract)
const bridge = JSON.parse(source.bridge)
const checks = []
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) })

check('ONE-2D.1 source ready not production accepted', contract.contractVersion === 'ONE-2D.1' && contract.status === 'SOURCE_READY' && contract.productionAccepted === false)
check('Product Hub remains source of truth', contract.sourceOfTruth?.physicalProduct === 'product-hub')
check('legacy link requires owner confirmation', contract.legacyMapping?.ownerConfirmationRequired === true && contract.legacyMapping?.autoLinkAllowed === false)
check('no Hub SKU mutation allowed', contract.legacyMapping?.hubSkuMutationAllowed === false)
check('feature flag defaults disabled', contract.activation?.hubFeatureFlag === 'ONE2D_RECONCILIATION_ENABLED' && contract.activation?.defaultEnabled === false && source.wrangler.includes('"ONE2D_RECONCILIATION_ENABLED": "false"'))

check('signed reconciliation snapshot endpoint exists', source.worker.includes("'/v1/reconciliation/products'") && source.worker.includes('authenticate(request, env, rawBuffer, url)'))
check('snapshot is POST only', source.worker.includes("url.pathname === '/v1/reconciliation/products' && request.method !== 'POST'"))
check('snapshot feature gated', source.worker.includes('RECONCILIATION_DISABLED') && source.worker.includes('ONE2D_RECONCILIATION_ENABLED'))
check('snapshot fields exclude financial data', !/cost|profit|commission|payment/i.test(contract.hubSnapshot?.fields?.join(',') || ''))
check('snapshot query selects operational fields only', source.worker.includes('id,sku,status,one_listing_readiness,category,serial_number,title,one_managed,updated_at'))
check('browser OPTIONS remains disabled', source.worker.includes('BRIDGE_BROWSER_ACCESS_DISABLED'))

check('legacy request added to Worker allowlist', source.worker.includes("'product.legacy_link_requested'"))
check('legacy consumer RPC exists', source.migration.includes('one2d_consume_legacy_link_event'))
check('RPC uses security invoker', /one2d_consume_legacy_link_event[\s\S]*?security invoker/i.test(source.migration))
check('RPC restricted to service role', source.migration.includes('grant execute on function public.one2d_consume_legacy_link_event(uuid) to service_role'))
check('RPC validates exact hub product and SKU', source.migration.includes('BRIDGE_LEGACY_HUB_PRODUCT_MISSING') && source.migration.includes('BRIDGE_LEGACY_SKU_MISMATCH'))
check('RPC never updates product SKU', !/update\s+public\.products[\s\S]{0,300}\bsku\b/i.test(source.migration))
check('RPC stops mapping conflict', source.migration.includes('BRIDGE_LEGACY_MAPPING_CONFLICT'))
check('RPC emits legacy linked acknowledgement', source.migration.includes("'product.legacy_linked'"))
check('entry consumes legacy event only when enabled', source.entry.includes("envelope.eventType === 'product.legacy_link_requested'") && source.entry.includes('ONE2D_RECONCILIATION_ENABLED'))

check('bridge events contain request and ack', bridge.events?.systemToHub?.includes('product.legacy_link_requested') && bridge.events?.hubToSystem?.includes('product.legacy_linked'))
check('bridge snapshot contract is server-only', bridge.one2d?.snapshot?.serverToServerOnly === true && bridge.one2d?.snapshot?.financialFieldsAllowed === false)
check('service secret remains Worker-side', source.worker.includes('SUPABASE_SECRET_KEY') && !source.worker.includes('VITE_SUPABASE_SECRET'))

const failed = checks.filter((item) => !item.ok)
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} - ${item.name}`)
if (failed.length) {
  console.error(`\nONE-2D Hub source verification failed: ${failed.length} check(s)`)
  process.exit(1)
}
console.log(`\nONE-2D Hub source verification PASS (${checks.length}/${checks.length})`)
