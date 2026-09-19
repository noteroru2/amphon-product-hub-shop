interface Env {
  IMAGES: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  LINE_CHANNEL_SECRET: string
  LINE_CHANNEL_ACCESS_TOKEN: string
  AI_BUYER_ENV?: string
}

type LineSource = {
  type?: string
  userId?: string
  groupId?: string
  roomId?: string
}

type LineImageSet = {
  id?: string
  index?: number
  total?: number
}

type LineMessage = {
  id: string
  type: string
  text?: string
  title?: string
  address?: string
  latitude?: number
  longitude?: number
  fileName?: string
  fileSize?: number
  imageSet?: LineImageSet
}

type LineWebhookEvent = {
  type: string
  webhookEventId?: string
  timestamp?: number
  source?: LineSource
  message?: LineMessage
  deliveryContext?: { isRedelivery?: boolean }
}

type LineWebhookBody = {
  destination?: string
  events?: LineWebhookEvent[]
}

type CustomerRow = {
  id: string
  line_user_id: string
}

type ConversationRow = {
  id: string
  customer_id: string
  line_user_id: string
}

type CaseRow = {
  id: string
  state: string
}

type MessageRow = {
  id: string
  line_message_id: string | null
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
const TERMINAL_STATES = ['COMPLETED', 'CUSTOMER_DECLINED', 'EXPIRED', 'CANCELLED']

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

function clean(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    const output = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i)
    return output
  } catch {
    return null
  }
}

async function verifyLineSignature(secret: string, signature: string, body: Uint8Array) {
  const signatureBytes = base64ToBytes(signature)
  if (!secret || !signatureBytes) return false
  const keyBytes = new TextEncoder().encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify('HMAC', key, toArrayBuffer(signatureBytes), toArrayBuffer(body))
}

function requireStorage(env: Env) {
  if (!clean(env.SUPABASE_URL) || !clean(env.SUPABASE_SECRET_KEY)) {
    throw new Error('AI_BUYER_STORAGE_NOT_CONFIGURED')
  }
}

function supabaseHeaders(env: Env, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    accept: 'application/json',
    ...extra,
  }
}

async function supabaseRequest(env: Env, path: string, init: RequestInit = {}) {
  requireStorage(env)
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...supabaseHeaders(env),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
}

async function readRows<T>(result: Response): Promise<T[]> {
  if (!result.ok) {
    const detail = await result.text().catch(() => '')
    throw new Error(`SUPABASE_READ_${result.status}:${detail.slice(0, 300)}`)
  }
  const text = await result.text()
  return text ? JSON.parse(text) as T[] : []
}

async function insertWebhookEvent(env: Env, event: LineWebhookEvent, lineUserId: string | null) {
  const webhookEventId = clean(event.webhookEventId, 200)
  if (!webhookEventId) throw new Error('LINE_WEBHOOK_EVENT_ID_MISSING')
  const payload = {
    type: event.type,
    timestamp: event.timestamp ?? null,
    source: event.source ?? null,
    message: event.message ?? null,
    deliveryContext: event.deliveryContext ?? null,
  }
  const result = await supabaseRequest(env, 'ai_buyer_webhook_events', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      webhook_event_id: webhookEventId,
      event_type: clean(event.type, 80) || 'unknown',
      line_user_id: lineUserId,
      payload,
      status: 'RECEIVED',
    }),
  })
  if (result.status === 409) return false
  if (!result.ok) {
    const detail = await result.text().catch(() => '')
    throw new Error(`WEBHOOK_INSERT_${result.status}:${detail.slice(0, 300)}`)
  }
  return true
}

