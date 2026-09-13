import { getCustomerProfile, listCustomerAddresses, type CustomerAddress, type CustomerProfile } from './customer-account'
import { getCustomerAuthConfig, getValidCustomerSession } from './customer-auth'

export interface CheckoutMemberState {
  authenticated: boolean
  profile: CustomerProfile | null
  addresses: CustomerAddress[]
  defaultAddress: CustomerAddress | null
}

export async function loadCheckoutMemberState(): Promise<CheckoutMemberState> {
  const session = await getValidCustomerSession().catch(() => null)
  if (!session?.access_token) {
    return { authenticated: false, profile: null, addresses: [], defaultAddress: null }
  }

  const [profile, addresses] = await Promise.all([
    getCustomerProfile(),
    listCustomerAddresses(),
  ])

  const activeProfile = profile?.status === 'ACTIVE' ? profile : null
  const activeAddresses = activeProfile ? addresses.filter((address) => address.is_active) : []
  return {
    authenticated: true,
    profile: activeProfile,
    addresses: activeAddresses,
    defaultAddress: activeAddresses.find((address) => address.is_default) || activeAddresses[0] || null,
  }
}

async function publicRestRpc<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { url, key } = getCustomerAuthConfig()
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const value = payload as { message?: unknown; error?: unknown } | null
    throw new Error(String(value?.message || value?.error || `HTTP ${response.status}`))
  }
  return payload as T
}

async function authenticatedRestRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
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

export async function getMemberCheckoutRequired() {
  const result = await publicRestRpc<boolean>('get_member_checkout_policy')
  return result === true
}

export async function prepareMemberCheckoutIntent(
  idempotencyKey: string,
  deliveryMethod: 'SHIPPING' | 'PICKUP',
  addressId: string | null,
) {
  return authenticatedRestRpc<{
    prepared: boolean
    consumed: boolean
    idempotencyKey: string
    customerId: string
    addressId: string | null
    deliveryMethod: 'SHIPPING' | 'PICKUP'
    expiresAt: string
    orderId?: string | null
  }>('prepare_member_checkout_intent', {
    target_idempotency_key: idempotencyKey,
    target_delivery_method: deliveryMethod,
    target_address_id: deliveryMethod === 'SHIPPING' ? addressId : null,
  })
}

// SHOP-8.4 compatibility bridge. SHOP-8.5 no longer needs this when the
// member-required policy is active because ownership is written atomically by
// create_commerce_order(). Keep it for safe rollback while the policy is false.
export async function attachCustomerCheckoutIdentity(idempotencyKey: string, addressId: string | null) {
  return authenticatedRestRpc<{
    attached: boolean
    orderId: string
    publicToken: string
    customerId: string
    authUserId: string
    addressId: string | null
  }>('attach_customer_checkout_identity', {
    target_idempotency_key: idempotencyKey,
    target_address_id: addressId,
  })
}

export function friendlyCheckoutIdentityError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '')
  const text = raw.toLowerCase()
  if (text.includes('auth_required') || text.includes('jwt')) return 'เซสชันสมาชิกหมดอายุ กรุณาเข้าสู่ระบบใหม่ แล้วตะกร้าจะยังอยู่'
  if (text.includes('customer_profile_not_found')) return 'ไม่พบโปรไฟล์สมาชิก กรุณาเปิดหน้าบัญชีของฉันแล้วบันทึกข้อมูลอีกครั้ง'
  if (text.includes('customer_email_not_verified')) return 'กรุณายืนยันอีเมลก่อน Checkout'
  if (text.includes('customer_email_mismatch')) return 'อีเมลสมาชิกไม่ตรงกับโปรไฟล์ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่'
  if (text.includes('member_address_required') || text.includes('customer_address_not_found')) return 'กรุณาเลือกที่อยู่จัดส่งที่บันทึกไว้ในบัญชี'
  if (text.includes('customer_name_required') || text.includes('customer_phone_required')) return 'กรุณาบันทึกชื่อและเบอร์โทรในบัญชีก่อน Checkout'
  if (text.includes('checkout_intent_already_owned')) return 'Checkout session นี้ถูกผูกกับบัญชีอื่นแล้ว กรุณารีโหลดหน้า'
  if (text.includes('member_checkout_intent_expired')) return 'Checkout session สมาชิกหมดอายุ กรุณากดสั่งซื้ออีกครั้ง'
  if (text.includes('member_checkout_delivery_mismatch')) return 'วิธีรับสินค้าเปลี่ยนแล้ว กรุณากดสั่งซื้ออีกครั้ง'
  if (text.includes('member_checkout_intent_required')) return 'ต้องเข้าสู่ระบบสมาชิกก่อนสร้างคำสั่งซื้อ'
  if (text.includes('order_email_mismatch')) return 'อีเมลใน Checkout ไม่ตรงกับบัญชีสมาชิก กรุณารีโหลดหน้าแล้วลองใหม่'
  if (text.includes('order_identity_window_expired')) return 'Checkout session หมดอายุ กรุณากลับไปตะกร้าแล้วเริ่ม Checkout ใหม่'
  if (text.includes('order_already_owned') || text.includes('member_order_ownership_mismatch')) return 'คำสั่งซื้อนี้ถูกผูกกับบัญชีอื่นแล้ว'
  return raw || 'ไม่สามารถยืนยันบัญชีสมาชิกสำหรับ Checkout ได้ กรุณาลองใหม่'
}
