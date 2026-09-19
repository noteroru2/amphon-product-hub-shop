import type { SalesPostPackage } from './salesPostPackage'
import type { ProductCategory, ProductDraft, ProductStatus } from '../types/product'
import {
  DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT,
  normalizeShopeeMarkup,
  shopeeManualPrice,
  shopeeMarkupAmount,
  type ShopeeManualMarkupPercent,
} from './shopeePricing'

export const DEFAULT_SHOPEE_SELLER_URL = 'https://seller.shopee.co.th/'

export const SHOPEE_CATEGORY_SUGGESTIONS: Record<ProductCategory, string> = {
  notebook: 'คอมพิวเตอร์และอุปกรณ์ > แล็ปท็อป',
  pc: 'คอมพิวเตอร์และอุปกรณ์ > คอมพิวเตอร์ตั้งโต๊ะ',
  iphone: 'มือถือและอุปกรณ์เสริม > โทรศัพท์มือถือ',
  smartphone: 'มือถือและอุปกรณ์เสริม > โทรศัพท์มือถือ',
  tablet: 'มือถือและอุปกรณ์เสริม > แท็บเล็ต',
  camera: 'กล้องและอุปกรณ์ถ่ายภาพ > กล้อง',
  lens: 'กล้องและอุปกรณ์ถ่ายภาพ > เลนส์',
  monitor: 'คอมพิวเตอร์และอุปกรณ์ > จอมอนิเตอร์',
  component: 'คอมพิวเตอร์และอุปกรณ์ > อุปกรณ์คอมพิวเตอร์',
  gaming: 'เกมและอุปกรณ์เสริม > เครื่องเล่นเกม/อุปกรณ์เกม',
  accessory: 'มือถือ/คอมพิวเตอร์ > อุปกรณ์เสริม',
  other: 'ค้นหาหมวดหมู่ที่ตรงสินค้าใน Seller Centre',
}

export type ShopeeManualReadiness = 'READY' | 'WARNING' | 'BLOCKED'
export type ShopeeManualCheckStatus = 'PASS' | 'WARNING' | 'N/A'

export interface ShopeeManualChecklistItem {
  id: string
  label: string
  status: ShopeeManualCheckStatus
  detail?: string
}

export interface ShopeeManualListingDraft {
  sku: string
  title: string
  basePrice: number
  markupPercent: ShopeeManualMarkupPercent
  markupAmount: number
  shopeePrice: number
  shopeePriceCopyValue: string
  shopeePriceDisplay: string
  basePriceDisplay: string
  priceFormulaText: string
  stock: number
  categorySuggestion: string
  conditionSuggestion: string
  description: string
  imageCount: number
  imageReady: boolean
  coverImageUrl?: string
  readiness: ShopeeManualReadiness
  readinessLabel: string
  warnings: string[]
  checklist: ShopeeManualChecklistItem[]
  copyAllText: string
  generatedAt: string
}

const BLOCKED_STATUSES = new Set<ProductStatus>(['sold', 'repair', 'returned', 'cancelled'])

