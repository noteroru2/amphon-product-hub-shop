export interface ConversationEngineEnv {
  IMAGES: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  LINE_CHANNEL_ACCESS_TOKEN: string
  OPENAI_API_KEY: string
  OPENAI_VISION_MODEL?: string
}

export type IntakeBatch = {
  conversationId: string
  caseId: string
  lineUserId: string
  replyToken?: string | null
  touchedAt: number
}

type ProductCategory =
  | 'NOTEBOOK'
  | 'MACBOOK'
  | 'DESKTOP_PC'
  | 'SMARTPHONE'
  | 'TABLET'
  | 'CAMERA'
  | 'OTHER'
  | 'UNKNOWN'

type ConversationRow = { id: string; control_mode: 'AUTO' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE' }

type CaseRow = {
  id: string
  state: string
  category: ProductCategory | null
  metadata: Record<string, unknown> | null
  control_mode: 'AUTO' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE'
}

type MessageRow = {
  id: string
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM'
  message_type: string
  text_content: string | null
  metadata: Record<string, unknown> | null
  line_timestamp: string | null
  created_at: string
  analysis_consumed_at?: string | null
}

type ImageRow = {
  id: string
  storage_key: string
  mime_type: string | null
  byte_size: number | null
  image_set_id: string | null
  image_set_index: number | null
  image_set_total: number | null
  analysis_status: 'PENDING' | 'READY' | 'PROCESSING' | 'ANALYZED' | 'FAILED'
  created_at: string
}

type ObservationRow = {
  confirmed: Record<string, unknown>
  inferred: Record<string, unknown>
  unknown_fields: unknown
  model_name: string | null
  model_code: string | null
  category: string | null
  identity_confidence: number | null
  created_at: string
}

type IntakeAction =
  | 'ASK_PRODUCT_TYPE'
  | 'ASK_MORE_INFO'
  | 'READY_TO_PRICE'
  | 'HUMAN_REVIEW'
  | 'NO_ACTION'

type RequestedInput =
  | 'PRODUCT_TYPE'
  | 'FULL_DEVICE'
  | 'FRONT_OPEN'
  | 'KEYBOARD'
  | 'BOTTOM_LABEL'
  | 'SYSTEM_INFO'
  | 'DEFECT_CLOSEUP'
  | 'CHARGER'
  | 'BACK'
  | 'FRAME'
  | 'ABOUT_SCREEN'
  | 'BATTERY_HEALTH'
  | 'PC_INTERIOR'
  | 'CPU_GPU_SCREEN'
  | 'CAMERA_FRONT_BACK'
  | 'LENS_FRONT_REAR'
  | 'SERIAL_LABEL'
  | 'ACCESSORIES'

type Fact = { key: string; value: string; evidence: string }

type IntakeResult = {
  intent: 'SELL_ITEM' | 'GENERAL' | 'UNKNOWN'
  category: ProductCategory
  product_title: string
  model_name: string
  model_code: string
  confirmed: Fact[]
  inferred: Fact[]
  unknown_fields: string[]
  requested_inputs: RequestedInput[]
  identity_confidence: number
  spec_completeness: number
  condition_completeness: number
  pricing_readiness: number
  action: IntakeAction
  asked_if_ai: boolean
  handoff_requested: boolean
  flags: string[]
}

type OpenAIResponse = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  usage?: Record<string, unknown>
}

const MAX_CONTEXT_MESSAGES = 30
const MAX_NEW_IMAGES = 8
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024

const CATEGORIES: ProductCategory[] = [
  'NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER','UNKNOWN',
]

