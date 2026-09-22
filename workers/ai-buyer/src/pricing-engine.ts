export interface PricingEnv {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  OPENAI_API_KEY: string
  OPENAI_PRICING_MODEL?: string
}

type ProductCategory =
  | 'NOTEBOOK'
  | 'MACBOOK'
  | 'DESKTOP_PC'
  | 'SMARTPHONE'
  | 'TABLET'
  | 'CAMERA'
  | 'OTHER'

type CaseRow = {
  id: string
  conversation_id: string
  state: string
  category: ProductCategory | null
  title: string | null
  identity_confidence: number | null
  spec_completeness: number | null
  condition_completeness: number | null
  pricing_readiness: number | null
  metadata: Record<string, unknown> | null
}

type ObservationRow = {
  confirmed: Record<string, unknown>
  inferred: Record<string, unknown>
  unknown_fields: unknown
  model_name: string | null
  model_code: string | null
  category: ProductCategory | null
  identity_confidence: number | null
  created_at: string
}

type VersionRow = {
  id: string
  version_name: string
  source_name: string | null
  source_checksum: string | null
}

type EntryRow = {
  id: string
  version_id: string
  category: ProductCategory
  brand: string | null
  model: string
  model_code: string | null
  aliases: unknown
  spec_match: Record<string, unknown> | null
  condition_key: string
  estimated_resale: number | null
  opening_offer: number
  target_buy: number
  hard_max: number
  adjustments: Record<string, unknown> | null
  normalized_brand: string | null
  normalized_model: string | null
  normalized_model_code: string | null
  lookup_keys: string[] | null
}

type CategoryRule = {
  category: ProductCategory
  market_enabled: boolean
  buyback_percent: number
  min_buyback_percent: number
  max_buyback_percent: number
  opening_discount_percent: number
  hard_max_percent: number
  risk_reserve: number
  rounding_step: number
  min_market_comparables: number
  max_market_dispersion: number
  adjustments: Record<string, unknown> | null
  active: boolean
}

type PricingDecision = {
  id: string
  case_id: string
  price_source: 'PRICE_BOOK' | 'MARKET' | 'ADMIN'
  estimated_resale: number | null
  opening_offer: number
  target_buy: number
  hard_max: number
  current_authorized_offer: number
  pricing_confidence: number
}

type PricingTag =
  | 'NO_CHARGER'
  | 'BATTERY_BAD'
  | 'SCREEN_DEFECT'
  | 'BODY_HEAVY'
  | 'HINGE_ISSUE'
  | 'NO_BOX'
  | 'DEVICE_NOT_BOOTING'
  | 'LOCKED'
  | 'MISSING_ACCESSORY'
  | 'MAJOR_DAMAGE'

type MarketCandidate = {
  title: string
  url: string
  price_thb: number
  condition: 'USED_GOOD' | 'USED_NORMAL' | 'USED_FAIR' | 'NEW' | 'REFURBISHED' | 'DEFECTIVE' | 'UNKNOWN'
  spec_match: number
}

type MarketSearchOutput = {
  product_identity: string
  comparables: MarketCandidate[]
}

type OpenAIResponse = {
  output?: unknown[]
  usage?: Record<string, unknown>
}

type PriceBookImportEntry = {
  category: ProductCategory
  brand?: string | null
  model: string
  model_code?: string | null
  aliases?: string[]
  spec_match?: Record<string, string | number | boolean>
  condition_key?: string
  estimated_resale?: number | null
  opening_offer: number
  target_buy: number
  hard_max: number
  adjustments?: Record<string, number>
}

export type PriceBookImportRule = {
  category: ProductCategory
  market_enabled?: boolean
  buyback_percent: number
  min_buyback_percent?: number
  max_buyback_percent?: number
  opening_discount_percent?: number
  hard_max_percent: number
  risk_reserve?: number
  rounding_step?: number
  min_market_comparables?: number
  max_market_dispersion?: number
  adjustments?: Record<string, number>
  active?: boolean
}

export type PriceBookImportPayload = {
  version_name: string
  source_name?: string
  source_checksum?: string
  activate?: boolean
  entries: PriceBookImportEntry[]
  category_rules?: PriceBookImportRule[]
}

export type PriceGuardResult =
  | { allowed: true; hardMax: number; decision: PricingDecision }
  | { allowed: false; reason: string; hardMax?: number; decision?: PricingDecision }

const PRICING_CATEGORIES: ProductCategory[] = [
  'NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER',
]

const COMPLEX_MARKET_TAGS: PricingTag[] = [
  'DEVICE_NOT_BOOTING',
  'LOCKED',
  'MAJOR_DAMAGE',
]

const MARKET_SCHEMA = {
  type: 'object',
  properties: {
    product_identity: { type: 'string' },
    comparables: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          price_thb: { type: 'number', minimum: 1 },
          condition: {
            type: 'string',
            enum: ['USED_GOOD','USED_NORMAL','USED_FAIR','NEW','REFURBISHED','DEFECTIVE','UNKNOWN'],
          },
          spec_match: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['title','url','price_thb','condition','spec_match'],
        additionalProperties: false,
      },
    },
  },
  required: ['product_identity','comparables'],
  additionalProperties: false,
} as const

function clean(value: unknown, max = 1000) {
  return String(value ?? '').trim().slice(0, max)
}

