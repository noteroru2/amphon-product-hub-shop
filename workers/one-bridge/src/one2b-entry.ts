import baseBridge from './index'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  SYSTEM_INTEGRATION_KEY_ID: string
  SYSTEM_INTEGRATION_SECRET: string
  INTEGRATION_SIGNATURE_MAX_AGE_SECONDS?: string
  ONE2B_SHELL_CONSUMER_ENABLED?: string
}

type IntakeEnvelope = {
  eventId: string
  eventType: string
  source: string
}

type ConsumeResult = {
  outcome?: string
  error?: string
  hubProductId?: string | null
  sku?: string | null
  listingReadiness?: string | null
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

async function consumeProductShell(env: Env, eventId: string): Promise<ConsumeResult> {
  const result = await supabaseRequest(env, 'rpc/one2b_consume_intake_event', {
    method: 'POST',
    body: JSON.stringify({ p_event_id: eventId }),
  })
  const text = await result.text()
  if (!result.ok) {
    throw new Error(`ONE2B_RPC:${result.status}:${text.slice(0, 200)}`)
  }
  return text ? JSON.parse(text) as ConsumeResult : {}
}

async function markInboxFailed(env: Env, eventId: string, error: unknown) {
  const safeError = `ONE2B_CONSUMER:${String(error instanceof Error ? error.message : error).slice(0, 500)}`
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
  if (!result.ok) throw new Error(`ONE2B_FAILED_MARK:${result.status}`)
}

async function maybeConsume(requestCopy: Request, baseResponse: Response, env: Env) {
  if (!enabled(env.ONE2B_SHELL_CONSUMER_ENABLED)) return baseResponse
  if (![200, 202].includes(baseResponse.status)) return baseResponse

  const url = new URL(requestCopy.url)
  if (url.pathname !== '/v1/events' || requestCopy.method !== 'POST') return baseResponse

  let envelope: IntakeEnvelope
  try {
    envelope = await requestCopy.json() as IntakeEnvelope
  } catch {
    return baseResponse
  }

  if (envelope.eventType !== 'product.intake_created' || envelope.source !== 'amphon-system' || !envelope.eventId) {
    return baseResponse
  }

  try {
    const consumed = await consumeProductShell(env, envelope.eventId)
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
  } catch (error) {
    console.error('ONE-2B shell consumer error', { eventId: envelope.eventId, error })
    await markInboxFailed(env, envelope.eventId, error).catch((markError) => {
      console.error('ONE-2B failed to mark inbox retryable', { eventId: envelope.eventId, markError })
    })
    return response({ ok: false, error: 'BRIDGE_SHELL_CONSUMER_UNAVAILABLE' }, 503)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestCopy = request.clone()
    const baseResponse = await baseBridge.fetch(request, env)
    return maybeConsume(requestCopy, baseResponse, env)
  },
}
