import type { StoreProduct } from './store-api'

export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL || 'https://shop.amphon.co.th').replace(/\/$/, '')

export function absoluteUrl(path: string) {
  return new URL(path, `${SITE_URL}/`).toString()
}

export function asciiSlug(value: string) {
  const slug = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase()
  return slug || 'item'
}

export function productSlug(product: Pick<StoreProduct, 'title' | 'listingSlug'>) {
  return product.listingSlug?.trim() || asciiSlug(product.title)
}

export function productSegment(product: Pick<StoreProduct, 'title' | 'sku' | 'listingSlug'>) {
  return `${productSlug(product)}-${product.sku.toLowerCase()}`
}

export function productPath(product: Pick<StoreProduct, 'title' | 'sku' | 'listingSlug'>) {
  return `/p/${productSegment(product)}/`
}

export function extractSkuFromProductSegment(segment: string) {
  const decoded = decodeURIComponent(segment).toUpperCase()
  const match = decoded.match(/(AT-[A-Z0-9]{2,5}-\d{4}-\d{6})$/)
  return match?.[1] || null
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(price)
}

export function formatThaiDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date)
}

export function productDescription(product: StoreProduct) {
  if (product.seoDescription?.trim()) return product.seoDescription.trim()
  const parts = [
    `${product.title} มือสอง`,
    product.brand ? `แบรนด์ ${product.brand}` : '',
    product.conditionPercent ? `สภาพประมาณ ${product.conditionPercent}%` : '',
    `ราคา ${formatPrice(product.price)}`,
    'ดูรูปและสเปกสินค้าจริงจาก AMPHON TRADING',
  ].filter(Boolean)
  return parts.join(' • ').slice(0, 165)
}

export function availabilitySchema(product: StoreProduct) {
  return product.availability === 'available'
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock'
}

export function conditionSchema(_product: StoreProduct) {
  return 'https://schema.org/UsedCondition'
}
