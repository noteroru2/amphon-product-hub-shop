import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [modelRoute, evergreenView, sitemap, migration] = await Promise.all([
  read('src/pages/[category]/[brand]/[series]/[model]/index.astro'),
  read('src/components/EvergreenPage.astro'),
  read('src/pages/sitemap-evergreen.xml.ts'),
  read('../supabase/migrations/20260924044732_shop_model_longtail_automation.sql'),
])

const checks = [
  ['model route resolves exact evergreen model pages', modelRoute.includes('resolveEvergreenPage') && modelRoute.includes('model: modelSlug')],
  ['model route filters products by category/brand/series/model', modelRoute.includes('listStoreProducts({ categorySlug, brandSlug, seriesSlug, modelSlug')],
  ['model pages respect effective INDEX policy', evergreenView.includes("page.effectiveIndexPolicy === 'INDEX'") && evergreenView.includes("'noindex,follow'")],
  ['evergreen sitemap is restricted to effective INDEX pages', sitemap.includes('getAllIndexEvergreenPages')],
  ['automation only creates models under mapped Series', migration.includes('cl.series_id is not null') && migration.includes('join public.commerce_series s on s.id = cl.series_id')],
  ['new model candidates start HOLD', migration.includes("'HOLD',") && migration.includes('index_policy')],
  ['manual model SEO is preserved on conflicts', migration.includes('on conflict (category_id, brand_id, slug) do nothing')],
  ['automation remaps listings after model creation', migration.includes('perform private.sync_commerce_listing_taxonomy(item.product_id)')],
  ['automation runs before governance every 15 minutes', migration.includes("'*/15 * * * *'") && migration.includes('sync_commerce_model_longtails(); select private.apply_commerce_seo_governance()')],
  ['F15 code variant is consolidated into the F15 model', migration.includes("model = 'TUF Gaming F15'") && migration.includes("AT-NB-2609-000044")],
]

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failures.length) {
  console.error(`MODEL LONGTAIL verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('MODEL LONGTAIL PASS — stock-backed model candidates, noindex gating, sitemap policy and 15-minute automation are protected')
