import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

const [migration, runtime, worker, wrangler, hubClient, hubAdmin, deploy] = await Promise.all([
  read('supabase/migrations/20260919121000_shopee_channel_runtime.sql'),
  read('workers/r2-upload/src/shopee.ts'),
  read('workers/r2-upload/src/index.ts'),
  read('workers/r2-upload/wrangler.jsonc'),
  read('src/lib/shopee.ts'),
  read('src/components/CommerceAdmin.tsx'),
  read('.github/workflows/store-worker-deploy.yml'),
])

const checks = [
  ['Shopee auto publish defaults ON but is mapping-gated',
    migration.includes('auto_publish_enabled boolean not null default true')
      && migration.includes('private.shopee_mapping_for_product(p.id) is not null')],
  ['Shopee tokens are stored in Supabase Vault, not plaintext connection columns',
    migration.includes('vault.create_secret')
      && migration.includes('vault.update_secret')
      && migration.includes('vault.decrypted_secrets')
      && !/access_token\\s+text/i.test(migration.match(/create table if not exists public\\.shopee_connections[\\s\\S]*?\\);/)?.[0] || '')],
  ['Token RPCs are service-role only',
    migration.includes('grant execute on function public.shopee_get_connection_secret(bigint)')
      && migration.includes('to service_role')
      && migration.includes('from public, anon, authenticated')],
  ['Shopee queue uses SKIP LOCKED and retry limits',
    migration.includes('for update skip locked')
      && migration.includes('v_attempt >= 5')
      && migration.includes("interval '30 minutes'")],
  ['Website/product write order is idempotently covered',
    migration.includes('trg_shopee_enqueue_website')
      && migration.includes('trg_shopee_stock_projection')
      && migration.includes('shopee_publish_queue_active_unique')],
  ['System authority drives Shopee stock projection',
    runtime.includes("product.one_availability === 'IN_STOCK' ? 1 : 0")
      && migration.includes("p.one_availability is distinct from 'SOLD'")],
  ['Missing mapping fails closed before Shopee add-item',
    runtime.includes("throw new ShopeeError('SHOPEE_CATEGORY_MAPPING_REQUIRED', false)")
      && runtime.includes("throw new ShopeeError('SHOPEE_MAPPING_INCOMPLETE', false)")],
  ['Seller API uses current auth/token endpoints and HMAC signing',
    runtime.includes('/api/v2/auth/token/get')
      && runtime.includes('/api/v2/auth/access_token/get')
      && runtime.includes("name: 'HMAC'")
      && runtime.includes("hash: 'SHA-256'")],
  ['Product publication uploads binary images before add_item',
    runtime.includes('/api/v2/media_space/upload_image')
      && runtime.includes('/api/v2/product/add_item')
      && runtime.includes('form.append(')
      && runtime.includes('image_id_list')],
  ['Stock synchronization calls Shopee update_stock with model 0',
    runtime.includes('/api/v2/product/update_stock')
      && runtime.includes('model_id: 0')
      && runtime.includes('normal_stock: stock')],
  ['Shopee webhook verifies HMAC from raw body before persistence',
    runtime.includes("request.headers.get('authorization')")
      && runtime.includes('${request.url}|${rawBody}')
      && runtime.includes('shopee_webhook_events')],
  ['Worker runs Shopee queue on the one-minute cadence',
    worker.includes('runShopeePublishSweep(env)')
      && worker.includes("cron === '* * * * *'")],
  ['Partner credentials are Worker-only secrets',
    wrangler.includes('"SHOPEE_PARTNER_ID"')
      && wrangler.includes('"SHOPEE_PARTNER_KEY"')
      && !hubClient.includes('SHOPEE_PARTNER_KEY')
      && !hubAdmin.includes('SHOPEE_PARTNER_KEY')],
  ['Hub has Shopee authorize, queue, discovery and mapping controls',
    hubClient.includes('startShopeeAuthorization')
      && hubClient.includes('discoverShopee')
      && hubClient.includes('saveShopeeCategoryMapping')
      && hubAdmin.includes('เชื่อมร้าน Shopee')
      && hubAdmin.includes('ตั้ง Mapping สำหรับ Auto Publish')],
  ['Production deploy syncs Shopee secrets without echoing their values',
    deploy.includes('wrangler secret put SHOPEE_PARTNER_ID')
      && deploy.includes('wrangler secret put SHOPEE_PARTNER_KEY')
      && deploy.includes('secrets.SHOPEE_PARTNER_KEY')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`SHOPEE AUTO PUBLISH verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SHOPEE AUTO PUBLISH verification PASS — System authority, Vault secrets, mapping gate, queue, API runtime, and Hub controls are source-locked')
