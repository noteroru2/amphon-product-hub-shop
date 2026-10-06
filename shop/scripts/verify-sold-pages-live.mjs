import assert from 'node:assert/strict'
const site = process.env.PUBLIC_SITE_URL || 'https://shop.amphon.co.th'
const api = process.env.PUBLIC_AMPHON_STORE_API || 'https://amphon-product-images.noteroru2.workers.dev/store'
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) })
  assert.equal(response.status, 200, url)
  return response
}
const { products } = await (await get(`${api}/products?availability=out_of_stock&limit=100`)).json()
assert.ok(products.length, 'Need a real sold listing to verify page retention')
const sitemap = await (await get(`${site}/sitemap-products.xml`)).text()
const sampled = products.filter(p => p.indexPolicy === 'INDEX').slice(0, 3)
assert.ok(sampled.length, 'Need an indexable sold listing')
for (const product of sampled) {
  const slug = product.listingSlug?.trim() || product.title.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').toLowerCase() || 'item'
  const path = `/p/${slug}-${product.sku.toLowerCase()}/`
  const response = await get(`${site}${path}`)
  assert.equal(new URL(response.url).pathname, path, 'Sold URL must remain its canonical page')
  const html = await response.text()
  assert.match(html, /สินค้าหมด/)
  assert.ok(!/name="robots"[^>]*content="noindex/.test(html), 'Sold page stays indexable')
  assert.ok(!/id="add-to-cart"/.test(html), 'Sold page has no cart action')
  assert.ok(!/สั่งซื้อผ่าน LINE/.test(html), 'Sold page cannot invite buying the sold item')
  const schemas = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]))
  const schema = schemas.flat().find(s => s['@type'] === 'Product')
  assert.ok(schema?.offers, 'Sold page retains unavailable Offer even with merchantEnabled=false')
  assert.equal(schema.offers.availability, 'https://schema.org/SoldOut')
  assert.equal(Number(schema.offers.price), product.price)
  assert.ok(sitemap.includes(`${site}${path}`), 'Sold URL is still in sitemap')
  if (product.categorySlug) {
    const category = await (await get(`${site}/${product.categorySlug}/`)).text()
    assert.match(category, /sold-product-archive/)
  }
  console.log(`PASS retained sold page ${product.sku}: HTTP 200, index, sitemap, unavailable Offer, no purchase action`)
}
