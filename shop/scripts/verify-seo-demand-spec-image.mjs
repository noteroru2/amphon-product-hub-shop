import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [migration, worker, storeApi, specLib, specRoute, specHub, specMap, imageMap, sitemapIndex, productPage, productTrust, home] = await Promise.all([
  read('../supabase/migrations/20260924145500_seo_demand_spec_governance.sql'),
  read('../workers/r2-upload/src/index.ts'),
  read('src/lib/store-api.ts'),
  read('src/lib/spec-seo.ts'),
  read('src/pages/specs/[dimension]/[token]/index.astro'),
  read('src/pages/specs/index.astro'),
  read('src/pages/sitemap-specs.xml.ts'),
  read('src/pages/sitemap-images.xml.ts'),
  read('src/pages/sitemap.xml.ts'),
  read('src/pages/p/[product].astro'),
  read('src/lib/product-trust.ts'),
  read('src/pages/index.astro'),
])

const checks = [
  ['GSC demand storage is RLS-protected', migration.includes('commerce_gsc_query_demand') && migration.includes('enable row level security')],
  ['stale GSC demand expires from governance', migration.includes("g.fetched_at >= now() - interval '3 days'")],
  ['GSC opportunity queue scores CTR/ranking gaps', migration.includes('commerce_gsc_opportunity_v') && migration.includes('CTR_OPPORTUNITY') && migration.includes('TOP10_PUSH') && migration.includes('PAGE1_RECOVERY')],
  ['spec candidates default HOLD', migration.includes("index_policy text not null default 'HOLD'") && migration.includes("effective_index_policy text not null default 'HOLD'")],
  ['GPU threshold requires stock history and brand diversity', migration.includes("dimension='GPU' and current_stock_count>=3 and historical_listing_count>=3 and distinct_brand_count>=2")],
  ['RAM and storage require real GSC demand', migration.includes("dimension='RAM'") && migration.includes('gsc_impressions_28d>=20') && migration.includes("dimension='STORAGE'")],
  ['spec governance runs every 15 minutes after existing SEO automation', migration.includes("'commerce-seo-governance-15m'") && migration.includes('refresh_commerce_spec_pages()')],
  ['Store API exposes list and resolve endpoints', worker.includes("/store/spec-pages/resolve") && worker.includes("/store/spec-pages") && storeApi.includes('resolveSpecPage') && storeApi.includes('getAllIndexSpecPages')],
  ['frontend token normalization mirrors DB categories', specLib.includes("kind === 'GPU'") && specLib.includes("kind === 'CPU'") && specLib.includes("kind === 'RAM'") && specLib.includes("kind === 'STORAGE'")],
  ['spec page is product-first and governance-aware', specRoute.indexOf('spec-stock-section') < specRoute.indexOf('spec-editorial-section') && specRoute.includes("page.effectiveIndexPolicy === 'INDEX'") && specRoute.includes('products.length >= 3')],
  ['spec hub links only governed INDEX pages', specHub.includes('getAllIndexSpecPages') && home.includes('indexSpecPages.length >= 3')],
  ['SKU pages link back to matching governed spec owners', productPage.includes('matchingSpecPages') && productPage.includes('matchesSpecPage')],
  ['spec sitemap contains only effective INDEX pages', specMap.includes('getAllIndexSpecPages')],
  ['image sitemap uses only current supported image tags', imageMap.includes('<image:loc>') && !imageMap.includes('<image:title>') && !imageMap.includes('<image:caption>')],
  ['image sitemap and spec sitemap are registered', sitemapIndex.includes('/sitemap-specs.xml') && sitemapIndex.includes('/sitemap-images.xml')],
  ['image SEO text is factual and SKU-specific', productTrust.includes('productImageSeoText') && productTrust.includes('product.conditionPercent') && productTrust.includes('product.defects')],
]

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failures.length) {
  console.error(`SEO DEMAND/SPEC/IMAGE verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SEO DEMAND/SPEC/IMAGE PASS — strict governance, clean routes, internal links and current image sitemap contract protected')
