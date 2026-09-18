import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const shopRoot = resolve(import.meta.dirname, '..')
const projectRoot = resolve(shopRoot, '..')
const required = [
  'src/lib/merchant-schema.ts',
  'src/lib/product-trust.ts',
  'src/pages/p/[product].astro',
  '../supabase/shop_3.sql',
  '../supabase/shop_3_verify.sql',
  '../docs/SHOP3_PRODUCT_DETAIL_PLAYBOOK.md',
]
const failures = []
for (const file of required) {
  try { await access(resolve(shopRoot, file)) } catch { failures.push(`missing: ${file}`) }
}

const sql = await readFile(resolve(projectRoot, 'supabase/shop_3.sql'), 'utf8')
const worker = await readFile(resolve(projectRoot, 'workers/r2-upload/src/index.ts'), 'utf8')
const api = await readFile(resolve(shopRoot, 'src/lib/store-api.ts'), 'utf8')
const merchant = await readFile(resolve(shopRoot, 'src/lib/merchant-schema.ts'), 'utf8')
const trust = await readFile(resolve(shopRoot, 'src/lib/product-trust.ts'), 'utf8')
const product = await readFile(resolve(shopRoot, 'src/pages/p/[product].astro'), 'utf8')
const layout = await readFile(resolve(shopRoot, 'src/layouts/BaseLayout.astro'), 'utf8')

const invariants = [
  [sql.includes('merchant_item_condition'), 'merchant item condition'],
  [sql.includes('create table if not exists public.commerce_store_settings'), 'store policy settings'],
  [sql.includes('purchase_enabled boolean not null default false'), 'purchase gate defaults closed'],
  [sql.includes('create or replace view public.commerce_merchant_readiness_v'), 'merchant readiness view'],
  [sql.includes("'PURCHASE_FLOW_DISABLED'"), 'purchase blocker audit'],
  [sql.includes('create or replace view public.commerce_public_store_settings_v'), 'safe settings view'],
  [sql.includes('revoke all on public.commerce_public_store_settings_v from anon'), 'anon settings revoke'],
  [worker.includes("'/store/settings'"), 'store settings endpoint'],
  [worker.includes('merchantItemCondition'), 'condition API mapping'],
  [/version:\s*(?:3|4|5|6|7|8|9|[1-9][0-9]+)/.test(worker), 'Store API v3+'],
  [api.includes('getStoreSettings'), 'storefront settings client'],
  [merchant.includes('https://schema.org/UsedCondition'), 'used condition schema'],
  [merchant.includes('https://schema.org/SoldOut'), 'sold-out schema'],
  [merchant.includes('settings?.purchaseEnabled && product.merchantEnabled'), 'merchant offer activation gate'],
  [merchant.includes("'@type': 'OnlineStore'"), 'online store schema'],
  [product.includes('id="condition"') && product.includes('ของชิ้นนี้เป็นยังไงบ้าง'), 'used-product trust section'],
  [product.includes('SHOP3_RELATED_PRODUCTS'), 'related stock recovery'],
  [product.includes('จุดที่ร้านระบุไว้'), 'defect disclosure'],
  [product.includes('จัดส่ง / คืนสินค้า'), 'shipping return disclosure'],
  [product.includes('data-product-gallery') && product.includes('data-gallery-main') && product.includes('gallery-thumbnails'), 'single-stage product gallery with thumbnails'],
  [product.includes('data-gallery-prev') && product.includes('data-gallery-next'), 'gallery previous/next controls'],
  [product.includes("addEventListener('touchstart'") && product.includes("addEventListener('touchend'") && product.includes('Math.abs(delta) < 45'), 'mobile swipe gallery interaction'],
  [layout.includes('ogImage'), 'product social image metadata'],
  [trust.includes('ACCESSORY_RE'), 'accessory grouping'],
  [trust.includes('CONDITION_RE'), 'condition grouping'],
]
for (const [ok, label] of invariants) if (!ok) failures.push(`invariant: ${label}`)

const publicView = sql.split('create or replace view public.commerce_public_listing_v')[1] || ''
for (const forbidden of ['product_financials', 'serial_number', 'cost numeric', 'target_margin_percent', 'supplier', 'employee', 'buyer_', 'seller_']) {
  if (publicView.toLowerCase().includes(forbidden.toLowerCase())) failures.push(`public listing view contains forbidden token: ${forbidden}`)
}

if (merchant.includes('offers: offer') && !merchant.includes('product.merchantEnabled')) {
  failures.push('Offer schema is not gated by merchant opt-in')
}

if (failures.length) {
  console.error('SHOP-3 VERIFY: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('SHOP-3 VERIFY: PASS')
console.log(`Required files: ${required.length}/${required.length}`)
console.log('Merchant activation gate: PASS')
console.log('Used product trust UX: PASS')
console.log('Shipping/return no-fabrication guardrail: PASS')
console.log('Private-field public projection audit: PASS')