const REQUESTED_INPUTS: RequestedInput[] = [
  'PRODUCT_TYPE','FULL_DEVICE','FRONT_OPEN','KEYBOARD','BOTTOM_LABEL','SYSTEM_INFO',
  'DEFECT_CLOSEUP','CHARGER','BACK','FRAME','ABOUT_SCREEN','BATTERY_HEALTH',
  'PC_INTERIOR','CPU_GPU_SCREEN','CAMERA_FRONT_BACK','LENS_FRONT_REAR',
  'SERIAL_LABEL','ACCESSORIES',
]

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['SELL_ITEM', 'GENERAL', 'UNKNOWN'] },
    category: { type: 'string', enum: CATEGORIES },
    product_title: { type: 'string' },
    model_name: { type: 'string' },
    model_code: { type: 'string' },
    confirmed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['key', 'value', 'evidence'],
        additionalProperties: false,
      },
    },
    inferred: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['key', 'value', 'evidence'],
        additionalProperties: false,
      },
    },
    unknown_fields: { type: 'array', items: { type: 'string' } },
    requested_inputs: { type: 'array', items: { type: 'string', enum: REQUESTED_INPUTS }, maxItems: 3 },
    identity_confidence: { type: 'number', minimum: 0, maximum: 1 },
    spec_completeness: { type: 'number', minimum: 0, maximum: 1 },
    condition_completeness: { type: 'number', minimum: 0, maximum: 1 },
    pricing_readiness: { type: 'number', minimum: 0, maximum: 1 },
    action: { type: 'string', enum: ['ASK_PRODUCT_TYPE','ASK_MORE_INFO','READY_TO_PRICE','HUMAN_REVIEW','NO_ACTION'] },
    asked_if_ai: { type: 'boolean' },
    handoff_requested: { type: 'boolean' },
    flags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  },
  required: [
    'intent','category','product_title','model_name','model_code','confirmed','inferred',
    'unknown_fields','requested_inputs','identity_confidence','spec_completeness',
    'condition_completeness','pricing_readiness','action','asked_if_ai',
    'handoff_requested','flags',
  ],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = [
  'You are the intake vision engine for AMPHON TRADING, a Thai used-IT buyback shop.',
  'Your job is product identification and information sufficiency only. Never quote, estimate, infer, mention, or suggest a purchase price.',
  'Customers often do not know model/specs. Images are primary evidence.',
  'CONFIRMED facts require readable visual evidence or an explicit customer statement.',
  'INFERRED facts are plausible but not proven. Never upgrade inferred CPU/GPU/storage/model variants to confirmed from chassis appearance alone.',
  'If images disagree with customer text, flag the conflict and prefer readable device labels or system screens for identity.',
  'Ask only for information still missing and materially useful for exact identity, important spec, condition, or accessories.',
  'Do not request something already visible or explicitly answered in the conversation.',
  'requested_inputs must contain at most 3 items, most useful first.',
  'READY_TO_PRICE means enough identity/spec/condition evidence exists for the separate Pricing Engine. It does not mean you know a price.',
  'Use HUMAN_REVIEW for rare products, complex damage, contradictory identity, or persistent ambiguity.',
  'If the customer explicitly asks for a human/admin, set handoff_requested=true.',
  'If the customer asks whether this is AI/bot/automatic, set asked_if_ai=true.',
  'Product categories are strictly NOTEBOOK, MACBOOK, DESKTOP_PC, SMARTPHONE, TABLET, CAMERA, OTHER, UNKNOWN.',
  'Be conservative. Unknown is better than guessing.',
].join('\n')

function clean(value: unknown, max = 1000) {
  return String(value ?? '').trim().slice(0, max)
}

function clamp01(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

function supabaseHeaders(env: ConversationEngineEnv, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
    accept: 'application/json',
    ...extra,
  }
}

async function supabaseRequest(env: ConversationEngineEnv, path: string, init: RequestInit = {}) {
  return fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
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
    throw new Error('SUPABASE_' + result.status + ':' + detail.slice(0, 400))
  }
  const text = await result.text()
  return text ? JSON.parse(text) as T[] : []
}

async function patchRows(env: ConversationEngineEnv, path: string, body: Record<string, unknown>) {
  const result = await supabaseRequest(env, path, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!result.ok) {
    const detail = await result.text().catch(() => '')
    throw new Error('SUPABASE_PATCH_' + result.status + ':' + detail.slice(0, 400))
  }
}

async function loadConversation(env: ConversationEngineEnv, id: string) {
  const rows = await readRows<ConversationRow>(await supabaseRequest(
    env,
    'ai_buyer_conversations?id=eq.' + encodeURIComponent(id) + '&select=id,control_mode&limit=1',
  ))
  return rows[0] || null
}

async function loadCase(env: ConversationEngineEnv, id: string) {
  const rows = await readRows<CaseRow>(await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(id) + '&select=id,state,category,metadata,control_mode&limit=1',
  ))
  return rows[0] || null
}

