import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const projectRoot = resolve(root, '..')

const required = [
  'astro.config.mjs',
  'wrangler.jsonc',
  'src/pages/index.astro',
  'src/pages/[category]/index.astro',
  'src/pages/p/[product].astro',
  'src/pages/product/[sku].astro',
  'src/pages/robots.txt.ts',
  'src/pages/sitemap.xml.ts',
  'src/pages/sitemap-categories.xml.ts',
  'src/pages/sitemap-products.xml.ts',
  '../supabase/shop_1.sql',
  '../supabase/shop_1_verify.sql',
]

const failures = []
for (const file of required) {
  try { await access(resolve(root, file)) } catch { failures.push(`missing: ${file}`) }
}

const sql = await readFile(resolve(projectRoot, 'supabase/shop_1.sql'), 'utf8')
const worker = await readFile(resolve(projectRoot, 'workers/r2-upload/src/index.ts'), 'utf8')
const productPage = await readFile(resolve(root, 'src/pages/p/[product].astro'), 'utf8')
const legacyPage = await readFile(resolve(root, 'src/pages/product/[sku].astro'), 'utf8')

const invariants = [
  [sql.includes('create table if not exists public.commerce_categories'), 'commerce_categories table'],
  [sql.includes('create table if not exists public.commerce_listings'), 'commerce_listings table'],
  [sql.includes('with (security_invoker = true)'), 'security_invoker view'],
  [sql.includes('revoke all on public.commerce_public_listing_v from anon'), 'anon view revoke'],
  [sql.includes("or (pp.status = 'ended' and p.status = 'sold')"), 'sold page retention'],
  [worker.includes('serviceRestWithCount'), 'paginated Store API'],
  [worker.includes("availability: row.status === 'sold' ? 'out_of_stock'"), 'sold availability mapping'],
  [productPage.includes("/p/" ) || productPage.includes('productPath'), 'canonical product route'],
  [legacyPage.includes('Astro.redirect(productPath(product), 301)'), 'legacy 301 bridge'],
]

for (const [ok, label] of invariants) if (!ok) failures.push(`invariant: ${label}`)

const publicView = sql.split('create or replace view public.commerce_public_listing_v')[1]?.split('-- ------------------------------------------------------------\n-- CATEGORY SEED')[0] || ''
for (const forbidden of ['gross_profit', 'net_profit', 'serial_number', 'buyer_', 'seller_', 'employee']) {
  if (publicView.toLowerCase().includes(forbidden)) failures.push(`public view contains forbidden token: ${forbidden}`)
}

if (failures.length) {
  console.error('SHOP-1 FOUNDATION VERIFY: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('SHOP-1 FOUNDATION VERIFY: PASS')
console.log(`Required files: ${required.length}/${required.length}`)
console.log('Security/public projection invariants: PASS')
console.log('Sold-page retention invariant: PASS')
console.log('Canonical + legacy redirect invariant: PASS')
