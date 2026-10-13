import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'

const cache = new Map()
async function loadTs(path) {
  if (cache.has(path)) return cache.get(path)
  let js = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll('import.meta.env.PUBLIC_SITE_URL', "'https://shop.amphon.co.th'")
  const imports = [...js.matchAll(/from ['"]([^'"]+)['"]/g)]
  for (const match of imports) {
    const dependency = await loadTs(new URL(`${match[1]}.ts`, path))
    js = js.replace(match[0], `from '${dependency}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  cache.set(path, url)
  return url
}
const load = async path => import(await loadTs(new URL(path, import.meta.url)))
const seo = await load('../shop/src/lib/seo.ts')
const merchant = await load('../shop/src/lib/merchant-schema.ts')
const { catalogCategories } = await load('../shop/src/config/catalog.ts')
const { effectiveCategoryIndexPolicy, categoryStockStateFromProducts } = await load('../shop/src/config/category-governance.ts')
const { categorySeoContent } = await load('../shop/src/config/category-seo-content.ts')
const { categorySearchIntent } = await load('../shop/src/config/search-intent-content.ts')
const product = { sku: 'AT-NB-2609-000045', title: 'Dell Latitude 7440', price: 14900, listingSlug: 'dell-latitude-7440', status: 'published', availability: 'available', categorySlug: 'notebooks', images: [], merchantEnabled: true }
const schema = (p, settings = null) => merchant.buildProductMerchantSchema({ product: p, settings, canonicalPath: seo.productPath(p), description: seo.productDescription(p), specs: [] })

test('sold listing preserves its URL and last price while declaring an unavailable offer after Merchant eligibility is revoked', () => {
  const sold = { ...product, status: 'sold', availability: 'out_of_stock', merchantEnabled: false }
  assert.equal(seo.productPath(sold), seo.productPath(product))
  assert.equal(seo.extractSkuFromProductSegment(seo.productSegment(sold)), sold.sku)
  const output = schema(sold)
  assert.equal(output.offers.price, 14900)
  assert.equal(output.offers.priceCurrency, 'THB')
  assert.equal(output.offers.availability, 'https://schema.org/SoldOut')
  assert.match(output.description, /^สินค้าหมด/)
  assert.match(seo.productDescription({ ...sold, seoDescription: 'รายละเอียดเครื่องจริง' }), /^สินค้าหมด/)
})

test('available and reserved offers retain the existing merchant eligibility gate', () => {
  assert.equal(schema(product).offers, undefined)
  const enabled = { purchaseEnabled: true, returns: { enabled: false }, shipping: { enabled: false } }
  assert.equal(schema(product, enabled).offers.availability, 'https://schema.org/InStock')
  assert.equal(schema({ ...product, availability: 'reserved' }, enabled).offers.availability, 'https://schema.org/OutOfStock')
  assert.equal(schema({ ...product, merchantEnabled: false }, enabled).offers, undefined)
})

test('all categories have individual buying guidance and FAQs; zero stock never forces an empty category into Google', () => {
  for (const category of catalogCategories) {
    assert.ok(categorySeoContent[category.key]?.buyingPoints.length >= 3, category.key)
    assert.ok(categorySearchIntent[category.key]?.faqs.length >= 2, category.key)
    assert.equal(effectiveCategoryIndexPolicy(category, { currentStockCount: 0, historicalStockCount: 0 }), 'HOLD')
    const threshold = category.minHistoricalStockForIndex || 1
    assert.equal(effectiveCategoryIndexPolicy(category, { currentStockCount: 0, historicalStockCount: threshold }), 'INDEX')
  }
})

test('sold products contribute historical evidence without increasing live stock', () => {
  const state = categoryStockStateFromProducts('notebooks', [product, { ...product, status: 'sold' }, { ...product, categorySlug: 'cameras' }])
  assert.deepEqual(state, { currentStockCount: 1, historicalStockCount: 2 })
})

test('Hub reads grouped inventory with quantities and paginates after grouping', async () => {
  const calls = []
  const first = Array.from({length: 500}, (_, i) => ({id: `live-${i}`,sku: `LIVE-${i}`,status: 'draft',one_managed: true,one_intake_group_id: `lot-${i}`,quantity_remaining: 3,quantity_total: 5,product_images: []}))
  const db = { async rpc(name, args) {
    assert.equal(name, 'hub_list_inventory')
    calls.push(args)
    return {data: args.p_offset === 0 ? first : [{id: 'last',sku: 'LAST',status: 'published',product_images: []}],error: null}
  }}
  let js = ts.transpileModule(await readFile(new URL('../src/lib/backend.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    .replace(/^import .*$/gm, '').replace(/^export /gm, '').replaceAll('import.meta.env', '{}')
  const listProducts = new Function('supabase', 'validateReadyToList', 'errorMessage', `${js}\nreturn listProducts`)(db, () => [], String)
  const products = await listProducts('sales')
  assert.equal(products.length, 501)
  assert.equal(products[0].quantityRemaining, 3)
  assert.equal(products[0].quantityTotal, 5)
  assert.equal(products[500].sku, 'LAST')
  assert.deepEqual(calls.map(x => x.p_offset), [0, 500])
})

test('Shop all-stock requests preserve availability=all for sold URLs and category history, including pagination', async () => {
  let js = ts.transpileModule(await readFile(new URL('../shop/src/lib/store-api.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    .replace(/^import .*$/gm, '').replace(/^export /gm, '').replaceAll('import.meta.env', "({PUBLIC_AMPHON_STORE_API: 'https://store.test/store'})")
  const requested = []
  const fetch = async url => {
    const parsed = new URL(url)
    requested.push(parsed)
    assert.equal(parsed.searchParams.get('availability'), 'all')
    const page = parsed.searchParams.get('offset') === '100'
      ? { products: [{ sku: 'SOLD', status: 'sold' }], pagination: { hasMore: false } }
      : { products: [{ sku: 'LIVE', status: 'published' }], pagination: { hasMore: true } }
    return { ok: true, json: async () => page }
  }
  const { getAllStoreProducts, listStoreProducts } = new Function('fetch', `${js}\nreturn { getAllStoreProducts, listStoreProducts }`)(fetch)
  const products = await getAllStoreProducts()
  assert.deepEqual(products.map(p => p.sku), ['LIVE', 'SOLD'])
  await listStoreProducts({ availability: 'all', categorySlug: 'notebooks', limit: 1 })
  assert.equal(requested[2].searchParams.get('categorySlug'), 'notebooks')
})

test('general PC collection includes gaming PCs so คอมมือสอง remains a stock-backed indexable category', () => {
  const state = categoryStockStateFromProducts('desktop-pcs', [
    { ...product, categorySlug: 'gaming-pcs' },
    { ...product, categorySlug: 'gaming-pcs', status: 'sold' },
    { ...product, categorySlug: 'notebooks' },
  ])
  assert.deepEqual(state, { currentStockCount: 1, historicalStockCount: 2 })
  const category = catalogCategories.find(c => c.slug === 'desktop-pcs')
  assert.equal(effectiveCategoryIndexPolicy(category, state), 'INDEX')
})

