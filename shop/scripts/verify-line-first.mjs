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

const checks = [
  ['LINE identity is @webuy', contact.includes("primaryLineId = '@webuy'") && contact.includes('line.me/R/ti/p/@webuy')],
  ['LINE CTA is globally visible in the header', layout.includes('header-line-link') && layout.includes('LINE {primaryLineId}')],
  ['LINE-first stylesheet is loaded after storefront styles', layout.indexOf("'../styles/line-first.css'") > layout.indexOf("'../styles/storefront-human.css'")],
  ['Product purchase UI promotes LINE first', layout.includes('line-primary-purchase') && layout.includes('ซื้อผ่าน LINE')],
  ['Existing product web-cart flow remains present', product.includes('id="add-to-cart"') && product.includes('href="/cart/"')],
  ['Web purchase CTA is explicitly demoted, not removed', layout.includes('web-purchase-secondary') && layout.includes('ใส่ตะกร้า (ชำระผ่านเว็บ)')],
  ['Homepage promotes LINE as the primary buying path', home.includes('ซื้อ / สอบถามผ่าน LINE') && home.includes('LINE เป็นช่องทางหลัก')],
  ['Cart promotes LINE before optional web checkout', cart.indexOf('button-line button-wide') < cart.indexOf('ชำระผ่านเว็บ (บัตร / PromptPay)')],
  ['PromptPay/card web checkout remains implemented', checkout.includes('promptPayEnabled') && checkout.includes('ชำระออนไลน์')],
  ['LINE primary visual treatment exists', styles.includes('--line-green: #06c755') && styles.includes('.button-line')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`SHOP LINE-first verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('SHOP LINE-FIRST: PASS — LINE @webuy is primary; web checkout remains a secondary option')
