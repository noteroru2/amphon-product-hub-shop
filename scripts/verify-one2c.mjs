import { readFile } from 'node:fs/promises'

const files = {
  contract: 'config/amphon-one2c.json',
  migration: 'supabase/migrations/20260915133000_one2c_product_hub_enrichment_workflow.sql',
  component: 'src/components/EnrichmentQueueDock.tsx',
  main: 'src/main.tsx',
  env: 'src/vite-env.d.ts',
}

const [contractText, migration, component, main, env] = await Promise.all([
  readFile(files.contract, 'utf8'),
  readFile(files.migration, 'utf8'),
  readFile(files.component, 'utf8'),
  readFile(files.main, 'utf8'),
  readFile(files.env, 'utf8'),
])

const contract = JSON.parse(contractText)
const checks = []
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) })

check('contract version ONE-2C.1', contract.contractVersion === 'ONE-2C.1')
check('source ready but not production accepted', contract.status === 'SOURCE_READY' && contract.productionAccepted === false)
check('no technical inspection stage', contract.principles?.technicalInspectionStageAdded === false)
check('no qc stage', contract.principles?.qcStageAdded === false)
check('workstreams independent / any order', contract.principles?.enrichmentMayOccurInAnyOrder === true && contract.readiness?.independentFlagsAuthoritative === true)
check('three workstream flags locked', [
  contract.workstreams?.photos?.field,
  contract.workstreams?.specs?.field,
  contract.workstreams?.listingContent?.field,
].join(',') === 'one_photos_complete,one_specs_complete,one_listing_content_complete')
check('battery grades locked', JSON.stringify(contract.batteryHealth?.values) === JSON.stringify(['LOW', 'GOOD', 'VERY_GOOD', 'UNKNOWN']))
check('battery percent not required', contract.batteryHealth?.percentageRequired === false)
check('feature flag defaults off', contract.ui?.activationFlag === 'VITE_ONE2C_ENRICHMENT_ENABLED' && contract.ui?.defaultEnabled === false)
check('enrichment event to system', contract.events?.output === 'product.enrichment_changed' && contract.events?.transactionalOutbox === true)

check('migration alters completion timestamps', migration.includes('one_photos_completed_at') && migration.includes('one_specs_completed_at') && migration.includes('one_listing_content_completed_at'))
check('category-aware specs function', migration.includes('private.one2c_specs_complete') && migration.includes("when 'notebook'") && migration.includes("when 'camera'") && migration.includes("when 'component'"))
check('photo rule is >=2 + cover', migration.includes('v_photo_count >= 2 and v_has_cover'))
check('listing content rule excludes serial requirement', migration.includes('private.one2c_listing_content_complete') && !/one2c_listing_content_complete[\s\S]{0,800}serial_number/.test(migration))
check('private trigger helpers', migration.includes('create schema if not exists private') && migration.includes('security definer') && migration.includes('revoke all on function private.one2c_'))
check('no public security definer function', !migration.match(/create or replace function public\.one2c_[\s\S]{0,180}security definer/i))
check('photos/spec/content can update independently', migration.includes('trg_one2c_product_images_after_change') && migration.includes('trg_one2c_product_before_write'))
check('legacy ready_to_list compatibility', migration.includes("new.status := 'ready_to_list'"))
check('transactional enrichment outbox', migration.includes("'product.enrichment_changed'") && migration.includes("'amphon-system'"))
check('activity audit actions', migration.includes('one_enrichment_photos_changed') && migration.includes('one_enrichment_changed'))
check('no QC_PENDING state', !migration.includes('QC_PENDING') && !contractText.includes('QC_PENDING'))

check('queue component feature gated', component.includes("VITE_ONE2C_ENRICHMENT_ENABLED === 'true'"))
check('queue shows independent flags', component.includes('one_photos_complete') && component.includes('one_specs_complete') && component.includes('one_listing_content_complete'))
check('queue supports Thai battery grades', component.includes("LOW: 'ต่ำ'") && component.includes("GOOD: 'ดี'") && component.includes("VERY_GOOD: 'ดีมาก'") && component.includes("UNKNOWN: 'ไม่ทราบ'"))
check('queue opens existing SKU product', component.includes("url.searchParams.set('sku', sku)"))
check('queue never references service role secret', !component.toLowerCase().includes('service_role') && !component.includes('SUPABASE_SECRET'))
check('main mounts queue dock', main.includes("import { EnrichmentQueueDock }") && main.includes('<EnrichmentQueueDock />'))
check('vite env declares feature flag', env.includes('VITE_ONE2C_ENRICHMENT_ENABLED'))

const failed = checks.filter((item) => !item.ok)
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} - ${item.name}`)

if (failed.length) {
  console.error(`\nONE-2C source verification failed: ${failed.length} check(s)`) 
  process.exit(1)
}

console.log(`\nONE-2C source verification PASS (${checks.length}/${checks.length})`)