async function loadRecentMessages(env: ConversationEngineEnv, caseId: string) {
  const rows = await readRows<MessageRow>(await supabaseRequest(env, [
    'ai_buyer_messages?select=id,direction,message_type,text_content,metadata,line_timestamp,created_at,analysis_consumed_at',
    'case_id=eq.' + encodeURIComponent(caseId),
    'order=created_at.desc',
    'limit=' + MAX_CONTEXT_MESSAGES,
  ].join('&')))
  return rows.reverse()
}

async function loadUnconsumedMessages(env: ConversationEngineEnv, caseId: string) {
  return readRows<MessageRow>(await supabaseRequest(env, [
    'ai_buyer_messages?select=id,direction,message_type,text_content,metadata,line_timestamp,created_at,analysis_consumed_at',
    'case_id=eq.' + encodeURIComponent(caseId),
    'direction=eq.INBOUND',
    'analysis_consumed_at=is.null',
    'order=created_at.asc',
    'limit=50',
  ].join('&')))
}

async function loadReadyImages(env: ConversationEngineEnv, caseId: string) {
  const rows = await readRows<ImageRow>(await supabaseRequest(env, [
    'ai_buyer_case_images?select=id,storage_key,mime_type,byte_size,image_set_id,image_set_index,image_set_total,analysis_status,created_at',
    'case_id=eq.' + encodeURIComponent(caseId),
    'analysis_status=eq.READY',
    'order=created_at.asc',
    'limit=' + (MAX_NEW_IMAGES * 2),
  ].join('&')))
  return rows.sort((a, b) => {
    if (a.image_set_id && a.image_set_id === b.image_set_id) {
      return Number(a.image_set_index ?? 999) - Number(b.image_set_index ?? 999)
    }
    return Date.parse(a.created_at) - Date.parse(b.created_at)
  }).slice(0, MAX_NEW_IMAGES)
}

async function loadPriorObservations(env: ConversationEngineEnv, caseId: string) {
  return readRows<ObservationRow>(await supabaseRequest(env, [
    'ai_buyer_product_observations?select=confirmed,inferred,unknown_fields,model_name,model_code,category,identity_confidence,created_at',
    'case_id=eq.' + encodeURIComponent(caseId),
    'order=created_at.desc',
    'limit=3',
  ].join('&')))
}

function normalizeFactKey(value: string) {
  return clean(value, 80).toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '')
}

function factsToObject(facts: Fact[]) {
  const output: Record<string, unknown> = {}
  for (const fact of facts) {
    const key = normalizeFactKey(fact.key)
    if (key) output[key] = clean(fact.value, 500)
  }
  return output
}

function evidenceList(result: IntakeResult) {
  return [
    ...result.confirmed.map((fact) => ({
      status: 'CONFIRMED',
      key: normalizeFactKey(fact.key),
      value: clean(fact.value, 500),
      evidence: clean(fact.evidence, 1000),
    })),
    ...result.inferred.map((fact) => ({
      status: 'INFERRED',
      key: normalizeFactKey(fact.key),
      value: clean(fact.value, 500),
      evidence: clean(fact.evidence, 1000),
    })),
  ]
}

function contextText(messages: MessageRow[], observations: ObservationRow[]) {
  const recent = messages.map((message) => {
    const speaker = message.direction === 'INBOUND' ? 'CUSTOMER' : message.direction === 'OUTBOUND' ? 'SHOP' : 'SYSTEM'
    const value = message.text_content
      ? clean(message.text_content, 1000)
      : message.message_type === 'LOCATION'
        ? '[LOCATION ' + JSON.stringify(message.metadata?.location || {}) + ']'
        : '[' + message.message_type + ']'
    return speaker + ': ' + value
  }).join('\n')

  const prior = observations.map((observation) => JSON.stringify({
    confirmed: observation.confirmed,
    inferred: observation.inferred,
    unknown_fields: observation.unknown_fields,
    model_name: observation.model_name,
    model_code: observation.model_code,
    category: observation.category,
    identity_confidence: observation.identity_confidence,
  })).join('\n')

  return [
    'Recent conversation:',
    recent || '(none)',
    '',
    'Previous structured observations, newest first:',
    prior || '(none)',
    '',
    'Analyze only what is supported by this context and the attached new images.',
  ].join('\n')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)))
  }
  return btoa(binary)
}

