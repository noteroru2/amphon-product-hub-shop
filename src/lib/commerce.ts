import { supabase } from './supabase'
import type {
  CommerceCatalog,
  CommerceProductConfig,
  CommerceStoreSettings,
  CommerceTaxonomyCandidate,
  MerchantItemCondition,
  CommerceIndexPolicy,
} from '../types/product'

const apiBase = (import.meta.env.VITE_R2_UPLOAD_API as string | undefined)?.trim().replace(/\/$/, '')
const salesSiteBaseUrl = (import.meta.env.VITE_SALES_SITE_URL as string | undefined)?.trim().replace(/\/$/, '')

async function sessionToken() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
  return data.session.access_token
}

async function commerceApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiBase) throw new Error('ยังไม่ได้ตั้งค่า VITE_R2_UPLOAD_API')
  const token = await sessionToken()
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const result = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(result?.error || `Commerce API failed (${response.status})`)
  return result as T
}

export function canonicalShopUrl(config?: Pick<CommerceProductConfig, 'canonicalUrl' | 'canonicalPath'> | null) {
  if (config?.canonicalUrl) return config.canonicalUrl
  if (salesSiteBaseUrl && config?.canonicalPath) return `${salesSiteBaseUrl}${config.canonicalPath}`
  return ''
}

export async function prepareCommerceProduct(productId: string): Promise<CommerceProductConfig> {
  const result = await commerceApi<{ product: CommerceProductConfig }>(`/commerce/products/${encodeURIComponent(productId)}/prepare`, { method: 'POST' })
  return result.product
}

export async function getCommerceProduct(productId: string): Promise<CommerceProductConfig> {
  const result = await commerceApi<{ product: CommerceProductConfig }>(`/commerce/products/${encodeURIComponent(productId)}`)
  return result.product
}

export async function updateCommerceProduct(
  productId: string,
  patch: Partial<{
    categoryId: string | null
    brandId: string | null
    seriesId: string | null
    modelId: string | null
    seoTitle: string | null
    seoDescription: string | null
    indexPolicy: CommerceIndexPolicy
    merchantEnabled: boolean
    merchantItemCondition: MerchantItemCondition
    googleProductCategory: string | null
    gtin: string | null
    mpn: string | null
    storeWarrantyDays: number | null
    storeWarrantyTerms: string | null
  }>,
): Promise<CommerceProductConfig> {
  const result = await commerceApi<{ product: CommerceProductConfig }>(`/commerce/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return result.product
}

export async function getCommerceCatalog(): Promise<CommerceCatalog> {
  const result = await commerceApi<{ catalog: CommerceCatalog }>('/commerce/catalog')
  return result.catalog
}

export async function getCommerceStoreSettings(): Promise<CommerceStoreSettings> {
  const result = await commerceApi<{ settings: CommerceStoreSettings }>('/commerce/settings')
  return result.settings
}

export async function updateCommerceStoreSettings(settings: CommerceStoreSettings): Promise<CommerceStoreSettings> {
  const result = await commerceApi<{ settings: CommerceStoreSettings }>('/commerce/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  })
  return result.settings
}

export async function createCommerceSeries(input: { categoryId: string; brandId: string; name: string; slug?: string }) {
  const result = await commerceApi<{ series: CommerceCatalog['series'][number] }>('/commerce/series', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.series
}

export async function createCommerceModel(input: { categoryId: string; brandId: string; seriesId?: string | null; name: string; code?: string; slug?: string }) {
  const result = await commerceApi<{ model: CommerceCatalog['models'][number] }>('/commerce/models', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.model
}

export async function listCommerceTaxonomyCandidates(): Promise<CommerceTaxonomyCandidate[]> {
  const result = await commerceApi<{ candidates: CommerceTaxonomyCandidate[] }>('/commerce/candidates')
  return result.candidates
}

export async function refreshCommerceMappings(): Promise<number> {
  const result = await commerceApi<{ affected: number }>('/commerce/remap', { method: 'POST' })
  return result.affected
}

export function merchantBlockerLabel(code: string) {
  const labels: Record<string, string> = {
    TITLE: 'ชื่อสินค้าไม่ครบ',
    PRICE: 'ยังไม่มีราคาขาย',
    IMAGE: 'ยังไม่มีรูปสาธารณะ',
    ITEM_CONDITION: 'ยังไม่ได้ระบุสภาพ Merchant',
    INDEX_POLICY: 'หน้า SKU ยังไม่ตั้ง INDEX',
    PURCHASE_FLOW_DISABLED: 'Checkout ยังไม่เปิดใช้งาน',
    MERCHANT_DISABLED: 'ยังไม่ได้เปิด Merchant สำหรับ SKU นี้',
    WEBSITE_NOT_PUBLISHED: 'ยังไม่ได้ Publish ไปเว็บไซต์',
    PRODUCT_NOT_AVAILABLE: 'สินค้าไม่ได้อยู่สถานะพร้อมขาย',
    GTIN_INVALID: 'GTIN รูปแบบไม่ถูกต้อง',
  }
  return labels[code] || code
}

export function validateGtin(value?: string | null) {
  const gtin = (value || '').replace(/\s+/g, '')
  if (!gtin) return true
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false
  const digits = gtin.split('').map(Number)
  const check = digits.pop()!
  let sum = 0
  for (let i = digits.length - 1, pos = 0; i >= 0; i--, pos++) sum += digits[i] * (pos % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === check
}
