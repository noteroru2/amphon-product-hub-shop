import { createGuardedOffer } from './pricing-engine'

export interface OfferFlowEnv {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

export type OfferFlowMessage = {
  id: string
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM'
  message_type: string
  text_content: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type ProductCategory = 'NOTEBOOK' | 'MACBOOK' | 'DESKTOP_PC' | 'SMARTPHONE' | 'TABLET' | 'CAMERA' | 'OTHER'
type RolloutMode = 'SHADOW' | 'APPROVAL' | 'AUTO'

type CaseRow = {
  id: string
  conversation_id: string
  customer_id: string
  state: string
  category: ProductCategory | null
  title: string | null
  accepted_price: number | null
  accepted_at: string | null
  metadata: Record<string, unknown> | null
}

type DecisionRow = {
  id: string
  case_id: string
  opening_offer: number
  target_buy: number
  hard_max: number
  current_authorized_offer: number
  pricing_confidence: number
  estimated_resale: number | null
  price_source: string
  price_book_version_id: string | null
  rationale: Record<string, unknown> | null
  created_at: string
}

type OfferRow = {
  id: string
  case_id: string
  pricing_decision_id: string
  amount: number
  actor: 'AI' | 'ADMIN' | 'CUSTOMER'
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED'
  idempotency_key: string | null
  round_no: number
  delivered_at: string | null
  created_at: string
}

type RolloutRow = {
  category: ProductCategory
  mode: RolloutMode
  max_negotiation_rounds: number
  active: boolean
}

type FulfillmentRow = {
  case_id: string
  customer_name: string | null
  phone: string | null
  method: 'PICKUP' | 'SHIP' | 'STORE_DROP' | null
  address: string | null
  latitude: number | null
  longitude: number | null
  location_title: string | null
  notes: string | null
  completed_at: string | null
  metadata: Record<string, unknown> | null
}

export type OfferFlowResult = {
  handled: boolean
  state?: string
  reply?: string | null
  action?: string
  offerId?: string | null
  outboundActionId?: string | null
  mode?: RolloutMode
  reason?: string
}

function clean(value: unknown, max = 1000) {
  return String(value ?? '').trim().slice(0, max)
}

function numberValue(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function supabaseHeaders(env: OfferFlowEnv, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
    accept: 'application/json',
    ...extra,
  }
}

async function supabaseRequest(env: OfferFlowEnv, path: string, init: RequestInit = {}) {
  return fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    ...init,
    headers: {
      ...supabaseHeaders(env),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
}

async function readRows<T>(response: Response): Promise<T[]> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error('SUPABASE_' + response.status + ':' + detail.slice(0, 600))
  }
  const text = await response.text()
  return text ? JSON.parse(text) as T[] : []
}

async function patchRows(env: OfferFlowEnv, path: string, body: Record<string, unknown>) {
  const response = await supabaseRequest(env, path, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error('SUPABASE_PATCH_' + response.status + ':' + detail.slice(0, 600))
  }
}

async function loadCase(env: OfferFlowEnv, caseId: string) {
  const rows = await readRows<CaseRow>(await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
      + '&select=id,conversation_id,customer_id,state,category,title,accepted_price,accepted_at,metadata&limit=1',
  ))
  return rows[0] || null
}

async function loadDecision(env: OfferFlowEnv, caseId: string) {
  const rows = await readRows<DecisionRow>(await supabaseRequest(
    env,
    'ai_buyer_pricing_decisions?case_id=eq.' + encodeURIComponent(caseId)
      + '&select=id,case_id,opening_offer,target_buy,hard_max,current_authorized_offer,pricing_confidence,estimated_resale,price_source,price_book_version_id,rationale,created_at'
      + '&order=created_at.desc&limit=1',
  ))
  return rows[0] || null
}

async function loadRollout(env: OfferFlowEnv, category: ProductCategory | null): Promise<RolloutRow> {
  if (!category) return { category: 'OTHER', mode: 'SHADOW', max_negotiation_rounds: 4, active: true }
  const rows = await readRows<RolloutRow>(await supabaseRequest(
    env,
    'ai_buyer_category_automation_modes?category=eq.' + encodeURIComponent(category)
      + '&select=category,mode,max_negotiation_rounds,active&limit=1',
  ))
  return rows[0] || { category, mode: 'SHADOW', max_negotiation_rounds: 4, active: true }
}

async function loadLatestShopOffer(env: OfferFlowEnv, caseId: string, deliveredOnly = true) {
  const delivered = deliveredOnly ? '&delivered_at=not.is.null' : ''
  const rows = await readRows<OfferRow>(await supabaseRequest(
    env,
    'ai_buyer_offers?case_id=eq.' + encodeURIComponent(caseId)
      + '&actor=in.(AI,ADMIN)&status=eq.PROPOSED' + delivered
      + '&select=id,case_id,pricing_decision_id,amount,actor,status,idempotency_key,round_no,delivered_at,created_at'
      + '&order=created_at.desc&limit=1',
  ))
  return rows[0] || null
}

