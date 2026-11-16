import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { publicAvailability } from '../src/lib/stock-status.ts'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const unit = (status, availability, price = 8900) => ({ status, availability, price })

test('only published, genuinely available, positive-price stock is sellable', () => {
  assert.equal(publicAvailability(unit('published', 'available')), 'available')
  assert.equal(publicAvailability(unit('sold', 'available')), 'out_of_stock')
  assert.equal(publicAvailability(unit('published', 'out_of_stock')), 'out_of_stock')
  assert.equal(publicAvailability(unit('published', 'available', 0)), 'out_of_stock')
  assert.equal(publicAvailability(unit('published', 'available', NaN)), 'out_of_stock')
  assert.equal(publicAvailability(unit('reserved', 'available')), 'reserved')
  assert.equal(publicAvailability(unit('published', 'reserved')), 'reserved')
  assert.equal(publicAvailability(unit('sold', 'reserved')), 'out_of_stock')
})

test('merchant feed is live and refuses missing shipping amounts', async () => {
  const [feed, route] = await Promise.all([
    read('src/lib/google-merchant-feed.ts'),
    read('src/pages/google-merchant.xml.ts'),
  ])
  for (const needle of ['shipping.rate !== null', 'shipping.handlingMinDays !== null', 'shipping.handlingMaxDays !== null', 'shipping.transitMinDays !== null', 'shipping.transitMaxDays !== null', 'Number.isFinite(product.price)']) {
    assert.ok(feed.includes(needle), `missing guard: ${needle}`)
  }
  assert.ok(route.includes("'cache-control': 'no-store, max-age=0'"))
  assert.ok(feed.includes("product.status === 'published'"))
  assert.ok(feed.includes("product.availability === 'available'"))
})

test('search is noindex, responsive and only shows verified live stock', async () => {
  const [page, layout, css] = await Promise.all([
    read('src/pages/search/index.astro'), read('src/layouts/BaseLayout.astro'), read('src/styles/search-performance.css'),
  ])
  assert.ok(page.includes('robots="noindex,follow"'))
  assert.ok(page.includes("listStoreProducts({ q: query, availability: 'available'"))
  assert.ok(page.includes("item.status === 'published' && item.availability === 'available'"))
  assert.ok(layout.includes('action="/search/" method="get"'))
  assert.ok(css.includes('@media (max-width: 720px)'))
})

test('commerce events reflect actual item selection and purchase eligibility', async () => {
  const [card, product, cart, checkout, attribution, tracking] = await Promise.all([
    read('src/components/ProductCard.astro'), read('src/pages/p/[product].astro'), read('src/pages/cart/index.astro'),
    read('src/pages/checkout/index.astro'), read('src/lib/seo-attribution.ts'), read('src/lib/conversion-events.ts'),
  ])
  assert.ok(card.includes('data-shop-select'))
  assert.ok(product.includes("trackShopEvent('view_item'"))
  assert.ok(product.includes("trackShopEvent('add_to_cart'"))
  assert.ok(cart.includes("item.status === 'published'"))
  assert.ok(checkout.includes("item?.status === 'published'"))
  assert.ok(checkout.includes("trackShopEvent('begin_checkout'"))
  assert.ok(attribution.includes("trackShopEvent('line_click'"))
  assert.ok(tracking.includes('amphon-shop-conversion'))
  assert.ok(!tracking.includes("event: 'purchase'"), 'must not claim purchase without verified payment')
})

test('merchant trust and core SEO pages remain truthful', async () => {
  const [layout, about, home, category, guide, schema] = await Promise.all([
    read('src/layouts/BaseLayout.astro'), read('src/pages/about.astro'), read('src/pages/index.astro'),
    read('src/pages/[category]/index.astro'), read('src/config/category-inspection-notes.ts'),
    read('src/lib/merchant-schema.ts'),
  ])
  assert.ok(layout.includes('MERCHANT_CONTACT.legalName'))
  assert.ok(layout.includes('href="/returns/"'))
  assert.ok(layout.includes('href="/privacy/"'))
  assert.ok(about.includes('MERCHANT_CONTACT.streetAddress'))
  assert.ok(home.includes("addressCountry: MERCHANT_CONTACT.country"))
  assert.ok(category.includes('inspectionNotes.checks.map'))
  assert.ok(guide.includes('Activation Lock'))
  assert.ok(schema.includes('Number.isFinite(product.price)'))
})

console.log('SHOP QUALITY regression contracts passed')
