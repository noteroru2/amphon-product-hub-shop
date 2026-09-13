import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const shopRoot = resolve(import.meta.dirname, '..')
const root = resolve(shopRoot, '..')
const required = [
  '../src/lib/commerce.ts','../src/components/CommerceAdmin.tsx','../src/components/PublishCenter.tsx',
  '../supabase/shop_4.sql','../supabase/shop_4_verify.sql','../docs/SHOP4_COMMERCE_ADMIN_PLAYBOOK.md','src/lib/merchant-schema.ts',
]
const failures = []
for (const file of required) { try { await access(resolve(shopRoot,file)) } catch { failures.push(`missing: ${file}`) } }
const sql = await readFile(resolve(root,'supabase/shop_4.sql'),'utf8')
const worker = await readFile(resolve(root,'workers/r2-upload/src/index.ts'),'utf8')
const admin = await readFile(resolve(root,'src/components/CommerceAdmin.tsx'),'utf8')
const publish = await readFile(resolve(root,'src/components/PublishCenter.tsx'),'utf8')
const commerce = await readFile(resolve(root,'src/lib/commerce.ts'),'utf8')
const merchant = await readFile(resolve(shopRoot,'src/lib/merchant-schema.ts'),'utf8')
const productTypes = await readFile(resolve(root,'src/types/product.ts'),'utf8')
let shop5 = ''
try { shop5 = await readFile(resolve(root,'supabase/shop_5.sql'),'utf8') } catch {}
const hasShop5 = shop5.includes('SHOP-5 Cart + Atomic Reservation')
const invariants = [
  [sql.includes("where merchant_item_condition = 'DAMAGED'"),'legacy DAMAGED migration'],
  [sql.includes("check (merchant_item_condition in ('NEW','USED','REFURBISHED'))"),'merchant condition constraint'],
  [sql.includes('commerce_store_settings_shop4_purchase_lock'),'historical SHOP-4 purchase lock'],
  [sql.includes('commerce_store_settings_shipping_completeness_check'),'shipping completeness DB guard'],
  [sql.includes('commerce_store_settings_return_completeness_check'),'return policy completeness DB guard'],
  [sql.includes('create or replace function public.prepare_commerce_listing'),'pre-publish prepare RPC'],
  [sql.includes('validate_commerce_listing_hierarchy'),'taxonomy hierarchy DB trigger'],
  [sql.includes('sync_website_publication_canonical_url'),'canonical publication URL sync'],
  [worker.includes("'/commerce/settings'"),'commerce settings API'], [worker.includes("'/commerce/catalog'"),'commerce catalog API'],
  [worker.includes("['NEW', 'USED', 'REFURBISHED'].includes(value)"),'condition API allowlist'],
  [worker.includes('validGtinChecksum'),'GTIN checksum validation'],
  [hasShop5 ? shop5.includes('drop constraint if exists commerce_store_settings_shop4_purchase_lock') : worker.includes('purchase_enabled: false'),'purchase activation transition'],
  [/shopVersion:\s*(?:4|5|6|7|8|9|[1-9][0-9]+)/.test(worker),'Store API v4+ health marker'],
  [commerce.includes('prepareCommerceProduct'),'app prepare client'],[admin.includes('ProductCommerceEditor'),'per-SKU commerce editor'],
  [admin.includes('MerchantSettingsModal'),'merchant configuration UI'],[publish.includes('prepareCommerceProduct(product.id)'),'website publish prepares canonical listing'],
  [/export type MerchantItemCondition = ["']NEW["'] \| ["']USED["'] \| ["']REFURBISHED["']/.test(productTypes),'app condition allowlist'],
  [merchant.includes('merchantReturnLink'),'return policy link support'],[merchant.includes('settings?.purchaseEnabled && product.merchantEnabled'),'Offer purchase gate'],
]
for (const [ok,label] of invariants) if (!ok) failures.push(`invariant: ${label}`)
for (const [name,text] of [['worker',worker],['admin',admin],['types',productTypes],['merchant-schema',merchant]]) if (/['"]DAMAGED['"]/.test(text)) failures.push(`${name}: DAMAGED active Merchant condition`)
if (failures.length) { console.error('SHOP-4 VERIFY: FAIL'); failures.forEach(x=>console.error(`- ${x}`)); process.exit(1) }
console.log('SHOP-4 VERIFY: PASS')
console.log(`Purchase activation state: ${hasShop5 ? 'UPGRADED_BY_SHOP5' : 'LOCKED_BY_SHOP4'}`)
console.log('Merchant/taxonomy/canonical regression: PASS')