async function imageInputs(env: ConversationEngineEnv, images: ImageRow[]) {
  const output: Array<{ type: 'input_image'; image_url: string; detail: 'auto' }> = []
  const includedIds: string[] = []
  const skippedIds: string[] = []
  let total = 0

  for (const image of images) {
    const object = await env.IMAGES.get(image.storage_key)
    if (!object) {
      skippedIds.push(image.id)
      continue
    }
    const size = Number(object.size || image.byte_size || 0)
    if (size > MAX_IMAGE_BYTES || total + size > MAX_TOTAL_IMAGE_BYTES) {
      skippedIds.push(image.id)
      continue
    }
    const bytes = new Uint8Array(await object.arrayBuffer())
    const mime = clean(object.httpMetadata?.contentType || image.mime_type || 'image/jpeg', 100)
    output.push({
      type: 'input_image',
      image_url: 'data:' + mime + ';base64,' + bytesToBase64(bytes),
      detail: 'auto',
    })
    includedIds.push(image.id)
    total += bytes.byteLength
  }

  return { output, includedIds, skippedIds }
}

function extractOutputText(response: OpenAIResponse) {
  for (const item of response.output || []) {
    if (item.type !== 'message') continue
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

function validRequestedInputs(value: unknown): RequestedInput[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is RequestedInput =>
    REQUESTED_INPUTS.includes(item as RequestedInput),
  ).slice(0, 3)
}

function normalizeIntake(value: unknown): IntakeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VISION_OUTPUT_NOT_OBJECT')
  const raw = value as Record<string, unknown>
  const category = CATEGORIES.includes(raw.category as ProductCategory) ? raw.category as ProductCategory : 'UNKNOWN'
  const actions: IntakeAction[] = ['ASK_PRODUCT_TYPE','ASK_MORE_INFO','READY_TO_PRICE','HUMAN_REVIEW','NO_ACTION']
  const action = actions.includes(raw.action as IntakeAction) ? raw.action as IntakeAction : 'HUMAN_REVIEW'
  const intents = ['SELL_ITEM','GENERAL','UNKNOWN'] as const
  const intent = intents.includes(raw.intent as typeof intents[number]) ? raw.intent as typeof intents[number] : 'UNKNOWN'
  const parseFacts = (input: unknown): Fact[] => Array.isArray(input)
    ? input.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
      const fact = item as Record<string, unknown>
      return { key: clean(fact.key, 80), value: clean(fact.value, 500), evidence: clean(fact.evidence, 1000) }
    }).filter((fact) => fact.key && fact.value)
    : []

  return {
    intent,
    category,
    product_title: clean(raw.product_title, 240),
    model_name: clean(raw.model_name, 200),
    model_code: clean(raw.model_code, 120),
    confirmed: parseFacts(raw.confirmed),
    inferred: parseFacts(raw.inferred),
    unknown_fields: Array.isArray(raw.unknown_fields)
      ? raw.unknown_fields.map((item) => clean(item, 80)).filter(Boolean).slice(0, 30)
      : [],
    requested_inputs: validRequestedInputs(raw.requested_inputs),
    identity_confidence: clamp01(raw.identity_confidence),
    spec_completeness: clamp01(raw.spec_completeness),
    condition_completeness: clamp01(raw.condition_completeness),
    pricing_readiness: clamp01(raw.pricing_readiness),
    action,
    asked_if_ai: Boolean(raw.asked_if_ai),
    handoff_requested: Boolean(raw.handoff_requested),
    flags: Array.isArray(raw.flags) ? raw.flags.map((item) => clean(item, 100)).filter(Boolean).slice(0, 12) : [],
  }
}