function numberValue(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp01(value: unknown) {
  return Math.max(0, Math.min(1, numberValue(value, 0)))
}

export function normalizeLookup(value: unknown) {
  return clean(value, 500)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeTokenText(value: unknown) {
  return clean(value, 1000)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeAdjustments(value: unknown) {
  const source = safeJsonObject(value)
  const output: Record<string, number> = {}
  for (const [key, raw] of Object.entries(source)) {
    const amount = Number(raw)
    if (!Number.isFinite(amount) || Math.abs(amount) > 10000000) {
      throw new Error('PRICE_ADJUSTMENT_INVALID:' + clean(key, 80))
    }
    output[clean(key, 80)] = Math.round(amount * 100) / 100
  }
  return output
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => clean(value, 500)).filter(Boolean))]
}

function supabaseHeaders(env: PricingEnv, extra: Record<string, string> = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
    accept: 'application/json',
    ...extra,
  }
}

async function supabaseRequest(env: PricingEnv, path: string, init: RequestInit = {}) {
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
    throw new Error('SUPABASE_' + result.status + ':' + detail.slice(0, 600))
  }
  const text = await result.text()
  return text ? JSON.parse(text) as T[] : []
}

async function patchRows(env: PricingEnv, path: string, body: Record<string, unknown>) {
  const result = await supabaseRequest(env, path, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!result.ok) {
    const detail = await result.text().catch(() => '')
    throw new Error('SUPABASE_PATCH_' + result.status + ':' + detail.slice(0, 600))
  }
}

function validateMoney(value: unknown, field: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 100000000) {
    throw new Error('PRICE_BOOK_INVALID_' + field.toUpperCase())
  }
  return Math.round(n * 100) / 100
}

function validatePercent(value: unknown, field: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n >= 1) {
    throw new Error('PRICE_RULE_INVALID_' + field.toUpperCase())
  }
  return n
}

function normalizeEntry(entry: PriceBookImportEntry) {
  const category = clean(entry.category, 40) as ProductCategory
  const model = clean(entry.model, 240)
  if (!PRICING_CATEGORIES.includes(category)) throw new Error('PRICE_BOOK_CATEGORY_INVALID')
  if (!model) throw new Error('PRICE_BOOK_ENTRY_IDENTITY_REQUIRED')

  const opening = validateMoney(entry.opening_offer, 'opening_offer')
  const target = validateMoney(entry.target_buy, 'target_buy')
  const hardMax = validateMoney(entry.hard_max, 'hard_max')
  if (!(opening <= target && target <= hardMax)) throw new Error('PRICE_BOOK_RANGE_INVALID')

  const brand = clean(entry.brand, 160) || null
  const modelCode = clean(entry.model_code, 160) || null
  const aliases = uniqueStrings(Array.isArray(entry.aliases) ? entry.aliases : [])
  const lookupKeys = uniqueStrings([
    normalizeLookup(model),
    normalizeLookup(modelCode),
    normalizeLookup(brand && model ? brand + ' ' + model : ''),
    ...aliases.map(normalizeLookup),
  ]).filter(Boolean)

  return {
    category,
    brand,
    model,
    model_code: modelCode,
    aliases,
    spec_match: safeJsonObject(entry.spec_match),
    condition_key: clean(entry.condition_key, 80) || 'NORMAL',
    estimated_resale: entry.estimated_resale == null ? null : validateMoney(entry.estimated_resale, 'estimated_resale'),
    opening_offer: opening,
    target_buy: target,
    hard_max: hardMax,
    adjustments: normalizeAdjustments(entry.adjustments),
    normalized_brand: normalizeLookup(brand) || null,
    normalized_model: normalizeLookup(model),
    normalized_model_code: normalizeLookup(modelCode) || null,
    lookup_keys: lookupKeys,
    active: true,
  }
}

function normalizeRule(rule: PriceBookImportRule) {
  const category = clean(rule.category, 40) as ProductCategory
  if (!PRICING_CATEGORIES.includes(category)) throw new Error('PRICE_RULE_CATEGORY_INVALID')
  const buyback = validatePercent(rule.buyback_percent, 'buyback_percent')
  const minBuyback = rule.min_buyback_percent == null ? Math.max(0.01, buyback - 0.10) : validatePercent(rule.min_buyback_percent, 'min_buyback_percent')
  const maxBuyback = rule.max_buyback_percent == null ? Math.min(0.99, buyback + 0.10) : validatePercent(rule.max_buyback_percent, 'max_buyback_percent')
  const hardMax = validatePercent(rule.hard_max_percent, 'hard_max_percent')
  if (!(minBuyback <= buyback && buyback <= hardMax && hardMax <= maxBuyback)) {
    throw new Error('PRICE_RULE_PERCENT_ORDER_INVALID')
  }

  return {
    category,
    market_enabled: Boolean(rule.market_enabled),
    buyback_percent: buyback,
    min_buyback_percent: minBuyback,
    max_buyback_percent: maxBuyback,
    opening_discount_percent: Math.max(0, Math.min(0.49, numberValue(rule.opening_discount_percent, 0.05))),
    hard_max_percent: hardMax,
    risk_reserve: validateMoney(rule.risk_reserve ?? 0, 'risk_reserve'),
    rounding_step: Math.max(1, Math.min(10000, Math.floor(numberValue(rule.rounding_step, 100)))),
    min_market_comparables: Math.max(3, Math.min(12, Math.floor(numberValue(rule.min_market_comparables, 3)))),
    max_market_dispersion: Math.max(0.01, Math.min(1, numberValue(rule.max_market_dispersion, 0.35))),
    adjustments: normalizeAdjustments(rule.adjustments),
    active: rule.active !== false,
  }
}