async function createEvent(
  env: OfferFlowEnv,
  body: Record<string, unknown>,
  onceByOfferAndType = false,
) {
  if (onceByOfferAndType && body.offer_id && body.event_type) {
    const existing = await readRows<{ id: string }>(await supabaseRequest(
      env,
      'ai_buyer_negotiation_events?offer_id=eq.' + encodeURIComponent(String(body.offer_id))
        + '&event_type=eq.' + encodeURIComponent(String(body.event_type))
        + '&select=id&limit=1',
    ))
    if (existing[0]) return existing[0]
  }
  const rows = await readRows<{ id: string }>(await supabaseRequest(env, 'ai_buyer_negotiation_events', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(body),
  }))
  return rows[0] || null
}

async function ensureAdminTask(
  env: OfferFlowEnv,
  caseId: string,
  taskType: string,
  payload: Record<string, unknown>,
  priority: 'NORMAL' | 'HIGH' = 'NORMAL',
) {
  const existing = await readRows<{ id: string }>(await supabaseRequest(
    env,
    'ai_buyer_admin_tasks?case_id=eq.' + encodeURIComponent(caseId)
      + '&task_type=eq.' + encodeURIComponent(taskType)
      + '&status=in.(ACTION_REQUIRED,IN_PROGRESS)&select=id&limit=1',
  ))
  if (existing[0]) return existing[0]
  const rows = await readRows<{ id: string }>(await supabaseRequest(env, 'ai_buyer_admin_tasks', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      case_id: caseId,
      task_type: taskType,
      status: 'ACTION_REQUIRED',
      priority,
      payload,
    }),
  }))
  return rows[0] || null
}

async function createOutboundAction(
  env: OfferFlowEnv,
  input: {
    conversationId: string
    caseId: string
    offerId?: string | null
    actionType: 'OFFER' | 'NEGOTIATION_REPLY' | 'FULFILLMENT_PROMPT' | 'FULFILLMENT_COMPLETE'
    idempotencyKey: string
    text: string
  },
) {
  const existing = await readRows<{ id: string; status: string }>(await supabaseRequest(
    env,
    'ai_buyer_outbound_actions?idempotency_key=eq.' + encodeURIComponent(input.idempotencyKey)
      + '&select=id,status&limit=1',
  ))
  if (existing[0]) return existing[0]
  const rows = await readRows<{ id: string; status: string }>(await supabaseRequest(env, 'ai_buyer_outbound_actions', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      conversation_id: input.conversationId,
      case_id: input.caseId,
      offer_id: input.offerId || null,
      action_type: input.actionType,
      idempotency_key: input.idempotencyKey,
      status: 'PENDING',
      payload: { text: input.text },
    }),
  }))
  if (!rows[0]) throw new Error('OUTBOUND_ACTION_CREATE_EMPTY')
  return rows[0]
}

function baht(amount: number) {
  return Math.round(amount).toLocaleString('en-US')
}

function initialOfferText(amount: number) {
  return 'ประเมินรับซื้อได้ที่ประมาณ ' + baht(amount)
    + ' บาทครับ ถ้าเครื่องตรงตามข้อมูลและสภาพที่ส่งมา ราคานี้รับได้ครับ'
}

function thaiDigitsToArabic(input: string) {
  const th = '๐๑๒๓๔๕๖๗๘๙'
  return input.replace(/[๐-๙]/g, (digit) => String(th.indexOf(digit)))
}

export function parseCounterAmount(text: string) {
  const source = thaiDigitsToArabic(clean(text, 1000)).toLowerCase()
  const candidates: number[] = []
  const k = source.match(/(\d+(?:\.\d+)?)\s*k\b/)
  if (k) candidates.push(Number(k[1]) * 1000)
  const thousand = source.match(/(\d+(?:\.\d+)?)\s*พัน/)
  if (thousand) candidates.push(Number(thousand[1]) * 1000)
  const tenThousand = source.match(/(\d+(?:\.\d+)?)\s*หมื่น/)
  if (tenThousand) candidates.push(Number(tenThousand[1]) * 10000)
  const plain = source.match(/(?:^|\D)(\d{3,6}|\d{1,3}(?:,\d{3})+)(?:\s*(?:บาท|บ\.?))?(?:\D|$)/)
  if (plain) candidates.push(Number(plain[1].replace(/,/g, '')))
  return candidates.find((value) => Number.isFinite(value) && value >= 100 && value <= 500000) || null
}

export function isExplicitAcceptance(text: string, currentOffer: number) {
  const source = clean(text, 500).toLowerCase()
  if (!source) return false
  if (/ได้ไหม|ได้หรือ|เพิ่ม|ขอเพิ่ม|สุดได้|เท่าไหร่|เท่าไร/.test(source)) return false
  const counter = parseCounterAmount(source)
  if (counter != null && Math.abs(counter - currentOffer) > 50) return false
  const exact = /^(ได้|ได้ครับ|ได้ค่ะ|โอเค|โอเคครับ|โอเคค่ะ|ตกลง|ตกลงครับ|ตกลงค่ะ)$/
  if (exact.test(source)) return true
  return [
    'ขายครับ','ขายค่ะ','เอาราคานี้','รับเลยครับ','รับเลยค่ะ',
    'ได้ตามนั้น','มารับได้เลย','ตกลงขาย','โอเคราคานี้',
  ].some((phrase) => source.includes(phrase))
}

