import type { SalesPostPackage } from './salesPostPackage'
import type { ProductCategory, ProductDraft, ProductStatus } from '../types/product'

export const MARKETPLACE_TITLE_WARNING_LENGTH = 100

export const MARKETPLACE_CATEGORY_SUGGESTIONS: Record<ProductCategory, string> = {
  notebook: 'อิเล็กทรอนิกส์ › คอมพิวเตอร์ › แล็ปท็อป',
  pc: 'อิเล็กทรอนิกส์ › คอมพิวเตอร์ตั้งโต๊ะ',
  iphone: 'อิเล็กทรอนิกส์ › โทรศัพท์มือถือ',
  smartphone: 'อิเล็กทรอนิกส์ › โทรศัพท์มือถือ',
  tablet: 'อิเล็กทรอนิกส์ › แท็บเล็ต',
  camera: 'อิเล็กทรอนิกส์ › กล้อง',
  lens: 'อิเล็กทรอนิกส์ › กล้องและเลนส์',
  monitor: 'อิเล็กทรอนิกส์ › จอคอมพิวเตอร์',
  component: 'อิเล็กทรอนิกส์ › อะไหล่คอมพิวเตอร์',
  gaming: 'อิเล็กทรอนิกส์ › เครื่องเล่นเกม',
  accessory: 'อิเล็กทรอนิกส์ › อุปกรณ์เสริม',
  other: 'โปรดเลือกหมวดหมู่ใน Marketplace',
}

export const DEFAULT_FACEBOOK_MARKETPLACE_URL = 'https://www.facebook.com/marketplace/'

export type MarketplaceCheckStatus = 'PASS' | 'WARNING' | 'N/A'
export type MarketplaceReadinessStatus = 'READY' | 'WARNING' | 'BLOCKED'

export interface MarketplaceChecklistItem {
  id: string
  label: string
  status: MarketplaceCheckStatus
  detail?: string
}

export interface MarketplaceListingDraft {
  sku: string
  title: string
  titleCharacterCount: number
  price: number
  priceCopyValue: string
  priceDisplay: string
  categorySuggestion: string
  conditionSuggestion: string
  description: string
  imageCount: number
  imageReady: boolean
  coverImageUrl?: string
  shopUrl?: string
  locationText?: string
  readiness: MarketplaceReadinessStatus
  readinessLabel: string
  warnings: string[]
  checklist: MarketplaceChecklistItem[]
  copyAllText: string
  generatedAt: string
}

const BLOCKED_STATUSES = new Set<ProductStatus>(['sold', 'repair', 'returned', 'cancelled'])