async function rpc(env: PricingEnv, name: string, body: Record<string, unknown>) {
  const result = await supabaseRequest(env, 'rpc/' + name, {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!result.ok) {
    const detail = await result.text().catch(() => '')
    throw new Error('SUPABASE_RPC_' + name + '_' + result.status + ':' + detail.slice(0, 600))
  }
}

export async function importPriceBook(env: PricingEnv, payload: PriceBookImportPayload) {
  const versionName = clean(payload.version_name, 160)
  const sourceName = clean(payload.source_name, 240) || null
  const checksum = clean(payload.source_checksum, 240) || null
  const entries = Array.isArray(payload.entries) ? payload.entries.map(normalizeEntry) : []
  const rules = Array.isArray(payload.category_rules) ? payload.category_rules.map(normalizeRule) : []

  const entryKeys = new Set<string>()
  for (const entry of entries) {
    const key = [
      entry.category,
      entry.normalized_model_code || entry.normalized_model,
      clean(entry.condition_key, 80).toUpperCase(),
      JSON.stringify(entry.spec_match),
    ].join('|')
    if (entryKeys.has(key)) throw new Error('PRICE_BOOK_DUPLICATE_ENTRY:' + key)
    entryKeys.add(key)
  }

  const ruleCategories = new Set<string>()
  for (const rule of rules) {
    if (ruleCategories.has(rule.category)) throw new Error('PRICE_RULE_DUPLICATE_CATEGORY:' + rule.category)
    ruleCategories.add(rule.category)
  }

  if (!versionName) throw new Error('PRICE_BOOK_VERSION_REQUIRED')
  if (!entries.length) throw new Error('PRICE_BOOK_ENTRIES_REQUIRED')
  if (entries.length > 5000) throw new Error('PRICE_BOOK_TOO_LARGE')

  const existing = await readRows<VersionRow>(await supabaseRequest(
    env,
    'ai_buyer_price_book_versions?version_name=eq.' + encodeURIComponent(versionName) + '&select=id,version_name,source_name,source_checksum&limit=1',
  ))
  if (existing[0]) throw new Error('PRICE_BOOK_VERSION_EXISTS')

  const versions = await readRows<VersionRow>(await supabaseRequest(env, 'ai_buyer_price_book_versions', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      version_name: versionName,
      status: 'DRAFT',
      source_name: sourceName,
      source_checksum: checksum,
    }),
  }))
  const version = versions[0]
  if (!version) throw new Error('PRICE_BOOK_VERSION_CREATE_EMPTY')

  const imports = await readRows<{ id: string }>(await supabaseRequest(env, 'ai_buyer_price_book_imports', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      version_id: version.id,
      status: 'RUNNING',
      source_name: sourceName,
      source_checksum: checksum,
    }),
  }))
  const importId = imports[0]?.id
  if (!importId) throw new Error('PRICE_BOOK_IMPORT_CREATE_EMPTY')

  try {
    const BATCH = 250
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH).map((entry) => ({ ...entry, version_id: version.id }))
      const inserted = await supabaseRequest(env, 'ai_buyer_price_book_entries', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify(chunk),
      })
      if (!inserted.ok) {
        const detail = await inserted.text().catch(() => '')
        throw new Error('PRICE_BOOK_ENTRY_INSERT_' + inserted.status + ':' + detail.slice(0, 600))
      }
    }

    for (const rule of rules) {
      const upsert = await supabaseRequest(env, 'ai_buyer_category_pricing_rules?on_conflict=category', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rule),
      })
      if (!upsert.ok) {
        const detail = await upsert.text().catch(() => '')
        throw new Error('PRICE_RULE_UPSERT_' + upsert.status + ':' + detail.slice(0, 600))
      }
    }

    if (payload.activate !== false) {
      await rpc(env, 'ai_buyer_activate_price_book', { p_version_id: version.id })
    }

    await patchRows(env, 'ai_buyer_price_book_imports?id=eq.' + encodeURIComponent(importId), {
      status: 'SUCCEEDED',
      entry_count: entries.length,
      rule_count: rules.length,
      completed_at: new Date().toISOString(),
    })

    return {
      ok: true,
      versionId: version.id,
      versionName,
      entries: entries.length,
      rules: rules.length,
      active: payload.activate !== false,
    }
  } catch (error) {
    await patchRows(env, 'ai_buyer_price_book_imports?id=eq.' + encodeURIComponent(importId), {
      status: 'FAILED',
      error: clean((error as Error)?.message || error, 2000),
      completed_at: new Date().toISOString(),
    }).catch(() => undefined)
    throw error
  }
}

async function loadCase(env: PricingEnv, caseId: string) {
  const rows = await readRows<CaseRow>(await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
      + '&select=id,conversation_id,state,category,title,identity_confidence,spec_completeness,condition_completeness,pricing_readiness,metadata&limit=1',
  ))
  return rows[0] || null
}

async function loadObservations(env: PricingEnv, caseId: string) {
  return readRows<ObservationRow>(await supabaseRequest(env, [
    'ai_buyer_product_observations?select=confirmed,inferred,unknown_fields,model_name,model_code,category,identity_confidence,created_at',
    'case_id=eq.' + encodeURIComponent(caseId),
    'order=created_at.desc',
    'limit=5',
  ].join('&')))
}

