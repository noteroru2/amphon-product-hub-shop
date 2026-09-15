interface Env {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  SYSTEM_API_BASE_URL: string
  SYSTEM_INTEGRATION_KEY_ID: string
  SYSTEM_INTEGRATION_SECRET: string
  HUB_OUTBOX_DELIVERY_ENABLED?: string
  HUB_OUTBOX_BATCH_SIZE?: string
  HUB_OUTBOX_LOCK_TIMEOUT_SECONDS?: string
  HUB_OUTBOX_MAX_ATTEMPTS?: string
  HUB_OUTBOX_BACKOFF_BASE_SECONDS?: string
  HUB_OUTBOX_BACKOFF_MAX_SECONDS?: string
}

type OutboxRow = {
  id: string
  event_id: string
  destination: string
  event_type: string
  payload: Record<string, unknown>
  attempts: number
  status: string
}

type FinishOutcome = 'DELIVERED' | 'FAILED' | 'DEAD'

const EVENTS_PATH = '/api/integrations/v1/events'

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function enabled(value: unknown) {
  return clean(value).toLowerCase() === 'true'
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(body: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(body))
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

function requireConfig(env: Env) {
  const supabaseUrl = clean(env.SUPABASE_URL).replace(/\/$/, '')
  const supabaseSecret = clean(env.SUPABASE_SECRET_KEY)
  const systemBase = clean(env.SYSTEM_API_BASE_URL)
  const keyId = clean(env.SYSTEM_INTEGRATION_KEY_ID)
  const secret = clean(env.SYSTEM_INTEGRATION_SECRET)
  if (!supabaseUrl || !supabaseSecret || !systemBase || !keyId || !secret) {
    throw new Error('HUB_OUTBOX_NOT_CONFIGURED')
  }
  const systemUrl = new URL(EVENTS_PATH, systemBase.endsWith('/') ? systemBase : `${systemBase}/`)
  if (systemUrl.protocol !== 'https:') throw new Error('SYSTEM_API_BASE_URL_HTTPS_REQUIRED')
  return { supabaseUrl, supabaseSecret, systemUrl, keyId, secret }
}

async function rpc<T>(env: Env, name: string, body: Record<string, unknown>): Promise<T> {
  const config = requireConfig(env)
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseSecret,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`SUPABASE_RPC_${name}:${response.status}:${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : null) as T
}

async function claim(env: Env, workerId: string) {
  const batchSize = boundedInt(env.HUB_OUTBOX_BATCH_SIZE, 10, 1, 50)
  const lockTimeoutSeconds = boundedInt(env.HUB_OUTBOX_LOCK_TIMEOUT_SECONDS, 120, 30, 900)
  return rpc<OutboxRow[]>(env, 'oneprod_claim_hub_outbox', {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lock_timeout_seconds: lockTimeoutSeconds,
  })
}

async function finish(
  env: Env,
  row: OutboxRow,
  workerId: string,
  outcome: FinishOutcome,
  nextAttemptAt: string | null,
  lastError: string | null,
) {
  return rpc<Record<string, unknown>>(env, 'oneprod_finish_hub_outbox', {
    p_id: row.id,
    p_worker_id: workerId,
    p_outcome: outcome,
    p_next_attempt_at: nextAttemptAt,
    p_last_error: lastError,
  })
}

function retryDelaySeconds(env: Env, attempt: number) {
  const base = boundedInt(env.HUB_OUTBOX_BACKOFF_BASE_SECONDS, 30, 5, 3600)
  const cap = boundedInt(env.HUB_OUTBOX_BACKOFF_MAX_SECONDS, 1800, base, 86400)
  const exponent = Math.min(20, Math.max(0, attempt - 1))
  return Math.min(cap, base * (2 ** exponent))
}

function classify(status: number, body: unknown) {
  const error = body && typeof body === 'object' ? clean((body as { error?: unknown }).error) : ''
  if (status >= 200 && status < 300) return { delivered: true, permanent: false, error }
  const permanent = new Set([
    'BRIDGE_IDEMPOTENCY_CONFLICT',
    'BRIDGE_ENVELOPE_INVALID',
    'BRIDGE_EVENT_NOT_ALLOWED',
    'BRIDGE_BODY_TOO_LARGE',
    'BRIDGE_JSON_REQUIRED',
    'BRIDGE_JSON_INVALID',
    'BRIDGE_SOURCE_MISMATCH',
  ])
  if (permanent.has(error)) return { delivered: false, permanent: true, error }
  if (status >= 400 && status < 500 && ![401, 403, 408, 409, 425, 429].includes(status)) {
    return { delivered: false, permanent: true, error }
  }
  return { delivered: false, permanent: false, error }
}

async function sendRow(env: Env, row: OutboxRow) {
  const config = requireConfig(env)
  if (row.destination !== 'amphon-system') throw new Error(`HUB_OUTBOX_DESTINATION_UNSUPPORTED:${row.destination}`)
  const bodyText = JSON.stringify(row.payload)
  const body = new TextEncoder().encode(bodyText)
  const timestamp = new Date().toISOString()
  const nonce = crypto.randomUUID()
  const canonical = [timestamp, nonce, 'POST', config.systemUrl.pathname, await sha256Hex(body)].join('\n')
  const signature = await hmacHex(config.secret, canonical)
  const response = await fetch(config.systemUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-amphon-key-id': config.keyId,
      'x-amphon-timestamp': timestamp,
      'x-amphon-nonce': nonce,
      'x-amphon-signature': signature,
      'user-agent': 'amphon-one-hub-outbox/1',
    },
    body: bodyText,
  })
  const text = await response.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text.slice(0, 300) } }
  return { status: response.status, body: parsed, classification: classify(response.status, parsed) }
}

async function sweep(env: Env) {
  if (!enabled(env.HUB_OUTBOX_DELIVERY_ENABLED)) {
    return { ok: true, enabled: false, claimed: 0, delivered: 0, failed: 0, dead: 0 }
  }
  requireConfig(env)
  const workerId = `hub-outbox:${crypto.randomUUID()}`
  const rows = await claim(env, workerId)
  const maxAttempts = boundedInt(env.HUB_OUTBOX_MAX_ATTEMPTS, 12, 1, 100)
  let delivered = 0
  let failed = 0
  let dead = 0

  for (const row of rows) {
    try {
      const result = await sendRow(env, row)
      if (result.classification.delivered) {
        await finish(env, row, workerId, 'DELIVERED', null, null)
        delivered += 1
        continue
      }
      const exhausted = Number(row.attempts || 0) >= maxAttempts
      const isDead = result.classification.permanent || exhausted
      const error = `http:${result.status}${result.classification.error ? `:${result.classification.error}` : ''}`
      if (isDead) {
        await finish(env, row, workerId, 'DEAD', null, exhausted ? `MAX_ATTEMPTS:${error}` : error)
        dead += 1
      } else {
        const delay = retryDelaySeconds(env, Number(row.attempts || 1))
        await finish(env, row, workerId, 'FAILED', new Date(Date.now() + delay * 1000).toISOString(), error)
        failed += 1
      }
    } catch (error) {
      const exhausted = Number(row.attempts || 0) >= maxAttempts
      const message = `network:${clean((error as Error)?.message || error).slice(0, 500)}`
      if (exhausted) {
        await finish(env, row, workerId, 'DEAD', null, `MAX_ATTEMPTS:${message}`)
        dead += 1
      } else {
        const delay = retryDelaySeconds(env, Number(row.attempts || 1))
        await finish(env, row, workerId, 'FAILED', new Date(Date.now() + delay * 1000).toISOString(), message)
        failed += 1
      }
    }
  }

  return { ok: true, enabled: true, claimed: rows.length, delivered, failed, dead }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/health' || request.method !== 'GET') {
      return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } })
    }
    let configured = true
    try { requireConfig(env) } catch { configured = false }
    return new Response(JSON.stringify({
      ok: true,
      service: 'amphon-one-hub-outbox',
      enabled: enabled(env.HUB_OUTBOX_DELIVERY_ENABLED),
      configured,
      time: new Date().toISOString(),
    }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweep(env).then((result) => console.log('AMPHON HUB OUTBOX SWEEP', result)).catch((error) => {
      console.error('AMPHON HUB OUTBOX SWEEP ERROR', clean((error as Error)?.message || error))
    }))
  },
}
