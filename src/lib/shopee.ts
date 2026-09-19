import { supabase } from './supabase'

const apiBase = (import.meta.env.VITE_R2_UPLOAD_API as string | undefined)
  ?.trim()
  .replace(/\/$/, '')

export interface ShopeeConnectionStatus {
  id: string
  shopId: number
  merchantId?: number | null
  region: string
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR'
  accessExpiresAt: string
  refreshExpiresAt: string
  authorizationExpiresAt?: string | null
  lastRefreshAt?: string | null
  lastError?: string | null
  updatedAt: string
}

export interface ShopeeStatus {
  mode: 'disabled' | 'direct_api' | 'partner_api'
  configured: boolean
  blockedReason?: 'DIRECT_API_NOT_AVAILABLE' | 'PARTNER_ADAPTER_NOT_CONFIGURED' | 'DIRECT_API_CREDENTIALS_MISSING' | null
  connections: ShopeeConnectionStatus[]
  settings: {
    autoPublishEnabled: boolean
    publishDelaySeconds: number
    priceMarkupPercent: number
  } | null
  queue: {
    pending: number
    processing: number
    failed: number
  }
  mappings?: {
    categories: number
    publishedProducts: number
  }
}

async function token() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
  return data.session.access_token
}

async function shopeeApi<T>(path: string, init: RequestInit = {}) {
  if (!apiBase) throw new Error('ยังไม่ได้ตั้งค่า VITE_R2_UPLOAD_API')
  const accessToken = await token()
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const result = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    throw new Error(result?.error || `Shopee API failed (${response.status})`)
  }
  return result as T
}

export async function getShopeeStatus() {
  return shopeeApi<ShopeeStatus>('/shopee/status')
}

export async function startShopeeAuthorization() {
  return shopeeApi<{ authorizationUrl: string }>('/shopee/auth/start', {
    method: 'POST',
  })
}

export async function seedShopeeQueue(shopId: number) {
  return shopeeApi<{ queued: number }>('/shopee/queue/seed', {
    method: 'POST',
    body: JSON.stringify({ shopId }),
  })
}

export async function discoverShopee(
  shopId: number,
  kind: 'categories' | 'logistics' | 'attributes',
  categoryIds?: number[],
) {
  const query = new URLSearchParams({
    shop_id: String(shopId),
    kind,
  })
  if (categoryIds?.length) {
    query.set('category_ids', categoryIds.join(','))
  }
  return shopeeApi<any>(`/shopee/discovery?${query.toString()}`)
}

export async function saveShopeeCategoryMapping(input: {
  sourceCategory: string
  sourceSubtype?: string | null
  shopeeCategoryId: number
  shopeeCategoryName?: string | null
  attributeList?: unknown[]
  logisticInfo: unknown[]
  weightKg: number
  dimension?: Record<string, unknown> | null
  brand?: Record<string, unknown> | null
}) {
  return shopeeApi<{ ok: boolean; queued: number }>('/shopee/mappings', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
