import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const entries = [
  ['layout', 'src/layouts/BaseLayout.astro'],
  ['home', 'src/pages/index.astro'],
  ['category', 'src/pages/[category]/index.astro'],
  ['evergreen', 'src/components/EvergreenPage.astro'],
  ['brand', 'src/pages/[category]/[brand]/index.astro'],
  ['series', 'src/pages/[category]/[brand]/[series]/index.astro'],
  ['model', 'src/pages/[category]/[brand]/[series]/[model]/index.astro'],
  ['product', 'src/pages/p/[product].astro'],
  ['legacyProduct', 'src/pages/product/[sku].astro'],
  ['cart', 'src/pages/cart/index.astro'],
  ['checkout', 'src/pages/checkout/index.astro'],
  ['account', 'src/pages/account/index.astro'],
  ['orders', 'src/pages/account/orders/index.astro'],
  ['login', 'src/pages/account/login.astro'],
  ['signup', 'src/pages/account/signup.astro'],
  ['forgot', 'src/pages/account/forgot-password.astro'],
  ['reset', 'src/pages/account/reset-password.astro'],
  ['verify', 'src/pages/account/verify.astro'],
  ['oauth', 'src/pages/account/oauth-callback.astro'],
  ['orderStatus', 'src/pages/order/[token]/index.astro'],
  ['document', 'src/pages/document/[token]/index.astro'],
  ['warranty', 'src/pages/warranty/[token]/index.astro'],
  ['notFound', 'src/pages/404.astro'],
]

const files = Object.fromEntries(await Promise.all(entries.map(async ([name, path]) => [name, await read(path)])))
const customerFacing = Object.entries(files)

const forbidden = [
  'AMPHON Product Hub',
  'SEO Release Gate',
  'EVERGREEN USED IT CATALOG',
  'ข้อมูลรุ่นแบบ Evergreen',
  'ถูก Publish',
  'แบบ atomic',
  'ระบบ Store API',
  'Store API unavailable',
  'ระบบ Order API',
  'Customer Profile',
  'snapshot จากระบบ',
  'SHOP-8.',
  'ล็อก SKU ในฐานข้อมูล',
  'Order จะถูกผูก',
  'Checkout แบบ Guest',
  'ประวัติ Order ของคุณ',
  'ORDER DETAIL',
  'MY ORDERS',
  'GOOGLE AUTH',
  'ไม่พบเซสชันหลังกลับจาก Google',
]

for (const [name, source] of customerFacing) {
  for (const phrase of forbidden) {
    if (source.includes(phrase)) {
      throw new Error(`CONTENT HYGIENE FAIL: ${name} contains customer-facing internal phrase: ${phrase}`)
    }
  }
}

const required = [
  ['home product intent', files.home.includes('สินค้าไอทีมือสองออนไลน์')],
  ['home human storefront copy', files.home.includes('เลือกของมือสองไม่ควรต้องเดา') && files.home.includes('กำลังหาอะไรอยู่?')],
  ['category human guidance', files.category.includes('เลือกของที่เหมาะกับคุณ') && files.category.includes('ก่อนซื้อ ลองดู 3 จุดนี้')],
  ['evergreen customer eyebrow', files.evergreen.includes('เลือกซื้อสินค้ามือสอง')],
  ['evergreen live-stock heading', files.evergreen.includes('สินค้าที่พร้อมจำหน่าย')],
  ['evergreen natural empty state', files.evergreen.includes('หน้านี้จะแสดงรายการเมื่อมีสินค้าเข้ามาใหม่')],
  ['product customer code label', files.product.includes('รหัสสินค้า:')],
  ['product human trust copy', files.product.includes('ของชิ้นนี้เป็นยังไงบ้าง') && files.product.includes('ร้านเช็กอะไรไว้บ้าง')],
  ['product quick navigation', files.product.includes('href="#condition"') && files.product.includes('href="#specs"') && files.product.includes('href="#shipping"')],
  ['product natural purchase microcopy', files.product.includes('ก่อนยืนยัน ร้านจะเช็กว่าสินค้ายังว่างให้อีกครั้ง')],
  ['legacy product friendly failure', files.legacyProduct.includes('ไม่สามารถโหลดข้อมูลสินค้าได้')],
  ['cart LINE-first CTA', files.cart.includes('ซื้อ / สอบถามผ่าน LINE') && files.cart.includes('ชำระผ่านเว็บ (บัตร / PromptPay)')],
  ['cart customer product code', files.cart.includes('รหัสสินค้า ${escapeHtml(item.sku)}')],
  ['checkout simple CTA', files.checkout.includes("submit.textContent = memberPolicyLoaded ? 'ยืนยันคำสั่งซื้อ'")],
  ['checkout member guidance', files.checkout.includes('เข้าสู่ระบบก่อนสั่งซื้อ')],
  ['account orders CTA', files.account.includes('ดูรายการสั่งซื้อ')],
  ['account current address guidance', files.account.includes('ระบบจะใช้ที่อยู่ที่คุณเลือกเมื่อสั่งซื้อสินค้าออนไลน์')],
  ['orders natural title', files.orders.includes('รายการสั่งซื้อของฉัน')],
  ['orders customer code label', files.orders.includes('รหัสสินค้า ${esc(item.sku)}')],
  ['orders tracking label', files.orders.includes('เลขติดตาม')],
  ['public order status heading', files.orderStatus.includes('สถานะคำสั่งซื้อ')],
  ['public order reservation copy', files.orderStatus.includes('สงวนสินค้าไว้ถึง')],
  ['document customer disclaimer', files.document.includes('ไม่ใช่ e-Tax Invoice/e-Receipt')],
  ['document customer code label', files.document.includes('รหัสสินค้า ${item.sku}')],
  ['warranty customer heading', files.warranty.includes('ใบรับประกันสินค้า')],
  ['warranty customer code label', files.warranty.includes('รหัสสินค้า {warranty.sku}')],
  ['forgot simple guidance', files.forgot.includes('ช่วยเหลือการเข้าสู่ระบบ')],
  ['reset simple guidance', files.reset.includes('ความปลอดภัยของบัญชี')],
  ['verify simple guidance', files.verify.includes('ยืนยันบัญชี')],
  ['oauth simple guidance', files.oauth.includes('เข้าสู่ระบบด้วย Google')],
  ['404 recovery guidance', files.notFound.includes('ลิงก์นี้อาจถูกย้าย')],
  ['login simple guidance', files.login.includes('ดูข้อมูลบัญชี ที่อยู่ และรายการสั่งซื้อ')],
  ['signup value guidance', files.signup.includes('บันทึกที่อยู่ สั่งซื้อสินค้า และติดตามรายการสั่งซื้อ')],
  ['global order nav', files.layout.includes('รายการสั่งซื้อ')],
]

for (const [label, ok] of required) {
  if (!ok) throw new Error(`CONTENT HYGIENE FAIL: ${label}`)
}

console.log(`SHOP CONTENT HYGIENE PASS — ${customerFacing.length} customer-facing sources checked`)
