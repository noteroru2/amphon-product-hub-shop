import baseBridge from './index'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  SYSTEM_INTEGRATION_KEY_ID: string
  SYSTEM_INTEGRATION_SECRET: string
  INTEGRATION_SIGNATURE_MAX_AGE_SECONDS?: string
  ONE2B_SHELL_CONSUMER_ENABLED?: string
  ONE2D_RECONCILIATION_ENABLED?: string
  ONE3_STOCK_CONSUMER_ENABLED?: string
}

type BridgeEnvelope = {
  eventId: string
  eventType: string
  source: string
}

type ConsumeResult = {
  outcome?: string
  error?: string
  hubProductId?: string | null
  productIdentityId?: string | null
  sku?: string | null
  listingReadiness?: string | null
  availability?: string | null
  availabilityVersion?: number | string | null
  hubStatus?: string | null
  ackEventId?: string | null
}

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

function enabled(value: string | undefined) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function supabaseHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    accept: 'application/json',
    ...extra,
  }
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...supabaseHeaders(env),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
}

async function callRpc(env: Env, rpc: string, eventId: string): Promise<ConsumeResult> {
  const result = await supabaseRequest(env, `rpc/${rpc}`, {
    method: 'POST',
    body: JSON.stringify({ p_event_id: eventId }),
  })
  const text = await result.text()
  if (!result.ok) {
    throw new Error(`${rpc.toUpperCase()}:${result.status}:${text.slice(0, 200)}`)
  }
  return text ? JSON.parse(text) as ConsumeResult : {}
}

async function markInboxFailed(env: Env, eventId: string, prefix: string, error: unknown) {
  const safeError = `${prefix}:${String(error instanceof Error ? error.message : error).slice(0, 500)}`
  const filter = `integration_event_inbox?event_id=eq.${encodeURIComponent(eventId)}&status=in.(RECEIVED,PROCESSING,FAILED)`
  const result = await supabaseRequest(env, filter, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'FAILED',
      last_error: safeError,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!result.ok) throw new Error(`${prefix}_FAILED_MARK:${result.status}`)
}

async function consumeShell(env: Env, envelope: BridgeEnvelope) {
  const consumed = await callRpc(env, 'one2b_consume_intake_event', envelope.eventId)
  const outcome = String(consumed.outcome || '').toUpperCase()

  if (outcome === 'CREATED') {
    return response({
      ok: true,
      accepted: true,
      duplicate: false,
      eventId: envelope.eventId,
      status: 'PROCESSED',
      shell: {
        hubProductId: consumed.hubProductId || null,
        sku: consumed.sku || null,
        listingReadiness: consumed.listingReadiness || 'INTAKE_ONLY',
      },
    }, 202)
  }

  if (outcome === 'DUPLICATE') {
    return response({
      ok: true,
      accepted: false,
      duplicate: true,
      eventId: envelope.eventId,
      status: 'PROCESSED',
      shell: {
        hubProductId: consumed.hubProductId || null,
        sku: consumed.sku || null,
        listingReadiness: consumed.listingReadiness || 'INTAKE_ONLY',
      },
    }, 200)
  }

  if (outcome === 'CONFLICT' || outcome === 'DEAD') {
    return response({
      ok: false,
      error: consumed.error || 'BRIDGE_SHELL_CONFLICT',
      eventId: envelope.eventId,
      sku: consumed.sku || null,
    }, 409)
  }

  console.error('ONE-2B unexpected consumer outcome', { eventId: envelope.eventId, outcome })
  return response({ ok: false, error: 'BRIDGE_SHELL_CONSUMER_UNAVAILABLE' }, 503)
}

async function consumeLegacyLink(env: Env, envelope: BridgeEnvelope) {
  const consumed = await callRpc(env, 'one2d_consume_legacy_link_event', envelope.eventId)
  const outcome = String(consumed.outcome || '').toUpperCase()

  if (outcome === 'LINKED') {
    return response({
      ok: true,
      accepted: true,
      duplicate: false,
      eventId: envelope.eventId,
      status: 'PROCESSED',
      legacyLink: {
        hubProductId: consumed.hubProductId || null,
        productIdentityId: consumed.productIdentityId || null,
        sku: consumed.sku || null,
      },
    }, 202)
  }

  if (outcome === 'DUPLICATE') {
    return response({
      ok: true,
      accepted: false,
      duplicate: true,
      eventId: envelope.eventId,
      status: 'PROCESSED',
      legacyLink: {
        hubProductId: consumed.hubProductId || null,
        productIdentityId: consumed.productIdentityId || null,
        sku: consumed.sku || null,
      },
    }, 200)
  }

  if (outcome === 'CONFLICT' || outcome === 'DEAD') {
    return response({
      ok: false,
      error: consumed.error || 'BRIDGE_LEGACY_LINK_CONFLICT',
      eventId: envelope.eventId,
      sku: consumed.sku || null,
    }, 409)
  }

  console.error('ONE-2D unexpected consumer outcome', { eventId: envelope.eventId, outcome })
  return response({ ok: false, error: 'BRIDGE_LEGACY_LINK_CONSUMER_UNAVAILABLE' }, 503)
}

