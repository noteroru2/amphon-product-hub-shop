import { readFile } from 'node:fs/promises'

const files = {
  layout: await readFile(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8'),
  home: await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8'),
  category: await readFile(new URL('../src/pages/[category]/index.astro', import.meta.url), 'utf8'),
  product: await readFile(new URL('../src/pages/p/[product].astro', import.meta.url), 'utf8'),
  cart: await readFile(new URL('../src/pages/cart/index.astro', import.meta.url), 'utf8'),
  checkout: await readFile(new URL('../src/pages/checkout/index.astro', import.meta.url), 'utf8'),
  account: await readFile(new URL('../src/pages/account/index.astro', import.meta.url), 'utf8'),
  login: await readFile(new URL('../src/pages/account/login.astro', import.meta.url), 'utf8'),
  signup: await readFile(new URL('../src/pages/account/signup.astro', import.meta.url), 'utf8'),
}

const customerFacing = Object.entries(files)

const forbidden = [
  'AMPHON Product Hub',
  'SEO Release Gate',
  'แบบ atomic',
  'ระบบ Store API',
  'Customer Profile',
  'snapshot จาก',
  'SHOP-8.',
  'ล็อก SKU ในฐานข้อมูล',
  'Order จะถูกผูก',
  'Checkout แบบ Guest',
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
  ['category customer copy', files.category.includes('เลือกดูสินค้าจากรายการที่ร้านเปิดขาย')],
  ['product customer code label', files.product.includes('รหัสสินค้า:')],
  ['product trust copy', files.product.includes('สภาพและข้อมูลของสินค้าชิ้นนี้')],
  ['cart customer CTA', files.cart.includes('ดำเนินการสั่งซื้อ')],
  ['checkout simple CTA', files.checkout.includes("submit.textContent = memberPolicyLoaded ? 'ยืนยันคำสั่งซื้อ'")],
  ['checkout member guidance', files.checkout.includes('เข้าสู่ระบบก่อนสั่งซื้อ')],
  ['account orders CTA', files.account.includes('ดูรายการสั่งซื้อ')],
  ['account current address guidance', files.account.includes('ระบบจะใช้ที่อยู่ที่คุณเลือกเมื่อสั่งซื้อสินค้าออนไลน์')],
  ['login simple guidance', files.login.includes('ดูข้อมูลบัญชี ที่อยู่ และรายการสั่งซื้อ')],
  ['signup value guidance', files.signup.includes('บันทึกที่อยู่ สั่งซื้อสินค้า และติดตามรายการสั่งซื้อ')],
  ['global order nav', files.layout.includes('รายการสั่งซื้อ')],
]

for (const [label, ok] of required) {
  if (!ok) throw new Error(`CONTENT HYGIENE FAIL: ${label}`)
}

console.log('SHOP CONTENT HYGIENE PASS — customer copy is clean and member guidance is current')