function clean(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function money(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}

function titleKeys(category?: ProductCategory) {
  if (category === 'notebook' || category === 'pc') return ['cpu', 'gpu', 'ram', 'ssd', 'storage']
  if (category === 'iphone' || category === 'smartphone' || category === 'tablet') return ['storage', 'color']
  if (category === 'camera') return ['model_code', 'sensor', 'megapixel']
  if (category === 'lens') return ['model_code', 'focal_length', 'aperture']
  if (category === 'component') return ['model_code', 'gpu_chip', 'vram', 'ram_capacity', 'storage_capacity', 'wattage']
  return ['model_code']
}

export function buildShopeeManualTitle(
  pkg: SalesPostPackage,
  source: Pick<ProductDraft, 'category' | 'specs'>,
) {
  const parts = [pkg.title]
  const normalized = () => parts.join(' ').toLocaleLowerCase('th-TH')
  for (const key of titleKeys(source.category)) {
    const value = clean(source.specs?.[key])
    if (value && !normalized().includes(value.toLocaleLowerCase('th-TH'))) parts.push(value)
  }
  return parts.join(' · ')
}

function appendRows(
  lines: string[],
  heading: string,
  rows: Array<{ label: string; value: string }>,
  limit?: number,
) {
  const selected = limit ? rows.slice(0, limit) : rows
  if (!selected.length) return
  lines.push('', heading, ...selected.map((row) => '• ' + row.label + ': ' + row.value))
}

export function buildShopeeManualDescription(pkg: SalesPostPackage, shopeePrice: number) {
  const lines = [
    pkg.title,
    '',
    'ราคาใน Shopee ' + money(shopeePrice) + ' บาท',
    'สินค้ามือสอง ตรวจเช็กการใช้งานและแจ้งสภาพตามจริง',
  ]
  appendRows(lines, 'รายละเอียดสเปก', pkg.specifications, 12)
  if (pkg.condition.length) lines.push('', 'สภาพสินค้า', ...pkg.condition.map((value) => '• ' + value))
  if (pkg.defects) lines.push('', 'ตำหนิ / จุดสังเกต', pkg.defects)
  appendRows(lines, 'อุปกรณ์ที่ได้รับ', pkg.accessories)
  lines.push('', 'ประกัน: ' + pkg.warranty)
  if (pkg.fulfillment) lines.push('การจัดส่ง: ' + pkg.fulfillment)
  lines.push(
    '',
    'หมายเหตุ',
    '• กรุณาดูรูปสินค้าจริงประกอบการตัดสินใจ',
    '• สินค้ามือสองแต่ละชิ้นมีเพียง 1 เครื่อง/ชิ้น',
    '• รหัสสินค้า: ' + pkg.sku,
  )
  return lines.join('\n').trim()
}

function check(
  id: string,
  label: string,
  ok: boolean,
  warningDetail: string,
  na = false,
): ShopeeManualChecklistItem {
  return {
    id,
    label,
    status: na ? 'N/A' : ok ? 'PASS' : 'WARNING',
    detail: ok || na ? undefined : warningDetail,
  }
}

export function buildShopeeManualListingDraft(
  pkg: SalesPostPackage,
  source: Pick<
    ProductDraft,
    'category' | 'specs' | 'status' | 'images' | 'conditionPercent'
  >,
  markupPercent = DEFAULT_SHOPEE_MANUAL_MARKUP_PERCENT,
  imageReady = true,
): ShopeeManualListingDraft {
  // Public/manual projection only. Cost, serialNumber, notes and staff data never enter this object.
  const markup = normalizeShopeeMarkup(Number(markupPercent))
  const title = buildShopeeManualTitle(pkg, source)
  const shopeePrice = shopeeManualPrice(pkg.price, markup)
  const markupAmount = shopeeMarkupAmount(pkg.price, markup)
  const categorySuggestion = source.category
    ? SHOPEE_CATEGORY_SUGGESTIONS[source.category]
    : 'ค้นหาหมวดหมู่ที่ตรงสินค้าใน Seller Centre'
  const cover =
    source.images.find((image) => image.isCover && image.publicUrl)?.publicUrl ||
    pkg.images[0]?.url
  const lifecycleBlocked = BLOCKED_STATUSES.has(source.status)
  const stock = source.status === 'ready_to_list' || source.status === 'published' ? 1 : 0
  const warnings = [...pkg.warnings]

  if (source.status === 'reserved') warnings.push('สินค้าถูกจองแล้ว — ตั้งสต๊อก Shopee เป็น 0 และอย่าเพิ่งลงขาย')
  if (lifecycleBlocked) warnings.push(source.status === 'sold' ? 'ขายแล้ว — ห้ามลง Shopee' : 'สถานะ ' + source.status + ' — ยังไม่พร้อมลง Shopee')
  if (!imageReady && pkg.imageCount > 0) warnings.push('รูปยังเตรียมไม่เสร็จ หรืออุปกรณ์นี้ต้องใช้ ZIP')
  if (!source.conditionPercent) warnings.push('ยังไม่มีเปอร์เซ็นต์สภาพ — ให้พนักงานตรวจสภาพใน Seller Centre')
  warnings.push('น้ำหนัก/ขนาดพัสดุต้องตรวจและกรอกใน Seller Centre ตามสินค้าจริง')

  const description = buildShopeeManualDescription(pkg, shopeePrice)
  const checklist: ShopeeManualChecklistItem[] = [
    check('images', 'รูปสินค้า', pkg.imageCount > 0 && Boolean(cover), 'ไม่มีรูปพร้อมใช้'),
    check('image_export', 'ส่งออกรูป', imageReady, 'ใช้ ZIP fallback หาก Share รูปไม่ได้'),
    check('title', 'ชื่อสินค้า', Boolean(title), 'ยังไม่มีชื่อสินค้า'),
    check('price', 'ราคา Shopee', shopeePrice > pkg.price && pkg.price > 0, 'ราคาฐานหรือราคา Shopee ไม่ถูกต้อง'),
    check('sku', 'Seller SKU', Boolean(pkg.sku), 'ยังไม่มี SKU'),
    check('stock', 'สต๊อกเริ่มต้น', stock === 1, 'สินค้านี้ไม่ควรตั้งสต๊อกเป็น 1'),
    check('category', 'หมวดหมู่', source.category !== 'other', 'ต้องเลือกหมวดหมู่เองใน Seller Centre'),
    check('condition', 'สภาพสินค้า', Boolean(source.conditionPercent), 'ตรวจสภาพและเลือกค่าที่ตรงสินค้า'),
    check('specs', 'สเปก', pkg.specifications.length > 0, 'สเปกยังไม่ครบ'),
    check('defects', 'ตำหนิ', Boolean(pkg.defects), 'ยังไม่มีข้อมูลตำหนิ'),
    check('accessories', 'อุปกรณ์', pkg.accessories.length > 0, 'ยังไม่มีอุปกรณ์ที่ระบุ'),
    check('warranty', 'ประกัน', pkg.warranty !== 'ไม่ระบุประกัน', 'ยังไม่ระบุประกัน'),
    check('package', 'น้ำหนัก/ขนาดพัสดุ', false, 'พนักงานต้องชั่ง/ตรวจขนาดจริงก่อนกดเผยแพร่'),
  ]

  const criticalReady =
    Boolean(pkg.sku && title && pkg.price > 0 && shopeePrice > 0 && pkg.imageCount > 0 && cover) &&
    stock === 1 &&
    !lifecycleBlocked
  const nonPackageWarnings = checklist.filter((item) => item.id !== 'package' && item.status === 'WARNING')
  const readiness: ShopeeManualReadiness = !criticalReady
    ? 'BLOCKED'
    : nonPackageWarnings.length || warnings.length
      ? 'WARNING'
      : 'READY'
  const readinessLabel =
    readiness === 'READY'
      ? 'ข้อมูลพร้อมสำหรับกรอก Shopee'
      : readiness === 'WARNING'
        ? 'กรอกได้ แต่มีข้อมูลที่ต้องตรวจ'
        : 'ยังไม่ควรลง Shopee'

  const copyAllText = [
    'ชื่อสินค้า: ' + title,
    'ราคา Hub: ' + money(pkg.price) + ' บาท',
    'บวก Shopee: ' + markup + '%',
    'ราคา Shopee: ' + money(shopeePrice) + ' บาท',
    'Seller SKU: ' + pkg.sku,
    'สต๊อก: ' + stock,
    'หมวดหมู่แนะนำ: ' + categorySuggestion,
    'สภาพ: มือสอง — เลือกค่าที่ตรงกับสินค้าจริง',
    '',
    'รายละเอียดสินค้า:',
    description,
    '',
    'ก่อนกดเผยแพร่: ตรวจน้ำหนัก ขนาดพัสดุ ช่องทางขนส่ง และค่าธรรมเนียม/โปรโมชันใน Seller Centre',
  ].join('\n')

  return {
    sku: pkg.sku,
    title,
    basePrice: pkg.price,
    markupPercent: markup,
    markupAmount,
    shopeePrice,
    shopeePriceCopyValue: String(shopeePrice),
    shopeePriceDisplay: money(shopeePrice) + ' บาท',
    basePriceDisplay: money(pkg.price) + ' บาท',
    priceFormulaText: money(pkg.price) + ' + ' + markup + '% → ' + money(shopeePrice) + ' บาท (ปัดขึ้นหลักสิบ)',
    stock,
    categorySuggestion,
    conditionSuggestion: 'มือสอง — เลือกค่าที่ตรงกับสินค้าจริง',
    description,
    imageCount: pkg.imageCount,
    imageReady,
    coverImageUrl: cover,
    readiness,
    readinessLabel,
    warnings: Array.from(new Set(warnings)),
    checklist,
    copyAllText,
    generatedAt: new Date().toISOString(),
  }
}

export function shopeeSellerDestinationUrl(configured?: string) {
  const value = clean(configured)
  if (!value) return DEFAULT_SHOPEE_SELLER_URL
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'seller.shopee.co.th' || url.hostname.endsWith('.seller.shopee.co.th'))
      ? url.toString()
      : DEFAULT_SHOPEE_SELLER_URL
  } catch {
    return DEFAULT_SHOPEE_SELLER_URL
  }
}
