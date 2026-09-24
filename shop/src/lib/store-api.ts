export type StoreAvailability = 'available' | 'reserved' | 'out_of_stock'
export type IndexPolicy = 'INDEX' | 'NOINDEX' | 'HOLD' | 'RETIRED'
export type EvergreenPageType = 'BRAND' | 'SERIES' | 'MODEL'

export interface StoreImage {
  url: string
  role: string
  isCover: boolean
  sortOrder: number
  width?: number | null
  height?: number | null
}

export interface CatalogIdentity {
  id?: string | null
  name: string
  slug: string
}

export interface CatalogModelIdentity extends CatalogIdentity {
  code: string | null
}

export interface StoreProduct {
  sku: string
  title: string
  category: string
  subtype: string | null
  brand: string | null
  model: string | null
  price: number
  conditionPercent: number | null
  warrantyUntil: string | null
  defects: string | null
  specs: Record<string, unknown>
  status: 'published' | 'reserved' | string
  availability: StoreAvailability
  images: StoreImage[]
  publishedAt: string | null
  updatedAt: string | null

  listingSlug?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  indexPolicy?: IndexPolicy | null
  categoryId?: string | null
  categoryKey?: string | null
  categoryName?: string | null
  categorySlug?: string | null
  catalogBrand?: CatalogIdentity | null
  catalogSeries?: CatalogIdentity | null
  catalogModel?: CatalogModelIdentity | null
  merchantEnabled?: boolean
  merchantItemCondition?: 'NEW' | 'USED' | 'REFURBISHED' | string
  googleProductCategory?: string | null
  gtin?: string | null
  mpn?: string | null
}


export interface StoreSettings {
  merchantName: string
  legalName: string | null
  siteUrl: string
  currency: string
  countryCode: string
  purchaseEnabled: boolean
  purchaseActivationLocked?: boolean
  checkout?: {
    enabled: boolean
    reservationMinutes: number
    bankTransferEnabled: boolean
    stripeEnabled: boolean
    promptPayEnabled: boolean
    payAtStoreEnabled: boolean
    pickupEnabled: boolean
    termsUrl: string | null
    turnstileEnabled: boolean
    turnstileSiteKey: string | null
  }
  shipping: {
    enabled: boolean
    country: string
    rate: number | null
    handlingMinDays: number | null
    handlingMaxDays: number | null
    transitMinDays: number | null
    transitMaxDays: number | null
    policyUrl: string | null
  }
  returns: {
    enabled: boolean
    category: 'FINITE' | 'NOT_PERMITTED' | 'UNLIMITED' | string | null
    days: number | null
    method: 'MAIL' | 'IN_STORE' | 'MAIL_AND_IN_STORE' | string | null
    fees: 'FREE' | 'CUSTOMER_RESPONSIBILITY' | string | null
    policyUrl: string | null
  }
  warrantyPolicyUrl: string | null
  warranty?: { defaultDays: number }
  documents?: { mode: string }
  updatedAt: string | null
}

