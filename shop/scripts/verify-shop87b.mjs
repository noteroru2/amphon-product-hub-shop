import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [layout, home, mobileCss] = await Promise.all([
  read('src/layouts/BaseLayout.astro'),
  read('src/pages/index.astro'),
  read('src/styles/mobile-first.css'),
])

const checks = [
  ['mobile stylesheet imported', layout.includes("../styles/mobile-first.css")],
  ['skip link present', layout.includes('class="skip-link"') && layout.includes('id="main-content"')],
  ['orders link has mobile class', layout.includes('class="account-link orders-link"')],
  ['home trust strip present', home.includes('home-trust-strip') && home.includes('home-trust-grid')],
  ['mobile category nav scrolls', mobileCss.includes('.nav {') && mobileCss.includes('grid-column:1 / -1')],
  ['mobile gallery is swipeable', mobileCss.includes('scroll-snap-type:x mandatory') && mobileCss.includes('.gallery .product-photo')],
  ['mobile purchase actions are fixed', mobileCss.includes('.buy-panel .purchase-actions') && mobileCss.includes('position:fixed')],
  ['cart CTA remains visible', mobileCss.includes('.cart-panel > .button-primary') && mobileCss.includes('position:sticky')],
  ['checkout summary moves before form', mobileCss.includes('.checkout-summary { order:-1; }')],
  ['checkout submit remains visible', mobileCss.includes('#checkout-submit') && mobileCss.includes('position:sticky')],
  ['account uses card sections on mobile', mobileCss.includes('.account-section {') && mobileCss.includes('border-radius:16px')],
  ['touch targets are mobile sized', mobileCss.includes('.button { min-height:48px') && mobileCss.includes('min-height:50px')],
]

const failures = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
if (failures.length) {
  console.error(`SHOP mobile UX verification failed: ${failures.map(([label]) => label).join(', ')}`)
  process.exit(1)
}
console.log('SHOP mobile UX verification PASS')
