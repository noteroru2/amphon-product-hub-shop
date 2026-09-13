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
  availability: 'available' | 'reserved' | 'out_of_stock'
  images: Array<{ url: string; role: string; isCover: boolean; sortOrder: number; width?: number | null; height?: number | null }>
  publishedAt: string | null
  updatedAt: string | null
  listingSlug?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  indexPolicy?: 'INDEX' | 'NOINDEX' | 'HOLD' | 'RETIRED' | null
  categoryKey?: string | null
  categoryName?: string | null
  categorySlug?: string | null
  catalogBrand?: { name: string; slug: string } | null
  catalogSeries?: { name: string; slug: string } | null
  catalogModel?: { name: string; code: string | null; slug: string } | null
}

const STORE_API = (import.meta.env.PUBLIC_AMPHON_STORE_API as string | undefined)?.replace(/\/$/, '')

function api() {
  if (!STORE_API) throw new Error('Missing PUBLIC_AMPHON_STORE_API')
  return STORE_API
}

export async function listStoreProducts(params: { q?: string; category?: string; subtype?: string; availability?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const response = await fetch(`${api()}/products?${query.toString()}`)
  if (!response.ok) throw new Error(`Store API ${response.status}`)
  return response.json() as Promise<{
    products: StoreProduct[]
    pagination: { total: number; limit: number; offset: number; hasMore: boolean }
  }>
}

export async function getStoreProduct(sku: string) {
  const response = await fetch(`${api()}/products/${encodeURIComponent(sku)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Store API ${response.status}`)
  const data = await response.json() as { product: StoreProduct }
  return data.product
}
