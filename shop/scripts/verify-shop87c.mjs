import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const paths = {
  evergreen: 'src/components/EvergreenPage.astro',
  brand: 'src/pages/[category]/[brand]/index.astro',
  series: 'src/pages/[category]/[brand]/[series]/index.astro',
  model: 'src/pages/[category]/[brand]/[series]/[model]/index.astro',
  home: 'src/pages/index.astro',
  category: 'src/pages/[category]/index.astro',
  product: 'src/pages/p/[product].astro',
  cart: 'src/pages/cart/index.astro',
  checkout: 'src/pages/checkout/index.astro',
  account: 'src/pages/account/index.astro',
  orders: 'src/pages/account/orders/index.astro',
  order: 'src/pages/order/[token]/index.astro',
  document: 'src/pages/document/[token]/index.astro',
  warranty: 'src/pages/warranty/[token]/index.astro',
  forgot: 'src/pages/account/forgot-password.astro',
  reset: 'src/pages/account/reset-password.astro',
  verify: 'src/pages/account/verify.astro',
  oauth: 'src/pages/account/oauth-callback.astro',
  notFound: 'src/pages/404.astro',
  evergreenSitemap: 'src/pages/sitemap-evergreen.xml.ts',
}
const files = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await read(path)])))

const checks = [
  ['evergreen index policy is conditional', files.evergreen.includes("page.effectiveIndexPolicy === 'INDEX'") && files.evergreen.includes("'noindex,follow'")],
  ['evergreen canonical is preserved', files.evergreen.includes('canonicalPath={page.canonicalPath}')],
  ['evergreen collection schema exists', files.evergreen.includes("'@type': 'CollectionPage'")],
  ['evergreen breadcrumb schema exists', files.evergreen.includes("'@type': 'BreadcrumbList'")],
  ['evergreen item list uses product URLs', files.evergreen.includes("'@type': 'ItemList'") && files.evergreen.includes('productPath(product)')],
  ['brand fallback is customer friendly and noindex', files.brand.includes('BaseLayout') && files.brand.includes('robots="noindex,follow"') && files.brand.includes('ไม่พบหน้าสินค้าที่ต้องการ')],
  ['series fallback is customer friendly and noindex', files.series.includes('BaseLayout') && files.series.includes('robots="noindex,follow"') && files.series.includes('ไม่พบหน้าสินค้าที่ต้องการ')],
  ['model fallback is customer friendly and noindex', files.model.includes('BaseLayout') && files.model.includes('robots="noindex,follow"') && files.model.includes('ไม่พบหน้าสินค้าที่ต้องการ')],
  ['evergreen sitemap uses index-only source', files.evergreenSitemap.includes('getAllIndexEvergreenPages')],
  ['home remains indexable by default', !files.home.includes('robots="noindex')],
  ['category keeps explicit index policy', files.category.includes("'index,follow,max-image-preview:large'") && files.category.includes("'noindex,follow'")],
  ['product keeps explicit index policy', files.product.includes("'index,follow,max-image-preview:large'") && files.product.includes("'noindex,follow'")],
  ['cart remains noindex', files.cart.includes('robots="noindex,follow"')],
  ['checkout remains noindex', files.checkout.includes('robots="noindex,nofollow"')],
  ['account remains noindex', files.account.includes('robots="noindex,nofollow"')],
  ['member orders remain noindex', files.orders.includes('robots="noindex,nofollow"')],
  ['public order status remains noindex and private-cache', files.order.includes('robots="noindex,nofollow"') && files.order.includes("'Cache-Control', 'no-store'")],
  ['document remains noindex and private-cache', files.document.includes('robots="noindex,nofollow"') && files.document.includes("'Cache-Control', 'no-store'")],
  ['warranty remains noindex and private-cache', files.warranty.includes('robots="noindex,nofollow"') && files.warranty.includes("'Cache-Control', 'no-store'")],
  ['password recovery pages remain noindex', files.forgot.includes('robots="noindex,nofollow"') && files.reset.includes('robots="noindex,nofollow"')],
  ['verification callbacks remain noindex', files.verify.includes('robots="noindex,nofollow"') && files.oauth.includes('robots="noindex,nofollow"')],
  ['404 remains noindex follow', files.notFound.includes('robots="noindex,follow"')],
]

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failures.length) {
  console.error(`SHOP-8.7C SEO UX verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}
console.log('SHOP-8.7C SEO UX verification PASS')
