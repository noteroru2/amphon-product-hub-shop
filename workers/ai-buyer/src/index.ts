export { ConversationBatcher } from './batcher'
import { importPriceBook, guardOffer, type PriceBookImportPayload } from './pricing-engine'
import { runPricingForCase } from './pricing-router'
import { approvePreparedOffer, markOfferFlowDelivery, markOfferFlowFailure, startOfferAfterPricing } from './negotiation-engine'
import { handleHubAdminDashboard, handleHubAdminPreflight } from './hub-admin'

interface Env {
  IMAGES: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  AI_BUYER_HUB_ORIGINS?: string
  LINE_CHANNEL_SECRET: string
  LINE_CHANNEL_ACCESS_TOKEN: string
  OPENAI_API_KEY: string
  OPENAI_ADMIN_KEY?: string
  OPENAI_VISION_MODEL?: string
  OPENAI_PRICING_MODEL?: string
  AI_BUYER_ADMIN_TOKEN: string
  AI_BUYER_BATCH_DEBOUNCE_MS?: string
  CONVERSATION_BATCHER: DurableObjectNamespace
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
  replyToken?: string
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

type ProductCategory = 'NOTEBOOK' | 'MACBOOK' | 'DESKTOP_PC' | 'SMARTPHONE' | 'TABLET' | 'CAMERA' | 'OTHER'

type CaseRow = {
  id: string
  state: string
}

type DeterministicTextHint = {
  category: ProductCategory
  title: string
  modelName?: string
  modelCode?: string
  confirmed: Record<string, string>
  unknownFields: string[]
  identityConfidence: number
  specCompleteness: number
  conditionCompleteness: number
  pricingReadiness: number
  state: 'IDENTIFYING_PRODUCT' | 'NEED_MORE_INFO' | 'READY_TO_PRICE' | 'HUMAN_REVIEW'
  controlMode: 'AUTO' | 'HUMAN_REQUIRED'
  requestedInputs: string[]
  pricingTags: string[]
  flags: string[]
  readinessReason: string
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
  const payload: Record<string, unknown> = { line_user_id: lineUserId }
  if (profile) {
    payload.display_name = profile.displayName || null
    payload.picture_url = profile.pictureUrl || null
    payload.language = profile.language || null
  }
  const result = await supabaseRequest(env, 'ai_buyer_customers?on_conflict=line_user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
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
      last_message_at: at,
    }),
  })
  const rows = await readRows<ConversationRow>(result)
  if (!rows[0]) throw new Error('CONVERSATION_UPSERT_EMPTY')
  return rows[0]
}

async function existingActiveCase(env: Env, conversation: ConversationRow) {
  const terminal = TERMINAL_STATES.join(',')
  const rows = await readRows<CaseRow>(await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?select=id,state'
      + '&conversation_id=eq.' + encodeURIComponent(conversation.id)
      + '&state=not.in.(' + terminal + ')'
      + '&order=updated_at.desc&limit=1',
  ))
  return rows[0] || null
}

async function activeCase(env: Env, conversation: ConversationRow, customer: CustomerRow) {
  const rows = await readRows<CaseRow>(await supabaseRequest(
    env,
    'rpc/ai_buyer_get_or_create_active_case',
    {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        p_conversation_id: conversation.id,
        p_customer_id: customer.id,
      }),
    },
  ))
  if (!rows[0]) throw new Error('CASE_GET_OR_CREATE_EMPTY')
  return rows[0]
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

function deterministicStorage(text: string) {
  const matches = [...text.matchAll(/(?:^|\D)(32|64|128|256|512|1024)\s*(?:gb|g\b)/gi)]
  return matches.length ? matches[matches.length - 1][1] + ' GB' : ''
}

function deterministicConditionTags(text: string) {
  const tags: string[] = []
  if (/จอแตก|หน้าจอแตก|จอดำ|black\s*screen|screen\s*(?:is\s*)?(?:cracked|broken)/i.test(text)) tags.push('SCREEN_DEFECT')
  if (/เปิดไม่ติด|เครื่องไม่ติด|บูตไม่ขึ้น|เปิดเครื่องไม่ได้|does\s*not\s*boot|not\s*booting/i.test(text)) {
    tags.push('DEVICE_NOT_BOOTING')
  }
  if (/โดนน้ำ|น้ำเข้า|น้ำหก|liquid\s*damage|water\s*damage/i.test(text)) tags.push('LIQUID_DAMAGE_HISTORY')
  if ((/ติด\s*i?cloud|icloud\s*(?:lock|locked)/i.test(text)) && !/ไม่ติด\s*i?cloud/i.test(text)) tags.push('LOCKED')
  if (/แบตเสื่อม|แบตไม่เก็บ|แบตหมดไว|battery\s*(?:bad|degraded)/i.test(text)) tags.push('BATTERY_BAD')
  const batteryPercent = text.match(/(?:battery|แบต)[^0-9]{0,24}(\d{1,3})\s*%/i)
  if (batteryPercent && Number(batteryPercent[1]) < 80) tags.push('BATTERY_BAD')
  return Array.from(new Set(tags))
}