function isExplicitDecline(text: string) {
  const source = clean(text, 500).toLowerCase()
  return /ไม่ขายแล้ว|ขอไม่ขาย|ยังไม่ขาย|ขอผ่าน|ไม่สะดวกขาย|ยกเลิกการขาย/.test(source)
}

function asksForIncrease(text: string) {
  const source = clean(text, 500).toLowerCase()
  return /เพิ่มได้|ขอเพิ่ม|ได้อีกไหม|ขยับได้|สุดได้เท่าไหร่|สุดได้เท่าไร|เต็มที่เท่าไหร่|เต็มที่เท่าไร/.test(source)
}

function roundDown(value: number, step = 100) {
  return Math.floor(Math.max(0, value) / step) * step
}

export function computeConcession(
  decision: Pick<DecisionRow, 'target_buy' | 'hard_max'>,
  currentOffer: number,
  counter: number | null,
  nextRound: number,
  maxRounds: number,
  roundingStep = 100,
) {
  const target = Math.max(currentOffer, numberValue(decision.target_buy))
  const hardMax = Math.max(target, numberValue(decision.hard_max))
  let cap = currentOffer
  if (nextRound >= maxRounds) {
    cap = hardMax
  } else if (nextRound <= 1) {
    cap = currentOffer + (target - currentOffer) * 0.5
  } else if (nextRound === 2) {
    cap = target
  } else {
    cap = target + (hardMax - target) * 0.5
  }
  cap = Math.min(hardMax, roundDown(cap, roundingStep))
  let next = counter != null ? Math.min(counter, cap) : cap
  next = Math.min(hardMax, Math.max(currentOffer, roundDown(next, roundingStep)))
  if (next === currentOffer && currentOffer < hardMax && counter !== null && counter > currentOffer) {
    next = Math.min(hardMax, currentOffer + roundingStep)
  }
  return next
}

async function createCustomerCounter(
  env: OfferFlowEnv,
  caseId: string,
  decisionId: string,
  amount: number,
  messageId: string,
) {
  const key = 'customer-counter:' + messageId + ':' + Math.round(amount)
  const existing = await readRows<{ id: string }>(await supabaseRequest(
    env,
    'ai_buyer_offers?idempotency_key=eq.' + encodeURIComponent(key) + '&select=id&limit=1',
  ))
  if (existing[0]) return existing[0]
  const rows = await readRows<{ id: string }>(await supabaseRequest(env, 'ai_buyer_offers', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      case_id: caseId,
      pricing_decision_id: decisionId,
      amount: Math.round(amount),
      actor: 'CUSTOMER',
      status: 'PROPOSED',
      idempotency_key: key,
      round_no: 0,
      message_id: messageId,
    }),
  }))
  return rows[0] || null
}

async function acceptOffer(env: OfferFlowEnv, caseId: string, offerId: string, messageId: string) {
  const rows = await readRows<{ offer_id: string; agreed_price: number }>(await supabaseRequest(
    env,
    'rpc/ai_buyer_accept_offer',
    {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        p_case_id: caseId,
        p_offer_id: offerId,
        p_inbound_message_id: messageId,
      }),
    },
  ))
  if (!rows[0]) throw new Error('ACCEPT_OFFER_EMPTY')
  return rows[0]
}

function parsePhone(text: string) {
  const source = thaiDigitsToArabic(clean(text, 1000)).replace(/[\s()-]/g, '')
  const match = source.match(/(?:\+66|0)[689]\d{8}/)
  if (!match) return null
  return match[0].startsWith('+66') ? '0' + match[0].slice(3) : match[0]
}

function parseName(text: string) {
  const source = clean(text, 1000)
  const match = source.match(/(?:ผมชื่อ|ดิฉันชื่อ|หนูชื่อ|ชื่อผม|ชื่อ)\s*[:：]?\s*([^,\n]{2,60}?)(?=\s*(?:เบอร์|โทร|ที่อยู่|อยู่ที่|$))/)
  return match ? clean(match[1], 60) : null
}

function parseMethod(text: string): FulfillmentRow['method'] {
  const source = clean(text, 1000).toLowerCase()
  if (/เข้าร้าน|ไปที่ร้าน|นำไปที่ร้าน|เอาไปที่ร้าน|ส่งที่ร้าน/.test(source)) return 'STORE_DROP'
  if (/ขนส่ง|ไปรษณีย์|flash|kerry|j&t|jnt|ส่งพัสดุ|ส่งของ/.test(source)) return 'SHIP'
  if (/มารับ|รับถึงบ้าน|นัดรับ|ไปรับ|รับที่บ้าน|รับของ/.test(source)) return 'PICKUP'
  return null
}

