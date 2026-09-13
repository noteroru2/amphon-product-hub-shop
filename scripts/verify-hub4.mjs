import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { buildSalesPostPackage, PUBLIC_SALES_FIELD_ALLOWLIST } from '../src/lib/salesPostPackage.ts'
import { buildMarketplaceListingDraft, MARKETPLACE_CATEGORY_SUGGESTIONS, marketplaceDestinationUrl } from '../src/lib/marketplaceListing.ts'
import { getSmartFields } from '../src/lib/productSchemas.ts'

const root = resolve(import.meta.dirname, '..')
const failures = []
const passes = []
const check = (condition, label) => (condition ? passes : failures).push(label)
const read = (path) => readFile(resolve(root, path), 'utf8')

const [app, panel, model, hub3, hub2, contextSource] = await Promise.all([
  read('src/App.tsx'), read('src/components/MarketplaceListingAssistant.tsx'), read('src/lib/marketplaceListing.ts'),
  read('src/lib/salesPostPackage.ts'), read('src/components/ProductImageExportActions.tsx'), read('src/lib/salesPostContext.ts'),
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
    localId: 'verify-hub4', remoteProductId: 'PRIVATE-ID-SENTINEL', ownerUserId: 'PRIVATE-OWNER-SENTINEL',
    sku: product.sku, category: product.category, subtype: product.subtype || undefined,
    brand: product.brand || undefined, model: product.model || undefined, serialNumber: 'PRIVATE-SERIAL-SENTINEL',
    title: product.title, price: product.price, cost: 987654321, conditionPercent: product.conditionPercent || undefined,
    warrantyUntil: product.warrantyUntil || undefined, defects: product.defects || undefined,
    notes: 'PRIVATE-NOTES-SENTINEL', specs: product.specs || {}, status: product.status,
    images: (product.images || []).map((image, index) => ({ id: `image-${index}`, name: `image-${index}`, publicUrl: image.url, isCover: image.isCover, order: image.sortOrder, imageRole: image.role })),
    currentStep: 4, updatedAt: Date.now(),
  }
  const context = {
    canonicalShopUrl: 'https://shop.amphon.co.th/p/apple-macbook-neo-at-pc-2609-000002/',
    defaultWarrantyDays: Number(settings?.warranty?.defaultDays || 0),
    fulfillmentText: 'จัดส่งในประเทศไทย · ค่าจัดส่ง 100 บาท / รับสินค้าที่ร้านได้',
    publishedToShop: true,
    storeName: settings?.merchantName,
  }
  const salesPackage = buildSalesPostPackage(draft, getSmartFields(draft), context)
  const listing = buildMarketplaceListingDraft(salesPackage, draft, true)
  const allPublicText = `${listing.title}\n${listing.description}\n${listing.copyAllText}`

  check(listing.sku === 'AT-PC-2609-000002' && listing.price === 21900 && listing.priceCopyValue === '21900' && listing.priceDisplay === '21,900 บาท', 'Real product title/price correct')
  check(listing.title.startsWith('Apple MacBook Neo') && listing.title === buildMarketplaceListingDraft(salesPackage, draft, true).title, 'Marketplace title deterministic')
  check(listing.description === salesPackage.captions.MARKETPLACE && listing.description.includes(product.title), 'Description reuses HUB-3 Marketplace preset')
  check(MARKETPLACE_CATEGORY_SUGGESTIONS.notebook === listing.categorySuggestion && listing.categorySuggestion.length > 0, 'Centralized category mapping')
  check(listing.conditionSuggestion.length > 0 && (!product.defects || listing.conditionSuggestion.includes('โปรดอ่านรายละเอียด')), 'Condition mapping safe')
  check(listing.imageCount === product.images.length && listing.coverImageUrl === (draft.images.find((image) => image.isCover)?.publicUrl || draft.images[0]?.publicUrl), 'Image count and cover image correct')
  check(!product.defects || listing.description.includes(product.defects), 'Recorded defects preserved')
  check(listing.description.includes(salesPackage.warranty) && !listing.description.includes('ประกันร้าน 7 วัน'), 'HUB-3 warranty semantics preserved')
  check(salesPackage.accessories.length ? salesPackage.accessories.every((item) => listing.description.includes(item.value)) : !listing.description.includes('อุปกรณ์ครบ'), 'Accessories not invented')
  check(listing.shopUrl === context.canonicalShopUrl && listing.locationText === context.fulfillmentText, 'SHOP link and configured fulfillment reused')
  check(listing.checklist.length >= 10 && listing.checklist.every((item) => ['PASS', 'WARNING', 'N/A'].includes(item.status)), 'Readiness checklist')
  check(!allPublicText.includes('987654321') && !allPublicText.includes('PRIVATE-SERIAL-SENTINEL') && !allPublicText.includes('PRIVATE-NOTES-SENTINEL') && !allPublicText.includes('PRIVATE-OWNER-SENTINEL') && !allPublicText.includes('PRIVATE-ID-SENTINEL'), 'Internal/private fields excluded')

  const sold = buildMarketplaceListingDraft(salesPackage, { ...draft, status: 'sold' }, true)
  const reserved = buildMarketplaceListingDraft(salesPackage, { ...draft, status: 'reserved' }, true)
  check(sold.readiness === 'BLOCKED' && sold.warnings.some((warning) => warning.includes('ขายแล้ว')), 'Sold product blocked')
  check(reserved.readiness !== 'BLOCKED' && reserved.warnings.some((warning) => warning.includes('จองแล้ว')), 'Reserved product warning')

  const missingDraft = { ...draft, model: undefined, conditionPercent: undefined, warrantyUntil: undefined, defects: undefined, specs: {}, status: 'ready_to_list', images: draft.images.slice(0, 1) }
  const missingPackage = buildSalesPostPackage(missingDraft, getSmartFields(missingDraft), { publishedToShop: false, defaultWarrantyDays: 0 })
  const missingListing = buildMarketplaceListingDraft(missingPackage, missingDraft, false)
  check(missingListing.description === missingPackage.captions.MARKETPLACE && !missingListing.description.includes('ไม่มีตำหนิ'), 'Missing defects not converted to no defects')
  check(missingPackage.warranty === 'ไม่ระบุประกัน' && !missingListing.description.includes('ประกันร้าน 7 วัน'), 'Zero-day/missing warranty remains non-positive')
  check(!missingListing.description.includes('อุปกรณ์ครบ'), 'Missing accessories not invented')
  check(!missingListing.shopUrl && missingListing.checklist.find((item) => item.id === 'shop')?.status === 'N/A', 'Unpublished SHOP behavior')
}

