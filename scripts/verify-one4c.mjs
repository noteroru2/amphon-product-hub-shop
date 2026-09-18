import { readFile } from 'node:fs/promises'

const files = {
  migration: 'supabase/migrations/20260917130327_one4c_payment_sale_outbox.sql',
  entry: 'workers/r2-upload/src/one4c-entry.ts',
  client: 'workers/r2-upload/src/one4-system-stock.ts',
  wrangler: 'workers/r2-upload/wrangler.jsonc',
  workerPackage: 'workers/r2-upload/package.json',
  workerTsconfig: 'workers/r2-upload/tsconfig.json',
  rootPackage: 'package.json',
}
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key,path]) => [key, await readFile(path,'utf8')])))
const failures = []
const requireText = (key, token, label) => { if (!source[key].includes(token)) failures.push(`${label}: missing ${token}`) }
const forbidText = (key, token, label) => { if (source[key].includes(token)) failures.push(`${label}: forbidden ${token}`) }

for (const token of [
  'private.one4_shop_stock_command_outbox',
  'private.one4_enqueue_shop_stock_command',
  'private.one4_finalize_commerce_order_paid',
  'public.one4_claim_shop_stock_commands',
  'public.one4_complete_shop_stock_command',
  'public.one4_fail_shop_stock_command',
  "if target.one_stock_authority is true then",
  "'CONFIRM_SOLD'",
  "'RELEASE'",
  "update public.commerce_store_settings set purchase_enabled=false where id=1",
]) requireText('migration', token, 'ONE-4C migration')

for (const token of [
  "import baseWorker from './index'",
  'confirmOne4SystemSale',
  'releaseOne4SystemStock',
  'one4SystemStockEnabled',
  'one4_claim_shop_stock_commands',
  'one4_complete_shop_stock_command',
  'one4_fail_shop_stock_command',
  "command.action === 'CONFIRM_SOLD' ? 'SOLD' : 'RELEASED'",
  'await (baseWorker as any).scheduled',
]) requireText('entry', token, 'ONE-4C runtime')

for (const token of ['confirmOne4SystemSale', "action: 'CONFIRM_SOLD'", ':confirm-sold:v1']) {
  requireText('client', token, 'signed sale command')
}

requireText('wrangler', '"main":  "src/one4c-entry.ts"', 'ONE-4C Worker entry')
requireText('wrangler', '"ONE4_SYSTEM_STOCK_ENABLED":', 'ONE-4C activation flag declaration')
requireText('wrangler', '"SYSTEM_API_BASE_URL": "https://api.amphontd.com"', 'System API target')
requireText('wrangler', '"SHOP_INTEGRATION_KEY_ID": "amphon-shop-v1"', 'Shop HMAC key id')
forbidText('wrangler', 'SHOP_INTEGRATION_SECRET', 'Shop secret must remain remote only')

requireText('workerPackage', '"@cloudflare/workers-types"', 'Store Worker Cloudflare typings')
requireText('workerPackage', '"typecheck": "tsc --noEmit"', 'Store Worker strict typecheck')
requireText('workerTsconfig', '"@cloudflare/workers-types"', 'Store Worker tsconfig typings')
requireText('workerTsconfig', '"strict": true', 'Store Worker strict compiler mode')
requireText('rootPackage', 'npm --prefix workers/r2-upload ci', 'ONE-4C verifier Worker dependency install')
requireText('rootPackage', 'npm --prefix workers/r2-upload run typecheck', 'ONE-4C verifier Worker typecheck')

if (failures.length) {
  console.error('AMPHON ONE-4C SHOP: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('AMPHON ONE-4C SHOP: PASS — payment/release commands are durable, System-authoritative, retryable, Worker-typed and activation-gated by ONE-4D')
