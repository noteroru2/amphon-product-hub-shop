import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [catalog, sitemapCategories, sitemapProducts, sitemapEvergreen, storeApi, baselineRaw] = await Promise.all([
  read('src/config/catalog.ts'),
  read('src/pages/sitemap-categories.xml.ts'),
  read('src/pages/sitemap-products.xml.ts'),
  read('src/pages/sitemap-evergreen.xml.ts'),
  read('src/lib/store-api.ts'),
  read('seo-observation/shop-seo41-baseline.json'),
])

const baseline = JSON.parse(baselineRaw)
const categoryMatches = [...catalog.matchAll(/key:\s*'([^']+)'[\s\S]*?indexPolicy:\s*'(INDEX|HOLD|NOINDEX|RETIRED)'/g)]
const categoryPolicies = new Map(categoryMatches.map((match) => [match[1], match[2]]))

const expectedIndex = [
  'notebooks',
  'desktop-pcs',
  'iphones',
  'smartphones',
  'tablets',
  'monitors',
  'cameras',
  'gaming-consoles',
]

const expectedHold = [
  'macbooks',
  'gaming-pcs',
  'camera-lenses',
  'graphics-cards',
  'pc-components',
  'accessories',
  'other-it',
]

const checks = [
  ['baseline phase is SHOP-SEO-4.1', baseline.phase === 'SHOP-SEO-4.1'],
  ['baseline capture date is immutable', baseline.captured_at === '2026-09-13'],
  ['baseline site is shop.amphon.co.th', baseline.site === 'https://shop.amphon.co.th'],
  ['baseline intended index surface is 11', baseline.index_surface?.total === 11],
  ['baseline evergreen index is zero', baseline.index_surface?.evergreen === 0],
  ['baseline records Shop GSC rows as not available yet', baseline.shop_performance?.status === 'NO_SEARCH_ANALYTICS_ROWS_YET'],
  ['baseline records Shop sitemap submission action', baseline.gsc_sitemaps?.action === 'SUBMIT_SHOP_SITEMAP_IN_GSC'],
  ['category sitemap is controlled by indexCategories', sitemapCategories.includes('indexCategories.map')],
  ['product sitemap excludes non-index policies', sitemapProducts.includes("['NOINDEX', 'HOLD', 'RETIRED']")],
  [
    'evergreen sitemap requires effective INDEX policy',
    sitemapEvergreen.includes('getAllIndexEvergreenPages') &&
      storeApi.includes('export async function getAllIndexEvergreenPages') &&
      storeApi.includes("listEvergreenPages({ effectiveIndexPolicy: 'INDEX'"),
  ],
]

for (const slug of expectedIndex) {
  checks.push([`${slug} remains INDEX during observation`, categoryPolicies.get(slug) === 'INDEX'])
}
for (const slug of expectedHold) {
  checks.push([`${slug} remains HOLD during observation`, categoryPolicies.get(slug) === 'HOLD'])
}

const baselineIndex = [...(baseline.index_categories || [])].sort().join('|')
const sourceIndex = [...expectedIndex].sort().join('|')
checks.push(['machine baseline INDEX categories match freeze contract', baselineIndex === sourceIndex])

const baselineHold = [...(baseline.hold_categories || [])].sort().join('|')
const sourceHold = [...expectedHold].sort().join('|')
checks.push(['machine baseline HOLD categories match freeze contract', baselineHold === sourceHold])

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failures.length) {
  console.error(`SHOP-SEO-4.1 observation freeze verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SHOP-SEO-4.1 verification PASS — GSC observation baseline and SEO freeze contract are intact')