async function finishWebhook(env: Env, eventId: string, status: 'PROCESSED' | 'IGNORED' | 'FAILED', error?: string) {
  const result = await supabaseRequest(
    env,
    `ai_buyer_webhook_events?webhook_event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        error: error ? clean(error, 1000) : null,
        processed_at: new Date().toISOString(),
      }),
    },
  )
  if (!result.ok) console.error('AI BUYER webhook status update failed', eventId, result.status)
}

async function lineProfile(env: Env, userId: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return null
  const result = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  })
  if (!result.ok) return null
  return await result.json() as {
    displayName?: string
    pictureUrl?: string
    language?: string
  }
}

async function upsertCustomer(env: Env, lineUserId: string) {
  const profile = await lineProfile(env, lineUserId)
  const result = await supabaseRequest(env, 'ai_buyer_customers?on_conflict=line_user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      line_user_id: lineUserId,
      display_name: profile?.displayName || null,
      picture_url: profile?.pictureUrl || null,
      language: profile?.language || null,
    }),
  })
  const rows = await readRows<CustomerRow>(result)
  if (!rows[0]) throw new Error('CUSTOMER_UPSERT_EMPTY')
  return rows[0]
}

async function upsertConversation(env: Env, customer: CustomerRow, at: string) {
  const result = await supabaseRequest(env, 'ai_buyer_conversations?on_conflict=line_user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      customer_id: customer.id,
      line_user_id: customer.line_user_id,
      status: 'ACTIVE',
      last_message_at: at,
    }),
  })
  const rows = await readRows<ConversationRow>(result)
  if (!rows[0]) throw new Error('CONVERSATION_UPSERT_EMPTY')
  return rows[0]
}

async function activeCase(env: Env, conversation: ConversationRow, customer: CustomerRow) {
  const terminal = TERMINAL_STATES.join(',')
  const path = [
    'ai_buyer_valuation_cases?select=id,state',
    `conversation_id=eq.${encodeURIComponent(conversation.id)}`,
    `state=not.in.(${terminal})`,
    'order=updated_at.desc',
    'limit=1',
  ].join('&')
  const existing = await readRows<CaseRow>(await supabaseRequest(env, path))
  if (existing[0]) return existing[0]

  const created = await readRows<CaseRow>(await supabaseRequest(env, 'ai_buyer_valuation_cases', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      conversation_id: conversation.id,
      customer_id: customer.id,
      state: 'NEW',
      control_mode: 'AUTO',
    }),
  }))
  if (!created[0]) throw new Error('CASE_CREATE_EMPTY')
  return created[0]
}

function lineTimestamp(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return new Date().toISOString()
  return new Date(timestamp).toISOString()
}

function normalizedMessageType(type: string) {
  const value = clean(type, 40).toLowerCase()
  if (value === 'text') return 'TEXT'
  if (value === 'image') return 'IMAGE'
  if (value === 'location') return 'LOCATION'
  if (value === 'video') return 'VIDEO'
  if (value === 'audio') return 'AUDIO'
  if (value === 'file') return 'FILE'
  if (value === 'sticker') return 'STICKER'
  return 'OTHER'
}

async function storeMessage(
  env: Env,
  conversation: ConversationRow,
  caseRow: CaseRow,
  event: LineWebhookEvent,
) {
  const message = event.message
  if (!message?.id) throw new Error('LINE_MESSAGE_ID_MISSING')

  const metadata: Record<string, unknown> = {}
  if (message.type === 'location') {
    metadata.location = {
      title: message.title || null,
      address: message.address || null,
      latitude: message.latitude ?? null,
      longitude: message.longitude ?? null,
    }
  }
  if (message.imageSet) metadata.imageSet = message.imageSet
  if (message.fileName) metadata.fileName = clean(message.fileName, 255)
  if (message.fileSize) metadata.fileSize = message.fileSize

  const result = await supabaseRequest(env, 'ai_buyer_messages?on_conflict=line_message_id', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      conversation_id: conversation.id,
      case_id: caseRow.id,
      webhook_event_id: event.webhookEventId || null,
      line_message_id: message.id,
      direction: 'INBOUND',
      message_type: normalizedMessageType(message.type),
      text_content: message.type === 'text' ? clean(message.text, 10000) : null,
      metadata,
      line_timestamp: lineTimestamp(event.timestamp),
    }),
  })
  const rows = await readRows<MessageRow>(result)
  if (rows[0]) return rows[0]

  const existing = await readRows<MessageRow>(await supabaseRequest(
    env,
    `ai_buyer_messages?line_message_id=eq.${encodeURIComponent(message.id)}&select=id,line_message_id&limit=1`,
  ))
  if (!existing[0]) throw new Error('MESSAGE_UPSERT_EMPTY')
  return existing[0]
}

async function downloadLineContent(env: Env, messageId: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINE_ACCESS_TOKEN_NOT_CONFIGURED')
  const result = await fetch(
    `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    { headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } },
  )
  if (!result.ok) throw new Error(`LINE_CONTENT_${result.status}`)
  const bytes = new Uint8Array(await result.arrayBuffer())
  return {
    bytes,
    contentType: clean(result.headers.get('content-type'), 120) || 'application/octet-stream',
  }
}

function safeKeyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160)
}

async function storeImage(
  env: Env,
  lineUserId: string,
  caseRow: CaseRow,
  dbMessage: MessageRow,
  lineMessage: LineMessage,
) {
  const content = await downloadLineContent(env, lineMessage.id)
  const storageKey = [
    'ai-buyer',
    safeKeyPart(lineUserId),
    safeKeyPart(caseRow.id),
    `${safeKeyPart(lineMessage.id)}.bin`,
  ].join('/')

  await env.IMAGES.put(storageKey, content.bytes, {
    httpMetadata: { contentType: content.contentType },
    customMetadata: {
      source: 'line',
      caseId: caseRow.id,
      lineMessageId: lineMessage.id,
    },
  })

  const imageSet = lineMessage.imageSet || {}
  const result = await supabaseRequest(env, 'ai_buyer_case_images?on_conflict=line_message_id', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      case_id: caseRow.id,
      message_id: dbMessage.id,
      line_message_id: lineMessage.id,
      storage_key: storageKey,
      mime_type: content.contentType,
      byte_size: content.bytes.byteLength,
      image_set_id: imageSet.id || null,
      image_set_index: Number.isInteger(imageSet.index) ? imageSet.index : null,
      image_set_total: Number.isInteger(imageSet.total) ? imageSet.total : null,
      analysis_status: 'READY',
    }),
  })
  if (!result.ok && result.status !== 409) {
    const detail = await result.text().catch(() => '')
    throw new Error(`IMAGE_RECORD_${result.status}:${detail.slice(0, 300)}`)
  }
}

async function processEvent(env: Env, event: LineWebhookEvent) {
  const eventId = clean(event.webhookEventId, 200)
  if (!eventId) {
    console.warn('AI BUYER ignored LINE event without webhookEventId')
    return
  }

  const lineUserId = clean(event.source?.userId, 200) || null
  let inserted = false
  try {
    inserted = await insertWebhookEvent(env, event, lineUserId)
    if (!inserted) return

    if (event.type !== 'message' || !event.message || !lineUserId) {
      await finishWebhook(env, eventId, 'IGNORED')
      return
    }

    const at = lineTimestamp(event.timestamp)
    const customer = await upsertCustomer(env, lineUserId)
    const conversation = await upsertConversation(env, customer, at)
    const caseRow = await activeCase(env, conversation, customer)
    const dbMessage = await storeMessage(env, conversation, caseRow, event)

    if (event.message.type === 'image') {
      await storeImage(env, lineUserId, caseRow, dbMessage, event.message)
    }

    await finishWebhook(env, eventId, 'PROCESSED')
  } catch (error) {
    console.error('AI BUYER event processing failed', eventId, error)
    if (inserted) await finishWebhook(env, eventId, 'FAILED', String((error as Error)?.message || error))
  }
}

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext) {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) return response({ ok: false, error: 'BODY_TOO_LARGE' }, 413)

  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.byteLength > MAX_BODY_BYTES) return response({ ok: false, error: 'BODY_TOO_LARGE' }, 413)

  const signature = clean(request.headers.get('x-line-signature'), 500)
  if (!env.LINE_CHANNEL_SECRET || !(await verifyLineSignature(env.LINE_CHANNEL_SECRET, signature, raw))) {
    return response({ ok: false, error: 'LINE_SIGNATURE_INVALID' }, 401)
  }

  let body: LineWebhookBody
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as LineWebhookBody
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }

  const events = Array.isArray(body.events) ? body.events : []
  ctx.waitUntil(Promise.all(events.map((event) => processEvent(env, event))).then(() => undefined))
  return response({ ok: true })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return response({
        ok: true,
        service: 'amphon-ai-buyer',
        version: 1,
        environment: env.AI_BUYER_ENV || 'unknown',
        configured: {
          supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
          line: Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
          images: Boolean(env.IMAGES),
        },
        time: new Date().toISOString(),
      })
    }

    if (url.pathname === '/v1/webhooks/line' && request.method === 'POST') {
      return handleWebhook(request, env, ctx)
    }

    return response({ ok: false, error: 'NOT_FOUND' }, 404)
  },
}