async function callVision(
  env: ConversationEngineEnv,
  messages: MessageRow[],
  observations: ObservationRow[],
  images: ImageRow[],
) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED')
  const model = clean(env.OPENAI_VISION_MODEL, 100) || 'gpt-5.6-sol'
  const prepared = await imageInputs(env, images)

  const userContent: Array<
    { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'auto' }
  > = [
    { type: 'input_text', text: contextText(messages, observations) },
    ...prepared.output,
  ]

  const apiResult = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.OPENAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'amphon_ai_buyer_intake',
          strict: true,
          schema: VISION_SCHEMA,
        },
      },
    }),
  })

  const raw = await apiResult.text()
  if (!apiResult.ok) throw new Error('OPENAI_' + apiResult.status + ':' + raw.slice(0, 800))

  const response = raw ? JSON.parse(raw) as OpenAIResponse : {}
  const outputText = extractOutputText(response)
  if (!outputText) throw new Error('OPENAI_OUTPUT_TEXT_MISSING')

  let parsed: unknown
  try {
    parsed = JSON.parse(outputText)
  } catch {
    throw new Error('OPENAI_OUTPUT_JSON_INVALID')
  }

  return {
    model,
    result: normalizeIntake(parsed),
    usage: response.usage || {},
    includedImageIds: prepared.includedIds,
    skippedImageIds: prepared.skippedIds,
  }
}

async function createAnalysisRun(
  env: ConversationEngineEnv,
  batch: IntakeBatch,
  model: string,
  messageIds: string[],
  imageIds: string[],
) {
  const rows = await readRows<{ id: string }>(await supabaseRequest(env, 'ai_buyer_analysis_runs', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      case_id: batch.caseId,
      conversation_id: batch.conversationId,
      provider: 'OPENAI',
      model,
      status: 'RUNNING',
      trigger_message_ids: messageIds,
      image_ids: imageIds,
      input_summary: { messageCount: messageIds.length, imageCount: imageIds.length },
    }),
  }))
  if (!rows[0]) throw new Error('ANALYSIS_RUN_CREATE_EMPTY')
  return rows[0]
}

async function completeAnalysisRun(
  env: ConversationEngineEnv,
  runId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED',
  output: unknown,
  usage: unknown,
  error?: string,
) {
  await patchRows(env, 'ai_buyer_analysis_runs?id=eq.' + encodeURIComponent(runId), {
    status,
    output: output || null,
    usage: usage || null,
    error: error ? clean(error, 2000) : null,
    completed_at: new Date().toISOString(),
  })
}

function inputLabel(code: RequestedInput) {
  const labels: Record<RequestedInput, string> = {
    PRODUCT_TYPE: 'สินค้าที่ต้องการขาย',
    FULL_DEVICE: 'รูปตัวเครื่องเต็มๆ',
    FRONT_OPEN: 'รูปหน้าเครื่องตอนเปิดจอ',
    KEYBOARD: 'รูปคีย์บอร์ดและตัวเครื่อง',
    BOTTOM_LABEL: 'รูปสติ๊กเกอร์ใต้เครื่องใกล้ๆ',
    SYSTEM_INFO: 'รูปหน้าสเปกในเครื่อง',
    DEFECT_CLOSEUP: 'รูปตำหนิใกล้ๆ',
    CHARGER: 'รูปที่ชาร์จหรืออะแดปเตอร์',
    BACK: 'รูปด้านหลังเครื่อง',
    FRAME: 'รูปขอบเครื่อง',
    ABOUT_SCREEN: 'รูปหน้า About/ข้อมูลเครื่อง',
    BATTERY_HEALTH: 'รูปหน้า Battery Health',
    PC_INTERIOR: 'รูปด้านในเคส',
    CPU_GPU_SCREEN: 'รูปหน้าที่เห็น CPU/GPU',
    CAMERA_FRONT_BACK: 'รูปกล้องด้านหน้าและด้านหลัง',
    LENS_FRONT_REAR: 'รูปหน้าเลนส์และท้ายเลนส์',
    SERIAL_LABEL: 'รูปสติ๊กเกอร์รุ่น/Serial',
    ACCESSORIES: 'รูปอุปกรณ์ที่มีทั้งหมด',
  }
  return labels[code]
}

function sameRequestedInputs(metadata: Record<string, unknown> | null, requested: RequestedInput[]) {
  const previous = Array.isArray(metadata?.lastRequestedInputs)
    ? metadata.lastRequestedInputs.map((item) => clean(item, 80))
    : []
  return requested.length > 0
    && previous.length === requested.length
    && requested.every((value, index) => value === previous[index])
}

