import { supabase } from './supabase'
import type { CommerceOrder, CommerceOrderStatus } from '../types/product'

const apiBase = (import.meta.env.VITE_R2_UPLOAD_API as string | undefined)?.trim().replace(/\/$/, '')

async function token() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
  return data.session.access_token
}

async function orderApi<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) throw new Error(result?.error || `Order API failed (${response.status})`)
  return result as T
}

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeOrder(raw: any): CommerceOrder {
  const items = Array.isArray(raw?.items) ? raw.items : []
  const warranties = Array.isArray(raw?.warranties) ? raw.warranties : []

  return {
    ...raw,
    id: String(raw?.id || ''),
    orderNumber: String(raw?.orderNumber || raw?.id || 'Order'),
    orderStatus: String(raw?.orderStatus || 'AWAITING_PAYMENT') as CommerceOrder['orderStatus'],
    paymentStatus: String(raw?.paymentStatus || 'UNPAID') as CommerceOrder['paymentStatus'],
    fulfillmentStatus: String(raw?.fulfillmentStatus || 'UNFULFILLED') as CommerceOrder['fulfillmentStatus'],
    paymentMethod: String(raw?.paymentMethod || 'BANK_TRANSFER'),
    paymentProvider: raw?.paymentProvider ? String(raw.paymentProvider) : undefined,
    deliveryMethod: String(raw?.deliveryMethod || 'SHIPPING'),
    customerName: String(raw?.customerName || '-'),
    customerPhone: String(raw?.customerPhone || '-'),
    currency: String(raw?.currency || 'THB'),
    subtotal: finiteNumber(raw?.subtotal),
    shippingAmount: finiteNumber(raw?.shippingAmount),
    total: finiteNumber(raw?.total),
    reservationExpiresAt: String(raw?.reservationExpiresAt || ''),
    createdAt: String(raw?.createdAt || ''),
    items: items.map((item: any) => ({
      ...item,
      productId: item?.productId ? String(item.productId) : undefined,
      sku: String(item?.sku || '-'),
      title: String(item?.title || 'สินค้า'),
      unitPrice: finiteNumber(item?.unitPrice),
    })),
    warranties: warranties.map((warranty: any) => ({
      ...warranty,
      publicToken: String(warranty?.publicToken || ''),
      warrantyNumber: String(warranty?.warrantyNumber || '-'),
      sku: String(warranty?.sku || '-'),
    })),
  }
}

export async function listCommerceOrders(status: CommerceOrderStatus | 'ALL' = 'ALL') {
  const result = await orderApi<{ orders?: unknown }>(`/commerce/orders?status=${encodeURIComponent(status)}&limit=100`)
  return (Array.isArray(result?.orders) ? result.orders : []).map(normalizeOrder)
}

export async function actOnCommerceOrder(orderId: string, action: 'CONFIRM_PAYMENT' | 'CANCEL' | 'MARK_PACKING' | 'MARK_SHIPPED' | 'MARK_IN_TRANSIT' | 'MARK_DELIVERED' | 'MARK_PICKUP_READY' | 'COMPLETE' | 'REFUND' | 'OPEN_WARRANTY_CLAIM', data: { trackingCarrier?: string; trackingNumber?: string; trackingUrl?: string; warrantyId?: string; issue?: string } = {}) {
  return orderApi<{ result: unknown }>(`/commerce/orders/${encodeURIComponent(orderId)}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action, ...data }),
  })
}
