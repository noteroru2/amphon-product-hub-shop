import { getCustomerAuthConfig, getValidCustomerSession } from './customer-auth'

export interface CustomerOrderSummary {
  orderId: string
  orderNumber: string
  orderStatus: string
  paymentStatus: string
  fulfillmentStatus: string
  paymentMethod: string
  paymentProvider: string
  deliveryMethod: string
  currency: string
  subtotal: number
  shippingAmount: number
  total: number
  reservationExpiresAt?: string | null
  paidAt?: string | null
  shippedAt?: string | null
  completedAt?: string | null
  trackingCarrier?: string | null
  trackingNumber?: string | null
  itemCount: number
  itemTitles: string[]
  hasDocument: boolean
  warrantyCount: number
  createdAt: string
  updatedAt: string
}

export interface CustomerOrderHistoryResponse {
  orders: CustomerOrderSummary[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export interface CustomerOrderItem {
  sku: string
  title: string
  unitPrice: number
  quantity: number
  condition: string
  warrantyDays: number
  warrantyTerms?: string | null
}

export interface CustomerOrderShipment {
  carrier?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
  status?: string | null
  shippedAt?: string | null
  deliveredAt?: string | null
}

export interface CustomerOrderDocument {
  publicToken: string
  number: string
  type: string
  issuedAt: string
}

export interface CustomerOrderWarranty {
  publicToken: string
  certificateNumber: string
  sku: string
  title: string
  warrantyDays: number
  terms?: string | null
  status: string
  startsAt: string
  endsAt: string
}

export interface CustomerOrderDetail {
  orderId: string
  publicToken: string
  orderNumber: string
  orderStatus: string
  paymentStatus: string
  fulfillmentStatus: string
  paymentMethod: string
  paymentProvider: string
  providerPaymentStatus?: string | null
  refundStatus?: string | null
  deliveryMethod: string
  currency: string
  subtotal: number
  shippingAmount: number
  total: number
  reservationExpiresAt?: string | null
  paidAt?: string | null
  shippedAt?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  expiredAt?: string | null
  refundedAt?: string | null
  paymentUrl?: string | null
  customerProfileSnapshot?: Record<string, unknown> | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  items: CustomerOrderItem[]
  shipment?: CustomerOrderShipment | null
  document?: CustomerOrderDocument | null
  warranties: CustomerOrderWarranty[]
  createdAt: string
  updatedAt: string
}

async function memberOrderRpc<T>(name: string, body: Record<string, unknown>) {
  const session = await getValidCustomerSession()
  if (!session?.access_token) throw new Error('AUTH_REQUIRED')
  const { url, key } = getCustomerAuthConfig()
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    throw new Error(String(payload?.message || payload?.error || `HTTP ${response.status}`))
  }
  return payload as T
}

export function getMyOrders(limit = 20, offset = 0) {
  return memberOrderRpc<CustomerOrderHistoryResponse>('get_my_orders', {
    page_limit: Math.min(Math.max(Math.trunc(limit) || 20, 1), 50),
    page_offset: Math.max(Math.trunc(offset) || 0, 0),
  })
}

export function getMyOrderDetail(orderId: string) {
  return memberOrderRpc<CustomerOrderDetail>('get_my_order_detail', {
    target_order_id: orderId,
  })
}

export function friendlyCustomerOrderError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '')
  const text = raw.toLowerCase()
  if (text.includes('auth_required') || text.includes('jwt')) return 'กรุณาเข้าสู่ระบบเพื่อดูคำสั่งซื้อของคุณ'
  if (text.includes('customer_profile_not_found')) return 'ไม่พบโปรไฟล์สมาชิกที่พร้อมใช้งาน กรุณาเปิดหน้าบัญชีของฉันก่อน'
  if (text.includes('order_not_found')) return 'ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณ'
  return raw || 'โหลดประวัติคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่'
}