function composeReply(result: IntakeResult, currentCase: CaseRow) {
  if (result.handoff_requested) return 'ได้ครับ เดี๋ยวส่งให้แอดมินดูต่อครับ'

  let operational = ''
  if (result.action === 'ASK_PRODUCT_TYPE' || result.category === 'UNKNOWN') {
    operational = 'ต้องการขายสินค้าอะไรครับ ส่งรูปมาให้ดูได้เลยครับ'
  } else if (result.action === 'ASK_MORE_INFO') {
    const requested = result.requested_inputs.filter((item) => item !== 'PRODUCT_TYPE').slice(0, 2)
    if (sameRequestedInputs(currentCase.metadata, requested)) {
      operational = 'ส่งรูปตามที่ขอมาได้เลยครับ เดี๋ยวเช็กต่อให้ครับ'
    } else if (requested.length) {
      operational = 'ขอ' + requested.map(inputLabel).join(' กับ ') + 'เพิ่มหน่อยครับ'
    } else {
      operational = 'ขอข้อมูลหรือรูปเพิ่มอีกนิดครับ จะได้เช็กให้ตรงรุ่นครับ'
    }
  } else if (
    result.action === 'READY_TO_PRICE'
    && result.identity_confidence >= 0.9
    && result.condition_completeness >= 0.75
  ) {
    operational = 'ข้อมูลพอเช็กราคาแล้วครับ เดี๋ยวขอเช็กราคาให้ครับ'
  } else if (result.action === 'HUMAN_REVIEW') {
    operational = 'ตัวนี้ขอเช็กเพิ่มนิดนึงครับ เดี๋ยวแอดมินดูให้ครับ'
  } else if (result.intent === 'GENERAL') {
    operational = 'ได้ครับ ถ้าต้องการขายสินค้า ส่งรูปมาให้ดูได้เลยครับ'
  }

  if (result.asked_if_ai) {
    const truth = 'เป็นผู้ช่วยอัตโนมัติของร้านครับ ถ้าต้องการให้แอดมินดูต่อบอกได้เลยครับ'
    return operational ? truth + '\n' + operational : truth
  }
  return operational
}

function nextState(result: IntakeResult) {
  if (result.handoff_requested) return { state: 'HUMAN_REVIEW', controlMode: 'HUMAN_REQUIRED' as const }
  if (result.action === 'HUMAN_REVIEW' || result.category === 'OTHER') {
    return { state: 'HUMAN_REVIEW', controlMode: 'HUMAN_REQUIRED' as const }
  }
  if (result.category === 'UNKNOWN' || result.action === 'ASK_PRODUCT_TYPE') {
    return { state: 'IDENTIFYING_PRODUCT', controlMode: 'AUTO' as const }
  }
  if (
    result.action === 'READY_TO_PRICE'
    && result.identity_confidence >= 0.9
    && result.condition_completeness >= 0.75
  ) {
    return { state: 'READY_TO_PRICE', controlMode: 'AUTO' as const }
  }
  if (result.action === 'ASK_MORE_INFO') {
    const photoRequests = result.requested_inputs.filter((item) => item !== 'PRODUCT_TYPE')
    return { state: photoRequests.length ? 'COLLECTING_PHOTOS' : 'NEED_MORE_INFO', controlMode: 'AUTO' as const }
  }
  return { state: 'IDENTIFYING_PRODUCT', controlMode: 'AUTO' as const }
}

async function storeObservation(
  env: ConversationEngineEnv,
  caseId: string,
  result: IntakeResult,
  hasImages: boolean,
) {
  const insert = await supabaseRequest(env, 'ai_buyer_product_observations', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      case_id: caseId,
      source: hasImages ? 'IMAGE' : 'CUSTOMER_TEXT',
      confirmed: factsToObject(result.confirmed),
      inferred: factsToObject(result.inferred),
      unknown_fields: result.unknown_fields,
      evidence: evidenceList(result),
      model_name: result.model_name || null,
      model_code: result.model_code || null,
      category: result.category === 'UNKNOWN' ? null : result.category,
      identity_confidence: result.identity_confidence,
    }),
  })
  if (!insert.ok) {
    const detail = await insert.text().catch(() => '')
    throw new Error('OBSERVATION_INSERT_' + insert.status + ':' + detail.slice(0, 400))
  }
}