function deterministicTextHint(input: string): DeterministicTextHint | null {
  const text = clean(input, 12000)
  const lower = text.toLocaleLowerCase('en-US')
  const pricingTags = deterministicConditionTags(text)
  const hardReview = pricingTags.some((tag) => [
    'DEVICE_NOT_BOOTING','LIQUID_DAMAGE_HISTORY','LOCKED','MAJOR_DAMAGE',
  ].includes(tag))

  const make = (
    category: ProductCategory,
    title: string,
    options: Partial<DeterministicTextHint> = {},
  ): DeterministicTextHint => ({
    category,
    title,
    confirmed: {},
    unknownFields: [],
    identityConfidence: 0.82,
    specCompleteness: 0.20,
    conditionCompleteness: pricingTags.length ? 0.70 : 0.20,
    pricingReadiness: 0.20,
    state: 'IDENTIFYING_PRODUCT',
    controlMode: 'AUTO',
    requestedInputs: ['MODEL'],
    pricingTags,
    flags: ['DETERMINISTIC_TEXT_CLASSIFICATION'],
    readinessReason: 'MISSING_MODEL',
    ...options,
  })

  const withRisk = (hint: DeterministicTextHint) => {
    if (!hardReview) return hint
    return {
      ...hint,
      state: 'HUMAN_REVIEW' as const,
      controlMode: 'HUMAN_REQUIRED' as const,
      pricingReadiness: Math.min(hint.pricingReadiness, 0.49),
      requestedInputs: [],
      readinessReason: pricingTags.includes('DEVICE_NOT_BOOTING')
        ? 'DEVICE_NOT_BOOTING'
        : pricingTags.includes('LOCKED')
          ? 'LOCKED'
          : 'HUMAN_REVIEW_REQUIRED',
      flags: Array.from(new Set([...hint.flags, 'DETERMINISTIC_HARD_REVIEW'])),
    }
  }

  if (/dell\s+precision\s+5820/i.test(text)) {
    const confirmed: Record<string, string> = {
      brand: 'Dell',
      model: 'Precision 5820',
      series: 'Precision',
    }
    if (/w-2223/i.test(text)) confirmed.cpu = 'Intel Xeon W-2223'
    if (/32\s*gb/i.test(text)) confirmed.ram = '32 GB'
    if (/256\s*gb/i.test(text) && /2\s*tb/i.test(text)) confirmed.storage = '256 GB NVMe + 2 TB NVMe'
    if (/a2000/i.test(text)) confirmed.gpu = 'NVIDIA Quadro RTX A2000 6GB'
    return withRisk(make('DESKTOP_PC','Dell Precision 5820',{
      modelName:'Dell Precision 5820',
      modelCode:'5820',
      confirmed,
      unknownFields:['motherboard','psu'],
      identityConfidence:0.99,
      specCompleteness:0.86,
      conditionCompleteness:0.20,
      pricingReadiness:0.92,
      state:'READY_TO_PRICE',
      requestedInputs:[],
      readinessReason:'READY_BY_MODEL_CODE',
      flags:['DETERMINISTIC_TEXT_CLASSIFICATION','COMMERCIAL_DESKTOP_MODEL_EXACT'],
    }))
  }

  if (/ipad\s*air\s*4|ไอแพด\s*air\s*4/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Apple', model:'iPad Air 4' }
    if (storage) confirmed.storage = storage
    return withRisk(make('TABLET','Apple iPad Air 4',{
      modelName:'iPad Air 4',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.99,
      specCompleteness:storage ? 0.92 : 0.72,
      conditionCompleteness:pricingTags.length ? 0.90 : 0.30,
      pricingReadiness:storage ? 0.94 : 0.55,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/ipad\s*air\s*5|ไอแพด\s*air\s*5/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Apple', model:'iPad Air 5' }
    if (storage) confirmed.storage = storage
    return withRisk(make('TABLET','Apple iPad Air 5',{
      modelName:'iPad Air 5',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.99,
      specCompleteness:storage ? 0.92 : 0.72,
      conditionCompleteness:pricingTags.length ? 0.90 : 0.30,
      pricingReadiness:storage ? 0.94 : 0.55,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/ipad\s*(?:gen\s*)?9|ไอแพด\s*(?:gen\s*)?9/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Apple', model:'iPad 9th Gen' }
    if (storage) confirmed.storage = storage
    return withRisk(make('TABLET','Apple iPad 9th Gen',{
      modelName:'iPad 9th Gen',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.98,
      specCompleteness:storage ? 0.90 : 0.68,
      pricingReadiness:storage ? 0.92 : 0.52,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/matepad\s*t\s*10s|matepad\s*t10s/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Huawei', model:'MatePad T10s' }
    if (storage) confirmed.storage = storage
    return withRisk(make('TABLET','Huawei MatePad T10s',{
      modelName:'Huawei MatePad T10s',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.98,
      specCompleteness:storage ? 0.90 : 0.68,
      pricingReadiness:storage ? 0.92 : 0.52,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/iphone\s*11\s*pro\s*max|ไอโฟน\s*11\s*pro\s*max/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Apple', model:'iPhone 11 Pro Max' }
    if (storage) confirmed.storage = storage
    return withRisk(make('SMARTPHONE','Apple iPhone 11 Pro Max',{
      modelName:'iPhone 11 Pro Max',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.99,
      specCompleteness:storage ? 0.90 : 0.68,
      conditionCompleteness:pricingTags.length ? 0.90 : 0.30,
      pricingReadiness:storage ? 0.93 : 0.52,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/galaxy\s*s23\s*ultra|s23\s*ultra|s23ul/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Samsung', model:'Galaxy S23 Ultra' }
    if (storage) confirmed.storage = storage
    return withRisk(make('SMARTPHONE','Samsung Galaxy S23 Ultra',{
      modelName:'Galaxy S23 Ultra',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.98,
      specCompleteness:storage ? 0.90 : 0.68,
      conditionCompleteness:pricingTags.length ? 0.90 : 0.30,
      pricingReadiness:storage ? 0.92 : 0.52,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/galaxy\s*s25\s*ultra|s25\s*ultra/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Samsung', model:'Galaxy S25 Ultra' }
    if (storage) confirmed.storage = storage
    return withRisk(make('SMARTPHONE','Samsung Galaxy S25 Ultra',{
      modelName:'Galaxy S25 Ultra',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.98,
      specCompleteness:storage ? 0.90 : 0.68,
      conditionCompleteness:pricingTags.length ? 0.85 : 0.35,
      pricingReadiness:storage ? 0.92 : 0.52,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/xiaomi\s*13t|เสี่ยวหมี่\s*13t/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Xiaomi', model:'Xiaomi 13T' }
    if (storage) confirmed.storage = storage
    return withRisk(make('SMARTPHONE','Xiaomi 13T',{
      modelName:'Xiaomi 13T',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.98,
      specCompleteness:storage ? 0.90 : 0.68,
      conditionCompleteness:pricingTags.length ? 0.85 : 0.30,
      pricingReadiness:storage ? 0.92 : 0.52,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/iphone\s*xr|ไอโฟน\s*xr/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Apple', model:'iPhone XR' }
    if (storage) confirmed.storage = storage
    return withRisk(make('SMARTPHONE','Apple iPhone XR',{
      modelName:'iPhone XR',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.99,
      specCompleteness:storage ? 0.90 : 0.65,
      pricingReadiness:storage ? 0.93 : 0.50,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/insta\s*360\s*(?:one\s*)?x2/i.test(lower)) {
    return withRisk(make('CAMERA','Insta360 ONE X2',{
      modelName:'Insta360 ONE X2',
      modelCode:'X2',
      confirmed:{ brand:'Insta360', model:'ONE X2' },
      identityConfidence:0.99,
      specCompleteness:0.86,
      pricingReadiness:0.92,
      state:'READY_TO_PRICE',
      requestedInputs:[],
      readinessReason:'READY_BY_MODEL_CODE',
    }))
  }

  if (/dji\s*(?:osmo\s*)?action\s*3/i.test(lower)) {
    return withRisk(make('CAMERA','DJI Osmo Action 3',{
      modelName:'DJI Osmo Action 3',
      modelCode:'ACTION3',
      confirmed:{ brand:'DJI', model:'Osmo Action 3' },
      identityConfidence:0.99,
      specCompleteness:0.86,
      pricingReadiness:0.92,
      state:'READY_TO_PRICE',
      requestedInputs:[],
      readinessReason:'READY_BY_MODEL_CODE',
    }))
  }

  if (/apple\s*watch|แอ[^\n]{0,20}เปิ้ล[^\n]{0,20}watc+h|นาฬิกา|smart\s*watch|watc+h|watcch/i.test(lower)) {
    const series10 = /series\s*10/i.test(lower)
    return make('OTHER',series10 ? 'Apple Watch Series 10' : 'Smartwatch',{
      modelName:series10 ? 'Apple Watch Series 10' : undefined,
      confirmed:series10 ? { brand:'Apple', model:'Watch Series 10' } : {},
      identityConfidence:series10 ? 0.98 : 0.82,
      specCompleteness:series10 ? 0.60 : 0.20,
      pricingReadiness:0.10,
      state:'HUMAN_REVIEW',
      controlMode:'HUMAN_REQUIRED',
      requestedInputs:[],
      readinessReason:'UNSUPPORTED_CATEGORY',
    })
  }

  if (/เครื่องเกม|nintendo|นินเท|playstation|xbox/i.test(lower)) {
    return make('OTHER','Game console',{
      identityConfidence:0.86,pricingReadiness:0.10,state:'HUMAN_REVIEW',
      controlMode:'HUMAN_REQUIRED',requestedInputs:[],readinessReason:'UNSUPPORTED_CATEGORY',
    })
  }
  if (/จอพกพา|portable\s*monitor|รับซื้อทีวี|\btv\b|โทรทัศน์/i.test(lower)) {
    return make('OTHER',/จอพกพา|portable\s*monitor/i.test(lower) ? 'Portable monitor' : 'Television',{
      identityConfidence:0.88,pricingReadiness:0.10,state:'HUMAN_REVIEW',
      controlMode:'HUMAN_REQUIRED',requestedInputs:[],readinessReason:'UNSUPPORTED_CATEGORY',
    })
  }
  if (/กล้องส่องทางไกล|binocular/i.test(lower)) {
    return make('OTHER','Binoculars',{
      identityConfidence:0.92,pricingReadiness:0.10,state:'HUMAN_REVIEW',
      controlMode:'HUMAN_REQUIRED',requestedInputs:[],readinessReason:'UNSUPPORTED_CATEGORY',
    })
  }
  if (/เหล้า|whisk(?:y|ey)|cognac|บรั่นดี|\bxo\b/i.test(lower)) {
    return make('OTHER','Alcoholic beverage',{
      identityConfidence:0.90,pricingReadiness:0.05,state:'HUMAN_REVIEW',
      controlMode:'HUMAN_REQUIRED',requestedInputs:[],readinessReason:'UNSUPPORTED_CATEGORY',
      flags:['DETERMINISTIC_TEXT_CLASSIFICATION','REGULATED_OR_UNSUPPORTED_PRODUCT'],
    })
  }

  if (/macbook\s*air[^\n]{0,40}\bm5\b|\bm5\b[^\n]{0,40}macbook\s*air/i.test(lower)) {
    const storage = deterministicStorage(lower)
    const confirmed: Record<string,string> = { brand:'Apple', model:'MacBook Air M5', chip:'Apple M5' }
    if (/24\s*gb/i.test(lower)) confirmed.ram = '24 GB'
    if (storage) confirmed.storage = storage
    if (/2026/.test(lower)) confirmed.year = '2026'
    return withRisk(make('MACBOOK','Apple MacBook Air M5',{
      modelName:'MacBook Air M5',
      confirmed,
      unknownFields:storage ? [] : ['storage'],
      identityConfidence:0.98,
      specCompleteness:storage ? 0.95 : 0.78,
      conditionCompleteness:pricingTags.length ? 0.85 : 0.55,
      pricingReadiness:storage ? 0.93 : 0.55,
      state:storage ? 'READY_TO_PRICE' : 'NEED_MORE_INFO',
      requestedInputs:storage ? [] : ['STORAGE_VARIANT'],
      readinessReason:storage ? 'READY_BY_MODEL_IDENTITY' : 'MISSING_STORAGE_VARIANT',
    }))
  }

  if (/macbook/i.test(lower)) {
    return make('MACBOOK','Apple MacBook',{
      confirmed:{brand:'Apple'},identityConfidence:0.88,requestedInputs:['MODEL','STORAGE_VARIANT'],
      readinessReason:'MISSING_MODEL',
    })
  }
  if (/iphone|ไอโฟน/i.test(lower)) {
    return make('SMARTPHONE','Apple iPhone',{
      confirmed:{brand:'Apple'},identityConfidence:0.86,requestedInputs:['MODEL','STORAGE_VARIANT'],
      readinessReason:'MISSING_MODEL',
    })
  }
  if (/ipad|ไอแพด|tablet|แท็บเล็ต|matepad|galaxy\s*tab/i.test(lower)) {
    return make('TABLET','Tablet',{
      identityConfidence:0.84,requestedInputs:['MODEL','STORAGE_VARIANT'],readinessReason:'MISSING_MODEL',
    })
  }
  if (/notebook|โน้ตบุ๊ก|โน๊ตบุ๊ค|laptop/i.test(lower)) {
    return make('NOTEBOOK','Notebook',{
      identityConfidence:0.82,requestedInputs:['MODEL','CORE_SPEC'],readinessReason:'MISSING_MODEL',
    })
  }
  if (/workstation|desktop|คอมตั้งโต๊ะ|คอมพิวเตอร์|precision\s+\d{4}/i.test(lower)) {
    return make('DESKTOP_PC','Desktop PC',{
      identityConfidence:0.82,requestedInputs:['MODEL','CORE_SPEC'],readinessReason:'MISSING_MODEL',
    })
  }
  if (/กล้อง|camera|cyber-shot|powershot|instax|dji\s*(?:osmo\s*)?action/i.test(lower)) {
    return make('CAMERA','Camera',{
      identityConfidence:0.82,requestedInputs:['MODEL'],readinessReason:'MISSING_MODEL',
    })
  }
  return null
}

async function applyDeterministicTextEvidence(
  env: Env,
  conversation: ConversationRow,
  caseRow: CaseRow,
  messageId: string,
) {
  const messageRows = await readRows<Array<{ id: string; text_content: string | null; created_at: string }> extends Array<infer T> ? T : never>(
    await supabaseRequest(
      env,
      'ai_buyer_messages?conversation_id=eq.' + encodeURIComponent(conversation.id)
        + '&direction=eq.INBOUND&message_type=eq.TEXT&text_content=not.is.null'
        + '&select=id,text_content,created_at&order=created_at.desc&limit=30',
    ),
  )
  const chronological = [...messageRows].reverse()
  const combined = chronological.map((row) => clean(row.text_content, 4000)).filter(Boolean).join('\n')
  const hint = deterministicTextHint(combined)
  if (!hint) return

  const cases = await readRows<Array<{
    id: string
    state: string
    category: ProductCategory | null
    title: string | null
    control_mode: string
    identity_confidence: number | null
    spec_completeness: number | null
    condition_completeness: number | null
    pricing_readiness: number | null
    metadata: Record<string, unknown> | null
  }> extends Array<infer T> ? T : never>(
    await supabaseRequest(
      env,
      'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id)
        + '&select=id,state,category,title,control_mode,identity_confidence,spec_completeness,condition_completeness,pricing_readiness,metadata&limit=1',
    ),
  )
  const current = cases[0]
  if (!current || TERMINAL_STATES.includes(current.state)) return

  const currentConfidence = Number(current.identity_confidence || 0)
  const canPromote = !current.category
    || ['NEW','IDENTIFYING_PRODUCT','NEED_MORE_INFO'].includes(current.state)
    || hint.identityConfidence > currentConfidence

  const oldTags = Array.isArray(current.metadata?.lastPricingTags)
    ? current.metadata.lastPricingTags.map((tag) => clean(tag, 100)).filter(Boolean)
    : []
  const oldFlags = Array.isArray(current.metadata?.lastFlags)
    ? current.metadata.lastFlags.map((flag) => clean(flag, 300)).filter(Boolean)
    : []
  const mergedTags = Array.from(new Set([...oldTags, ...hint.pricingTags])).slice(0, 16)
  const mergedFlags = Array.from(new Set([...oldFlags, ...hint.flags])).slice(0, 20)
  const hardReview = mergedTags.some((tag) => [
    'DEVICE_NOT_BOOTING','LIQUID_DAMAGE_HISTORY','LOCKED','MAJOR_DAMAGE',
  ].includes(tag))

  if (canPromote) {
    const observation = await supabaseRequest(env, 'ai_buyer_product_observations', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        case_id: current.id,
        source: 'CUSTOMER_TEXT',
        confirmed: hint.confirmed,
        inferred: {},
        unknown_fields: hint.unknownFields,
        evidence: [{
          type: 'DETERMINISTIC_TEXT',
          message_id: messageId,
          message_ids: chronological.map((row) => row.id),
        }],
        model_name: hint.modelName || null,
        model_code: hint.modelCode || null,
        category: hint.category,
        identity_confidence: hint.identityConfidence,
      }),
    })
    if (!observation.ok) {
      const detail = await observation.text().catch(() => '')
      throw new Error('DETERMINISTIC_OBSERVATION_' + observation.status + ':' + detail.slice(0, 300))
    }
  }

  const nextCategory = current.category || hint.category
  const nextState = hardReview
    ? 'HUMAN_REVIEW'
    : canPromote
      ? hint.state
      : current.state
  const nextControlMode = hardReview || nextCategory === 'OTHER'
    ? 'HUMAN_REQUIRED'
    : current.control_mode

  const metadata = {
    ...(current.metadata || {}),
    lastRequestedInputs: canPromote ? hint.requestedInputs : (current.metadata?.lastRequestedInputs || []),
    lastPricingTags: mergedTags,
    lastFlags: mergedFlags,
    readinessReason: hardReview ? hint.readinessReason : (canPromote ? hint.readinessReason : current.metadata?.readinessReason),
    deterministicTextEvidenceAt: new Date().toISOString(),
  }

  const patch = await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(current.id),
    {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        state: nextState,
        category: nextCategory,
        title: current.title || hint.title,
        control_mode: nextControlMode,
        identity_confidence: Math.max(currentConfidence, hint.identityConfidence),
        spec_completeness: Math.max(Number(current.spec_completeness || 0), hint.specCompleteness),
        condition_completeness: Math.max(Number(current.condition_completeness || 0), hint.conditionCompleteness),
        pricing_readiness: hardReview
          ? Math.min(Math.max(Number(current.pricing_readiness || 0), hint.pricingReadiness), 0.49)
          : Math.max(Number(current.pricing_readiness || 0), hint.pricingReadiness),
        metadata,
      }),
    },
  )
  if (!patch.ok) {
    const detail = await patch.text().catch(() => '')
    throw new Error('DETERMINISTIC_CASE_PATCH_' + patch.status + ':' + detail.slice(0, 300))
  }

  if (nextControlMode === 'HUMAN_REQUIRED') {
    await supabaseRequest(
      env,
      'ai_buyer_conversations?id=eq.' + encodeURIComponent(conversation.id),
      {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ control_mode: 'HUMAN_REQUIRED' }),
      },
    )
  }
}


async function storeMessage(
  env: Env,
  conversation: ConversationRow,
  caseRow: CaseRow | null,
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
      case_id: caseRow?.id || null,
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

async function scheduleConversationIntake(
  env: Env,
  conversation: ConversationRow,
  caseRow: CaseRow,
  lineUserId: string,
  event: LineWebhookEvent,
) {
  const id = env.CONVERSATION_BATCHER.idFromName(conversation.id)
  const stub = env.CONVERSATION_BATCHER.get(id)
  const result = await stub.fetch('https://batcher/touch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId: conversation.id,
      caseId: caseRow.id,
      lineUserId,
      replyToken: event.replyToken || null,
      touchedAt: Date.now(),
    }),
  })
  if (!result.ok) throw new Error('BATCHER_SCHEDULE_' + result.status)
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

    const passiveWithoutCase = ['sticker','location'].includes(event.message.type)
    const existingCase = passiveWithoutCase ? await existingActiveCase(env, conversation) : null
    if (passiveWithoutCase && !existingCase) {
      await storeMessage(env, conversation, null, event)
      await finishWebhook(env, eventId, 'PROCESSED')
      return
    }

    const caseRow = existingCase || await activeCase(env, conversation, customer)
    const dbMessage = await storeMessage(env, conversation, caseRow, event)

    if (event.message.type === 'text') {
      const text = clean(event.message.text, 2000)
      const nonSellerPawn = /รับจำนำ|จำนำ|ฝากไว้|ยอดตังฝาก|ยอดฝาก/i.test(text)
        && !/ขาย|รับซื้อ|ตีราคา|ประเมินราคา/i.test(text)
      const logisticsOnly = /นัดรับวันไหน|นัดรับ.*(?:พรุ่งนี้|วันนี้|วันไหน)|มารับวันไหน/i.test(text)
        && !/ขาย|รับซื้อ|ตีราคา|ประเมินราคา|รุ่น|สเปก/i.test(text)

      if (nonSellerPawn || (logisticsOnly && caseRow.state === 'NEW')) {
        const cancelReason = nonSellerPawn
          ? 'NON_SELLER_PAWN_OR_DEPOSIT_INQUIRY'
          : 'LOGISTICS_ONLY_NO_ACTIVE_PRODUCT'
        const patch = await supabaseRequest(
          env,
          'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id),
          {
            method: 'PATCH',
            headers: { prefer: 'return=minimal' },
            body: JSON.stringify({
              state: 'CANCELLED',
              completed_at: new Date().toISOString(),
              metadata: {
                cancelReason,
                cancelledAt: new Date().toISOString(),
              },
            }),
          },
        )
        if (!patch.ok) {
          const detail = await patch.text().catch(() => '')
          throw new Error('NON_VALUATION_CANCEL_' + patch.status + ':' + detail.slice(0, 300))
        }
        await finishWebhook(env, eventId, 'PROCESSED')
        return
      }

      try {
        await applyDeterministicTextEvidence(env, conversation, caseRow, dbMessage.id)
      } catch (deterministicError) {
        console.error('AI BUYER deterministic text classification failed', eventId, deterministicError)
      }
    }

    if (event.message.type === 'image') {
      await storeImage(env, lineUserId, caseRow, dbMessage, event.message)
    }

    try {
      await scheduleConversationIntake(env, conversation, caseRow, lineUserId, event)
    } catch (scheduleError) {
      console.error('AI BUYER batch scheduling failed', eventId, scheduleError)
    }

    await finishWebhook(env, eventId, 'PROCESSED')
  } catch (error) {
    console.error('AI BUYER event processing failed', eventId, error)
    if (inserted) await finishWebhook(env, eventId, 'FAILED', String((error as Error)?.message || error))
  }
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

async function requireAdmin(request: Request, env: Env) {
  const expected = clean(env.AI_BUYER_ADMIN_TOKEN, 500)
  const provided = clean(request.headers.get('x-ai-buyer-admin-token'), 500)
  if (!expected || !provided) return false
  return constantTimeEqual(await sha256(expected), await sha256(provided))
}

async function handleCaseRetryPricing(request: Request, env: Env) {
  if (!(await requireAdmin(request, env))) {
    return response({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401)
  }

  let payload: { caseId?: string }
  try {
    payload = await request.json() as { caseId?: string }
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }

  const caseId = clean(payload.caseId, 100)
  if (!caseId) return response({ ok: false, error: 'CASE_ID_REQUIRED' }, 400)

  const cases = await readRows<Array<{
    id: string
    conversation_id: string
    state: string
    control_mode: string
    metadata: Record<string, unknown> | null
  }> extends Array<infer T> ? T : never>(
    await supabaseRequest(
      env,
      'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
        + '&select=id,conversation_id,state,control_mode,metadata&limit=1',
    ),
  )
  const caseRow = cases[0]
  if (!caseRow) return response({ ok: false, error: 'CASE_NOT_FOUND' }, 404)

  const reviewReason = clean(caseRow.metadata?.pricingReviewReason, 120)
  const retryable = [
    'SPEC_REQUIRED_COMPONENT_MISSING',
    'SPEC_COMPONENT_UNMAPPED',
    'SPEC_LOW_CONFIDENCE_COMPONENT',
    'SPEC_PRICING_CONFIDENCE_LOW',
    'PRICING_GATE_NOT_MET',
  ].includes(reviewReason)
  if (caseRow.state === 'HUMAN_REVIEW' && !retryable) {
    return response({
      ok: false,
      error: 'CASE_REVIEW_NOT_RETRYABLE',
      reason: reviewReason || null,
    }, 409)
  }

  const nextMetadata = { ...(caseRow.metadata || {}) }
  delete nextMetadata.pricingReviewReason
  delete nextMetadata.pricingReviewDetail

  const casePatch = await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId),
    {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        state: 'READY_TO_PRICE',
        control_mode: 'AUTO',
        metadata: nextMetadata,
      }),
    },
  )
  if (!casePatch.ok) return response({ ok: false, error: 'CASE_RESET_FAILED' }, 500)

  await supabaseRequest(
    env,
    'ai_buyer_conversations?id=eq.' + encodeURIComponent(caseRow.conversation_id),
    {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ control_mode: 'AUTO' }),
    },
  )

  const pricing = await runPricingForCase(env, caseId)
  const pricingOk = Boolean(
    pricing
    && typeof pricing === 'object'
    && (pricing as { ok?: boolean }).ok,
  )

  let offerFlow: unknown = null
  if (pricingOk) {
    offerFlow = await startOfferAfterPricing(env, caseId)
  }

  return response({
    ok: pricingOk,
    caseId,
    pricing,
    offerFlow,
  }, pricingOk ? 200 : 409)
}

async function handleCaseReprocess(request: Request, env: Env) {
  if (!(await requireAdmin(request, env))) {
    return response({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401)
  }

  let payload: { caseId?: string }
  try {
    payload = await request.json() as { caseId?: string }
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }

  const caseId = clean(payload.caseId, 100)
  if (!caseId) return response({ ok: false, error: 'CASE_ID_REQUIRED' }, 400)

  const cases = await readRows<Array<{ id: string; conversation_id: string; state: string }> extends Array<infer T> ? T : never>(
    await supabaseRequest(
      env,
      'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
        + '&select=id,conversation_id,state&limit=1',
    ),
  )
  const caseRow = cases[0]
  if (!caseRow) return response({ ok: false, error: 'CASE_NOT_FOUND' }, 404)

  const conversations = await readRows<ConversationRow>(
    await supabaseRequest(
      env,
      'ai_buyer_conversations?id=eq.' + encodeURIComponent(caseRow.conversation_id)
        + '&select=id,customer_id,line_user_id&limit=1',
    ),
  )
  const conversation = conversations[0]
  if (!conversation?.line_user_id) {
    return response({ ok: false, error: 'CONVERSATION_NOT_FOUND' }, 404)
  }

  await scheduleConversationIntake(
    env,
    conversation,
    { id: caseRow.id, state: caseRow.state },
    conversation.line_user_id,
    { type: 'manual-reprocess' },
  )

  return response({
    ok: true,
    scheduled: true,
    caseId: caseRow.id,
    conversationId: conversation.id,
  }, 202)
}

async function handlePriceBookImport(request: Request, env: Env) {
  if (!(await requireAdmin(request, env))) {
    return response({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401)
  }

  let payload: PriceBookImportPayload
  try {
    payload = await request.json() as PriceBookImportPayload
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }

  try {
    const result = await importPriceBook(env, payload)
    return response(result, 201)
  } catch (error) {
    return response({
      ok: false,
      error: clean((error as Error)?.message || error, 1000),
    }, 400)
  }
}

async function handlePriceGuardCheck(request: Request, env: Env) {
  if (!(await requireAdmin(request, env))) {
    return response({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401)
  }

  let payload: { caseId?: string; decisionId?: string; amount?: number }
  try {
    payload = await request.json() as { caseId?: string; decisionId?: string; amount?: number }
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }

  const caseId = clean(payload.caseId, 100)
  const decisionId = clean(payload.decisionId, 100)
  if (!caseId || !decisionId || !Number.isFinite(Number(payload.amount))) {
    return response({ ok: false, error: 'PRICE_GUARD_INPUT_INVALID' }, 400)
  }

  const result = await guardOffer(env, {
    caseId,
    decisionId,
    amount: Number(payload.amount),
  })
  return response({ ok: true, result })
}

async function handleAutomationMode(request: Request, env: Env) {
  if (!(await requireAdmin(request, env))) {
    return response({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401)
  }

  if (request.method === 'GET') {
    const url = new URL(request.url)
    const category = clean(url.searchParams.get('category'), 40)
    const path = category
      ? 'ai_buyer_category_automation_modes?category=eq.' + encodeURIComponent(category)
        + '&select=category,mode,max_negotiation_rounds,active,metadata,updated_at&limit=1'
      : 'ai_buyer_category_automation_modes?select=category,mode,max_negotiation_rounds,active,metadata,updated_at&order=category.asc'
    const rows = await readRows<Record<string, unknown>>(await supabaseRequest(env, path))
    return response({ ok: true, modes: rows })
  }

  let payload: { category?: string; mode?: string; maxNegotiationRounds?: number; active?: boolean }
  try {
    payload = await request.json() as typeof payload
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }
  const category = clean(payload.category, 40)
  const mode = clean(payload.mode, 20)
  const categories = ['NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER']
  const modes = ['SHADOW','APPROVAL','AUTO']
  if (!categories.includes(category) || !modes.includes(mode)) {
    return response({ ok: false, error: 'AUTOMATION_MODE_INVALID' }, 400)
  }
  const rounds = payload.maxNegotiationRounds == null
    ? 4
    : Math.max(1, Math.min(10, Math.floor(Number(payload.maxNegotiationRounds) || 4)))
  const rows = await readRows<Record<string, unknown>>(await supabaseRequest(
    env,
    'ai_buyer_category_automation_modes?on_conflict=category',
    {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        category,
        mode,
        max_negotiation_rounds: rounds,
        active: payload.active !== false,
      }),
    },
  ))
  return response({ ok: true, mode: rows[0] || null })
}

async function handleApproveOffer(request: Request, env: Env) {
  if (!(await requireAdmin(request, env))) {
    return response({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401)
  }
  let payload: { caseId?: string; offerId?: string }
  try {
    payload = await request.json() as { caseId?: string; offerId?: string }
  } catch {
    return response({ ok: false, error: 'JSON_INVALID' }, 400)
  }
  const caseId = clean(payload.caseId, 100)
  const offerId = clean(payload.offerId, 100)
  if (!caseId || !offerId) return response({ ok: false, error: 'APPROVAL_INPUT_INVALID' }, 400)

  try {
    const flow = await approvePreparedOffer(env, caseId, offerId)
    if (!flow.handled || !flow.reply || !flow.lineUserId) {
      return response({ ok: false, error: flow.reason || 'OFFER_NOT_APPROVABLE' }, 400)
    }

    const sent = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: flow.lineUserId,
        messages: [{ type: 'text', text: flow.reply }],
      }),
    })
    if (!sent.ok) {
      const detail = await sent.text().catch(() => '')
      await markOfferFlowFailure(env, flow.outboundActionId, 'LINE_PUSH_' + sent.status + ':' + detail)
        .catch(() => undefined)
      return response({ ok: false, error: 'LINE_PUSH_' + sent.status }, 502)
    }

    await markOfferFlowDelivery(env, {
      offerId: flow.offerId,
      outboundActionId: flow.outboundActionId,
    })

    const cases = await readRows<{ conversation_id: string }>(await supabaseRequest(
      env,
      'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
        + '&select=conversation_id&limit=1',
    ))
    if (cases[0]) {
      await supabaseRequest(env, 'ai_buyer_messages', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          conversation_id: cases[0].conversation_id,
          case_id: caseId,
          direction: 'OUTBOUND',
          message_type: 'TEXT',
          text_content: flow.reply,
          metadata: { source: 'ADMIN_APPROVAL', action: 'OFFER', offerId },
          line_timestamp: new Date().toISOString(),
        }),
      })
    }
    return response({ ok: true, sent: true, caseId, offerId, amountGuarded: true })
  } catch (error) {
    return response({ ok: false, error: clean((error as Error)?.message || error, 1000) }, 400)
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
          vision: Boolean(env.OPENAI_API_KEY),
          pricing: Boolean(env.OPENAI_API_KEY),
          admin: Boolean(env.AI_BUYER_ADMIN_TOKEN),
          batcher: Boolean(env.CONVERSATION_BATCHER),
          hubAdmin: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
        },
        time: new Date().toISOString(),
      })
    }

    if (url.pathname === '/v1/webhooks/line' && request.method === 'POST') {
      return handleWebhook(request, env, ctx)
    }

    if (url.pathname === '/v1/hub/admin/dashboard' && request.method === 'OPTIONS') {
      return handleHubAdminPreflight(request, env)
    }

    if (url.pathname === '/v1/hub/admin/dashboard' && request.method === 'GET') {
      return handleHubAdminDashboard(request, env)
    }

    if (url.pathname === '/v1/admin/case/reprocess' && request.method === 'POST') {
      return handleCaseReprocess(request, env)
    }

    if (url.pathname === '/v1/admin/case/retry-pricing' && request.method === 'POST') {
      return handleCaseRetryPricing(request, env)
    }

    if (url.pathname === '/v1/admin/price-book/import' && request.method === 'POST') {
      return handlePriceBookImport(request, env)
    }

    if (url.pathname === '/v1/admin/price-guard/check' && request.method === 'POST') {
      return handlePriceGuardCheck(request, env)
    }

    if (url.pathname === '/v1/admin/automation-mode' && (request.method === 'GET' || request.method === 'POST')) {
      return handleAutomationMode(request, env)
    }

    if (url.pathname === '/v1/admin/offer/approve' && request.method === 'POST') {
      return handleApproveOffer(request, env)
    }

    return response({ ok: false, error: 'NOT_FOUND' }, 404)
  },
}
