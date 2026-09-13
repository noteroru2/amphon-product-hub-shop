import { getCustomerAuthConfig, getValidCustomerSession } from './customer-auth'

export interface CustomerProfile {
  id: string
  auth_user_id: string
  email: string | null
  display_name: string | null
  phone: string | null
  email_verified_at: string | null
  auth_provider: string
  status: 'ACTIVE' | 'DISABLED'
}

export interface CustomerAddress {
  id: string
  customer_id: string
  label: string
  recipient_name: string
  phone: string
  address_line1: string
  address_line2: string | null
  subdistrict: string
  district: string
  province: string
  postal_code: string
  country_code: 'TH'
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CustomerAddressInput {
  label: string
  recipient_name: string
  phone: string
  address_line1: string
  address_line2?: string | null
  subdistrict: string
  district: string
  province: string
  postal_code: string
  make_default?: boolean
}

async function customerRestFetch(path: string, init: RequestInit = {}) {
  const session = await getValidCustomerSession()
  if (!session?.access_token) throw new Error('กรุณาเข้าสู่ระบบก่อนจัดการข้อมูลบัญชี')
  const { url, key } = getCustomerAuthConfig()
  const headers = new Headers(init.headers || {})
  headers.set('apikey', key)
  headers.set('authorization', `Bearer ${session.access_token}`)
  headers.set('content-type', 'application/json')
  const response = await fetch(`${url}/rest/v1${path}`, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'message' in data
      ? String((data as { message?: unknown }).message || `HTTP ${response.status}`)
      : String(data || `HTTP ${response.status}`)
    throw new Error(message)
  }
  return data
}

export async function getCustomerProfile() {
  const data = await customerRestFetch('/commerce_customer_profiles?select=id,auth_user_id,email,display_name,phone,email_verified_at,auth_provider,status&limit=1')
  return (Array.isArray(data) ? data[0] : null) as CustomerProfile | null
}

export async function updateCustomerProfile(profileId: string, input: { display_name: string; phone: string | null }) {
  const data = await customerRestFetch(`/commerce_customer_profiles?id=eq.${encodeURIComponent(profileId)}&select=id,auth_user_id,email,display_name,phone,email_verified_at,auth_provider,status`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      display_name: input.display_name.trim(),
      phone: input.phone?.trim() || null,
    }),
  })
  return (Array.isArray(data) ? data[0] : null) as CustomerProfile | null
}

export async function listCustomerAddresses() {
  const data = await customerRestFetch('/commerce_customer_addresses?select=id,customer_id,label,recipient_name,phone,address_line1,address_line2,subdistrict,district,province,postal_code,country_code,is_default,is_active,created_at,updated_at&is_active=eq.true&order=is_default.desc,updated_at.desc')
  return (Array.isArray(data) ? data : []) as CustomerAddress[]
}

function cleanAddress(input: CustomerAddressInput) {
  return {
    label: input.label.trim() || 'บ้าน',
    recipient_name: input.recipient_name.trim(),
    phone: input.phone.trim(),
    address_line1: input.address_line1.trim(),
    address_line2: input.address_line2?.trim() || null,
    subdistrict: input.subdistrict.trim(),
    district: input.district.trim(),
    province: input.province.trim(),
    postal_code: input.postal_code.trim(),
    country_code: 'TH',
    is_active: true,
  }
}

export async function createCustomerAddress(customerId: string, input: CustomerAddressInput) {
  const existing = await listCustomerAddresses()
  const shouldDefault = input.make_default === true || existing.length === 0
  const data = await customerRestFetch('/commerce_customer_addresses?select=id,customer_id,label,recipient_name,phone,address_line1,address_line2,subdistrict,district,province,postal_code,country_code,is_default,is_active,created_at,updated_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...cleanAddress(input), customer_id: customerId, is_default: false }),
  })
  const created = (Array.isArray(data) ? data[0] : null) as CustomerAddress | null
  if (created && shouldDefault) await setCustomerDefaultAddress(created.id)
  return created
}

export async function updateCustomerAddress(addressId: string, input: CustomerAddressInput) {
  const data = await customerRestFetch(`/commerce_customer_addresses?id=eq.${encodeURIComponent(addressId)}&select=id,customer_id,label,recipient_name,phone,address_line1,address_line2,subdistrict,district,province,postal_code,country_code,is_default,is_active,created_at,updated_at`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(cleanAddress(input)),
  })
  const updated = (Array.isArray(data) ? data[0] : null) as CustomerAddress | null
  if (updated && input.make_default) await setCustomerDefaultAddress(updated.id)
  return updated
}

export async function setCustomerDefaultAddress(addressId: string) {
  await customerRestFetch('/rpc/set_customer_default_address', {
    method: 'POST',
    body: JSON.stringify({ target_address_id: addressId }),
  })
}

export async function deleteCustomerAddress(addressId: string) {
  await customerRestFetch('/rpc/delete_customer_address', {
    method: 'POST',
    body: JSON.stringify({ target_address_id: addressId }),
  })
}

export function friendlyCustomerDataError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '')
  const text = raw.toLowerCase()
  if (text.includes('customer_profile_not_found')) return 'ไม่พบโปรไฟล์ลูกค้า กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่'
  if (text.includes('address_not_found')) return 'ไม่พบที่อยู่นี้ หรือคุณไม่มีสิทธิ์แก้ไข'
  if (text.includes('postal_code') || text.includes('check constraint')) return 'กรุณาตรวจสอบข้อมูลที่อยู่และรหัสไปรษณีย์ 5 หลัก'
  if (text.includes('jwt') || text.includes('permission') || text.includes('row-level') || text.includes('rls')) return 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาเข้าสู่ระบบใหม่'
  return raw || 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่'
}