async function updateCase(
  env: ConversationEngineEnv,
  batch: IntakeBatch,
  currentCase: CaseRow,
  result: IntakeResult,
  runId: string,
  reply: string,
) {
  const transition = nextState(result)
  const metadata = {
    ...(currentCase.metadata || {}),
    lastAnalysisRunId: runId,
    lastRequestedInputs: result.requested_inputs,
    lastFlags: result.flags,
    lastIntent: result.intent,
    pendingReply: reply ? {
      text: reply,
      action: result.action,
      createdAt: new Date().toISOString(),
    } : null,
  }

  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(currentCase.id), {
    state: transition.state,
    category: result.category === 'UNKNOWN' ? currentCase.category : result.category,
    title: result.product_title || result.model_name || null,
    control_mode: transition.controlMode,
    identity_confidence: result.identity_confidence,
    spec_completeness: result.spec_completeness,
    condition_completeness: result.condition_completeness,
    pricing_readiness: result.pricing_readiness,
    metadata,
  })

  if (transition.controlMode === 'HUMAN_REQUIRED') {
    await patchRows(
      env,
      'ai_buyer_conversations?id=eq.' + encodeURIComponent(batch.conversationId),
      { control_mode: 'HUMAN_REQUIRED' },
    )
  }
  return { ...transition, metadata }
}

function pendingReply(metadata: Record<string, unknown> | null) {
  const value = metadata?.pendingReply
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const pending = value as Record<string, unknown>
  const text = clean(pending.text, 4500)
  const actions: IntakeAction[] = ['ASK_PRODUCT_TYPE','ASK_MORE_INFO','READY_TO_PRICE','HUMAN_REVIEW','NO_ACTION']
  const action = actions.includes(pending.action as IntakeAction)
    ? pending.action as IntakeAction
    : 'NO_ACTION'
  return text ? { text, action } : null
}

async function clearPendingReply(
  env: ConversationEngineEnv,
  caseId: string,
  metadata: Record<string, unknown> | null,
) {
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId), {
    metadata: { ...(metadata || {}), pendingReply: null },
  })
}

async function markMessagesConsumed(env: ConversationEngineEnv, ids: string[]) {
  if (!ids.length) return
  await patchRows(
    env,
    'ai_buyer_messages?id=in.(' + ids.map((id) => clean(id, 80)).join(',') + ')',
    { analysis_consumed_at: new Date().toISOString() },
  )
}

async function markImages(
  env: ConversationEngineEnv,
  ids: string[],
  status: 'READY' | 'PROCESSING' | 'ANALYZED' | 'FAILED',
  runId?: string,
) {
  if (!ids.length) return
  const body: Record<string, unknown> = { analysis_status: status }
  if (runId) body.last_analysis_run_id = runId
  if (status === 'ANALYZED') body.analyzed_at = new Date().toISOString()
  await patchRows(env, 'ai_buyer_case_images?id=in.(' + ids.map((id) => clean(id, 80)).join(',') + ')', body)
}

async function sendLineText(
  env: ConversationEngineEnv,
  batch: IntakeBatch,
  text: string,
  action: IntakeAction,
) {
  const trimmed = clean(text, 4500)
  if (!trimmed) return false

  const requestBody = batch.replyToken
    ? { replyToken: batch.replyToken, messages: [{ type: 'text', text: trimmed }] }
    : { to: batch.lineUserId, messages: [{ type: 'text', text: trimmed }] }
  const endpoint = batch.replyToken
    ? 'https://api.line.me/v2/bot/message/reply'
    : 'https://api.line.me/v2/bot/message/push'

  let sent = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!sent.ok && batch.replyToken) {
    sent = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ to: batch.lineUserId, messages: [{ type: 'text', text: trimmed }] }),
    })
  }

  if (!sent.ok) {
    const detail = await sent.text().catch(() => '')
    throw new Error('LINE_SEND_' + sent.status + ':' + detail.slice(0, 400))
  }

  const audit = await supabaseRequest(env, 'ai_buyer_messages', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      conversation_id: batch.conversationId,
      case_id: batch.caseId,
      direction: 'OUTBOUND',
      message_type: 'TEXT',
      text_content: trimmed,
      metadata: { source: 'CONVERSATION_ENGINE', action },
      line_timestamp: new Date().toISOString(),
    }),
  })
  if (!audit.ok) console.error('AI BUYER outbound audit insert failed', audit.status)
  return true
}

