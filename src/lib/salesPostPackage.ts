import type { SmartFieldDefinition } from './productSchemas'
import type { ProductDraft } from '../types/product'

export type SalesPostPreset = 'GENERAL' | 'MARKETPLACE' | 'FACEBOOK_PAGE' | 'LINE'

export const PUBLIC_SALES_FIELD_ALLOWLIST = [
  'sku', 'title', 'price', 'category', 'subtype', 'brand', 'model',
  'conditionPercent', 'warrantyUntil', 'defects', 'specs', 'images', 'status',
] as const

export interface SalesPostContext {
  canonicalShopUrl?: string
  defaultWarrantyDays?: number
  fulfillmentText?: string
  listingWarrantyDays?: number
  listingWarrantyTerms?: string
  publishedToShop: boolean
  storeName?: string
}

export interface SalesPostPackage {
  sku: string
  title: string
  price: number
  titleAndPrice: string
  imageCount: number
  images: Array<{ url: string; order: number }>
  specifications: Array<{ label: string; value: string }>
  condition: string[]
  defects?: string
  accessories: Array<{ label: string; value: string }>
  warranty: string
  fulfillment?: string
  storeName?: string
  publishedToShop: boolean
  canonicalShopUrl?: string
  captions: Record<SalesPostPreset, string>
  warnings: string[]
  readinessScore: number
  generatedAt: string
}

function clean(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function baht(value: number) {
  return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)} บาท`
}

function thaiDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function rowsFor(fields: SmartFieldDefinition[], specs: Record<string, string>, section: 'spec' | 'condition' | 'accessory') {
  const seen = new Set<string>()
  return fields.flatMap((field) => {
    const actualSection = field.section || 'spec'
    const value = clean(specs[field.key])
    if (actualSection !== section || !value || seen.has(field.key)) return []
    seen.add(field.key)
    return [{ label: field.label, value }]
  })
}

function warrantyText(draft: Pick<ProductDraft, 'warrantyUntil'>, context: SalesPostContext) {
  if (clean(draft.warrantyUntil)) return `ประกันถึง ${thaiDate(draft.warrantyUntil!)}`
  if (context.listingWarrantyDays !== undefined) {
    if (context.listingWarrantyDays > 0) return `ประกันร้าน ${context.listingWarrantyDays} วัน${clean(context.listingWarrantyTerms) ? ` — ${clean(context.listingWarrantyTerms)}` : ''}`
    return 'ไม่มีประกันร้าน'
  }
  if (Number(context.defaultWarrantyDays) > 0) return `ประกันร้าน ${Number(context.defaultWarrantyDays)} วัน`
  return 'ไม่ระบุประกัน'
}

function appendRows(lines: string[], heading: string, rows: Array<{ label: string; value: string }>, limit?: number) {
  const selected = limit ? rows.slice(0, limit) : rows
  if (!selected.length) return
  lines.push('', `${heading}:`, ...selected.map((row) => `• ${row.label}: ${row.value}`))
}

function appendFacts(lines: string[], pkg: Omit<SalesPostPackage, 'captions' | 'generatedAt'>, specLimit?: number) {
  appendRows(lines, 'สเปก', pkg.specifications, specLimit)
  if (pkg.condition.length) lines.push('', 'สภาพ:', ...pkg.condition.map((value) => `• ${value}`))
  if (pkg.defects) lines.push('', 'ตำหนิ:', pkg.defects)
  appendRows(lines, 'อุปกรณ์', pkg.accessories)
  lines.push('', 'ประกัน:', pkg.warranty)
}

function appendCta(lines: string[], pkg: Omit<SalesPostPackage, 'captions' | 'generatedAt'>) {
  if (pkg.fulfillment) lines.push('', 'การจัดส่ง / รับสินค้า:', pkg.fulfillment)
  const cta = [pkg.storeName, pkg.canonicalShopUrl].filter(Boolean)
  if (cta.length) lines.push('', 'สนใจสอบถาม / สั่งซื้อ:', ...cta as string[])
  lines.push('', `SKU: ${pkg.sku}`)
}

function hashtags(draft: Pick<ProductDraft, 'brand' | 'model' | 'category'>) {
  const values = [draft.brand, draft.model, draft.category === 'notebook' ? 'โน้ตบุ๊กมือสอง' : undefined, 'สินค้ามือสอง']
  return Array.from(new Set(values.map(clean).filter(Boolean).map((value) => `#${value.replace(/\s+/g, '')}`))).slice(0, 4).join(' ')
}

