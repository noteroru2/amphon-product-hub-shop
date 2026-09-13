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
  if (text.includes('customer_email_not_verified')) return 'กรุณายืนยันอีเมลก่อนผูกคำสั่งซื้อกับบัญชี'
  if (text.includes('member_address_required') || text.includes('customer_address_not_found')) return 'กรุณาเลือกที่อยู่จัดส่งที่บันทึกไว้ในบัญชี'
  if (text.includes('customer_name_required') || text.includes('customer_phone_required')) return 'กรุณาบันทึกชื่อและเบอร์โทรในบัญชีก่อนเลือกรับสินค้าที่ร้าน'
  if (text.includes('order_email_mismatch')) return 'อีเมลใน Checkout ไม่ตรงกับบัญชีสมาชิก กรุณารีโหลดหน้าแล้วลองใหม่'
  if (text.includes('order_identity_window_expired')) return 'Checkout session หมดอายุ กรุณากลับไปตะกร้าแล้วเริ่ม Checkout ใหม่'
  if (text.includes('order_already_owned')) return 'คำสั่งซื้อนี้ถูกผูกกับบัญชีอื่นแล้ว'
  return raw || 'ไม่สามารถผูกคำสั่งซื้อกับบัญชีสมาชิกได้ กรุณาลองใหม่'
}