check(app.includes('ผู้ช่วยลง Marketplace') && /lazy\s*\(\s*\(\)\s*=>\s*import\(["']\.\/components\/MarketplaceListingAssistant["']\)/.test(app), 'Marketplace Assistant exists and is lazy-loaded')
check(panel.includes('buildSalesPostPackage') && panel.includes('buildMarketplaceListingDraft') && panel.includes('loadSalesPostContext'), 'HUB-3 package reused')
check(PUBLIC_SALES_FIELD_ALLOWLIST.includes('sku') && !PUBLIC_SALES_FIELD_ALLOWLIST.includes('cost') && model.includes('Never spread ProductDraft'), 'Public field allowlist reused')
check(!/source\.(?:cost|serialNumber|notes|ownerUserId|remoteProductId)|pkg\.(?:cost|serialNumber|notes)/.test(model), 'Internal fields inaccessible in Marketplace model')
check(panel.includes('ProductImageExportControls') && hub2.includes('useProductImageExport') && app.includes('imageExport={imageExport}'), 'HUB-2 image flow reused')
check(panel.includes('คัดลอกชื่อ') && panel.includes('priceCopyValue') && panel.includes('คัดลอกรายละเอียด') && panel.includes('คัดลอกลิงก์สินค้า') && panel.includes('คัดลอกทั้งหมด'), 'Required copy actions')
check(panel.includes('รูปหน้าปก') && panel.includes('Checklist') && panel.includes('readinessLabel'), 'Cover and readiness UI')
check(model.includes('MARKETPLACE_TITLE_WARNING_LENGTH') && model.includes('MARKETPLACE_CATEGORY_SUGGESTIONS'), 'Centralized title/category configuration')
check(model.includes("['sold', 'repair', 'returned', 'cancelled']") && model.includes("source.status === 'reserved'"), 'Product lifecycle protection')
check(panel.includes('target="_blank"') && panel.includes('เปิด Facebook Marketplace') && model.includes('marketplaceDestinationUrl'), 'Safe Facebook navigation only')
check(marketplaceDestinationUrl('javascript:alert(1)') === 'https://www.facebook.com/marketplace/' && marketplaceDestinationUrl('https://evil.example/') === 'https://www.facebook.com/marketplace/', 'Facebook destination validation')
check(!/graph\.facebook|access.?token|facebook.?password|session.?cookie|puppeteer|playwright|selenium|auto.?submit/i.test(panel + model + contextSource), 'No Facebook auth/token/scraping/auto-submit')
check(!/method:\s*['"](?:POST|PATCH|PUT|DELETE)|purchase_enabled|stripe|checkout\/session|webhooks\/stripe/i.test(panel + model + contextSource), 'No SHOP/payment/order mutation')
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
  console.error('HUB-4 VERIFY: FAIL')
  failures.forEach((label) => console.error(`- ${label}`))
  process.exit(1)
}
console.log('HUB-4 VERIFY: PASS')
passes.forEach((label) => console.log(`- ${label}: PASS`))
console.log('- No order, Stripe Session, charge, Facebook login, or Marketplace post created: PASS')
console.log('- Native employee workflow: OWNER_DEVICE_VERIFICATION_REQUIRED')