function captionsFor(draft: ProductDraft, pkg: Omit<SalesPostPackage, 'captions' | 'generatedAt'>): Record<SalesPostPreset, string> {
  const general = [pkg.title, '', `ราคา ${baht(pkg.price)}`]
  appendFacts(general, pkg)
  appendCta(general, pkg)

  const marketplace = [pkg.title, `ราคา ${baht(pkg.price)}`]
  appendFacts(marketplace, pkg, 8)
  appendCta(marketplace, pkg)

  const facebook = [`✨ ${pkg.title} พร้อมขาย`, '', `💰 ราคา ${baht(pkg.price)}`]
  appendFacts(facebook, pkg, 8)
  appendCta(facebook, pkg)
  const tags = hashtags(draft)
  if (tags) facebook.push('', tags)

  const line = [`${pkg.title} — ${baht(pkg.price)}`]
  appendRows(line, 'สเปก', pkg.specifications, 5)
  if (pkg.condition.length) line.push('', `สภาพ: ${pkg.condition.join(' · ')}`)
  if (pkg.defects) line.push(`ตำหนิ: ${pkg.defects}`)
  line.push(`ประกัน: ${pkg.warranty}`)
  appendCta(line, pkg)

  return {
    GENERAL: general.join('\n').trim(),
    MARKETPLACE: marketplace.join('\n').trim(),
    FACEBOOK_PAGE: facebook.join('\n').trim(),
    LINE: line.join('\n').trim(),
  }
}

export function buildSalesPostPackage(draft: ProductDraft, fields: SmartFieldDefinition[], context: SalesPostContext): SalesPostPackage {
  // Explicit public projection: do not spread draft. Cost, serialNumber, notes,
  // owner/session data and internal IDs cannot cross this boundary.
  const sku = clean(draft.sku)
  const title = clean(draft.title) || [clean(draft.brand), clean(draft.model)].filter(Boolean).join(' ')
  const price = Number(draft.price || 0)
  const images = draft.images
    .filter((image): image is typeof image & { publicUrl: string } => Boolean(image.publicUrl))
    .sort((a, b) => a.order - b.order)
    .map((image) => ({ url: image.publicUrl, order: image.order }))
  const specifications = rowsFor(fields, draft.specs || {}, 'spec')
  const conditionFields = rowsFor(fields, draft.specs || {}, 'condition')
  const accessories = rowsFor(fields, draft.specs || {}, 'accessory')
  const condition = [draft.conditionPercent ? `สภาพที่บันทึก ${draft.conditionPercent}%` : '', ...conditionFields.map((row) => `${row.label}: ${row.value}`)].filter(Boolean)
  const defects = clean(draft.defects) || undefined
  const warranty = warrantyText(draft, context)
  const warnings: string[] = []
  if (!sku) warnings.push('ยังไม่มี SKU')
  if (!title) warnings.push('ยังไม่มีชื่อสินค้า')
  if (!(price > 0)) warnings.push('ราคาขายไม่ถูกต้อง')
  if (!images.length) warnings.push('ยังไม่มีรูปที่อัปโหลด')
  if (!specifications.length) warnings.push('สเปกยังไม่ครบ')
  if (!condition.length) warnings.push('ยังไม่มีข้อมูลสภาพ')
  if (!defects) warnings.push('ยังไม่มีข้อมูลตำหนิ')
  if (!accessories.length) warnings.push('ยังไม่มีอุปกรณ์ที่ระบุ')
  if (warranty === 'ไม่ระบุประกัน') warnings.push('ยังไม่ระบุประกัน')

  const essentialReady = [Boolean(sku), Boolean(title), price > 0, images.length > 0].filter(Boolean).length
  const optionalReady = [specifications.length > 0, condition.length > 0, Boolean(defects), accessories.length > 0, warranty !== 'ไม่ระบุประกัน', context.publishedToShop].filter(Boolean).length
  const base = {
    sku, title, price, titleAndPrice: `${title} — ${baht(price)}`, imageCount: images.length, images,
    specifications, condition, defects, accessories, warranty,
    fulfillment: clean(context.fulfillmentText) || undefined,
    storeName: clean(context.storeName) || undefined,
    publishedToShop: context.publishedToShop,
    canonicalShopUrl: context.publishedToShop ? clean(context.canonicalShopUrl) || undefined : undefined,
    warnings,
    readinessScore: essentialReady + optionalReady,
  }
  return { ...base, captions: captionsFor(draft, base), generatedAt: new Date().toISOString() }
}

export function validateSalesPostPackage(pkg: SalesPostPackage) {
  const missing = []
  if (!pkg.sku) missing.push('SKU')
  if (!pkg.title) missing.push('ชื่อสินค้า')
  if (!(pkg.price > 0)) missing.push('ราคาขาย')
  if (!pkg.imageCount) missing.push('รูปสินค้า')
  return { ready: missing.length === 0, missing }
}