export interface ProductListResult {
  products: StoreProduct[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}


export interface StoreVerifiedReview {
  id: string
  product_id?: string
  sku: string
  product_title?: string
  rating: number
  title: string | null
  body: string
  display_name: string
  verified_purchase: boolean
  submitted_at: string
  moderated_at?: string | null
}

export interface StoreReviewInvite {
  valid: boolean
  product_title: string
  product_sku: string
  expires_at: string
  already_used: boolean
}

export interface ListStoreProductsParams {
  q?: string
  category?: string
  subtype?: string
  availability?: StoreAvailability | 'all'
  categorySlug?: string
  brandSlug?: string
  seriesSlug?: string
  modelSlug?: string
  limit?: number
  offset?: number
}

export interface EvergreenFaq {
  question: string
  answer: string
}

export interface EvergreenPage {
  pageType: EvergreenPageType
  entityId: string
  category: { id: string; key: string; name: string; slug: string }
  brand: { id: string; name: string; slug: string }
  series: { id: string; name: string; slug: string } | null
  model: { id: string; name: string; code: string | null; slug: string } | null
  seoTitle: string | null
  seoDescription: string | null
  seoH1: string | null
  primaryKeyword: string | null
  introContent: string | null
  editorialContent: string | null
  faq: EvergreenFaq[]
  indexPolicy: IndexPolicy
  seoReady: boolean
  effectiveIndexPolicy: IndexPolicy
  canonicalPath: string
  currentStockCount: number
  historicalListingCount: number
  updatedAt: string | null
  sortOrder: number
}

export interface EvergreenPageListResult {
  pages: EvergreenPage[]
  pagination: { total: number; limit: number; offset: number; hasMore: boolean }
}


export type SpecDimension = 'GPU' | 'CPU' | 'RAM' | 'STORAGE'

export interface SpecPage {
  id: string
  dimension: SpecDimension
  token: string
  label: string
  canonicalPath: string
  primaryKeyword: string
  seoTitle: string
  seoDescription: string
  introContent: string
  indexPolicy: IndexPolicy
  seoReady: boolean
  effectiveIndexPolicy: IndexPolicy
  currentStockCount: number
  historicalListingCount: number
  distinctBrandCount: number
  gscImpressions28d: number
  gscClicks28d: number
  updatedAt: string | null
}

export interface SpecPageListResult {
  pages: SpecPage[]
  pagination: { total: number; limit: number; offset: number; hasMore: boolean }
}

export interface ListSpecPagesParams {
  dimension?: SpecDimension
  effectiveIndexPolicy?: IndexPolicy
  limit?: number
  offset?: number
}

export interface ListEvergreenPagesParams {
  pageType?: EvergreenPageType
  category?: string
  brand?: string
  series?: string
  model?: string
  effectiveIndexPolicy?: IndexPolicy
  limit?: number
  offset?: number
}

function storeApiBase() {
  const value = import.meta.env.PUBLIC_AMPHON_STORE_API?.trim().replace(/\/$/, '')
  if (!value) throw new Error('Missing PUBLIC_AMPHON_STORE_API')
  return value
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers || {}) },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Store API ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  return response.json() as Promise<T>
}

function queryString(params: object) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === 'all') continue
    query.set(key, String(value))
  }
  return query.size ? `?${query.toString()}` : ''
}