async function loadActiveVersion(env: PricingEnv) {
  const rows = await readRows<VersionRow>(await supabaseRequest(
    env,
    'ai_buyer_price_book_versions?status=eq.ACTIVE&select=id,version_name,source_name,source_checksum&limit=1',
  ))
  return rows[0] || null
}

async function loadEntries(env: PricingEnv, versionId: string, category: ProductCategory) {
  return readRows<EntryRow>(await supabaseRequest(env, [
    'ai_buyer_price_book_entries?select=id,version_id,category,brand,model,model_code,aliases,spec_match,condition_key,estimated_resale,opening_offer,target_buy,hard_max,adjustments,normalized_brand,normalized_model,normalized_model_code,lookup_keys',
    'version_id=eq.' + encodeURIComponent(versionId),
    'category=eq.' + encodeURIComponent(category),
    'active=eq.true',
    'limit=1000',
  ].join('&')))
}

async function loadRule(env: PricingEnv, category: ProductCategory) {
  const rows = await readRows<CategoryRule>(await supabaseRequest(env, [
    'ai_buyer_category_pricing_rules?select=category,market_enabled,buyback_percent,min_buyback_percent,max_buyback_percent,opening_discount_percent,hard_max_percent,risk_reserve,rounding_step,min_market_comparables,max_market_dispersion,adjustments,active',
    'category=eq.' + encodeURIComponent(category),
    'active=eq.true',
    'limit=1',
  ].join('&')))
  return rows[0] || null
}

function aggregateIdentity(caseRow: CaseRow, observations: ObservationRow[]) {
  const confirmed: Record<string, unknown> = {}
  let modelName = ''
  let modelCode = ''

  for (const observation of [...observations].reverse()) {
    Object.assign(confirmed, safeJsonObject(observation.confirmed))
    if (observation.model_name) modelName = observation.model_name
    if (observation.model_code) modelCode = observation.model_code
  }

  const tags = Array.isArray(caseRow.metadata?.lastPricingTags)
    ? caseRow.metadata?.lastPricingTags.map((tag) => clean(tag, 80)).filter(Boolean) as PricingTag[]
    : []

  const values = Object.values(confirmed).map((value) => clean(value, 500)).filter(Boolean)
  const searchText = normalizeTokenText([
    caseRow.title || '',
    modelName,
    modelCode,
    ...values,
  ].join(' '))

  return {
    modelName,
    modelCode,
    confirmed,
    tags,
    searchText,
    normalizedModel: normalizeLookup(modelName),
    normalizedModelCode: normalizeLookup(modelCode),
    normalizedTitle: normalizeLookup(caseRow.title),
  }
}

function specCompatibility(entry: EntryRow, confirmed: Record<string, unknown>) {
  const required = safeJsonObject(entry.spec_match)
  const pairs = Object.entries(required)
  if (!pairs.length) return { compatible: true, score: 1 }

  const confirmedText = normalizeLookup(Object.values(confirmed).map((value) => clean(value, 500)).join(' '))
  let matched = 0
  for (const [, expected] of pairs) {
    const normalized = normalizeLookup(expected)
    if (!normalized) continue
    if (confirmedText.includes(normalized)) matched += 1
    else return { compatible: false, score: matched / pairs.length }
  }
  return { compatible: true, score: matched / Math.max(1, pairs.length) }
}

function desiredConditionKey(tags: PricingTag[]) {
  if (tags.some((tag) => ['DEVICE_NOT_BOOTING','LOCKED','MAJOR_DAMAGE'].includes(tag))) return 'DEFECTIVE'
  if (tags.some((tag) => ['SCREEN_DEFECT','BODY_HEAVY','HINGE_ISSUE','BATTERY_BAD'].includes(tag))) return 'ROUGH'
  return 'NORMAL'
}

function priceBookMatchScore(
  entry: EntryRow,
  identity: ReturnType<typeof aggregateIdentity>,
) {
  const entryCode = entry.normalized_model_code || normalizeLookup(entry.model_code)
  const entryModel = entry.normalized_model || normalizeLookup(entry.model)
  const keys = uniqueStrings([
    ...(Array.isArray(entry.lookup_keys) ? entry.lookup_keys : []),
    ...(Array.isArray(entry.aliases) ? entry.aliases.map(normalizeLookup) : []),
    entryCode,
    entryModel,
  ]).filter(Boolean)

  let score = 0
  let reason = 'NONE'
  if (identity.normalizedModelCode && entryCode === identity.normalizedModelCode) {
    score = 1
    reason = 'MODEL_CODE_EXACT'
  } else if (identity.normalizedModelCode && keys.includes(identity.normalizedModelCode)) {
    score = 0.97
    reason = 'MODEL_CODE_ALIAS'
  } else if (identity.normalizedModel && entryModel === identity.normalizedModel) {
    score = 0.94
    reason = 'MODEL_EXACT'
  } else if (identity.normalizedModel && keys.includes(identity.normalizedModel)) {
    score = 0.92
    reason = 'MODEL_ALIAS'
  } else if (identity.normalizedTitle && keys.includes(identity.normalizedTitle)) {
    score = 0.90
    reason = 'TITLE_ALIAS'
  } else {
    const modelTokens = normalizeTokenText(entry.model).split(/\s+/).filter(Boolean)
    const hit = modelTokens.filter((token) => identity.searchText.includes(token)).length
    if (modelTokens.length >= 2 && hit / modelTokens.length >= 0.8) {
      score = 0.82
      reason = 'TOKEN_MATCH'
    }
  }

  const spec = specCompatibility(entry, identity.confirmed)
  if (!spec.compatible) return { score: 0, reason: 'SPEC_CONFLICT' }

  const wantedCondition = desiredConditionKey(identity.tags)
  const entryCondition = clean(entry.condition_key, 80).toUpperCase() || 'NORMAL'
  const conditionBonus = entryCondition === wantedCondition
    ? 0.025
    : entryCondition === 'NORMAL'
      ? 0
      : -0.025

  return {
    score: Math.max(0, Math.min(
      1,
      score
        + (Object.keys(safeJsonObject(entry.spec_match)).length ? 0.02 * spec.score : 0)
        + conditionBonus,
    )),
    reason: reason + ':CONDITION_' + entryCondition,
  }
}

