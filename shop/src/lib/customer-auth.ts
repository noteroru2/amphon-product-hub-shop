export interface CustomerAuthIdentity {
  id?: string
  identity_id?: string
  provider: string
  email?: string | null
  identity_data?: Record<string, unknown>
}

export interface CustomerAuthUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  identities?: CustomerAuthIdentity[] | null
}

export interface CustomerAuthSession {
  access_token: string
  refresh_token: string
  expires_at: number
  expires_in?: number
  token_type?: string
  user?: CustomerAuthUser | null
}

type AuthResponse = CustomerAuthSession & {
  user?: CustomerAuthUser | null
  session?: CustomerAuthSession | null
  error?: string
  error_description?: string
  msg?: string
  message?: string
  url?: string | null
}

const SESSION_KEY = 'amphon_shop_customer_auth_v1'
const OAUTH_NEXT_KEY = 'amphon_shop_customer_oauth_next_v1'
const OAUTH_MODE_KEY = 'amphon_shop_customer_oauth_mode_v1'
const DEFAULT_SUPABASE_URL = 'https://mfpdtlxwdbxitgfzdape.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TWyHir8t7-LO7PZLHAzR6Q_yXjDRK5-'

function authConfig() {
  const url = String(import.meta.env.PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/$/, '')
  const key = String(import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY).trim()
  if (!url || !key) throw new Error('ระบบสมาชิกยังตั้งค่าไม่ครบ กรุณาติดต่อร้าน')
  return { url, key }
}

export function getCustomerAuthConfig() {
  return authConfig()
}

function headers(accessToken?: string) {
  const { key } = authConfig()
  const result: Record<string, string> = {
    apikey: key,
    'content-type': 'application/json',
  }
  if (accessToken) result.authorization = `Bearer ${accessToken}`
  return result
}

async function authFetch(path: string, init: RequestInit = {}) {
  const { url } = authConfig()
  const response = await fetch(`${url}/auth/v1${path}`, init)
  const data = (await response.json().catch(() => ({}))) as AuthResponse
  if (!response.ok) {
    const message = data.msg || data.message || data.error_description || data.error || `Auth ${response.status}`
    throw new Error(String(message))
  }
  return data
}

function normalizeSession(value: Partial<CustomerAuthSession> | null | undefined): CustomerAuthSession | null {
  if (!value?.access_token || !value?.refresh_token) return null
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = Number(value.expires_at || now + Number(value.expires_in || 3600))
  return {
    access_token: String(value.access_token),
    refresh_token: String(value.refresh_token),
    expires_at: expiresAt,
    expires_in: Number(value.expires_in || Math.max(0, expiresAt - now)),
    token_type: value.token_type || 'bearer',
    user: value.user || null,
  }
}

export function saveCustomerSession(value: Partial<CustomerAuthSession> | null | undefined) {
  const session = normalizeSession(value)
  if (!session) return null
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  window.dispatchEvent(new CustomEvent('amphon:customer-auth'))
  return session
}

export function clearCustomerSession() {
  localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new CustomEvent('amphon:customer-auth'))
}

export function readCustomerSession(): CustomerAuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return normalizeSession(JSON.parse(raw) as CustomerAuthSession)
  } catch {
    clearCustomerSession()
    return null
  }
}

export async function refreshCustomerSession() {
  const current = readCustomerSession()
  if (!current?.refresh_token) return null
  try {
    const data = await authFetch('/token?grant_type=refresh_token', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    })
    return saveCustomerSession(data)
  } catch (error) {
    clearCustomerSession()
    throw error
  }
}

export async function getValidCustomerSession() {
  const current = readCustomerSession()
  if (!current) return null
  const now = Math.floor(Date.now() / 1000)
  if (current.expires_at > now + 60) return current
  return refreshCustomerSession()
}

export async function getCustomerUser() {
  const session = await getValidCustomerSession()
  if (!session) return null
  try {
    const data = await authFetch('/user', {
      method: 'GET',
      headers: headers(session.access_token),
    })
    const user = data as unknown as CustomerAuthUser
    saveCustomerSession({ ...session, user })
    return user
  } catch {
    clearCustomerSession()
    return null
  }
}

