import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [
  catalog,
  categoryContent,
  home,
  categoryPage,
  productPage,
  evergreenPage,
  sitemapCategories,
  sitemapProducts,
  sitemapEvergreen,
  storeApi,
] = await Promise.all([
  read('src/config/catalog.ts'),
  read('src/config/category-seo-content.ts'),
  read('src/pages/index.astro'),
  read('src/pages/[category]/index.astro'),
  read('src/pages/p/[product].astro'),
  read('src/components/EvergreenPage.astro'),
  read('src/pages/sitemap-categories.xml.ts'),
  read('src/pages/sitemap-products.xml.ts'),
  read('src/pages/sitemap-evergreen.xml.ts'),
  read('src/lib/store-api.ts'),
])

const strategicIndexSlugs = [
  'notebooks',
  'macbooks',
  'gaming-laptops',
  'gaming-pcs',
  'iphones',
  'tablets',
  'cameras',
]
const stockGatedSlugs = [
  'desktop-pcs',
  'smartphones',
  'monitors',
  'gaming-consoles',
]
const gatedSlugs = [
  'camera-lenses',
  'graphics-cards',
  'pc-components',
  'accessories',
  'other-it',
]

const checks = [
  ['homepage derives governed categories from real stock', home.includes('homeCategories') && home.includes('categoryIsEffectivelyIndexable') && home.includes('getAllStoreProducts')],
  ['category listing uses canonical taxonomy ownership', categoryPage.includes('categorySlug: category.slug')],
  ['category listing no longer queries source category directly', !categoryPage.includes('category: category.sourceCategory')],
  ['category commercial content is rendered', categoryPage.includes('category-commercial-content') && categoryPage.includes('seoContent.buyingPoints')],
  ['category has CollectionPage schema', categoryPage.includes("'@type': 'CollectionPage'")],
  ['category has ItemList schema for current products', categoryPage.includes("'@type': 'ItemList'") && categoryPage.includes('productPath(product)')],
  ['category keeps BreadcrumbList schema', categoryPage.includes("'@type': 'BreadcrumbList'")],
  ['category page uses effective stock-aware index policy', categoryPage.includes('effectiveCategoryIndexPolicy') && categoryPage.includes('historicalStockCount') && categoryPage.includes("'noindex,follow'")],
  ['category sitemap uses stock-aware governance', sitemapCategories.includes('categoryIsEffectivelyIndexable') && sitemapCategories.includes('getAllStoreProducts')],
  ['product sitemap excludes non-index policies', sitemapProducts.includes("['NOINDEX', 'HOLD', 'RETIRED']")],
  [
    'evergreen sitemap contains only effective INDEX',
    sitemapEvergreen.includes('getAllIndexEvergreenPages') &&
      storeApi.includes('export async function getAllIndexEvergreenPages') &&
      storeApi.includes("listEvergreenPages({ effectiveIndexPolicy: 'INDEX'"),
  ],
  ['product page respects listing index policy', productPage.includes("product.indexPolicy !== 'NOINDEX'") && productPage.includes("product.indexPolicy !== 'HOLD'") && productPage.includes("product.indexPolicy !== 'RETIRED'")],
  ['evergreen page respects effective index policy', evergreenPage.includes("page.effectiveIndexPolicy === 'INDEX'")],
]

for (const slug of strategicIndexSlugs) {
  checks.push([
    `strategic category ${slug} remains INDEX`,
    new RegExp(`key: '${slug}'[\\s\\S]{0,650}?indexPolicy: 'INDEX'`).test(catalog),
  ])
  checks.push([
    `strategic category ${slug} has commercial content`,
    new RegExp(`(?:^|\\n)  ['\"]?${slug}['\"]?: \\{[\\s\\S]{0,1800}?primaryKeyword:`).test(categoryContent),
  ])
}

for (const slug of stockGatedSlugs) {
  checks.push([
    `empty strategic category ${slug} is HOLD with auto-index governance`,
    new RegExp(`key: '${slug}'[\\s\\S]{0,700}?indexPolicy: 'HOLD'[\\s\\S]{0,220}?autoIndexWhenStocked: true`).test(catalog),
  ])
  checks.push([
    `stock-gated category ${slug} keeps commercial content`,
    new RegExp(`(?:^|\\n)  ['"]?${slug}['"]?: \\{[\\s\\S]{0,1800}?primaryKeyword:`).test(categoryContent),
  ])
}

for (const slug of gatedSlugs) {
  checks.push([
    `secondary category ${slug} remains gated`,
    new RegExp(`key: '${slug}'[\\s\\S]{0,650}?indexPolicy: 'HOLD'`).test(catalog),
  ])
}

const keywordMatches = [...categoryContent.matchAll(/primaryKeyword:\s*'([^']+)'/g)].map((match) => match[1].trim().toLowerCase())
checks.push(['11 strategic category keyword owners defined', keywordMatches.length === strategicIndexSlugs.length + stockGatedSlugs.length])
checks.push(['strategic category keyword owners are unique', new Set(keywordMatches).size === keywordMatches.length])

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failures.length) {
  console.error(`SHOP-SEO-4 verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SHOP-SEO-4 PASS — canonical taxonomy ownership, index governance, sitemap policy, and commercial content are protected')
