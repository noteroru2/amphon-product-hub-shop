import type { StoreProduct, StoreSettings } from './store-api'
import { absoluteUrl, productPath } from './seo'
import { xmlEscape } from './xml'

const GOOGLE_CATEGORY_BY_SHOP_SLUG: Record<string, string> = {
  notebooks: '328',
  macbooks: '328',
  'gaming-laptops': '328',
  'desktop-pcs': '325',
  'gaming-pcs': '325',
  iphones: '267',
  smartphones: '267',
  tablets: '4745',
  cameras: '152',
  monitors: '305',
  'gaming-consoles': '1294',
}

const SPEC_DETAILS: Array<{ key: string; section: string; name: string }> = [
  { key: 'cpu', section: 'Performance', name: 'CPU' },
  { key: 'gpu', section: 'Performance', name: 'GPU' },
  { key: 'ram', section: 'Memory', name: 'RAM' },
  { key: 'ssd', section: 'Storage', name: 'SSD' },
  { key: 'hdd', section: 'Storage', name: 'HDD' },
  { key: 'storage', section: 'Storage', name: 'Storage' },
  { key: 'chipset', section: 'Performance', name: 'Chipset' },
  { key: 'screen_size', section: 'Display', name: 'Screen size' },
  { key: 'resolution', section: 'Display', name: 'Resolution' },
  { key: 'refresh_rate', section: 'Display', name: 'Refresh rate' },
  { key: 'battery', section: 'Condition', name: 'Battery' },
  { key: 'battery_cycle', section: 'Condition', name: 'Battery cycle count' },
  { key: 'screen_condition', section: 'Condition', name: 'Screen condition' },
  { key: 'hinge_condition', section: 'Condition', name: 'Hinge condition' },
  { key: 'keyboard_layout', section: 'General', name: 'Keyboard layout' },
  { key: 'charger', section: 'Included accessories', name: 'Charger' },
  { key: 'box_accessories', section: 'Included accessories', name: 'Box and accessories' },
  { key: 'connectivity', section: 'Connectivity', name: 'Connectivity' },
  { key: 'color', section: 'General', name: 'Color' },
  { key: 'mainboard', section: 'Performance', name: 'Mainboard' },
  { key: 'psu', section: 'Performance', name: 'Power supply' },
  { key: 'model_code', section: 'General', name: 'Model code' },
]

function clean(value: unknown) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text || /^[-–—]+$/.test(text) || /^(n\/a|none|null)$/i.test(text)) return ''
  return text
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

function merchantCondition(value?: string | null) {
  const normalized = String(value || 'USED').toUpperCase()
  if (normalized === 'NEW') return 'new'
  if (normalized === 'REFURBISHED') return 'refurbished'
  return 'used'
}

function merchantCategory(product: StoreProduct) {
  return clean(product.googleProductCategory)
    || GOOGLE_CATEGORY_BY_SHOP_SLUG[product.categorySlug || '']
    || ''
}

function merchantProductType(product: StoreProduct) {
  const parts = [
    'Used IT',
    clean(product.categoryName) || clean(product.categorySlug) || clean(product.category),
    clean(product.catalogBrand?.name) || clean(product.brand),
    clean(product.catalogSeries?.name),
    clean(product.catalogModel?.name) || clean(product.model),
  ].filter(Boolean)
  return truncate(parts.join(' > '), 750)
}

function conditionLabel(product: StoreProduct) {
  const score = Number(product.conditionPercent)
  if (!Number.isFinite(score)) return 'used_unspecified'
  if (score >= 95) return 'used_like_new'
  if (score >= 90) return 'used_very_good'
  if (score >= 80) return 'used_good'
  return 'used_fair'
}

function merchantDescription(product: StoreProduct) {
  const values: string[] = []
  const brand = clean(product.catalogBrand?.name) || clean(product.brand)
  const model = clean(product.catalogModel?.name) || clean(product.model)
  if (brand) values.push(`แบรนด์ ${brand}`)
  if (model && !product.title.toLowerCase().includes(model.toLowerCase())) values.push(`รุ่น ${model}`)

  const prioritySpecs = ['cpu', 'gpu', 'ram', 'ssd', 'storage', 'screen_size', 'battery']
  for (const key of prioritySpecs) {
    const value = clean(product.specs?.[key])
    if (value) values.push(`${key.toUpperCase()} ${value}`)
  }

  if (Number.isFinite(Number(product.conditionPercent))) values.push(`สภาพประมาณ ${Number(product.conditionPercent)}%`)
  const defects = clean(product.defects)
  if (defects) values.push(`ตำหนิ: ${defects}`)

  return truncate(
    `${product.title} สินค้าไอทีมือสองจาก AMPHON TRADING พร้อมรูปสินค้าจริง ราคาและสถานะล่าสุด${values.length ? `. ${values.join(' • ')}` : ''}`,
    4500,
  )
}

function imageTags(product: StoreProduct) {
  const sorted = [...product.images]
    .filter((image) => Boolean(clean(image.url)))
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder)
  if (!sorted.length) return ''

  const [cover, ...rest] = sorted
  return [
    `<g:image_link>${xmlEscape(cover.url)}</g:image_link>`,
    ...rest.slice(0, 10).map((image) => `<g:additional_image_link>${xmlEscape(image.url)}</g:additional_image_link>`),
  ].join('')
}