function parseAddress(text: string) {
  const source = clean(text, 1000)
  const labelled = source.match(/(?:ที่อยู่|สถานที่|จุดรับ|อยู่ที่)\s*[:：]?\s*(.{6,220})/)
  if (labelled) return clean(labelled[1], 220)
  if (source.length >= 8 && /(จังหวัด|จ\.|อำเภอ|อ\.|ตำบล|ต\.|ถนน|ซอย|หมู่\s*\d|แขวง|เขต)/.test(source)) {
    return source
  }
  return null
}

function locationFromMessage(message: OfferFlowMessage) {
  if (message.message_type !== 'LOCATION') return null
  const raw = message.metadata?.location
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const loc = raw as Record<string, unknown>
  const latitude = Number(loc.latitude)
  const longitude = Number(loc.longitude)
  return {
    title: clean(loc.title, 160) || null,
    address: clean(loc.address, 220) || null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  }
}

async function loadFulfillment(env: OfferFlowEnv, caseId: string) {
  const rows = await readRows<FulfillmentRow>(await supabaseRequest(
    env,
    'ai_buyer_fulfillment_details?case_id=eq.' + encodeURIComponent(caseId)
      + '&select=case_id,customer_name,phone,method,address,latitude,longitude,location_title,notes,completed_at,metadata&limit=1',
  ))
  return rows[0] || null
}

async function updateFulfillmentFromMessages(env: OfferFlowEnv, caseId: string, messages: OfferFlowMessage[]) {
  const current = await loadFulfillment(env, caseId)
  const next: Record<string, unknown> = {
    case_id: caseId,
    customer_name: current?.customer_name || null,
    phone: current?.phone || null,
    method: current?.method || null,
    address: current?.address || null,
    latitude: current?.latitude ?? null,
    longitude: current?.longitude ?? null,
    location_title: current?.location_title || null,
    notes: current?.notes || null,
    metadata: current?.metadata || {},
  }

  for (const message of messages) {
    if (message.direction !== 'INBOUND') continue
    if (message.text_content) {
      next.customer_name = parseName(message.text_content) || next.customer_name
      next.phone = parsePhone(message.text_content) || next.phone
      next.method = parseMethod(message.text_content) || next.method
      next.address = parseAddress(message.text_content) || next.address
    }
    const location = locationFromMessage(message)
    if (location) {
      next.address = location.address || next.address
      next.latitude = location.latitude ?? next.latitude
      next.longitude = location.longitude ?? next.longitude
      next.location_title = location.title || next.location_title
    }
  }

  const response = await supabaseRequest(
    env,
    'ai_buyer_fulfillment_details?on_conflict=case_id',
    {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(next),
    },
  )
  const rows = await readRows<FulfillmentRow>(response)
  return rows[0] || { ...current, ...next } as FulfillmentRow
}

function fulfillmentMissing(value: FulfillmentRow | null) {
  const missing: string[] = []
  if (!value?.customer_name) missing.push('ชื่อผู้ขาย')
  if (!value?.phone) missing.push('เบอร์โทร')
  if (!value?.method) missing.push('วิธีส่งมอบ (นัดรับ/ส่งพัสดุ/นำเข้าร้าน)')
  const hasLocation = Boolean(value?.address || (value?.latitude != null && value?.longitude != null))
  if (value?.method !== 'STORE_DROP' && !hasLocation) missing.push('ที่อยู่หรือส่งพิกัด')
  return missing
}

function fulfillmentPrompt(missing: string[]) {
  if (!missing.length) return ''
  return 'ตกลงราคากันแล้วครับ ขอข้อมูลเพิ่มอีกนิดครับ: ' + missing.join(', ')
}

