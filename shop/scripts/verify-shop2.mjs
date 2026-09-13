import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const shopRoot = resolve(import.meta.dirname, '..')
const projectRoot = resolve(shopRoot, '..')
const required = [
  'src/components/EvergreenPage.astro',
  'src/pages/[category]/[brand]/index.astro',
  'src/pages/[category]/[brand]/[series]/index.astro',
  'src/pages/[category]/[brand]/[series]/[model]/index.astro',
  'src/pages/sitemap-evergreen.xml.ts',
  '../supabase/shop_2.sql',
  '../supabase/shop_2_verify.sql',
  '../docs/SHOP2_TAXONOMY_PLAYBOOK.md',
]
const failures = []
for (const file of required) {
  try { await access(resolve(shopRoot, file)) } catch { failures.push(`missing: ${file}`) }
}

const sql = await readFile(resolve(projectRoot, 'supabase/shop_2.sql'), 'utf8')
const worker = await readFile(resolve(projectRoot, 'workers/r2-upload/src/index.ts'), 'utf8')
const storeApi = await readFile(resolve(shopRoot, 'src/lib/store-api.ts'), 'utf8')
const categoryPage = await readFile(resolve(shopRoot, 'src/pages/[category]/index.astro'), 'utf8')
const productPage = await readFile(resolve(shopRoot, 'src/pages/p/[product].astro'), 'utf8')
const evergreen = await readFile(resolve(shopRoot, 'src/components/EvergreenPage.astro'), 'utf8')
const sitemap = await readFile(resolve(shopRoot, 'src/pages/sitemap.xml.ts'), 'utf8')

const invariants = [
  [sql.includes('create table if not exists public.commerce_brand_pages'), 'category-specific brand pages'],
  [sql.includes('create table if not exists public.commerce_brand_aliases'), 'brand aliases'],
  [sql.includes('create table if not exists public.commerce_model_aliases'), 'model aliases'],
  [sql.includes('create or replace view public.commerce_evergreen_page_v'), 'evergreen server view'],
  [sql.includes("effective_index_policy"), 'effective index gate'],
  [sql.includes("and r.category_index_policy = 'INDEX'"), 'category parent index gate'],
  [sql.includes("coalesce(char_length(trim(r.editorial_content)), 0) >= 400"), 'empty-stock editorial gate'],
  [sql.includes('public.refresh_commerce_taxonomy_mappings()'), 'admin remap RPC'],
  [sql.includes('create or replace view public.commerce_taxonomy_candidates_v'), 'taxonomy candidate audit'],
  [sql.includes('SHOP-2 appended columns'), 'public view append-only compatibility'],
  [worker.includes("'/store/seo-pages/resolve'"), 'SEO resolve endpoint'],
  [worker.includes("'/store/seo-pages'"), 'SEO list endpoint'],
  [worker.includes('categorySlug?: string'), 'catalog product filtering'],
  [storeApi.includes('resolveEvergreenPage'), 'storefront SEO resolver'],
  [categoryPage.includes("pageType: 'BRAND'"), 'category -> brand discovery'],
  [productPage.includes('SHOP2_PRODUCT_EVERGREEN_TRAIL'), 'SKU -> evergreen trail'],
  [evergreen.includes("'@type': 'CollectionPage'"), 'collection schema'],
  [!evergreen.includes("'@type': 'Product'"), 'no Product schema on listing hubs'],
  [sitemap.includes('/sitemap-evergreen.xml'), 'evergreen sitemap registered'],
]
for (const [ok, label] of invariants) if (!ok) failures.push(`invariant: ${label}`)

const evergreenView = sql.split('create or replace view public.commerce_evergreen_page_v')[1]?.split('-- ------------------------------------------------------------\n-- STAFF CANDIDATE VIEW')[0] || ''
if (!evergreenView.includes("when r.page_type = 'MODEL'")) failures.push('model hierarchy release gate missing')
if (!evergreenView.includes("parent.page_type = 'SERIES'")) failures.push('model parent series gate missing')
if (!evergreenView.includes("parent.page_type = 'BRAND'")) failures.push('parent brand gate missing')

for (const forbidden of ['product_financials', 'serial_number', 'cost numeric', 'target_margin_percent']) {
  if (evergreenView.toLowerCase().includes(forbidden.toLowerCase())) failures.push(`evergreen view contains forbidden token: ${forbidden}`)
}

if (failures.length) {
  console.error('SHOP-2 VERIFY: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('SHOP-2 VERIFY: PASS')
console.log(`Required files: ${required.length}/${required.length}`)
console.log('Brand -> Series -> Model hierarchy: PASS')
console.log('SEO Release Gate: PASS')
console.log('Public discovery / sitemap constraints: PASS')
console.log('No Product schema on evergreen hubs: PASS')