function bestPriceBookEntry(entries: EntryRow[], identity: ReturnType<typeof aggregateIdentity>) {
  const scored = entries
    .map((entry) => ({ entry, ...priceBookMatchScore(entry, identity) }))
    .filter((row) => row.score >= 0.82)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return { match: null, ambiguous: false }
  const top = scored[0]
  const second = scored[1]
  const ambiguous = Boolean(
    second
    && top.entry.id !== second.entry.id
    && Math.abs(top.score - second.score) < 0.02
    && (
      normalizeLookup(top.entry.model_code) !== normalizeLookup(second.entry.model_code)
      || clean(top.entry.condition_key, 80).toUpperCase() !== clean(second.entry.condition_key, 80).toUpperCase()
    ),
  )
  return { match: top, ambiguous }
}

function adjustmentDelta(tags: PricingTag[], ...sources: Array<Record<string, unknown> | null | undefined>) {
  let delta = 0
  const applied: Array<{ tag: PricingTag; amount: number }> = []
  for (const tag of tags) {
    let amount = 0
    for (const source of sources) {
      const n = Number(source?.[tag])
      if (Number.isFinite(n)) amount += n
    }
    if (amount !== 0) {
      delta += amount
      applied.push({ tag, amount })
    }
  }
  return { delta, applied }
}

function normalizeMoneyRange(opening: number, target: number, hardMax: number) {
  const hard = Math.max(0, Math.round(hardMax))
  const targetSafe = Math.max(0, Math.min(hard, Math.round(target)))
  const openingSafe = Math.max(0, Math.min(targetSafe, Math.round(opening)))
  return { opening: openingSafe, target: targetSafe, hardMax: hard }
}

function roundDown(value: number, step: number) {
  return Math.max(0, Math.floor(value / step) * step)
}

async function createDecision(
  env: PricingEnv,
  input: {
    caseId: string
    source: 'PRICE_BOOK' | 'MARKET' | 'ADMIN'
    versionId?: string | null
    entryId?: string | null
    estimatedResale?: number | null
    opening: number
    target: number
    hardMax: number
    confidence: number
    adjustments: unknown
    comparables: unknown
    rationale: unknown
  },
) {
  const rows = await readRows<PricingDecision>(await supabaseRequest(env, 'ai_buyer_pricing_decisions', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      case_id: input.caseId,
      price_source: input.source,
      price_book_version_id: input.versionId || null,
      price_book_entry_id: input.entryId || null,
      estimated_resale: input.estimatedResale ?? null,
      opening_offer: input.opening,
      target_buy: input.target,
      hard_max: input.hardMax,
      current_authorized_offer: input.opening,
      pricing_confidence: clamp01(input.confidence),
      adjustments: input.adjustments || [],
      comparables: input.comparables || [],
      rationale: input.rationale || {},
    }),
  }))
  if (!rows[0]) throw new Error('PRICING_DECISION_CREATE_EMPTY')
  return rows[0]
}

async function setPricingSuccess(
  env: PricingEnv,
  caseRow: CaseRow,
  decision: PricingDecision,
  source: string,
) {
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id), {
    state: 'PRICING',
    metadata: {
      ...(caseRow.metadata || {}),
      pricingDecisionId: decision.id,
      pricingSource: source,
      pricingReadyAt: new Date().toISOString(),
    },
  })
}

async function escalatePricing(
  env: PricingEnv,
  caseRow: CaseRow,
  reason: string,
  detail: Record<string, unknown> = {},
) {
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id), {
    state: 'HUMAN_REVIEW',
    control_mode: 'HUMAN_REQUIRED',
    metadata: {
      ...(caseRow.metadata || {}),
      pricingReviewReason: reason,
      pricingReviewDetail: detail,
    },
  })
  await patchRows(
    env,
    'ai_buyer_conversations?id=eq.' + encodeURIComponent(caseRow.conversation_id),
    { control_mode: 'HUMAN_REQUIRED' },
  )

  const exists = await readRows<{ id: string }>(await supabaseRequest(env, [
    'ai_buyer_admin_tasks?select=id',
    'case_id=eq.' + encodeURIComponent(caseRow.id),
    'task_type=eq.PRICING_REVIEW',
    'status=in.(ACTION_REQUIRED,IN_PROGRESS)',
    'limit=1',
  ].join('&')))

  if (!exists[0]) {
    const task = await supabaseRequest(env, 'ai_buyer_admin_tasks', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        case_id: caseRow.id,
        task_type: 'PRICING_REVIEW',
        status: 'ACTION_REQUIRED',
        priority: 'HIGH',
        payload: { reason, ...detail },
      }),
    })
    if (!task.ok) console.error('AI BUYER pricing review task insert failed', task.status)
  }
  return { ok: false as const, humanReview: true as const, reason }
}