function clean(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function titleKeys(category?: ProductCategory) {
  if (category === 'notebook' || category === 'pc') return ['cpu', 'gpu', 'ram', 'ssd', 'storage']
  if (category === 'iphone' || category === 'smartphone' || category === 'tablet') return ['storage', 'color']
  if (category === 'camera') return ['model_code', 'sensor', 'megapixel']
  if (category === 'lens') return ['model_code', 'focal_length', 'aperture']
  if (category === 'component') return ['model_code', 'gpu_chip', 'vram', 'ram_capacity', 'storage_capacity', 'wattage']
  return ['model_code']
}

export function buildMarketplaceTitle(pkg: SalesPostPackage, source: Pick<ProductDraft, 'category' | 'model' | 'specs'>) {
  const parts = [pkg.title]
  const normalized = () => parts.join(' ').toLocaleLowerCase('th-TH')
  for (const key of titleKeys(source.category)) {
    const value = clean(source.specs?.[key])
    if (value && !normalized().includes(value.toLocaleLowerCase('th-TH'))) parts.push(value)
  }
  return parts.join(' · ')
}

function conditionSuggestion(source: Pick<ProductDraft, 'conditionPercent'>, pkg: SalesPostPackage) {
  const percent = Number(source.conditionPercent || 0)
  let suggestion = 'โปรดเลือกสภาพใน Marketplace'
  if (percent >= 95) suggestion = 'เหมือนใหม่'
  else if (percent >= 80) suggestion = 'สภาพดี'
  else if (percent >= 60) suggestion = 'สภาพพอใช้'
  else if (percent > 0) suggestion = 'มีร่องรอยการใช้งาน โปรดตรวจรายละเอียด'
  if (pkg.defects) suggestion += ' — มีตำหนิ/หมายเหตุ โปรดอ่านรายละเอียด'
  return suggestion
}

function check(id: string, label: string, ok: boolean, warningDetail: string, na = false): MarketplaceChecklistItem {
  return { id, label, status: na ? 'N/A' : ok ? 'PASS' : 'WARNING', detail: ok || na ? undefined : warningDetail }
}

export function buildMarketplaceListingDraft(
  pkg: SalesPostPackage,
  source: Pick<ProductDraft, 'category' | 'model' | 'conditionPercent' | 'specs' | 'status' | 'images'>,
  imageReady: boolean,
): MarketplaceListingDraft {
  // HUB-4 reads only HUB-3 public output plus explicitly public source fields.
  // Never spread ProductDraft here: cost, serial, notes and identities stay outside.
  const title = buildMarketplaceTitle(pkg, source)
  const categorySuggestion = source.category ? MARKETPLACE_CATEGORY_SUGGESTIONS[source.category] : 'โปรดเลือกหมวดหมู่ใน Marketplace'
  const condition = conditionSuggestion(source, pkg)
  const cover = source.images.find((image) => image.isCover && image.publicUrl)?.publicUrl || pkg.images[0]?.url
  const lifecycleBlocked = BLOCKED_STATUSES.has(source.status)
  const warnings = [...pkg.warnings]
  if (title.length > MARKETPLACE_TITLE_WARNING_LENGTH) warnings.push(`ชื่อประกาศยาว ${title.length} ตัวอักษร ควรตรวจสอบก่อนวาง`)
  if (!clean(source.model)) warnings.push('ยังไม่มีข้อมูลรุ่นสำหรับตรวจชื่อประกาศ')
  if (source.status === 'reserved') warnings.push('สินค้าถูกจองแล้ว — ตรวจสอบก่อนลง Marketplace')
  if (lifecycleBlocked) warnings.push(source.status === 'sold' ? 'ขายแล้ว — ไม่ควรลง Marketplace' : `สถานะ ${source.status} — ไม่พร้อมลง Marketplace`)
  if (!imageReady && pkg.imageCount > 0) warnings.push('รูปยังเตรียมไม่เสร็จหรืออุปกรณ์นี้ต้องใช้ ZIP')

  const checklist: MarketplaceChecklistItem[] = [
    check('images', 'รูปสินค้า', pkg.imageCount > 0 && Boolean(cover), 'ไม่มีรูปพร้อมใช้'),
    check('image_export', 'ส่งออกรูป', imageReady, 'ตรวจ native share หรือใช้ ZIP fallback'),
    check('title', 'ชื่อประกาศ', Boolean(title), 'ไม่มีชื่อประกาศ'),
    check('price', 'ราคา', pkg.price > 0, 'ราคาขายไม่ถูกต้อง'),
    check('category', 'หมวดหมู่แนะนำ', categorySuggestion !== 'โปรดเลือกหมวดหมู่ใน Marketplace', 'โปรดเลือกหมวดหมู่เอง'),
    check('condition', 'สภาพ', condition !== 'โปรดเลือกสภาพใน Marketplace', 'ยังไม่มีข้อมูลสภาพ'),
    check('specs', 'สเปก', pkg.specifications.length > 0, 'สเปกยังไม่ครบ'),
    check('defects', 'ตำหนิ', Boolean(pkg.defects), 'ยังไม่มีข้อมูลตำหนิ'),
    check('accessories', 'อุปกรณ์', pkg.accessories.length > 0, 'ยังไม่มีอุปกรณ์ที่ระบุ'),
    check('warranty', 'ประกัน', pkg.warranty !== 'ไม่ระบุประกัน', 'ยังไม่ระบุประกัน'),
    check('description', 'รายละเอียด', Boolean(pkg.captions.MARKETPLACE), 'ไม่มีรายละเอียด'),
    check('shop', 'ลิงก์ SHOP', Boolean(pkg.canonicalShopUrl), 'ยังไม่ได้เผยแพร่ใน SHOP', !pkg.publishedToShop),
  ]
  const criticalReady = Boolean(pkg.sku && title && pkg.price > 0 && pkg.imageCount > 0 && cover) && !lifecycleBlocked
  const hasWarnings = warnings.length > 0 || checklist.some((item) => item.status === 'WARNING')
  const readiness: MarketplaceReadinessStatus = !criticalReady ? 'BLOCKED' : hasWarnings ? 'WARNING' : 'READY'
  const readinessLabel = readiness === 'READY' ? 'พร้อมลง Marketplace' : readiness === 'WARNING' ? 'พร้อมลง แต่ควรตรวจสอบข้อมูล' : 'ยังไม่พร้อมลง Marketplace'
  const priceCopyValue = String(Math.round(pkg.price))
  const priceDisplay = `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(pkg.price)} บาท`
  const copyAllText = [
    `ชื่อ: ${title}`,
    `ราคา: ${priceCopyValue}`,
    `หมวดหมู่แนะนำ: ${categorySuggestion}`,
    `สภาพ: ${condition}`,
    '',
    'รายละเอียด:',
    pkg.captions.MARKETPLACE,
    pkg.canonicalShopUrl ? `\nSHOP: ${pkg.canonicalShopUrl}` : '',
    `\nSKU สำหรับพนักงาน: ${pkg.sku}`,
  ].filter(Boolean).join('\n')
  return {
    sku: pkg.sku, title, titleCharacterCount: title.length, price: pkg.price, priceCopyValue, priceDisplay,
    categorySuggestion, conditionSuggestion: condition, description: pkg.captions.MARKETPLACE,
    imageCount: pkg.imageCount, imageReady, coverImageUrl: cover, shopUrl: pkg.canonicalShopUrl,
    locationText: pkg.fulfillment, readiness, readinessLabel, warnings: Array.from(new Set(warnings)),
    checklist, copyAllText, generatedAt: new Date().toISOString(),
  }
}

export function marketplaceDestinationUrl(configured?: string) {
  const value = clean(configured)
  if (!value) return DEFAULT_FACEBOOK_MARKETPLACE_URL
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))
      ? url.toString()
      : DEFAULT_FACEBOOK_MARKETPLACE_URL
  } catch {
    return DEFAULT_FACEBOOK_MARKETPLACE_URL
  }
}
