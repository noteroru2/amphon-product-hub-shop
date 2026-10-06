import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { buyingCollections, buyingGuides, guidePath } = await load('../src/config/buying-guides.ts')
const { collectionStock } = await load('../src/lib/buying-collections.ts')
const site = process.env.PUBLIC_SITE_URL || 'https://shop.amphon.co.th'
const api = process.env.PUBLIC_AMPHON_STORE_API || 'https://amphon-product-images.noteroru2.workers.dev/store'
async function get(path) {
  const response = await fetch(new URL(path, site), { signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200, path)
  return response.text()
}
function schemas(html) {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).flat()
}
function canonical(html, path) {
  assert.ok(html.includes(`rel="canonical" href="${site}${path}"`), `${path}: canonical`)
}
const products = []
for (let offset = 0; ; offset += 100) {
  const response = await fetch(`${api}/products?availability=all&limit=100&offset=${offset}`, { signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200)
  const data = await response.json()
  products.push(...data.products)
  if (!data.pagination.hasMore) break
}
const [staticMap, collectionMap, home, guides] = await Promise.all(['/sitemap-static.xml', '/sitemap-collections.xml', '/', '/guides/'].map(get))
assert.ok(home.includes('href="/guides/'))
assert.ok(guides.includes('คู่มือเลือกซื้อสินค้าไอทีมือสอง'))
for (const guide of buyingGuides) {
  const path = guidePath(guide.slug)
  const html = await get(path)
  canonical(html, path)
  assert.ok(html.includes(guide.answer), `${path}: visible answer`)
  assert.ok(staticMap.includes(`${site}${path}`), `${path}: sitemap`)
  assert.ok(!/name="robots"[^>]*content="noindex/.test(html))
  const article = schemas(html).find(s => s['@type'] === 'Article')
  assert.equal(article?.headline, guide.title)
  assert.equal(article?.author?.name, 'AMPHON TRADING')
  const faq = schemas(html).find(s => s['@type'] === 'FAQPage')
  assert.equal(faq?.mainEntity.length, guide.faqs.length)
  for (const item of faq.mainEntity) assert.ok(html.includes(item.acceptedAnswer.text), 'FAQ agrees with visible answer')
  console.log(`PASS guide: ${path}`)
}
for (const collection of buyingCollections) {
  const path = `/collections/${collection.slug}/`
  const stock = collectionStock(products, collection)
  const html = await get(path)
  canonical(html, path)
  assert.equal(!/name="robots"[^>]*content="noindex/.test(html), stock.indexable, `${path}: indexing gate`)
  assert.equal(collectionMap.includes(`${site}${path}`), stock.indexable, `${path}: sitemap gate`)
  const schema = schemas(html).find(s => s['@type'] === 'CollectionPage')
  assert.equal(schema?.mainEntity?.itemListElement.length, Math.min(stock.current.length, 48), `${path}: actual purchasable stock`)
  if (stock.sold.length) assert.ok(html.includes('รายการเดิม — สินค้าหมด'))
  console.log(`PASS collection: ${path} (${stock.current.length} current, ${stock.history.length} history, index=${stock.indexable})`)
}
console.log('BUYING PAGES LIVE PASS — visible answers, schema, actual stock and sitemap governance')
