interface Env {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  SYSTEM_INTEGRATION_KEY_ID: string
  SYSTEM_INTEGRATION_SECRET: string
  INTEGRATION_SIGNATURE_MAX_AGE_SECONDS?: string
}

type Envelope = {
  eventId: string
  eventType: string
  version: number
  source: string
  occurredAt: string
  idempotencyKey: string
  entity: { type: string; id: string | number; sku?: string | null }
  actor?: unknown
  payload: Record<string, unknown>
}

type InboxIdentity = {
  event_id: string
  source: string
  event_type: string
  idempotency_key: string
  status: string
}

const MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_MAX_AGE_SECONDS = 300
const SYSTEM_EVENT_ALLOWLIST = new Set([
  'product.intake_created',
  'product.reserve_requested',
  'product.release_requested',
  'product.mark_sold_requested',
  'product.price_change_requested',
  'publication.end_requested',
])

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function clean(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function maxAgeSeconds(env: Env) {
  const parsed = Number(env.INTEGRATION_SIGNATURE_MAX_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS)
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_AGE_SECONDS
  return Math.min(900, Math.max(30, Math.floor(parsed)))
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array | null {
  const normalized = clean(hex).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) return null
  const bytes = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function sha256Hex(body: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', body)
  return bytesToHex(new Uint8Array(digest))
}

async function verifyHmac(secret: string, signature: string, canonical: string) {
  const signatureBytes = hexToBytes(signature)
  if (!secret || !signatureBytes) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(canonical),
  )
}

function supabaseHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    ...extra,
  }
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...supabaseHeaders(env, { accept: 'application/json' }),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
}

async function readRows<T>(result: Response): Promise<T[]> {
  if (!result.ok) throw new Error(`SUPABASE_READ:${result.status}`)
  const text = await result.text()
  return text ? JSON.parse(text) as T[] : []
}

