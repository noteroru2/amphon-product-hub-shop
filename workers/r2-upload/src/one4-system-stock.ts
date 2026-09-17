export interface One4SystemStockEnv {
  SYSTEM_API_BASE_URL?: string
  SHOP_INTEGRATION_KEY_ID?: string
  SHOP_INTEGRATION_SECRET?: string
  ONE4_SYSTEM_STOCK_ENABLED?: string
}

export type One4SystemReservationItem = {
  sku: string
  productIdentityId: string
  hubProductId: string
  availability: 'RESERVED' | 'IN_STOCK' | 'SOLD'
  availabilityVersion: number
  unitPrice?: number
  profit?: number
}

export type One4SystemStockResult = {
  ok: boolean
  outcome?: 'RESERVED' | 'RELEASED' | 'SOLD' | 'REJECTED' | 'CONFLICT' | 'DISABLED'
  duplicate?: boolean
  checkoutIdempotencyKey?: string
  expiresAt?: string
  releasedCount?: number
  soldCount?: number
  orderId?: string
  paymentProvider?: string
  paidAt?: string
  items?: One4SystemReservationItem[]
  errorCode?: string | null
}

const STOCK_PATH = '/api/integrations/v1/shop/stock'

function clean(value: unknown) {
  return String(value ?? '').trim()
}

export function one4SystemStockEnabled(env: One4SystemStockEnv) {
  return clean(env.ONE4_SYSTEM_STOCK_ENABLED).toLowerCase() === 'true'
}

function requireConfig(env: One4SystemStockEnv) {
  const base = clean(env.SYSTEM_API_BASE_URL)
  const keyId = clean(env.SHOP_INTEGRATION_KEY_ID)
  const secret = clean(env.SHOP_INTEGRATION_SECRET)
  if (!base || !keyId || !secret) throw new Error('ONE4_SYSTEM_STOCK_NOT_CONFIGURED')
  const url = new URL(STOCK_PATH, base.endsWith('/') ? base : `${base}/`)
  if (url.protocol !== 'https:') throw new Error('ONE4_SYSTEM_API_HTTPS_REQUIRED')
  return { url, keyId, secret }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return bytesToHex(new Uint8Array(digest))
}

async function hmacHex(secret: string, canonical: string) {
  const secretBytes = new TextEncoder().encode(secret)
  const messageBytes = new TextEncoder().encode(canonical)
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(secretBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, toArrayBuffer(messageBytes))
  return bytesToHex(new Uint8Array(signature))
}

async function send(
  env: One4SystemStockEnv,
  body: Record<string, unknown>,
): Promise<One4SystemStockResult> {
  if (!one4SystemStockEnabled(env)) {
    return { ok: false, outcome: 'DISABLED', errorCode: 'ONE4_SYSTEM_STOCK_DISABLED' }
  }
  const { url, keyId, secret } = requireConfig(env)
  const bodyText = JSON.stringify(body)
  const bytes = new TextEncoder().encode(bodyText)
  const timestamp = new Date().toISOString()
  const nonce = crypto.randomUUID()
  const canonical = [timestamp, nonce, 'POST', url.pathname, await sha256Hex(bytes)].join('\n')
  const signature = await hmacHex(secret, canonical)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-amphon-key-id': keyId,
      'x-amphon-timestamp': timestamp,
      'x-amphon-nonce': nonce,
      'x-amphon-signature': signature,
      'user-agent': 'amphon-shop-one4/1',
    },
    body: bodyText,
  })
  const text = await response.text()
  let parsed: One4SystemStockResult
  try {
    parsed = text ? JSON.parse(text) as One4SystemStockResult : { ok: false }
  } catch {
    parsed = { ok: false, errorCode: `ONE4_SYSTEM_RESPONSE_INVALID:${response.status}` }
  }
  if (!response.ok && !parsed.errorCode) parsed.errorCode = `ONE4_SYSTEM_HTTP_${response.status}`
  return parsed
}

function normalizedSkus(skus: string[]) {
  return [...new Set(skus.map((sku) => clean(sku).toUpperCase()).filter(Boolean))].sort()
}

export async function reserveOne4SystemStock(env: One4SystemStockEnv, input: {
  checkoutIdempotencyKey: string
  skus: string[]
  expiresAt: string
}) {
  const checkoutKey = clean(input.checkoutIdempotencyKey)
  return send(env, {
    action: 'RESERVE',
    commandKey: `shop:${checkoutKey}:reserve:v1`,
    checkoutIdempotencyKey: checkoutKey,
    skus: normalizedSkus(input.skus),
    expiresAt: input.expiresAt,
  })
}

export async function releaseOne4SystemStock(env: One4SystemStockEnv, input: {
  checkoutIdempotencyKey: string
  skus: string[]
  reason?: string
}) {
  const checkoutKey = clean(input.checkoutIdempotencyKey)
  return send(env, {
    action: 'RELEASE',
    commandKey: `shop:${checkoutKey}:release:v1`,
    checkoutIdempotencyKey: checkoutKey,
    skus: normalizedSkus(input.skus),
    reason: clean(input.reason || 'SHOP_ORDER_CREATE_FAILED'),
  })
}

export async function confirmOne4SystemSale(env: One4SystemStockEnv, input: {
  checkoutIdempotencyKey: string
  orderId: string
  skus: string[]
  saleItems: Array<{ sku: string; unitPrice: number }>
  paymentProvider: string
  paymentReference?: string | null
  paidAt: string
}) {
  const checkoutKey = clean(input.checkoutIdempotencyKey)
  const skus = normalizedSkus(input.skus)
  const saleItems = input.saleItems
    .map((item) => ({ sku: clean(item.sku).toUpperCase(), unitPrice: Number(item.unitPrice) }))
    .sort((a, b) => a.sku.localeCompare(b.sku))
  return send(env, {
    action: 'CONFIRM_SOLD',
    commandKey: `shop:${checkoutKey}:confirm-sold:v1`,
    checkoutIdempotencyKey: checkoutKey,
    orderId: clean(input.orderId),
    skus,
    saleItems,
    paymentProvider: clean(input.paymentProvider || 'MANUAL').toUpperCase(),
    paymentReference: clean(input.paymentReference || '') || null,
    paidAt: clean(input.paidAt),
  })
}
