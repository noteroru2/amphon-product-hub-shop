import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')
const dq = String.fromCharCode(36, 36)

const [doc, channels, migration, assistedMigration, shopee, workflow] = await Promise.all([
  read('docs/channel-architecture.md'),
  read('src/lib/channels.ts'),
  read('supabase/migrations/20260919193000_channel_architecture.sql'),
  read('supabase/migrations/20260919204500_shopee_assisted_listing.sql'),
  read('workers/r2-upload/src/shopee.ts'),
  read('.github/workflows/store-worker-deploy.yml'),
])

const checks = [
  ['System remains canonical stock authority', doc.includes('AMPHON System') && doc.includes('No external channel may become stock master')],
  ['Stable Website/Facebook/Shopee keys exist', ['website','facebook_page','facebook_marketplace','shopee'].every((key) => channels.includes("'" + key + "'"))],
  ['Website is native auto channel', channels.includes("key: 'website'") && channels.includes("mode: 'native'") && channels.includes('autoPublish: true')],
  ['Facebook is assisted, not auto-published', channels.includes("key: 'facebook_page'") && channels.includes("key: 'facebook_marketplace'") && channels.includes("mode: 'assisted'")],
  ['Shopee is assisted for staff while direct API stays disabled by default', channels.includes("key: 'shopee'") && channels.includes("mode: 'assisted'") && assistedMigration.includes("adapter_mode = 'assisted'") && assistedMigration.includes('auto_publish = false') && shopee.includes("env.CHANNEL_SHOPEE_MODE || 'disabled'")],
  ['Stock projection is one only for IN_STOCK', channels.includes("oneAvailability === 'IN_STOCK' ? 1 : 0") && migration.includes("p.one_availability = 'IN_STOCK' then 1 else 0")],
  ['Generic registry and durable job tables exist', migration.includes('public.sales_channel_registry') && migration.includes('public.sales_channel_links') && migration.includes('public.sales_channel_jobs')],
  ['Migration DO block uses valid dollar quoting', migration.includes('do ' + dq) && migration.includes('end ' + dq + ';')],
  ['Generic queue writes are service only', migration.includes('revoke insert, update, delete on table public.sales_channel_jobs from anon, authenticated') && migration.includes('grant select, insert, update, delete on table public.sales_channel_jobs to service_role')],
  ['Shopee runtime is mode gated', shopee.includes("CHANNEL_SHOPEE_MODE?: string") && shopee.includes("channelMode(env)") && shopee.includes("=== 'direct_api'")],
  ['Shopee deploy credentials are optional', workflow.includes('Shopee direct API disabled') && !workflow.includes('for name in CLOUDFLARE_API_TOKEN SHOPEE_PARTNER_ID SHOPEE_PARTNER_KEY')],
]

const failed = checks.filter((entry) => !entry[1])
for (const entry of checks) console.log((entry[1] ? 'PASS' : 'FAIL') + ' - ' + entry[0])
if (failed.length) {
  console.error('CHANNEL ARCHITECTURE verification failed: ' + failed.map((entry) => entry[0]).join(', '))
  process.exit(1)
}
console.log('CHANNEL ARCHITECTURE verification PASS — Website native, Facebook assisted, Shopee assisted/manual with direct API fail-closed, System stock authority preserved')
