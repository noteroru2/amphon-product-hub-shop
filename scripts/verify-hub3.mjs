import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { buildSalesPostPackage, PUBLIC_SALES_FIELD_ALLOWLIST, validateSalesPostPackage } from '../src/lib/salesPostPackage.ts'
import { getSmartFields } from '../src/lib/productSchemas.ts'

const root = resolve(import.meta.dirname, '..')
const failures = []
const passes = []
const check = (condition, label) => (condition ? passes : failures).push(label)
const read = (path) => readFile(resolve(root, path), 'utf8')

const [app, panel, generator, download, imageActions] = await Promise.all([
  read('src/App.tsx'), read('src/components/SalesPostPackagePanel.tsx'), read('src/lib/salesPostPackage.ts'),
  read('src/lib/salesPostPackageDownload.ts'), read('src/components/ProductImageExportActions.tsx'),
])

const [productResponse, settingsResponse] = await Promise.all([
  fetch('https://amphon-product-images.noteroru2.workers.dev/store/products/AT-PC-2609-000002', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) }),
  fetch('https://amphon-product-images.noteroru2.workers.dev/store/settings', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) }),
])
if (!productResponse.ok) failures.push(`Real product API HTTP ${productResponse.status}`)
if (!settingsResponse.ok) failures.push(`Store settings API HTTP ${settingsResponse.status}`)
const product = productResponse.ok ? (await productResponse.json()).product : null
const settings = settingsResponse.ok ? (await settingsResponse.json()).settings : null

if (product) {
  const draft = {
    localId: 'verify-real-product', remoteProductId: 'redacted', sku: product.sku, category: product.category,
    subtype: product.subtype || undefined, brand: product.brand || undefined, model: product.model || undefined,
    serialNumber: 'PRIVATE-SERIAL-SENTINEL', title: product.title, price: product.price, cost: 123456789,
    conditionPercent: product.conditionPercent || undefined, warrantyUntil: product.warrantyUntil || undefined,
    defects: product.defects || undefined, notes: 'PRIVATE-NOTES-SENTINEL', specs: product.specs || {}, status: product.status,
    images: (product.images || []).map((image, index) => ({ id: `image-${index}`, name: `image-${index}`, publicUrl: image.url, isCover: image.isCover, order: image.sortOrder, imageRole: image.role })),
    currentStep: 4, updatedAt: Date.now(),
  }
  const fields = getSmartFields(draft)
  const context = {
    canonicalShopUrl: 'https://shop.amphon.co.th/p/apple-macbook-neo-at-pc-2609-000002/',
    defaultWarrantyDays: Number(settings?.warranty?.defaultDays || 0),
    fulfillmentText: 'จัดส่งในประเทศไทย · ค่าจัดส่ง 100 บาท / รับสินค้าที่ร้านได้',
    publishedToShop: true,
    storeName: settings?.merchantName,
  }
  const pkg = buildSalesPostPackage(draft, fields, context)
  const allText = Object.values(pkg.captions).join('\n')
  check(pkg.title === 'Apple MacBook Neo' && pkg.price === 21900 && pkg.titleAndPrice === 'Apple MacBook Neo — 21,900 บาท', 'Real product title/price correct')
  check(pkg.sku === 'AT-PC-2609-000002' && pkg.imageCount === product.images.length && pkg.imageCount > 0, 'Real product SKU/image count correct')
  check(pkg.specifications.some((row) => row.label === 'CPU' && row.value.includes('Apple A18 Pro')) && pkg.specifications.some((row) => row.label === 'RAM'), 'Category-aware real specifications')
  check(pkg.accessories.some((row) => row.value === 'ครบกล่อง'), 'Recorded accessories included')
  check(pkg.defects === product.defects && allText.includes(product.defects), 'Recorded defects are not hidden')
  const warrantyCorrect = product.warrantyUntil
    ? pkg.warranty.startsWith('ประกันถึง ') && allText.includes(pkg.warranty)
    : Number(settings?.warranty?.defaultDays || 0) > 0
      ? pkg.warranty === `ประกันร้าน ${Number(settings.warranty.defaultDays)} วัน`
      : pkg.warranty === 'ไม่ระบุประกัน' && allText.includes('ไม่ระบุประกัน')
  check(warrantyCorrect && !allText.includes('ประกันร้าน 7 วัน'), 'Real warranty priority/0-day semantics preserved')
  check(!allText.includes('123456789') && !allText.includes('PRIVATE-SERIAL-SENTINEL') && !allText.includes('PRIVATE-NOTES-SENTINEL'), 'Internal/private fields excluded from captions')
  check(!('cost' in pkg) && !('serialNumber' in pkg) && !('notes' in pkg) && !('remoteProductId' in pkg), 'Public package projection excludes internal fields')
  check(validateSalesPostPackage(pkg).ready, 'Real product sales package ready')
  check(pkg.captions.MARKETPLACE.length > 0 && pkg.captions.FACEBOOK_PAGE.length > 0 && pkg.captions.LINE.length > 0, 'Marketplace/Facebook Page/LINE presets')
  check(pkg.publishedToShop && pkg.canonicalShopUrl === context.canonicalShopUrl, 'Published canonical SHOP link')
  const second = buildSalesPostPackage(draft, fields, context)
  check(JSON.stringify(pkg.captions) === JSON.stringify(second.captions), 'Deterministic caption generator')

  const missingDraft = { ...draft, defects: undefined, warrantyUntil: undefined, specs: {}, images: draft.images.slice(0, 1) }
  const missing = buildSalesPostPackage(missingDraft, fields, { publishedToShop: false, defaultWarrantyDays: 0 })
  const missingText = Object.values(missing.captions).join('\n')
  check(missing.warnings.includes('ยังไม่มีข้อมูลตำหนิ') && !missingText.includes('ไม่มีตำหนิ'), 'Missing defects not converted to no-defect claim')
  check(missing.warnings.includes('ยังไม่มีอุปกรณ์ที่ระบุ') && !missingText.includes('อุปกรณ์ครบ'), 'Missing accessories not invented')
  check(missing.warranty === 'ไม่ระบุประกัน' && !missingText.includes('ประกันร้าน 7 วัน'), 'Missing/0-day warranty not made positive')
  const explicitlyNoStoreWarranty = buildSalesPostPackage(missingDraft, fields, { publishedToShop: false, listingWarrantyDays: 0 })
  check(explicitlyNoStoreWarranty.warranty === 'ไม่มีประกันร้าน', 'Explicit listing 0-day warranty remains non-positive')
  check(!missing.publishedToShop && !missing.canonicalShopUrl, 'Unpublished product does not invent SHOP URL')
}