export async function getStoreSettings(): Promise<StoreSettings | null> {
  const response = await fetch(`${storeApiBase()}/settings`, { headers: { accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Store API ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  const data = await response.json() as { settings: StoreSettings }
  return data.settings
}

export async function listStoreProducts(params: ListStoreProductsParams = {}): Promise<ProductListResult> {
  return fetchJson<ProductListResult>(`${storeApiBase()}/products${queryString(params)}`)
}

export async function getStoreProduct(sku: string): Promise<StoreProduct | null> {
  const response = await fetch(`${storeApiBase()}/products/${encodeURIComponent(sku)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Store API ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  const data = await response.json() as { product: StoreProduct }
  return data.product
}


export async function listVerifiedProductReviews(sku: string, limit = 10): Promise<StoreVerifiedReview[]> {
  const data = await fetchJson<{ reviews: StoreVerifiedReview[] }>(
    `${storeApiBase()}/reviews?sku=${encodeURIComponent(sku)}&limit=${Math.min(Math.max(limit, 1), 50)}`,
  )
  return data.reviews || []
}

export async function resolveStoreReviewInvite(token: string): Promise<StoreReviewInvite | null> {
  const response = await fetch(`${storeApiBase()}/review-invites/${encodeURIComponent(token)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Store API ${response.status}`)
  const data = await response.json() as { invite: StoreReviewInvite }
  return data.invite
}

export async function submitStoreVerifiedReview(input: {
  token: string
  rating: number
  title?: string
  body: string
  displayName: string
}) {
  return fetchJson<{ ok: boolean; reviewId: string; status: string }>(`${storeApiBase()}/reviews/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function listEvergreenPages(params: ListEvergreenPagesParams = {}): Promise<EvergreenPageListResult> {
  return fetchJson<EvergreenPageListResult>(`${storeApiBase()}/seo-pages${queryString(params)}`)
}

export async function resolveEvergreenPage(params: {
  category: string
  brand: string
  series?: string
  model?: string
}): Promise<EvergreenPage | null> {
  const response = await fetch(`${storeApiBase()}/seo-pages/resolve${queryString(params)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Store API ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  const data = await response.json() as { page: EvergreenPage }
  return data.page
}

export async function getAllStoreProducts(maxPages = 100): Promise<StoreProduct[]> {
  const products: StoreProduct[] = []
  const limit = 100
  let offset = 0
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listStoreProducts({ availability: 'all', limit, offset })
    products.push(...result.products)
    if (!result.pagination.hasMore) break
    offset += limit
  }
  return products
}

export async function getAllIndexEvergreenPages(maxPages = 100): Promise<EvergreenPage[]> {
  const pages: EvergreenPage[] = []
  const limit = 200
  let offset = 0
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listEvergreenPages({ effectiveIndexPolicy: 'INDEX', limit, offset })
    pages.push(...result.pages)
    if (!result.pagination.hasMore) break
    offset += limit
  }
  return pages
}


export async function listSpecPages(params: ListSpecPagesParams = {}): Promise<SpecPageListResult> {
  return fetchJson<SpecPageListResult>(`${storeApiBase()}/spec-pages${queryString(params)}`)
}

export async function resolveSpecPage(params: { dimension: SpecDimension | string; token: string }): Promise<SpecPage | null> {
  const response = await fetch(`${storeApiBase()}/spec-pages/resolve${queryString(params)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Store API ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  const data = await response.json() as { page: SpecPage }
  return data.page
}

export async function getAllIndexSpecPages(maxPages = 20): Promise<SpecPage[]> {
  const pages: SpecPage[] = []
  const limit = 200
  let offset = 0
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listSpecPages({ effectiveIndexPolicy: 'INDEX', limit, offset })
    pages.push(...result.pages)
    if (!result.pagination.hasMore) break
    offset += limit
  }
  return pages
}


export interface StoreOrderItem {
  sku: string
  title: string
  unitPrice: number
  condition: string
  warrantyDays?: number
}

export interface StoreOrder {
  orderNumber: string
  publicToken: string
  orderStatus: string
  paymentStatus: string
  fulfillmentStatus: string
  paymentMethod: 'BANK_TRANSFER' | 'PAY_AT_STORE' | 'STRIPE' | string
  paymentProvider?: string
  providerPaymentStatus?: string | null
  refundStatus?: string | null
  paymentUrl?: string | null
  deliveryMethod: 'SHIPPING' | 'PICKUP' | string
  currency: string
  subtotal: number
  shippingAmount: number
  total: number
  reservationExpiresAt: string
  paymentReference: string | null
  paymentNotifiedAt: string | null
  paidAt: string | null
  trackingCarrier: string | null
  trackingNumber: string | null
  trackingUrl?: string | null
  shipmentStatus?: string | null
  shippedAt: string | null
  deliveredAt?: string | null
  completedAt: string | null
  createdAt: string
  items: StoreOrderItem[]
  document?: { publicToken: string; number: string; type: string; issuedAt: string } | null
  warranties?: Array<{ publicToken: string; certificateNumber: string; sku: string; title: string; status: string; startsAt: string; endsAt: string }>
  paymentInstructions: null | { bankName: string; accountName: string; accountNumber: string }
}

export interface StoreDocument { number: string; type: string; seller: Record<string, unknown>; customer: Record<string, unknown>; totals: Record<string, unknown>; items: unknown[]; issuedAt: string; eTaxIntegrated: boolean }
export interface StoreWarranty { certificateNumber: string; sku: string; title: string; warrantyDays: number; terms: string | null; startsAt: string; endsAt: string; status: string }

export async function getStoreOrder(publicToken: string): Promise<StoreOrder | null> {
  const response = await fetch(`${storeApiBase()}/orders/${encodeURIComponent(publicToken)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Store API ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  const data = await response.json() as { order: StoreOrder }
  return data.order
}


export async function getStoreDocument(publicToken: string): Promise<StoreDocument | null> {
  const response = await fetch(`${storeApiBase()}/documents/${encodeURIComponent(publicToken)}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Store API ${response.status}`)
  const data = await response.json() as { document: StoreDocument }
  return data.document
}

export async function getStoreWarranty(publicToken: string): Promise<StoreWarranty | null> {
  const response = await fetch(`${storeApiBase()}/warranties/${encodeURIComponent(publicToken)}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Store API ${response.status}`)
  const data = await response.json() as { warranty: StoreWarranty }
  return data.warranty
}
