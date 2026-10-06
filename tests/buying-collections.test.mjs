import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'

async function load(path) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replaceAll('import.meta.env.PUBLIC_SITE_URL', "'https://shop.amphon.co.th'")
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { buyingCollections } = await load('../shop/src/config/buying-guides.ts')
const { matchesBuyingCollection, collectionStock } = await load('../shop/src/lib/buying-collections.ts')
const { formatThaiDate } = await load('../shop/src/lib/seo.ts')
const laptopBudget = buyingCollections.find(c => c.slug === 'notebooks-under-10000')
const study = buyingCollections.find(c => c.slug === 'notebooks-for-study')
const pcBudget = buyingCollections.find(c => c.slug === 'pcs-under-10000')
const p = { categorySlug: 'notebooks', price: 10000, status: 'published', availability: 'available', specs: { ram: '8GB DDR4', ssd: '256GB' } }

test('inspection dates in Buddhist and Gregorian ISO years render the same Thai date; invalid dates stay unknown', () => {
  assert.equal(formatThaiDate('2569-09-30'), formatThaiDate('2026-09-30'))
  assert.match(formatThaiDate('2569-09-30'), /2569/)
  assert.equal(formatThaiDate('2026-02-30'), null)
  assert.equal(formatThaiDate('not-a-date'), null)
  assert.equal(formatThaiDate(null), null)
})

test('budget pages use the inclusive ceiling, reject unknown/invalid prices and do not mix product categories', () => {
  assert.equal(matchesBuyingCollection(p, laptopBudget), true)
  for (const price of [10001, 0, -1, NaN]) assert.equal(matchesBuyingCollection({ ...p, price }, laptopBudget), false)
  assert.equal(matchesBuyingCollection({ ...p, categorySlug: 'tablets' }, laptopBudget), false)
  assert.equal(matchesBuyingCollection({ ...p, categorySlug: 'gaming-laptops' }, laptopBudget), true)
  assert.equal(matchesBuyingCollection({ ...p, categorySlug: 'gaming-pcs' }, pcBudget), true)
})

test('study selection requires actual RAM and SSD fields, without inferring specifications from the title', () => {
  assert.equal(matchesBuyingCollection(p, study), true)
  for (const specs of [{}, { ram: '4GB', ssd: '256GB' }, { ram: '8GB' }, { ram: '8GB', ssd: 'ไม่มี SSD' }, { ram: '8GB', ssd: 'HDD 1TB' }]) {
    assert.equal(matchesBuyingCollection({ ...p, title: 'RAM 16GB SSD 512GB', specs }, study), false)
  }
  assert.equal(matchesBuyingCollection({ ...p, specs: { ram: 16, storage: '512GB', storage_type: 'NVMe SSD' } }, study), true)
  assert.equal(matchesBuyingCollection({ ...p, specs: { ram: 'Kingston HyperX 8GB DDR4 Bus 3200', ssd: '240GB' } }, study), true)
  assert.equal(matchesBuyingCollection({ ...p, specs: { ram: 'DDR4 Bus 3200', ssd: '240GB' } }, study), false)
})

test('reserved and sold pieces never become purchasable stock; sold history preserves collection eligibility', () => {
  const reserved = { ...p, status: 'reserved', availability: 'reserved' }
  const sold = { ...p, status: 'sold', availability: 'out_of_stock' }
  const stock = collectionStock([p, reserved, sold], laptopBudget)
  assert.deepEqual(stock.current, [p])
  assert.deepEqual(stock.sold, [sold])
  assert.equal(stock.indexable, true)
  assert.equal(collectionStock([sold, { ...sold }, { ...sold }], laptopBudget).indexable, true)
  assert.equal(collectionStock([p], laptopBudget).indexable, false)
})