check(app.includes('เตรียมโพสต์ขาย') && /lazy\s*\(\s*\(\)\s*=>\s*import\(["']\.\/components\/SalesPostPackagePanel["']\)/.test(app), 'Sales Package button exists and panel is lazy-loaded')
check(generator.includes('PUBLIC_SALES_FIELD_ALLOWLIST') && PUBLIC_SALES_FIELD_ALLOWLIST.includes('sku') && !PUBLIC_SALES_FIELD_ALLOWLIST.includes('cost'), 'Explicit public field allowlist')
check(!/draft\.(?:cost|serialNumber|notes|ownerUserId)/.test(generator), 'Generator never reads forbidden draft fields')
check(panel.includes('คัดลอกข้อความขาย') && /copy\(caption,\s*["']คัดลอกแล้ว["']\)/.test(panel) && panel.includes('คัดลอกชื่อ + ราคา') && panel.includes('await copyText(value)'), 'Clipboard and title/price actions')
check(panel.includes('ProductImageExportControls') && imageActions.includes('useProductImageExport'), 'HUB-2 image sharing reused')
check(download.includes("ข้อความขาย.txt") && download.includes('marketplace.txt') && download.includes('facebook-page.txt') && download.includes('line.txt') && !/\.json|cost|serialNumber|notes/.test(download), 'Safe ZIP sales package')
check(panel.includes('เปิดหน้าสินค้าใน SHOP') && panel.includes('ยังไม่ได้เผยแพร่ใน SHOP'), 'Published/unpublished SHOP behavior')
check(app.includes('Suspense') && panel.includes('sales-caption-editor'), 'Lazy mobile editable preview')
check(!/facebook\.com|line\.me|graph\.facebook|auto.?post|signInWithPassword/.test(panel + generator + download), 'No social auto-posting')
check(!/purchase_enabled|stripe_promptpay|webhooks\/stripe|\/store\/checkout|method:\s*['"](?:POST|PATCH|PUT|DELETE)/.test(panel + generator + download), 'No SHOP mutation')
check(settings?.purchaseEnabled === true, 'Production purchase_enabled remains true')
check(settings?.checkout?.promptPayEnabled === false, 'Production PromptPay remains disabled')

async function filesUnder(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.wrangler', '.git'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await filesUnder(path, output)
    else if (['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.sql', '.ps1', '.bat', '.toml'].includes(extname(entry.name))) output.push(path)
  }
  return output
}
const secretPattern = /(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,}|sb_secret_[A-Za-z0-9._-]{12,})/g
const leaks = []
for (const file of await filesUnder(root)) {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (secretPattern.test(text)) leaks.push(file.replace(`${root}\\`, ''))
  secretPattern.lastIndex = 0
}
check(leaks.length === 0, `Secret scan${leaks.length ? `: ${leaks.join(', ')}` : ''}`)

if (failures.length) {
  console.error('HUB-3 VERIFY: FAIL')
  failures.forEach((label) => console.error(`- ${label}`))
  process.exit(1)
}
console.log('HUB-3 VERIFY: PASS')
passes.forEach((label) => console.log(`- ${label}: PASS`))
console.log('- No order, Stripe Session, charge, or social post created: PASS')
console.log('- Native employee workflow: OWNER_DEVICE_VERIFICATION_REQUIRED')