function canonicalUrl(value: unknown) {
  try {
    const url = new URL(clean(value, 2000))
    url.hash = ''
    const params = [...url.searchParams.keys()]
    for (const key of params) {
      if (/^(utm_|fbclid|gclid|ref$|ref_|source$)/i.test(key)) url.searchParams.delete(key)
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function collectSourceUrls(value: unknown, output = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceUrls(item, output)
    return output
  }
  if (!value || typeof value !== 'object') return output
  const object = value as Record<string, unknown>
  if (typeof object.url === 'string') {
    const normalized = canonicalUrl(object.url)
    if (normalized) output.add(normalized)
  }
  for (const child of Object.values(object)) collectSourceUrls(child, output)
  return output
}

function extractOutputText(response: OpenAIResponse) {
  for (const item of response.output || []) {
    if (!item || typeof item !== 'object') continue
    const object = item as Record<string, unknown>
    if (object.type !== 'message' || !Array.isArray(object.content)) continue
    for (const part of object.content) {
      if (!part || typeof part !== 'object') continue
      const content = part as Record<string, unknown>
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text
    }
  }
  return ''
}

async function marketSearch(
  env: PricingEnv,
  caseRow: CaseRow,
  identity: ReturnType<typeof aggregateIdentity>,
) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED')
  const model = clean(env.OPENAI_PRICING_MODEL, 100) || 'gpt-5.6-sol'
  const identityText = clean([
    caseRow.category,
    caseRow.title,
    identity.modelName,
    identity.modelCode,
    Object.values(identity.confirmed).join(' '),
  ].filter(Boolean).join(' | '), 3000)

  const prompt = [
    'Search the current Thai market for USED listings of this exact product/spec:',
    identityText,
    '',
    'Goal: collect comparable asking prices in THB for resale estimation.',
    'Rules:',
    '- Prefer Thailand listings and current/recent used listings.',
    '- Do not use buyback/wanted-to-buy offers as resale comparables.',
    '- Exclude new, refurbished, defective, bundle, auction, obvious typo, and wrong-spec listings from normal comparables.',
    '- Each comparable URL must be a URL actually found by web search.',
    '- Return conservative spec_match. If exact model/spec is uncertain, use a low score.',
    '- Do not calculate a buyback offer. Return comparable evidence only.',
  ].join('\n')

  const result = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.OPENAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'amphon_market_comparables',
          strict: true,
          schema: MARKET_SCHEMA,
        },
      },
    }),
  })

  const raw = await result.text()
  if (!result.ok) throw new Error('OPENAI_MARKET_' + result.status + ':' + raw.slice(0, 800))
  const response = raw ? JSON.parse(raw) as OpenAIResponse : {}
  const outputText = extractOutputText(response)
  if (!outputText) throw new Error('MARKET_OUTPUT_TEXT_MISSING')

  let parsed: MarketSearchOutput
  try {
    parsed = JSON.parse(outputText) as MarketSearchOutput
  } catch {
    throw new Error('MARKET_OUTPUT_JSON_INVALID')
  }

  const sourceUrls = collectSourceUrls(response.output)
  const candidates = Array.isArray(parsed.comparables) ? parsed.comparables : []
  return {
    model,
    usage: response.usage || {},
    productIdentity: clean(parsed.product_identity, 1000),
    sourceUrls,
    candidates,
  }
}

function verifiedComparables(
  candidates: MarketCandidate[],
  sourceUrls: Set<string>,
) {
  return candidates.map((candidate) => {
    const url = canonicalUrl(candidate.url)
    const verified = Boolean(url && sourceUrls.has(url))
    const condition = clean(candidate.condition, 40) as MarketCandidate['condition']
    const validCondition = ['USED_GOOD','USED_NORMAL','USED_FAIR'].includes(condition)
    return {
      ...candidate,
      url,
      price_thb: numberValue(candidate.price_thb, 0),
      spec_match: clamp01(candidate.spec_match),
      source_verified: verified,
      usable: verified && validCondition && candidate.price_thb > 0 && clamp01(candidate.spec_match) >= 0.85,
    }
  })
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function marketStats(values: number[]) {
  const med = median(values)
  if (!med) return { median: 0, dispersion: 1, kept: [] as number[] }
  const firstPass = values.filter((value) => value >= med * 0.55 && value <= med * 1.75)
  const base = firstPass.length >= 3 ? firstPass : values
  const med2 = median(base)
  const absolute = base.map((value) => Math.abs(value - med2))
  const mad = median(absolute)
  return {
    median: med2,
    dispersion: med2 > 0 ? mad / med2 : 1,
    kept: base,
  }
}

async function storeMarketComparables(
  env: PricingEnv,
  caseId: string,
  decisionId: string | null,
  rows: ReturnType<typeof verifiedComparables>,
  includedPrices: number[],
) {
  if (!rows.length) return
  const payload = rows.map((row) => ({
    case_id: caseId,
    pricing_decision_id: decisionId,
    source_url: row.url || clean(row.url, 2000),
    source_domain: (() => {
      try { return new URL(row.url).hostname } catch { return null }
    })(),
    source_title: clean(row.title, 1000) || null,
    product_title: clean(row.title, 1000) || null,
    price: Math.max(1, Math.round(row.price_thb)),
    currency: 'THB',
    listing_condition: row.condition,
    spec_match: row.spec_match,
    source_verified: row.source_verified,
    included_in_estimate: row.usable && includedPrices.includes(row.price_thb),
    raw: {
      usable: row.usable,
    },
  }))

  const result = await supabaseRequest(env, 'ai_buyer_market_comparables', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  })
  if (!result.ok) console.error('AI BUYER market comparable audit insert failed', result.status)
}