function identifierTags(product: StoreProduct) {
  const gtin = clean(product.gtin)
  const mpn = clean(product.mpn)
  const brand = clean(product.catalogBrand?.name) || clean(product.brand)
  const tags: string[] = []
  if (brand) tags.push(`<g:brand>${xmlEscape(brand)}</g:brand>`)
  if (gtin) tags.push(`<g:gtin>${xmlEscape(gtin)}</g:gtin>`)
  if (mpn) tags.push(`<g:mpn>${xmlEscape(mpn)}</g:mpn>`)

  // Only state that identifiers do not exist when this is clearly a custom/unbranded item.
  // For branded used hardware, omitting a missing UPI is safer than falsely asserting none exists.
  if (!gtin && !mpn && (!brand || brand.toLowerCase() === 'custom pc')) {
    tags.push('<g:identifier_exists>false</g:identifier_exists>')
  }
  return tags.join('')
}

function productDetailTags(product: StoreProduct) {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const detail of SPEC_DETAILS) {
    const value = clean(product.specs?.[detail.key])
    if (!value) continue
    const signature = `${detail.section}:${detail.name}:${value}`
    if (seen.has(signature)) continue
    seen.add(signature)
    tags.push(
      `<g:product_detail><g:section_name>${xmlEscape(detail.section)}</g:section_name><g:attribute_name>${xmlEscape(detail.name)}</g:attribute_name><g:attribute_value>${xmlEscape(truncate(value, 1000))}</g:attribute_value></g:product_detail>`,
    )
  }
  return tags.slice(0, 30).join('')
}

function shippingTag(settings: StoreSettings | null) {
  const shipping = settings?.shipping
  if (!shipping?.enabled) return ''
  const country = clean(shipping.country || settings?.countryCode || 'TH')
  const currency = clean(settings?.currency || 'THB') || 'THB'
  const rate = Number(shipping.rate)
  const handlingMin = Number(shipping.handlingMinDays)
  const handlingMax = Number(shipping.handlingMaxDays)
  const transitMin = Number(shipping.transitMinDays)
  const transitMax = Number(shipping.transitMaxDays)
  const complete = country
    && Number.isFinite(rate)
    && Number.isFinite(handlingMin)
    && Number.isFinite(handlingMax)
    && Number.isFinite(transitMin)
    && Number.isFinite(transitMax)
  if (!complete) return ''

  return `<g:shipping><g:country>${xmlEscape(country)}</g:country><g:service>Standard</g:service><g:price>${rate.toFixed(2)} ${xmlEscape(currency)}</g:price><g:min_handling_time>${Math.max(0, Math.trunc(handlingMin))}</g:min_handling_time><g:max_handling_time>${Math.max(0, Math.trunc(handlingMax))}</g:max_handling_time><g:min_transit_time>${Math.max(0, Math.trunc(transitMin))}</g:min_transit_time><g:max_transit_time>${Math.max(0, Math.trunc(transitMax))}</g:max_transit_time></g:shipping>`
}

function customLabelTags(product: StoreProduct) {
  const brand = clean(product.catalogBrand?.slug) || clean(product.catalogBrand?.name) || clean(product.brand)
  const series = clean(product.catalogSeries?.slug) || clean(product.catalogSeries?.name)
  const labels = [
    'used_it',
    clean(product.categorySlug) || clean(product.category),
    brand,
    series,
    conditionLabel(product),
  ]
  return labels.map((value, index) => value ? `<g:custom_label_${index}>${xmlEscape(truncate(value, 100))}</g:custom_label_${index}>` : '').join('')
}

export function merchantFeedEligible(product: StoreProduct) {
  return product.availability === 'available'
    && product.indexPolicy === 'INDEX'
    && product.merchantEnabled === true
    && Number(product.price) > 0
    && product.images.some((image) => Boolean(clean(image.url)))
}

export function buildMerchantItem(product: StoreProduct, settings: StoreSettings | null) {
  const category = merchantCategory(product)
  const productType = merchantProductType(product)
  const currency = clean(settings?.currency || 'THB') || 'THB'
  const title = truncate(clean(product.title), 150)
  const link = absoluteUrl(productPath(product))

  return [
    '<item>',
    `<g:id>${xmlEscape(product.sku)}</g:id>`,
    `<title>${xmlEscape(title)}</title>`,
    `<description>${xmlEscape(merchantDescription(product))}</description>`,
    `<link>${xmlEscape(link)}</link>`,
    imageTags(product),
    '<g:availability>in_stock</g:availability>',
    `<g:price>${Number(product.price).toFixed(2)} ${xmlEscape(currency)}</g:price>`,
    `<g:condition>${merchantCondition(product.merchantItemCondition)}</g:condition>`,
    identifierTags(product),
    category ? `<g:google_product_category>${xmlEscape(category)}</g:google_product_category>` : '',
    productType ? `<g:product_type>${xmlEscape(productType)}</g:product_type>` : '',
    productDetailTags(product),
    shippingTag(settings),
    customLabelTags(product),
    '</item>',
  ].join('')
}

export function buildGoogleMerchantFeed(products: StoreProduct[], settings: StoreSettings | null) {
  const eligible = products.filter(merchantFeedEligible)
  const items = eligible.map((product) => buildMerchantItem(product, settings)).join('\n')
  const storeName = clean(settings?.merchantName) || 'AMPHON TRADING'
  const now = new Date().toUTCString()
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xmlEscape(storeName)} - Google Merchant Feed</title><link>${xmlEscape(absoluteUrl('/'))}</link><description>สินค้าไอทีมือสองพร้อมขายจาก ${xmlEscape(storeName)}</description><lastBuildDate>${xmlEscape(now)}</lastBuildDate>${items}</channel></rss>\n`
}