async function buildPurchaseTask(env: OfferFlowEnv, caseRow: CaseRow, fulfillment: FulfillmentRow) {
  const [customerRows, decisionRows, offerRows, imageRows, messageRows] = await Promise.all([
    readRows<Record<string, unknown>>(await supabaseRequest(
      env,
      'ai_buyer_customers?id=eq.' + encodeURIComponent(caseRow.customer_id)
        + '&select=id,line_user_id,display_name,phone&limit=1',
    )),
    readRows<DecisionRow>(await supabaseRequest(
      env,
      'ai_buyer_pricing_decisions?case_id=eq.' + encodeURIComponent(caseRow.id)
        + '&select=id,case_id,opening_offer,target_buy,hard_max,current_authorized_offer,pricing_confidence,estimated_resale,price_source,price_book_version_id,rationale,created_at'
        + '&order=created_at.desc&limit=1',
    )),
    readRows<OfferRow>(await supabaseRequest(
      env,
      'ai_buyer_offers?case_id=eq.' + encodeURIComponent(caseRow.id)
        + '&status=eq.ACCEPTED&select=id,case_id,pricing_decision_id,amount,actor,status,idempotency_key,round_no,delivered_at,created_at&limit=1',
    )),
    readRows<Record<string, unknown>>(await supabaseRequest(
      env,
      'ai_buyer_case_images?case_id=eq.' + encodeURIComponent(caseRow.id)
        + '&select=id,storage_key,mime_type,created_at&order=created_at.asc&limit=20',
    )),
    readRows<Record<string, unknown>>(await supabaseRequest(
      env,
      'ai_buyer_messages?case_id=eq.' + encodeURIComponent(caseRow.id)
        + '&select=id,direction,message_type,text_content,line_timestamp,created_at'
        + '&order=created_at.desc&limit=12',
    )),
  ])

  const decision = decisionRows[0]
  const accepted = offerRows[0]
  const payload = {
    customer: {
      ...(customerRows[0] || {}),
      name: fulfillment.customer_name,
      phone: fulfillment.phone,
    },
    product: {
      category: caseRow.category,
      title: caseRow.title,
    },
    agreed_price: caseRow.accepted_price ?? accepted?.amount ?? null,
    fulfillment: {
      method: fulfillment.method,
      address: fulfillment.address,
      latitude: fulfillment.latitude,
      longitude: fulfillment.longitude,
      location_title: fulfillment.location_title,
      notes: fulfillment.notes,
    },
    pricing_snapshot: decision ? {
      decision_id: decision.id,
      source: decision.price_source,
      price_book_version_id: decision.price_book_version_id,
      estimated_resale: decision.estimated_resale,
      opening_offer: decision.opening_offer,
      target_buy: decision.target_buy,
      hard_max: decision.hard_max,
      confidence: decision.pricing_confidence,
      rationale: decision.rationale,
    } : null,
    accepted_offer: accepted || null,
    images: imageRows,
    important_messages: messageRows.reverse(),
  }
  return ensureAdminTask(env, caseRow.id, 'PURCHASE_PICKUP', payload, 'HIGH')
}

async function finalizeFulfillment(
  env: OfferFlowEnv,
  caseRow: CaseRow,
  fulfillment: FulfillmentRow,
  messageId: string | null,
) {
  await buildPurchaseTask(env, caseRow, fulfillment)
  await patchRows(env, 'ai_buyer_fulfillment_details?case_id=eq.' + encodeURIComponent(caseRow.id), {
    completed_at: new Date().toISOString(),
  })
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id), {
    state: 'ACTION_REQUIRED',
  })
  await createEvent(env, {
    case_id: caseRow.id,
    event_type: 'FULFILLMENT_UPDATE',
    inbound_message_id: messageId,
    metadata: { complete: true, method: fulfillment.method },
  })
  const text = 'รับข้อมูลครบแล้วครับ เดี๋ยวแอดมินติดต่อยืนยันรายละเอียดการรับเครื่องให้อีกครั้งครับ'
  const action = await createOutboundAction(env, {
    conversationId: caseRow.conversation_id,
    caseId: caseRow.id,
    actionType: 'FULFILLMENT_COMPLETE',
    idempotencyKey: 'fulfillment-complete:' + caseRow.id,
    text,
  })
  return {
    handled: true,
    state: 'ACTION_REQUIRED',
    reply: text,
    action: 'FULFILLMENT_COMPLETE',
    outboundActionId: action.id,
  } satisfies OfferFlowResult
}

export async function startOfferAfterPricing(env: OfferFlowEnv, caseId: string): Promise<OfferFlowResult> {
  const caseRow = await loadCase(env, caseId)
  if (!caseRow || !caseRow.category) return { handled: false, reason: 'CASE_NOT_FOUND' }
  const decision = await loadDecision(env, caseId)
  if (!decision) return { handled: false, reason: 'DECISION_NOT_FOUND' }
  const rollout = await loadRollout(env, caseRow.category)
  if (!rollout.active) return { handled: true, mode: 'SHADOW', reason: 'ROLLOUT_DISABLED' }

  const created = await createGuardedOffer(env, {
    caseId,
    decisionId: decision.id,
    amount: decision.opening_offer,
    actor: 'AI',
    idempotencyKey: 'initial:' + caseId + ':' + decision.id,
    roundNo: 0,
  })
  const offerId = created.offer.id
  await createEvent(env, {
    case_id: caseId,
    pricing_decision_id: decision.id,
    offer_id: offerId,
    event_type: 'INITIAL_OFFER',
    shop_amount: decision.opening_offer,
    attempt_no: 0,
    metadata: { rollout_mode: rollout.mode },
  }, true)

  if (rollout.mode === 'SHADOW') {
    await createEvent(env, {
      case_id: caseId,
      pricing_decision_id: decision.id,
      offer_id: offerId,
      event_type: 'ROLLOUT_BLOCKED',
      shop_amount: decision.opening_offer,
      metadata: { mode: 'SHADOW' },
    }, true)
    await ensureAdminTask(env, caseId, 'OFFER_SHADOW_REVIEW', {
      offer_id: offerId,
      opening_offer: decision.opening_offer,
      target_buy: decision.target_buy,
      hard_max: decision.hard_max,
    })
    return { handled: true, mode: rollout.mode, offerId, reason: 'SHADOW_NO_SEND' }
  }

  if (rollout.mode === 'APPROVAL') {
    await ensureAdminTask(env, caseId, 'OFFER_APPROVAL', {
      offer_id: offerId,
      opening_offer: decision.opening_offer,
      target_buy: decision.target_buy,
      hard_max: decision.hard_max,
    }, 'HIGH')
    return { handled: true, mode: rollout.mode, offerId, reason: 'AWAITING_APPROVAL' }
  }

  const text = initialOfferText(decision.opening_offer)
  const action = await createOutboundAction(env, {
    conversationId: caseRow.conversation_id,
    caseId,
    offerId,
    actionType: 'OFFER',
    idempotencyKey: 'outbound:offer:' + offerId,
    text,
  })
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId), { state: 'OFFERED' })
  return {
    handled: true,
    state: 'OFFERED',
    reply: text,
    action: 'OFFER',
    offerId,
    outboundActionId: action.id,
    mode: rollout.mode,
  }
}