async function consumeAvailability(env: Env, envelope: BridgeEnvelope) {
  const consumed = await callRpc(env, 'one3c_consume_stock_event', envelope.eventId)
  const outcome = String(consumed.outcome || '').toUpperCase()
  const projection = {
    hubProductId: consumed.hubProductId || null,
    productIdentityId: consumed.productIdentityId || null,
    sku: consumed.sku || null,
    availability: consumed.availability || null,
    availabilityVersion: consumed.availabilityVersion ?? null,
    hubStatus: consumed.hubStatus || null,
    ackEventId: consumed.ackEventId || null,
  }

  if (outcome === 'APPLIED') {
    return response({
      ok: true,
      accepted: true,
      duplicate: false,
      stale: false,
      eventId: envelope.eventId,
      status: 'PROCESSED',
      projection,
    }, 202)
  }

  if (outcome === 'DUPLICATE' || outcome === 'STALE') {
    return response({
      ok: true,
      accepted: false,
      duplicate: outcome === 'DUPLICATE',
      stale: outcome === 'STALE',
      eventId: envelope.eventId,
      status: 'PROCESSED',
      projection,
    }, 200)
  }

  if (outcome === 'CONFLICT' || outcome === 'DEAD') {
    return response({
      ok: false,
      error: consumed.error || 'BRIDGE_AVAILABILITY_CONFLICT',
      eventId: envelope.eventId,
      sku: consumed.sku || null,
    }, 409)
  }

  console.error('ONE-3C unexpected consumer outcome', { eventId: envelope.eventId, outcome })
  return response({ ok: false, error: 'BRIDGE_AVAILABILITY_CONSUMER_UNAVAILABLE' }, 503)
}

async function maybeConsume(requestCopy: Request, baseResponse: Response, env: Env) {
  if (![200, 202].includes(baseResponse.status)) return baseResponse

  const url = new URL(requestCopy.url)
  if (url.pathname !== '/v1/events' || requestCopy.method !== 'POST') return baseResponse

  let envelope: BridgeEnvelope
  try {
    envelope = await requestCopy.json() as BridgeEnvelope
  } catch {
    return baseResponse
  }

  if (envelope.source !== 'amphon-system' || !envelope.eventId) return baseResponse

  if (envelope.eventType === 'product.intake_created') {
    if (!enabled(env.ONE2B_SHELL_CONSUMER_ENABLED)) return baseResponse
    try {
      return await consumeShell(env, envelope)
    } catch (error) {
      console.error('ONE-2B shell consumer error', { eventId: envelope.eventId, error })
      await markInboxFailed(env, envelope.eventId, 'ONE2B_CONSUMER', error).catch((markError) => {
        console.error('ONE-2B failed to mark inbox retryable', { eventId: envelope.eventId, markError })
      })
      return response({ ok: false, error: 'BRIDGE_SHELL_CONSUMER_UNAVAILABLE' }, 503)
    }
  }

  if (envelope.eventType === 'product.legacy_link_requested') {
    if (!enabled(env.ONE2D_RECONCILIATION_ENABLED)) return baseResponse
    try {
      return await consumeLegacyLink(env, envelope)
    } catch (error) {
      console.error('ONE-2D legacy link consumer error', { eventId: envelope.eventId, error })
      await markInboxFailed(env, envelope.eventId, 'ONE2D_CONSUMER', error).catch((markError) => {
        console.error('ONE-2D failed to mark inbox retryable', { eventId: envelope.eventId, markError })
      })
      return response({ ok: false, error: 'BRIDGE_LEGACY_LINK_CONSUMER_UNAVAILABLE' }, 503)
    }
  }

  if (['product.reserve_requested', 'product.release_requested', 'product.mark_sold_requested'].includes(envelope.eventType)) {
    if (!enabled(env.ONE3_STOCK_CONSUMER_ENABLED)) return baseResponse
    try {
      return await consumeAvailability(env, envelope)
    } catch (error) {
      console.error('ONE-3C availability consumer error', { eventId: envelope.eventId, error })
      await markInboxFailed(env, envelope.eventId, 'ONE3C_CONSUMER', error).catch((markError) => {
        console.error('ONE-3C failed to mark inbox retryable', { eventId: envelope.eventId, markError })
      })
      return response({ ok: false, error: 'BRIDGE_AVAILABILITY_CONSUMER_UNAVAILABLE' }, 503)
    }
  }

  return baseResponse
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestCopy = request.clone()
    const baseResponse = await baseBridge.fetch(request, env)
    return maybeConsume(requestCopy, baseResponse, env)
  },
}