async function cleanupExpiredNonces(env: Env) {
  const now = encodeURIComponent(new Date().toISOString())
  const result = await supabaseRequest(env, `integration_replay_nonces?expires_at=lt.${now}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  })
  if (!result.ok) throw new Error(`NONCE_CLEANUP:${result.status}`)
}

async function registerNonce(env: Env, keyId: string, nonce: string, ttlSeconds: number) {
  const result = await supabaseRequest(env, 'integration_replay_nonces', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      key_id: keyId,
      nonce,
      source: 'amphon-system',
      expires_at: new Date(Date.now() + ttlSeconds * 2 * 1000).toISOString(),
    }),
  })

  if (result.status === 409) return false
  if (!result.ok) throw new Error(`NONCE_INSERT:${result.status}`)
  return true
}

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''))
}

function validateEnvelope(value: unknown): { ok: true; envelope: Envelope } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['envelope must be an object'] }
  }

  const envelope = value as Partial<Envelope>
  if (!validUuid(envelope.eventId)) errors.push('eventId must be UUID')
  if (!clean(envelope.eventType)) errors.push('eventType is required')
  if (!Number.isInteger(envelope.version) || Number(envelope.version) < 1) errors.push('version must be a positive integer')
  if (!clean(envelope.source)) errors.push('source is required')
  if (Number.isNaN(Date.parse(String(envelope.occurredAt || '')))) errors.push('occurredAt must be ISO-8601 compatible')
  if (!clean(envelope.idempotencyKey)) errors.push('idempotencyKey is required')
  if (!envelope.entity || typeof envelope.entity !== 'object') errors.push('entity is required')
  else {
    if (!clean(envelope.entity.type)) errors.push('entity.type is required')
    if (!clean(String(envelope.entity.id ?? ''))) errors.push('entity.id is required')
  }
  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) errors.push('payload must be an object')

  return errors.length
    ? { ok: false, errors }
    : { ok: true, envelope: envelope as Envelope }
}

async function authenticate(request: Request, env: Env, body: Uint8Array, url: URL) {
  const keyId = clean(request.headers.get('x-amphon-key-id'))
  const timestamp = clean(request.headers.get('x-amphon-timestamp'))
  const nonce = clean(request.headers.get('x-amphon-nonce'))
  const signature = clean(request.headers.get('x-amphon-signature'))

  if (!keyId || !timestamp || !nonce || !signature) return { ok: false as const, status: 401, error: 'BRIDGE_AUTH_REQUIRED' }
  if (!env.SYSTEM_INTEGRATION_KEY_ID || !env.SYSTEM_INTEGRATION_SECRET) return { ok: false as const, status: 503, error: 'BRIDGE_NOT_CONFIGURED' }
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return { ok: false as const, status: 503, error: 'BRIDGE_STORAGE_NOT_CONFIGURED' }
  if (keyId !== env.SYSTEM_INTEGRATION_KEY_ID) return { ok: false as const, status: 401, error: 'BRIDGE_AUTH_INVALID' }

  const parsedTime = Date.parse(timestamp)
  const ttl = maxAgeSeconds(env)
  if (!Number.isFinite(parsedTime) || Math.abs(Date.now() - parsedTime) > ttl * 1000) {
    return { ok: false as const, status: 401, error: 'BRIDGE_AUTH_INVALID' }
  }

  const canonical = [
    timestamp,
    nonce,
    request.method.toUpperCase(),
    url.pathname,
    await sha256Hex(body),
  ].join('\n')

  if (!(await verifyHmac(env.SYSTEM_INTEGRATION_SECRET, signature, canonical))) {
    return { ok: false as const, status: 401, error: 'BRIDGE_AUTH_INVALID' }
  }

  try {
    await cleanupExpiredNonces(env)
    if (!(await registerNonce(env, keyId, nonce, ttl))) {
      return { ok: false as const, status: 409, error: 'BRIDGE_REPLAY_DETECTED' }
    }
  } catch (error) {
    console.error('ONE-1 replay storage error', error)
    return { ok: false as const, status: 503, error: 'BRIDGE_SECURITY_STORAGE_UNAVAILABLE' }
  }

  return { ok: true as const, source: 'amphon-system', keyId }
}

async function findExistingInbox(env: Env, envelope: Envelope): Promise<InboxIdentity | null> {
  const select = 'event_id,source,event_type,idempotency_key,status'
  const byEvent = await readRows<InboxIdentity>(await supabaseRequest(
    env,
    `integration_event_inbox?event_id=eq.${encodeURIComponent(envelope.eventId)}&select=${select}&limit=1`,
  ))
  if (byEvent[0]) return byEvent[0]

  const byIdempotency = await readRows<InboxIdentity>(await supabaseRequest(
    env,
    `integration_event_inbox?source=eq.${encodeURIComponent(envelope.source)}&idempotency_key=eq.${encodeURIComponent(envelope.idempotencyKey)}&select=${select}&limit=1`,
  ))
  return byIdempotency[0] || null
}

async function storeInbox(env: Env, envelope: Envelope) {
  const result = await supabaseRequest(env, 'integration_event_inbox', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      event_id: envelope.eventId,
      source: envelope.source,
      event_type: envelope.eventType,
      version: envelope.version,
      idempotency_key: envelope.idempotencyKey,
      entity_type: envelope.entity.type,
      entity_id: String(envelope.entity.id),
      entity_sku: envelope.entity.sku || null,
      payload: envelope,
    }),
  })

  if (result.status === 409) {
    const existing = await findExistingInbox(env, envelope)
    const exactDuplicate = Boolean(
      existing
        && existing.event_id === envelope.eventId
        && existing.source === envelope.source
        && existing.event_type === envelope.eventType
        && existing.idempotency_key === envelope.idempotencyKey
    )
    return {
      inserted: false as const,
      conflict: !exactDuplicate,
      status: existing?.status || 'EXISTS',
    }
  }
  if (!result.ok) {
    const text = await result.text().catch(() => '')
    throw new Error(`INBOX_INSERT:${result.status}:${text.slice(0, 200)}`)
  }
  return { inserted: true as const, conflict: false, status: 'RECEIVED' }
}

async function handle(request: Request, env: Env) {
  const url = new URL(request.url)
  if (!['/v1/health', '/v1/events'].includes(url.pathname)) return response({ ok: false, error: 'NOT_FOUND' }, 404)
  if (request.method === 'OPTIONS') return response({ ok: false, error: 'BRIDGE_BROWSER_ACCESS_DISABLED' }, 405)
  if (url.pathname === '/v1/health' && request.method !== 'GET') return response({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)
  if (url.pathname === '/v1/events' && request.method !== 'POST') return response({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) return response({ ok: false, error: 'BRIDGE_BODY_TOO_LARGE' }, 413)

  const rawBuffer = new Uint8Array(await request.arrayBuffer())
  if (rawBuffer.byteLength > MAX_BODY_BYTES) return response({ ok: false, error: 'BRIDGE_BODY_TOO_LARGE' }, 413)

  const auth = await authenticate(request, env, rawBuffer, url)
  if (!auth.ok) return response({ ok: false, error: auth.error }, auth.status)

  if (url.pathname === '/v1/health') {
    return response({ ok: true, service: 'amphon-one-bridge', version: 1, peer: auth.source, time: new Date().toISOString() })
  }

  const contentType = clean(request.headers.get('content-type')).toLowerCase()
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    return response({ ok: false, error: 'BRIDGE_JSON_REQUIRED' }, 415)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBuffer))
  } catch {
    return response({ ok: false, error: 'BRIDGE_JSON_INVALID' }, 400)
  }

  const validation = validateEnvelope(parsed)
  if (!validation.ok) return response({ ok: false, error: 'BRIDGE_ENVELOPE_INVALID', details: validation.errors }, 400)
  const envelope = validation.envelope
  if (envelope.source !== auth.source) return response({ ok: false, error: 'BRIDGE_SOURCE_MISMATCH' }, 403)
  if (!SYSTEM_EVENT_ALLOWLIST.has(envelope.eventType)) return response({ ok: false, error: 'BRIDGE_EVENT_NOT_ALLOWED' }, 422)

  try {
    const stored = await storeInbox(env, envelope)
    if (!stored.inserted && stored.conflict) {
      return response({ ok: false, error: 'BRIDGE_IDEMPOTENCY_CONFLICT', eventId: envelope.eventId }, 409)
    }
    if (!stored.inserted) {
      return response({ ok: true, accepted: false, duplicate: true, eventId: envelope.eventId, status: stored.status }, 200)
    }
    return response({ ok: true, accepted: true, duplicate: false, eventId: envelope.eventId, status: stored.status }, 202)
  } catch (error) {
    console.error('ONE-1 inbox error', error)
    return response({ ok: false, error: 'BRIDGE_INBOX_UNAVAILABLE' }, 503)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch (error) {
      console.error('ONE-1 bridge unhandled error', error)
      return response({ ok: false, error: 'BRIDGE_INTERNAL_ERROR' }, 500)
    }
  },
}