export async function approvePreparedOffer(
  env: OfferFlowEnv,
  caseId: string,
  offerId: string,
): Promise<OfferFlowResult & { lineUserId?: string }> {
  const caseRow = await loadCase(env, caseId)
  if (!caseRow || !caseRow.category) return { handled: false, reason: 'CASE_NOT_FOUND' }
  const rollout = await loadRollout(env, caseRow.category)
  if (rollout.mode !== 'APPROVAL') return { handled: false, reason: 'CATEGORY_NOT_IN_APPROVAL' }

  const rows = await readRows<OfferRow>(await supabaseRequest(
    env,
    'ai_buyer_offers?id=eq.' + encodeURIComponent(offerId)
      + '&case_id=eq.' + encodeURIComponent(caseId)
      + '&actor=in.(AI,ADMIN)&status=eq.PROPOSED&delivered_at=is.null'
      + '&select=id,case_id,pricing_decision_id,amount,actor,status,idempotency_key,round_no,delivered_at,created_at&limit=1',
  ))
  const offer = rows[0]
  if (!offer) return { handled: false, reason: 'OFFER_NOT_APPROVABLE' }

  const text = initialOfferText(offer.amount)
  const action = await createOutboundAction(env, {
    conversationId: caseRow.conversation_id,
    caseId,
    offerId,
    actionType: 'OFFER',
    idempotencyKey: 'approval-outbound:offer:' + offerId,
    text,
  })
  const conversations = await readRows<{ line_user_id: string }>(await supabaseRequest(
    env,
    'ai_buyer_conversations?id=eq.' + encodeURIComponent(caseRow.conversation_id)
      + '&select=line_user_id&limit=1',
  ))
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId), { state: 'OFFERED' })
  return {
    handled: true,
    state: 'OFFERED',
    reply: text,
    action: 'OFFER',
    offerId,
    outboundActionId: action.id,
    mode: rollout.mode,
    lineUserId: conversations[0]?.line_user_id,
  }
}

export async function markOfferFlowDelivery(
  env: OfferFlowEnv,
  input: { offerId?: string | null; outboundActionId?: string | null },
) {
  const now = new Date().toISOString()
  if (input.offerId) {
    await patchRows(env, 'ai_buyer_offers?id=eq.' + encodeURIComponent(input.offerId), { delivered_at: now })
  }
  if (input.outboundActionId) {
    await patchRows(env, 'ai_buyer_outbound_actions?id=eq.' + encodeURIComponent(input.outboundActionId), {
      status: 'SENT',
      sent_at: now,
      error: null,
    })
  }
}

export async function markOfferFlowFailure(
  env: OfferFlowEnv,
  outboundActionId: string | null | undefined,
  error: unknown,
) {
  if (!outboundActionId) return
  await patchRows(env, 'ai_buyer_outbound_actions?id=eq.' + encodeURIComponent(outboundActionId), {
    status: 'FAILED',
    error: clean((error as Error)?.message || error, 1000),
  })
}

async function collectFulfillment(
  env: OfferFlowEnv,
  caseRow: CaseRow,
  messages: OfferFlowMessage[],
): Promise<OfferFlowResult> {
  const fulfillment = await updateFulfillmentFromMessages(env, caseRow.id, messages)
  const missing = fulfillmentMissing(fulfillment)
  const lastId = messages.filter((m) => m.direction === 'INBOUND').at(-1)?.id || null

  await createEvent(env, {
    case_id: caseRow.id,
    event_type: 'FULFILLMENT_UPDATE',
    inbound_message_id: lastId,
    metadata: { missing },
  })

  if (!missing.length) {
    return finalizeFulfillment(env, caseRow, fulfillment, lastId)
  }

  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id), {
    state: 'COLLECTING_FULFILLMENT',
  })
  const text = fulfillmentPrompt(missing)
  const key = 'fulfillment-prompt:' + caseRow.id + ':' + missing.join('|')
  const action = await createOutboundAction(env, {
    conversationId: caseRow.conversation_id,
    caseId: caseRow.id,
    actionType: 'FULFILLMENT_PROMPT',
    idempotencyKey: key,
    text,
  })
  return {
    handled: true,
    state: 'COLLECTING_FULFILLMENT',
    reply: text,
    action: 'FULFILLMENT_PROMPT',
    outboundActionId: action.id,
  }
}