export async function runPricingForCase(env: PricingEnv, caseId: string) {
  const caseRow = await loadCase(env, caseId)
  if (!caseRow) return { ok: false as const, reason: 'CASE_NOT_FOUND' }
  if (caseRow.state !== 'READY_TO_PRICE' && caseRow.state !== 'PRICING') {
    return { ok: false as const, reason: 'CASE_NOT_READY' }
  }
  if (!caseRow.category || caseRow.category === 'OTHER') {
    return escalatePricing(env, caseRow, 'CATEGORY_NOT_AUTOPRICED')
  }
  if (numberValue(caseRow.identity_confidence) < 0.88) {
    return escalatePricing(env, caseRow, 'PRICING_GATE_NOT_MET', {
      identityConfidence: caseRow.identity_confidence,
      conditionCompleteness: caseRow.condition_completeness,
      policy: 'STRONG_IDENTITY_CAN_PRICE_WITH_PARTIAL_CONDITION',
    })
  }

  const observations = await loadObservations(env, caseId)
  const identity = aggregateIdentity(caseRow, observations)
  const [version, rule] = await Promise.all([
    loadActiveVersion(env),
    loadRule(env, caseRow.category),
  ])

  if (version) {
    const entries = await loadEntries(env, version.id, caseRow.category)
    const selected = bestPriceBookEntry(entries, identity)

    if (selected.ambiguous) {
      return escalatePricing(env, caseRow, 'PRICE_BOOK_AMBIGUOUS')
    }

    if (selected.match) {
      const row = selected.match
      const adjust = adjustmentDelta(identity.tags, row.entry.adjustments, rule?.adjustments)
      const prices = normalizeMoneyRange(
        row.entry.opening_offer + adjust.delta,
        row.entry.target_buy + adjust.delta,
        row.entry.hard_max + adjust.delta,
      )
      const confidence = Math.min(
        0.99,
        0.80 + row.score * 0.16 + clamp01(caseRow.condition_completeness) * 0.03,
      )
      if (prices.hardMax <= 0) {
        return escalatePricing(env, caseRow, 'PRICE_BOOK_VALUE_NONPOSITIVE', {
          matchScore: row.score,
          adjustmentDelta: adjust.delta,
        })
      }
      if (confidence < 0.85) {
        return escalatePricing(env, caseRow, 'PRICE_BOOK_CONFIDENCE_LOW', {
          matchScore: row.score,
          matchReason: row.reason,
        })
      }

      const decision = await createDecision(env, {
        caseId,
        source: 'PRICE_BOOK',
        versionId: version.id,
        entryId: row.entry.id,
        estimatedResale: row.entry.estimated_resale,
        opening: prices.opening,
        target: prices.target,
        hardMax: prices.hardMax,
        confidence,
        adjustments: adjust.applied,
        comparables: [],
        rationale: {
          matchReason: row.reason,
          matchScore: row.score,
          version: version.version_name,
          model: row.entry.model,
          modelCode: row.entry.model_code,
        },
      })
      await setPricingSuccess(env, caseRow, decision, 'PRICE_BOOK')
      return {
        ok: true as const,
        source: 'PRICE_BOOK' as const,
        decision,
        match: { id: row.entry.id, model: row.entry.model, score: row.score, reason: row.reason },
      }
    }
  }

  if (!rule || !rule.market_enabled) {
    return escalatePricing(env, caseRow, 'MARKET_FALLBACK_DISABLED', {
      activePriceBook: version?.version_name || null,
    })
  }
  if (identity.tags.some((tag) => COMPLEX_MARKET_TAGS.includes(tag))) {
    return escalatePricing(env, caseRow, 'COMPLEX_CONDITION_REQUIRES_ADMIN', {
      tags: identity.tags,
    })
  }
  if (!identity.modelName && !identity.modelCode && !caseRow.title) {
    return escalatePricing(env, caseRow, 'MARKET_IDENTITY_INSUFFICIENT')
  }

  const market = await marketSearch(env, caseRow, identity)
  const verified = verifiedComparables(market.candidates, market.sourceUrls)
  const usable = verified.filter((row) => row.usable)
  const values = usable.map((row) => row.price_thb)
  const stats = marketStats(values)

  if (stats.kept.length < rule.min_market_comparables) {
    await storeMarketComparables(env, caseId, null, verified, [])
    return escalatePricing(env, caseRow, 'MARKET_COMPARABLES_INSUFFICIENT', {
      required: rule.min_market_comparables,
      valid: stats.kept.length,
      sourceCount: market.sourceUrls.size,
    })
  }
  if (stats.dispersion > Number(rule.max_market_dispersion)) {
    await storeMarketComparables(env, caseId, null, verified, stats.kept)
    return escalatePricing(env, caseRow, 'MARKET_PRICE_DISPERSION_HIGH', {
      dispersion: stats.dispersion,
      allowed: rule.max_market_dispersion,
    })
  }

  const adjust = adjustmentDelta(identity.tags, rule.adjustments)
  const estimatedResale = roundDown(stats.median, rule.rounding_step)
  const target = roundDown(
    estimatedResale * Number(rule.buyback_percent) - Number(rule.risk_reserve) + adjust.delta,
    rule.rounding_step,
  )
  const hardMax = roundDown(
    estimatedResale * Number(rule.hard_max_percent) - Number(rule.risk_reserve) + adjust.delta,
    rule.rounding_step,
  )
  const opening = roundDown(
    target * (1 - Number(rule.opening_discount_percent)),
    rule.rounding_step,
  )
  const prices = normalizeMoneyRange(opening, target, hardMax)

  const compFactor = Math.min(1, stats.kept.length / Math.max(rule.min_market_comparables, 5))
  const dispersionFactor = Math.max(0, 1 - stats.dispersion / Math.max(0.01, Number(rule.max_market_dispersion)))
  const confidence = Math.min(
    0.94,
    0.73
      + compFactor * 0.08
      + dispersionFactor * 0.07
      + clamp01(caseRow.identity_confidence) * 0.05
      + clamp01(caseRow.condition_completeness) * 0.01,
  )

  if (confidence < 0.85 || prices.hardMax <= 0) {
    await storeMarketComparables(env, caseId, null, verified, stats.kept)
    return escalatePricing(env, caseRow, 'MARKET_PRICING_CONFIDENCE_LOW', {
      confidence,
      dispersion: stats.dispersion,
      comparables: stats.kept.length,
    })
  }

  const decision = await createDecision(env, {
    caseId,
    source: 'MARKET',
    estimatedResale,
    opening: prices.opening,
    target: prices.target,
    hardMax: prices.hardMax,
    confidence,
    adjustments: [
      { type: 'RISK_RESERVE', amount: -Number(rule.risk_reserve) },
      ...adjust.applied,
    ],
    comparables: verified.filter((row) => row.usable).map((row) => ({
      url: row.url,
      title: row.title,
      price: row.price_thb,
      condition: row.condition,
      specMatch: row.spec_match,
      sourceVerified: row.source_verified,
    })),
    rationale: {
      model: market.model,
      productIdentity: market.productIdentity,
      sourceCount: market.sourceUrls.size,
      validComparables: stats.kept.length,
      dispersion: stats.dispersion,
      buybackPercent: rule.buyback_percent,
      hardMaxPercent: rule.hard_max_percent,
      roundingStep: rule.rounding_step,
    },
  })

  await storeMarketComparables(env, caseId, decision.id, verified, stats.kept)
  await setPricingSuccess(env, caseRow, decision, 'MARKET')
  return { ok: true as const, source: 'MARKET' as const, decision }
}