export async function signUpCustomer(input: {
  email: string
  password: string
  displayName: string
  redirectTo: string
}) {
  const redirect = encodeURIComponent(input.redirectTo)
  const data = await authFetch(`/signup?redirect_to=${redirect}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      data: { display_name: input.displayName.trim() },
    }),
  })
  const session = normalizeSession(data.session || data)
  if (session) saveCustomerSession(session)
  return { user: data.user || session?.user || null, session }
}

export async function signInCustomer(email: string, password: string) {
  const data = await authFetch('/token?grant_type=password', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  })
  const session = saveCustomerSession(data)
  if (!session) throw new Error('ไม่สามารถสร้างเซสชันเข้าสู่ระบบได้')
  return session
}

function setPendingOAuth(mode: 'signin' | 'link', nextPath: string) {
  try {
    sessionStorage.setItem(OAUTH_MODE_KEY, mode)
    sessionStorage.setItem(OAUTH_NEXT_KEY, safeNextPath(nextPath))
  } catch {
    // OAuth still works even when sessionStorage is unavailable; callback falls back to /account/.
  }
}

export function readPendingCustomerOAuth() {
  try {
    return {
      mode: sessionStorage.getItem(OAUTH_MODE_KEY) === 'link' ? 'link' as const : 'signin' as const,
      next: safeNextPath(sessionStorage.getItem(OAUTH_NEXT_KEY)),
    }
  } catch {
    return { mode: 'signin' as const, next: '/account/' }
  }
}

export function clearPendingCustomerOAuth() {
  try {
    sessionStorage.removeItem(OAUTH_MODE_KEY)
    sessionStorage.removeItem(OAUTH_NEXT_KEY)
  } catch {
    // Ignore storage restrictions.
  }
}

function googleCallbackUrl() {
  return new URL('/account/oauth-callback/', location.origin).toString()
}

export function startGoogleSignIn(nextPath = '/account/') {
  const { url } = authConfig()
  setPendingOAuth('signin', nextPath)
  const authorize = new URL(`${url}/auth/v1/authorize`)
  authorize.searchParams.set('provider', 'google')
  authorize.searchParams.set('redirect_to', googleCallbackUrl())
  location.assign(authorize.toString())
}

export async function linkGoogleIdentity(nextPath = '/account/') {
  const session = await getValidCustomerSession()
  if (!session) throw new Error('กรุณาเข้าสู่ระบบก่อนเชื่อมบัญชี Google')
  setPendingOAuth('link', nextPath)
  const redirect = encodeURIComponent(googleCallbackUrl())
  const data = await authFetch(`/user/identities/authorize?provider=google&redirect_to=${redirect}`, {
    method: 'GET',
    headers: headers(session.access_token),
  })
  if (!data.url) throw new Error('ไม่สามารถเริ่มการเชื่อมบัญชี Google ได้')
  location.assign(data.url)
}

export function customerHasIdentity(user: CustomerAuthUser | null | undefined, provider: string) {
  return Boolean(user?.identities?.some((identity) => identity.provider === provider))
}

export async function signOutCustomer() {
  const session = readCustomerSession()
  try {
    if (session?.access_token) {
      await authFetch('/logout', {
        method: 'POST',
        headers: headers(session.access_token),
      })
    }
  } finally {
    clearCustomerSession()
  }
}

export async function requestCustomerPasswordReset(email: string, redirectTo: string) {
  await authFetch(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  })
}

export async function updateCustomerPassword(password: string) {
  const session = await getValidCustomerSession()
  if (!session) throw new Error('ลิงก์ตั้งรหัสผ่านหมดอายุ กรุณาขอลิงก์ใหม่')
  const data = await authFetch('/user', {
    method: 'PUT',
    headers: headers(session.access_token),
    body: JSON.stringify({ password }),
  })
  saveCustomerSession({ ...session, user: data as unknown as CustomerAuthUser })
  return data as unknown as CustomerAuthUser
}

export function consumeCustomerAuthRedirect() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(location.search)
  const error = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error')
  const type = hash.get('type') || query.get('type') || ''
  if (error) return { session: null, type, error }

  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  if (!accessToken || !refreshToken) return { session: readCustomerSession(), type, error: null }

  const expiresIn = Number(hash.get('expires_in') || 3600)
  const expiresAt = Number(hash.get('expires_at') || Math.floor(Date.now() / 1000) + expiresIn)
  const session = saveCustomerSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: hash.get('token_type') || 'bearer',
  })
  history.replaceState({}, document.title, location.pathname)
  return { session, type, error: null }
}

export function safeNextPath(value: string | null | undefined, fallback = '/account/') {
  if (!value) return fallback
  try {
    const url = new URL(value, location.origin)
    if (url.origin !== location.origin || !url.pathname.startsWith('/')) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function friendlyAuthError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '')
  const text = raw.toLowerCase()
  if (text.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (text.includes('email not confirmed')) return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ'
  if (text.includes('user already registered')) return 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ'
  if (text.includes('password should be')) return 'รหัสผ่านยังไม่ผ่านเงื่อนไขความปลอดภัย'
  if (text.includes('provider is not enabled') || text.includes('unsupported provider')) return 'ยังไม่ได้เปิดใช้งาน Google Sign-In ในระบบ กรุณาติดต่อร้าน'
  if (text.includes('manual linking') || text.includes('identity linking')) return 'ระบบเชื่อมบัญชี Google ยังไม่ได้เปิดใช้งาน กรุณาติดต่อร้าน'
  if (text.includes('identity is already linked') || text.includes('already been linked')) return 'บัญชี Google นี้ถูกเชื่อมกับบัญชีอื่นแล้ว'
  if (text.includes('rate limit') || text.includes('too many')) return 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
  if (text.includes('expired') || text.includes('invalid token')) return 'ลิงก์หมดอายุหรือใช้ไม่ได้ กรุณาขอลิงก์ใหม่'
  return raw || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}