function latestMessageId(messages: OfferFlowMessage[]) {
  return messages.filter((message) => message.direction === 'INBOUND').at(-1)?.id || 'none'
}

export async function handleOfferFlow(
  env: OfferFlowEnv,
  caseId: string,
  messages: OfferFlowMessage[],
): Promise<OfferFlowResult> {
  const caseRow = await loadCase(env, caseId)
  if (!caseRow) return { handled: false, reason: 'CASE_NOT_FOUND' }

  if (caseRow.state === 'COLLECTING_FULFILLMENT' || caseRow.state === 'ACCEPTED') {
    return collectFulfillment(env, caseRow, messages)
  }
  if (caseRow.state === 'ACTION_REQUIRED' || caseRow.state === 'ADMIN_ASSIGNED' || caseRow.state === 'COMPLETED') {
    return { handled: true, state: caseRow.state, reason: 'POST_ACCEPTANCE_CLOSED' }
  }
  if (!['PRICING','OFFERED','NEGOTIATING'].includes(caseRow.state)) return { handled: false }

  const rollout = await loadRollout(env, caseRow.category)
  if (caseRow.state === 'PRICING' || rollout.mode !== 'AUTO') {
    await ensureAdminTask(env, caseId, rollout.mode === 'APPROVAL' ? 'OFFER_APPROVAL' : 'OFFER_SHADOW_REVIEW', {
      reason: 'CUSTOMER_MESSAGE_WHILE_PRICE_PENDING',
      rollout_mode: rollout.mode,
    })
    const pendingText = 'รับข้อมูลแล้วครับ เดี๋ยวแอดมินเช็กราคาและแจ้งกลับให้ครับ'
    const pendingAction = await createOutboundAction(env, {
      conversationId: caseRow.conversation_id,
      caseId,
      actionType: 'NEGOTIATION_REPLY',
      idempotencyKey: 'pricing-pending:' + latestMessageId(messages),
      text: pendingText,
    })
    return {
      handled: true,
      state: 'PRICING',
      reply: pendingText,
      action: 'PRICING_PENDING',
      outboundActionId: pendingAction.id,
      mode: rollout.mode,
    }
  }

  const decision = await loadDecision(env, caseId)
  const currentOffer = await loadLatestShopOffer(env, caseId, true)
  if (!decision || !currentOffer) {
    await ensureAdminTask(env, caseId, 'NEGOTIATION_REVIEW', {
      reason: !decision ? 'DECISION_NOT_FOUND' : 'DELIVERED_OFFER_NOT_FOUND',
    }, 'HIGH')
    return { handled: true, state: 'HUMAN_REVIEW', reason: 'NEGOTIATION_CONTEXT_MISSING' }
  }

  const inbound = messages.filter((message) => message.direction === 'INBOUND')
  const latest = inbound.at(-1)
  const text = clean(latest?.text_content, 1000)
  if (!latest) return { handled: true, state: caseRow.state, reason: 'NO_INBOUND' }

  if (isExplicitAcceptance(text, currentOffer.amount)) {
    const accepted = await acceptOffer(env, caseId, currentOffer.id, latest.id)
    const refreshed = await loadCase(env, caseId)
    if (!refreshed) throw new Error('CASE_MISSING_AFTER_ACCEPT')
    void accepted
    return collectFulfillment(env, refreshed, messages)
  }

  if (isExplicitDecline(text)) {
    await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId), {
      state: 'CUSTOMER_DECLINED',
    })
    await patchRows(env, 'ai_buyer_offers?case_id=eq.' + encodeURIComponent(caseId) + '&status=eq.PROPOSED', {
      status: 'REJECTED',
    })
    await createEvent(env, {
      case_id: caseId,
      pricing_decision_id: decision.id,
      offer_id: currentOffer.id,
      inbound_message_id: latest.id,
      event_type: 'DECLINE',
      shop_amount: currentOffer.amount,
    })
    const declineText = 'ได้ครับ หากต้องการประเมินใหม่ภายหลังทักมาได้เลยครับ'
    const declineAction = await createOutboundAction(env, {
      conversationId: caseRow.conversation_id,
      caseId,
      actionType: 'NEGOTIATION_REPLY',
      idempotencyKey: 'decline-ack:' + latest.id,
      text: declineText,
    })
    return {
      handled: true,
      state: 'CUSTOMER_DECLINED',
      reply: declineText,
      action: 'DECLINE_ACK',
      outboundActionId: declineAction.id,
    }
  }

  const counter = parseCounterAmount(text)
  const wantsIncrease = asksForIncrease(text)
  if (counter != null) {
    await createCustomerCounter(env, caseId, decision.id, counter, latest.id)
    await createEvent(env, {
      case_id: caseId,
      pricing_decision_id: decision.id,
      offer_id: currentOffer.id,
      inbound_message_id: latest.id,
      event_type: 'CUSTOMER_COUNTER',
      customer_amount: counter,
      shop_amount: currentOffer.amount,
      attempt_no: currentOffer.round_no,
    })
  }

  if (counter == null && !wantsIncrease) {
    const reminderText = 'ราคาที่เสนอไว้ ' + baht(currentOffer.amount) + ' บาทครับ ถ้าสะดวกราคานี้แจ้งตกลงได้เลยครับ'
    const reminderAction = await createOutboundAction(env, {
      conversationId: caseRow.conversation_id,
      caseId,
      offerId: currentOffer.id,
      actionType: 'NEGOTIATION_REPLY',
      idempotencyKey: 'offer-reminder:' + latest.id,
      text: reminderText,
    })
    return {
      handled: true,
      state: caseRow.state,
      reply: reminderText,
      action: 'OFFER_REMINDER',
      offerId: currentOffer.id,
      outboundActionId: reminderAction.id,
    }
  }

  if (counter != null && counter <= currentOffer.amount) {
    const withinText = 'ได้ครับ ราคาที่เสนอ ' + baht(currentOffer.amount) + ' บาทรับได้ครับ ถ้าตกลงแจ้งได้เลยครับ'
    const withinAction = await createOutboundAction(env, {
      conversationId: caseRow.conversation_id,
      caseId,
      offerId: currentOffer.id,
      actionType: 'NEGOTIATION_REPLY',
      idempotencyKey: 'counter-within:' + latest.id,
      text: withinText,
    })
    return {
      handled: true,
      state: caseRow.state,
      reply: withinText,
      action: 'COUNTER_WITHIN_CURRENT',
      offerId: currentOffer.id,
      outboundActionId: withinAction.id,
    }
  }

  const nextRound = Math.min(20, currentOffer.round_no + 1)
  const nextAmount = computeConcession(
    decision,
    currentOffer.amount,
    counter,
    nextRound,
    rollout.max_negotiation_rounds,
    100,
  )
  if (nextAmount <= currentOffer.amount) {
    const holdText = 'ตอนนี้เต็มที่ที่เสนอได้คือ ' + baht(currentOffer.amount) + ' บาทครับ ถ้าสะดวกราคานี้รับได้เลยครับ'
    const holdAction = await createOutboundAction(env, {
      conversationId: caseRow.conversation_id,
      caseId,
      offerId: currentOffer.id,
      actionType: 'NEGOTIATION_REPLY',
      idempotencyKey: 'hold-offer:' + latest.id,
      text: holdText,
    })
    return {
      handled: true,
      state: caseRow.state,
      reply: holdText,
      action: 'HOLD_OFFER',
      offerId: currentOffer.id,
      outboundActionId: holdAction.id,
    }
  }

  const created = await createGuardedOffer(env, {
    caseId,
    decisionId: decision.id,
    amount: nextAmount,
    actor: 'AI',
    idempotencyKey: 'negotiation:' + caseId + ':' + decision.id + ':round:' + nextRound + ':' + Math.round(nextAmount),
    roundNo: nextRound,
    messageId: latest.id,
  })
  const offerId = created.offer.id
  await createEvent(env, {
    case_id: caseId,
    pricing_decision_id: decision.id,
    offer_id: offerId,
    inbound_message_id: latest.id,
    event_type: 'SHOP_CONCESSION',
    customer_amount: counter,
    shop_amount: nextAmount,
    attempt_no: nextRound,
  }, true)
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId), { state: 'NEGOTIATING' })

  const atMax = nextAmount >= decision.hard_max
  const textReply = atMax && counter != null && counter > decision.hard_max
    ? 'เต็มที่ผมขยับได้ ' + baht(nextAmount) + ' บาทครับ เพราะต้องเผื่อต้นทุนและความเสี่ยงตอนขายต่อ ถ้าสะดวกราคานี้รับได้เลยครับ'
    : 'ผมขยับให้ได้ที่ ' + baht(nextAmount) + ' บาทครับ ถ้าสะดวกราคานี้แจ้งตกลงได้เลยครับ'
  const action = await createOutboundAction(env, {
    conversationId: caseRow.conversation_id,
    caseId,
    offerId,
    actionType: 'NEGOTIATION_REPLY',
    idempotencyKey: 'outbound:negotiation:' + offerId,
    text: textReply,
  })
  return {
    handled: true,
    state: 'NEGOTIATING',
    reply: textReply,
    action: 'NEGOTIATION_REPLY',
    offerId,
    outboundActionId: action.id,
    mode: rollout.mode,
  }
}
