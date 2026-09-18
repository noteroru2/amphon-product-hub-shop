import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

const [contact, layout, home, cart, product, checkout, styles] = await Promise.all([
  read('src/lib/contact.ts'),
  read('src/layouts/BaseLayout.astro'),
  read('src/pages/index.astro'),
  read('src/pages/cart/index.astro'),
  read('src/pages/p/[product].astro'),
  read('src/pages/checkout/index.astro'),
  read('src/styles/line-first.css'),
])

const cartActionBlock = cart.split('<div class="cart-channel-actions">')[1] || ''

const checks = [
  ['LINE identity is @webuy', contact.includes("primaryLineId = '@webuy'") && contact.includes('line.me/R/ti/p/@webuy')],
  ['Official trust links are configured', contact.includes('facebook.com/amphontrading') && contact.includes('https://amphon.co.th/')],
  ['LINE CTA is globally visible in the header', layout.includes('header-line-link') && layout.includes('สั่งซื้อผ่าน LINE {primaryLineId}')],
  ['Footer keeps brand links secondary to LINE', layout.includes('เว็บไซต์หลัก AMPHON TRADING') && layout.includes('Facebook อำพล เทรดดิ้ง')],
  ['LINE-first stylesheet is loaded after storefront styles', layout.indexOf("'../styles/line-first.css'") > layout.indexOf("'../styles/storefront-human.css'")],
  ['Product purchase markup promotes LINE first without JS reordering', product.includes('line-primary-purchase') && product.includes('สั่งซื้อผ่าน LINE {lineId}') && product.indexOf('line-primary-purchase') < product.indexOf('id="add-to-cart"')],
  ['Existing product web-cart flow remains present', product.includes('id="add-to-cart"') && product.includes('href="/cart/"')],
  ['Web purchase CTA is explicitly demoted, not removed', product.includes('web-purchase-secondary') && product.includes('ใส่ตะกร้า (ชำระผ่านเว็บ)') && product.includes('ไปตะกร้า / ชำระผ่านเว็บ')],
  ['Homepage promotes LINE as the primary buying path', home.includes('สั่งซื้อผ่าน LINE {primaryLineId}') && home.includes('LINE เป็นช่องทางหลัก')],
  ['Homepage shows available products before category browsing', home.includes("availability: 'available'") && home.includes('limit: 16') && home.indexOf('id="latest-products"') < home.indexOf('id="shop-categories"')],
  ['Homepage connects official brand profiles in schema', home.includes('sameAs: [mainWebsiteUrl, facebookPageUrl]')],
  ['Cart renders LINE before optional web checkout', cartActionBlock.includes('สั่งซื้อผ่าน LINE ${escapeHtml(lineId)}') && cartActionBlock.indexOf('button-line button-wide') < cartActionBlock.indexOf('${webCheckout}')],
  ['PromptPay/card web checkout remains implemented', checkout.includes('promptPayEnabled') && checkout.includes('ชำระออนไลน์')],
  ['LINE primary visual treatment exists', styles.includes('--line-green: #06c755') && styles.includes('.button-line')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`SHOP LINE-first verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SHOP LINE-FIRST: PASS — LINE @webuy is primary; Facebook/main website are secondary trust links; web checkout remains available')
