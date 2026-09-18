import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [migration, workflow, shopee] = await Promise.all([
  readFile(resolve(root, 'supabase/migrations/20260919102500_merchant_auto_enable.sql'), 'utf8'),
  readFile(resolve(root, '.github/workflows/store-worker-deploy.yml'), 'utf8'),
  readFile(resolve(root, 'docs/shopee-integration-discovery.md'), 'utf8'),
])

const checks = [
  ['Merchant current eligible listings are backfilled', migration.includes('set merchant_enabled = true') && migration.includes("p.status = 'published'") && migration.includes("cl.index_policy = 'INDEX'")],
  ['Merchant future Website publications sync automatically', migration.includes('trg_sync_merchant_from_website_publication') && migration.includes("new.channel <> 'website'")],
  ['Merchant eligibility refuses System SOLD', migration.includes("p.one_availability is distinct from 'SOLD'")],
  ['Store Worker deploy is production, not dry-run', workflow.includes('npx wrangler deploy --config wrangler.jsonc') && !workflow.includes('--dry-run')],
  ['Store Worker deploy requires Cloudflare token', workflow.includes('CLOUDFLARE_API_TOKEN') && workflow.includes('Missing repository secret CLOUDFLARE_API_TOKEN')],
  ['Store Worker deploy smoke-checks live autoPublish settings', workflow.includes('amphon-product-images.noteroru2.workers.dev/store/settings') && workflow.includes('"autoPublish"')],
  ['Shopee keeps AMPHON System as stock authority', shopee.includes('AMPHON System') && shopee.includes('Shopee must **never** become master stock')],
  ['Shopee plan includes durable mapping + queue', shopee.includes('shopee_product_mappings') && shopee.includes('shopee_publish_queue')],
  ['Shopee plan includes image upload, category, stock and webhook contracts', shopee.includes('v2.media_space.upload_image') && shopee.includes('v2.product.update_stock') && shopee.includes('Push Mechanism')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`MERCHANT/SHOPEE foundation verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('MERCHANT/SHOPEE foundation verification PASS')