async function failAnalysis(
  env: ConversationEngineEnv,
  runId: string | null,
  imageIds: string[],
  error: unknown,
) {
  const message = String((error as Error)?.message || error)
  if (imageIds.length) await markImages(env, imageIds, 'READY').catch(() => undefined)
  if (runId) await completeAnalysisRun(env, runId, 'FAILED', null, null, message).catch(() => undefined)
}

export async function runConversationIntake(env: ConversationEngineEnv, batch: IntakeBatch) {
  const conversation = await loadConversation(env, batch.conversationId)
  const currentCase = await loadCase(env, batch.caseId)
  if (!conversation || !currentCase) return { ok: false, skipped: true, reason: 'CASE_NOT_FOUND' }

  const [recentMessages, unconsumedMessages, readyImages, observations] = await Promise.all([
    loadRecentMessages(env, batch.caseId),
    loadUnconsumedMessages(env, batch.caseId),
    loadReadyImages(env, batch.caseId),
    loadPriorObservations(env, batch.caseId),
  ])

  const pending = pendingReply(currentCase.metadata)
  if (!unconsumedMessages.length && !readyImages.length && pending) {
    try {
      await sendLineText(env, batch, pending.text, pending.action)
      await clearPendingReply(env, currentCase.id, currentCase.metadata)
      return { ok: true, skipped: false, resentPendingReply: true }
    } catch (error) {
      return {
        ok: false,
        skipped: false,
        deliveryOnly: true,
        error: clean((error as Error)?.message || error, 500),
      }
    }
  }

  if (conversation.control_mode !== 'AUTO' || currentCase.control_mode !== 'AUTO') {
    return { ok: true, skipped: true, reason: 'HUMAN_CONTROL' }
  }

  if (!unconsumedMessages.length && !readyImages.length) {
    return { ok: true, skipped: true, reason: 'NOTHING_NEW' }
  }

  const model = clean(env.OPENAI_VISION_MODEL, 100) || 'gpt-5.6-sol'
  const messageIds = unconsumedMessages.map((message) => message.id)
  const imageIds = readyImages.map((image) => image.id)
  let runId: string | null = null

  try {
    if (imageIds.length) await markImages(env, imageIds, 'PROCESSING')
    const run = await createAnalysisRun(env, batch, model, messageIds, imageIds)
    runId = run.id

    const vision = await callVision(env, recentMessages, observations, readyImages)
    const result = vision.result

    const reply = composeReply(result, currentCase)
    await storeObservation(env, batch.caseId, result, vision.includedImageIds.length > 0)
    const transition = await updateCase(env, batch, currentCase, result, run.id, reply)
    await markMessagesConsumed(env, messageIds)

    if (vision.includedImageIds.length) await markImages(env, vision.includedImageIds, 'ANALYZED', run.id)
    if (vision.skippedImageIds.length) await markImages(env, vision.skippedImageIds, 'FAILED', run.id)

    await completeAnalysisRun(env, run.id, 'SUCCEEDED', {
      ...result,
      transition,
      includedImageIds: vision.includedImageIds,
      skippedImageIds: vision.skippedImageIds,
    }, vision.usage)

    let sent = false
    if (reply) {
      try {
        sent = await sendLineText(env, batch, reply, result.action)
        if (sent) await clearPendingReply(env, currentCase.id, transition.metadata)
      } catch (deliveryError) {
        console.error('AI BUYER LINE delivery failed after successful analysis', batch.caseId, deliveryError)
        return {
          ok: false,
          skipped: false,
          deliveryOnly: true,
          caseId: batch.caseId,
          state: transition.state,
          error: clean((deliveryError as Error)?.message || deliveryError, 500),
        }
      }
    }

    return {
      ok: true,
      skipped: false,
      caseId: batch.caseId,
      state: transition.state,
      category: result.category,
      requestedInputs: result.requested_inputs,
      sent,
    }
  } catch (error) {
    await failAnalysis(env, runId, imageIds, error)
    console.error('AI BUYER conversation intake failed', batch.caseId, error)
    return {
      ok: false,
      skipped: false,
      caseId: batch.caseId,
      error: clean((error as Error)?.message || error, 500),
    }
  }
}