async function loadDecision(env: PricingEnv, decisionId: string) {
  const rows = await readRows<PricingDecision>(await supabaseRequest(
    env,
    'ai_buyer_pricing_decisions?id=eq.' + encodeURIComponent(decisionId)
      + '&select=id,case_id,price_source,estimated_resale,opening_offer,target_buy,hard_max,current_authorized_offer,pricing_confidence&limit=1',
  ))
  return rows[0] || null
}

export async function guardOffer(
  env: PricingEnv,
  input: { caseId: string; decisionId: string; amount: number },
): Promise<PriceGuardResult> {
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount < 0) return { allowed: false, reason: 'AMOUNT_INVALID' }

  const decision = await loadDecision(env, input.decisionId)
  if (!decision) return { allowed: false, reason: 'DECISION_NOT_FOUND' }
  if (decision.case_id !== input.caseId) {
    return { allowed: false, reason: 'DECISION_CASE_MISMATCH', decision }
  }
  if (decision.pricing_confidence < 0.85) {
    return { allowed: false, reason: 'DECISION_CONFIDENCE_LOW', hardMax: decision.hard_max, decision }
  }
  if (amount > decision.hard_max) {
    return { allowed: false, reason: 'HARD_MAX_EXCEEDED', hardMax: decision.hard_max, decision }
  }
  return { allowed: true, hardMax: decision.hard_max, decision }
}

export async function createGuardedOffer(
  env: PricingEnv,
  input: {
    caseId: string
    decisionId: string
    amount: number
    actor: 'AI' | 'ADMIN'
    messageId?: string | null
    idempotencyKey?: string | null
    roundNo?: number
  },
) {
  const guard = await guardOffer(env, input)
  if (!guard.allowed) {
    throw new Error('PRICE_GUARD_BLOCKED:' + guard.reason)
  }

  const amount = Math.round(input.amount)
  const idempotencyKey = clean(
    input.idempotencyKey
      || ['offer', input.caseId, input.decisionId, input.actor, amount].join(':'),
    500,
  )
  const rows = await readRows<{ id: string; amount: number }>(await supabaseRequest(
    env,
    'rpc/ai_buyer_create_guarded_offer',
    {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        p_case_id: input.caseId,
        p_decision_id: input.decisionId,
        p_amount: amount,
        p_actor: input.actor,
        p_idempotency_key: idempotencyKey,
        p_round_no: Math.max(0, Math.floor(numberValue(input.roundNo, 0))),
        p_message_id: input.messageId || null,
      }),
    },
  ))
  if (!rows[0]) throw new Error('GUARDED_OFFER_CREATE_EMPTY')
  return { ok: true, offer: rows[0], guard }
}
