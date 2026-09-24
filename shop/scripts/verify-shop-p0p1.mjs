import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

const required = [
  'src/pages/new-arrivals/index.astro',
  'src/pages/about.astro',
  'src/pages/how-to-buy.astro',
  'src/pages/shipping.astro',
  'src/pages/warranty.astro',
  'src/pages/returns.astro',
  'src/pages/sitemap-static.xml.ts',
  'src/pages/google-merchant.xml.ts',
]

const failures = []
for (const path of required) {
  try { await access(resolve(root, path)) } catch { failures.push(`missing: ${path}`) }
}

const [layout, product, home, card, sitemap, merchantRoute, merchantFeed, arrivals] = await Promise.all([
  read('src/layouts/BaseLayout.astro'),
  read('src/pages/p/[product].astro'),
  read('src/pages/index.astro'),
  read('src/components/ProductCard.astro'),
  read('src/pages/sitemap.xml.ts'),
  read('src/pages/google-merchant.xml.ts'),
  read('src/lib/google-merchant-feed.ts'),
  read('src/pages/new-arrivals/index.astro'),
])

const checks = [
  ['Open Graph uses secure product image metadata', layout.includes('og:image:secure_url') && layout.includes('og:image:width') && layout.includes('og:image:height') && layout.includes('og:image:alt')],
  ['Product social title contains live price', product.includes('const socialTitle = product ?') && product.includes('formatPrice(product.price)')],
  ['Legacy SEO title gets current price when missing', product.includes('storedSeoTitleHasPrice') && product.includes('ราคา ${formatPrice(product.price)} | AMPHON TRADING')],
  ['Product image dimensions flow to Open Graph', product.includes('primaryImageWidth') && product.includes('primaryImageHeight') && product.includes('ogImageWidth={primaryImageWidth}')],
  ['Homepage links into new-arrivals crawl surface', home.includes('href="/new-arrivals/"') && home.includes('ดูสินค้าเข้าใหม่ทั้งหมด')],
  ['Homepage surfaces store trust pages', home.includes('href="/about/"') && home.includes('href="/shipping/"') && home.includes('href="/warranty/"')],
  ['Global navigation links new arrivals and policies', layout.includes('href="/new-arrivals/"') && layout.includes('href="/how-to-buy/"') && layout.includes('href="/returns/"')],
  ['Product cards show real-image count and SKU', card.includes('รูปจริง {product.images.length} รูป') && card.includes('รหัสสินค้า {product.sku}')],
  ['Static trust sitemap is part of sitemap index', sitemap.includes("absoluteUrl('/sitemap-static.xml')")],
  ['Merchant feed exports only available INDEX merchant products', merchantFeed.includes("product.availability === 'available'") && merchantFeed.includes("product.indexPolicy === 'INDEX'") && merchantFeed.includes('product.merchantEnabled === true') && merchantFeed.includes('<g:image_link>') && merchantRoute.includes('buildGoogleMerchantFeed')],
  ['New arrivals is indexable collection with ItemList', arrivals.includes("'@type': 'CollectionPage'") && arrivals.includes("'@type': 'ItemList'") && arrivals.includes("availability: 'available'")],
]

for (const [label, ok] of checks) if (!ok) failures.push(`invariant: ${label}`)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failures.length) {
  console.error('SHOP P0/P1 verification failed')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('SHOP P0/P1 verification PASS — social metadata, trust UX, crawl surface, sitemap, and Merchant feed are source-locked')
