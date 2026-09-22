import type { PricingEnv } from './pricing-engine'

type SpecCategory = 'NOTEBOOK' | 'DESKTOP_PC'
type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NA'

type CaseRow = {
  id: string
  conversation_id: string
  state: string
  category: string | null
  title: string | null
  identity_confidence: number | null
  condition_completeness: number | null
  metadata: Record<string, unknown> | null
}

type ObservationRow = {
  confirmed: Record<string, unknown>
  inferred: Record<string, unknown>
  model_name: string | null
  model_code: string | null
  created_at: string
}

type VersionRow = {
  id: string
  version_name: string
  source_name: string | null
  source_checksum: string | null
}

type SpecEntryRow = {
  id: string
  version_id: string
  category: SpecCategory
  component_type: string
  lookup_key: string
  normalized_key: string
  numeric_value: number
  confidence: Confidence
  metadata: Record<string, unknown> | null
}

type SpecSettingRow = {
  version_id: string
  category: SpecCategory
  base_value: number
  target_buy_percent: number
  hard_max_percent: number
  opening_discount_percent: number
  risk_reserve: number
  rounding_step: number
  confidence_gate: number
  metadata: Record<string, unknown> | null
}

type PricingDecision = {
  id: string
  case_id: string
  price_source: 'PRICE_BOOK'
  estimated_resale: number | null
  opening_offer: number
  target_buy: number
  hard_max: number
  current_authorized_offer: number
  pricing_confidence: number
}

type Match = {
  entry: SpecEntryRow
  reason: string
}

type ComponentTrace = {
  type: string
  key: string
  amount: number
  confidence: Confidence
  reason: string
}

export type SpecPricingResult =
  | { handled: false }
  | { handled: true; result: unknown }

const KEY_ALIASES: Record<string, string[]> = {
  brand: ['brand', 'ยี่ห้อ'],
  series: ['series', 'series_key', 'ซีรีส์', 'ตระกูล'],
  cpu: ['cpu', 'processor', 'ซีพียู'],
  gpu: ['gpu', 'vga', 'graphics', 'การ์ดจอ'],
  ram: ['ram', 'memory', 'แรม'],
  storage: ['storage', 'ssd', 'disk', 'พื้นที่เก็บข้อมูล', 'ความจุ'],
  primary_storage: ['primary_storage', 'storage', 'ssd'],
  secondary_storage: ['secondary_storage', 'hdd', 'secondary_disk'],
  display: ['display', 'screen', 'จอ'],
  motherboard: ['motherboard', 'mainboard', 'board', 'เมนบอร์ด'],
  psu: ['psu', 'power_supply', 'power supply', 'power', 'พาวเวอร์'],
  case: ['case', 'chassis', 'เคส'],
  cooler: ['cooler', 'cooling', 'heatsink', 'ชุดน้ำ', 'ซิงก์'],
  system_class: ['system_class', 'build_class', 'pc_class'],
  condition: ['condition', 'สภาพ'],
  warranty: ['warranty', 'ประกัน'],
  defects: ['defects', 'defect', 'damage', 'ตำหนิ', 'อาการเสีย'],
}

const CONDITION_TAG_MAP: Record<string, string> = {
  NO_CHARGER: 'NO_CHARGER',
  BATTERY_BAD: 'BATTERY_BAD',
  SCREEN_DEFECT: 'SCREEN_DEFECT',
  BODY_HEAVY: 'ROUGH',
  HINGE_ISSUE: 'HINGE_ISSUE',
  DEVICE_NOT_BOOTING: 'NOT_BOOTING',
  MAJOR_DAMAGE: 'MAJOR_DAMAGE',
}

const DETAIL_DEFECT_TAGS = new Set([
  'KEYBOARD_DEFECT',
  'KEYBOARD_BACKLIGHT_DEFECT',
  'TOUCHPAD_DEFECT',
  'USB_PORT_DEFECT',
  'SPEAKER_DEFECT',
  'WEBCAM_DEFECT',
  'MIC_DEFECT',
  'AUDIO_JACK_DEFECT',
  'WIFI_BT_DEFECT',
  'FINGERPRINT_DEFECT',
  'CHARGING_PORT_DEFECT',
  'FAN_ABNORMAL',
  'THERMAL_OVERHEAT',
  'KEY_MISSING',
  'PORT_MULTIPLE_DEFECT',
  'LIQUID_DAMAGE_HISTORY',
  'BOARD_REPAIR_HISTORY',
  'INTERMITTENT_POWER',
])

const HARD_REVIEW_TAGS = new Set([
  'LOCKED',
  'MAJOR_DAMAGE',
  'DEVICE_NOT_BOOTING',
  'LIQUID_DAMAGE_HISTORY',
  'BOARD_REPAIR_HISTORY',
  'INTERMITTENT_POWER',
  'PORT_MULTIPLE_DEFECT',
])

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

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalize(value: unknown) {
  return clean(value, 1000)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizedFactKey(value: unknown) {
  return clean(value, 200)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/g, '')
}

function tokens(value: unknown) {
  return clean(value, 1000)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function capacityTokens(value: unknown) {
  return tokens(value).filter((token) => /^\d+(?:gb|tb)$/.test(token))
}

function hzTokens(value: unknown) {
  return tokens(value).filter((token) => /^\d+hz$/.test(token))
}

function nominalStorageGb(value: unknown) {
  const raw = clean(value, 1000).toLocaleLowerCase('en-US')
  const match = raw.match(/(\d{2,4}(?:\.\d+)?)\s*(?:gb|g\b)/)
  if (!match) return null
  const gb = Number(match[1])
  if (!Number.isFinite(gb)) return null
  if (gb >= 110 && gb <= 130) return 128
  if (gb >= 220 && gb <= 260) return 256
  if (gb >= 450 && gb <= 520) return 512
  if (gb >= 900 && gb <= 1050) return 1024
  if (gb >= 1800 && gb <= 2100) return 2048
  return Math.round(gb)
}

function isIntegratedGpuText(value: unknown) {
  const raw = clean(value, 1000).toLocaleLowerCase('en-US')
  return /\biris\s*xe\b|\bintel\s+uhd\b|\bintegrated\b|\bigpu\b|\bradeon\s+(?:vega\s*\d*|graphics)\b/.test(raw)
}

function psuWatt(value: unknown) {
  const match = clean(value, 1000).toLocaleLowerCase('en-US').match(/(\d{3,4})\s*w\b/)
  return match ? Number(match[1]) : null
}

function semanticComponentScore(type: string, explicitValue: string, lookupKey: string) {
  const explicitTokens = tokens(explicitValue)
  const keyTokens = tokens(lookupKey)
  if (!explicitTokens.length || !keyTokens.length) return 0

  if (['RAM','SSD','STORAGE'].includes(type)) {
    const explicitCapacity = capacityTokens(explicitValue)
    const keyCapacity = capacityTokens(lookupKey)
    const explicitNominal = type === 'RAM' ? null : nominalStorageGb(explicitValue)
    const keyNominal = type === 'RAM' ? null : nominalStorageGb(lookupKey)
    const nominalMatch = explicitNominal != null && keyNominal != null && explicitNominal === keyNominal
    if (!nominalMatch && (!explicitCapacity.length || !keyCapacity.some((token) => explicitCapacity.includes(token)))) return 0

    if (type === 'RAM') {
      const explicitDdr = explicitTokens.find((token) => /^ddr\d$/.test(token))
      const keyDdr = keyTokens.find((token) => /^ddr\d$/.test(token))
      if (explicitDdr && keyDdr && explicitDdr !== keyDdr) return 0
    }

    const storageKey = keyTokens.some((token) => ['ssd','hdd'].includes(token))
    const explicitStorage = explicitTokens.some((token) => ['ssd','hdd','nvme','m2'].includes(token))
    if (type === 'STORAGE' && storageKey && explicitStorage) {
      const keyKind = keyTokens.includes('hdd') ? 'hdd' : 'ssd'
      const explicitKind = explicitTokens.includes('hdd') ? 'hdd' : 'ssd'
      if (keyKind !== explicitKind) return 0
    }
    if (nominalMatch) return 73500 + String(keyNominal).length
    return 72000 + Math.max(...keyCapacity.filter((token) => explicitCapacity.includes(token)).map((token) => token.length))
  }

  if (type === 'GPU') {
    const lookupIntegrated = /integrated|igpu/i.test(clean(lookupKey))
    if (lookupIntegrated && isIntegratedGpuText(explicitValue)) return 76000
  }

  if (type === 'DISPLAY') {
    const explicitHz = hzTokens(explicitValue)
    const keyHz = hzTokens(lookupKey)
    if (explicitHz.length && keyHz.length && !keyHz.some((token) => explicitHz.includes(token))) {
      const raw = clean(lookupKey).toLocaleLowerCase('en-US')
      if (!explicitHz.some((token) => raw.includes(token.replace('hz', '')))) return 0
    }
    const shared = keyTokens.filter((token) => explicitTokens.includes(token) && token.length >= 3)
    return shared.length >= 1 ? 70000 + shared.reduce((sum, token) => sum + token.length, 0) : 0
  }

  return 0
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

async function loadCase(env: PricingEnv, caseId: string) {
  const rows = await readRows<CaseRow>(await supabaseRequest(
    env,
    'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
      + '&select=id,conversation_id,state,category,title,identity_confidence,condition_completeness,metadata&limit=1',
  ))
  return rows[0] || null
}

async function loadObservations(env: PricingEnv, caseId: string) {
  return readRows<ObservationRow>(await supabaseRequest(env, [
    'ai_buyer_product_observations?select=confirmed,inferred,model_name,model_code,created_at',
    'case_id=eq.' + encodeURIComponent(caseId),
    'order=created_at.desc',
    'limit=8',
  ].join('&')))
}

async function loadVersion(env: PricingEnv) {
  const rows = await readRows<VersionRow>(await supabaseRequest(
    env,
    'ai_buyer_price_book_versions?status=eq.ACTIVE&select=id,version_name,source_name,source_checksum&limit=1',
  ))
  return rows[0] || null
}

async function loadSetting(env: PricingEnv, versionId: string, category: SpecCategory) {
  const rows = await readRows<SpecSettingRow>(await supabaseRequest(env, [
    'ai_buyer_spec_price_settings?select=version_id,category,base_value,target_buy_percent,hard_max_percent,opening_discount_percent,risk_reserve,rounding_step,confidence_gate,metadata',
    'version_id=eq.' + encodeURIComponent(versionId),
    'category=eq.' + encodeURIComponent(category),
    'limit=1',
  ].join('&')))
  return rows[0] || null
}

async function loadEntries(env: PricingEnv, versionId: string, category: SpecCategory) {
  return readRows<SpecEntryRow>(await supabaseRequest(env, [
    'ai_buyer_spec_price_entries?select=id,version_id,category,component_type,lookup_key,normalized_key,numeric_value,confidence,metadata',
    'version_id=eq.' + encodeURIComponent(versionId),
    'category=eq.' + encodeURIComponent(category),
    'active=eq.true',
    'limit=5000',
  ].join('&')))
}

function aggregateFacts(caseRow: CaseRow, observations: ObservationRow[]) {
  const confirmed: Record<string, unknown> = {}
  let modelName = ''
  let modelCode = ''
  for (const observation of [...observations].reverse()) {
    Object.assign(confirmed, safeObject(observation.confirmed))
    if (observation.model_name) modelName = observation.model_name
    if (observation.model_code) modelCode = observation.model_code
  }

  const searchText = [
    caseRow.title,
    modelName,
    modelCode,
    ...Object.values(confirmed).map((value) => clean(value, 500)),
  ].filter(Boolean).join(' ')

  const rawTags = caseRow.metadata?.lastPricingTags
  const tags = Array.isArray(rawTags)
    ? rawTags.map((tag) => clean(tag, 100)).filter(Boolean)
    : []

  return { confirmed, modelName, modelCode, searchText, tags }
}

function factValue(confirmed: Record<string, unknown>, canonical: keyof typeof KEY_ALIASES) {
  const aliases = new Set(KEY_ALIASES[canonical].map(normalizedFactKey))
  for (const [key, value] of Object.entries(confirmed)) {
    if (aliases.has(normalizedFactKey(key))) {
      const output = clean(value, 500)
      if (output) return output
    }
  }
  return ''
}

function componentRows(entries: SpecEntryRow[], type: string) {
  return entries.filter((entry) => entry.component_type === type)
}

function metadataText(entry: SpecEntryRow, key: string) {
  return clean(safeObject(entry.metadata)[key], 500)
}

function matchEntry(
  entries: SpecEntryRow[],
  type: string,
  explicitValue: string,
  searchText: string,
  options: { searchFallback?: boolean } = {},
): Match | null {
  const rows = componentRows(entries, type)
  if (!rows.length) return null
  const explicit = normalize(explicitValue)
  const search = normalize(searchText)

  const candidates = rows.map((entry) => {
    const entryKey = entry.normalized_key || normalize(entry.lookup_key)
    const series = normalize(metadataText(entry, 'series'))
    const brand = normalize(metadataText(entry, 'brand'))
    let score = 0
    let reason = ''

    if (explicit && explicit === entryKey) {
      score = 100000 + entryKey.length
      reason = 'EXACT'
    } else if (explicit && entryKey && (explicit.includes(entryKey) || entryKey.includes(explicit))) {
      score = 80000 + Math.min(explicit.length, entryKey.length)
      reason = 'EXPLICIT_CONTAINS'
    } else if (explicit && type === 'SERIES' && series && explicit.includes(series)) {
      score = 76000 + series.length + (brand && search.includes(brand) ? 500 : 0)
      reason = 'SERIES_EXPLICIT'
    } else if (explicit) {
      const semantic = semanticComponentScore(type, explicitValue, entry.lookup_key)
      if (semantic > 0) {
        score = semantic
        reason = 'SEMANTIC_COMPONENT_MATCH'
      }
    }
    if (!score && options.searchFallback && entryKey && search.includes(entryKey)) {
      score = 60000 + entryKey.length
      reason = 'SEARCH_KEY'
    } else if (options.searchFallback && type === 'SERIES' && series && search.includes(series)) {
      score = 58000 + series.length + (brand && search.includes(brand) ? 500 : 0)
      reason = 'SEARCH_SERIES'
    }

    return { entry, score, reason }
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score)

  return candidates[0]
    ? { entry: candidates[0].entry, reason: candidates[0].reason }
    : null
}

function findByKey(entries: SpecEntryRow[], type: string, key: string) {
  const wanted = normalize(key)
  return componentRows(entries, type).find((entry) => (
    (entry.normalized_key || normalize(entry.lookup_key)) === wanted
  )) || null
}

function confidenceScore(value: Confidence) {
  if (value === 'HIGH') return 0.97
  if (value === 'MEDIUM') return 0.88
  if (value === 'LOW') return 0.72
  return 0.90
}

function roundTo(value: number, step: number) {
  const safeStep = Math.max(1, Math.round(step || 100))
  return Math.max(0, Math.round(value / safeStep) * safeStep)
}

function normalizeMoney(opening: number, target: number, hardMax: number) {
  const hard = Math.max(0, Math.round(hardMax))
  const targetSafe = Math.max(0, Math.min(hard, Math.round(target)))
  const openingSafe = Math.max(0, Math.min(targetSafe, Math.round(opening)))
  return { opening: openingSafe, target: targetSafe, hardMax: hard }
}

function isReviewEntry(entry: SpecEntryRow | null) {
  return clean(entry?.metadata?.auto, 30).toUpperCase() === 'REVIEW'
}

function trace(match: Match | null, type: string): ComponentTrace | null {
  if (!match) return null
  return {
    type,
    key: match.entry.lookup_key,
    amount: numberValue(match.entry.numeric_value),
    confidence: match.entry.confidence,
    reason: match.reason,
  }
}

function parseDefectText(
  entries: SpecEntryRow[],
  confirmed: Record<string, unknown>,
  tags: string[],
) {
  const output: SpecEntryRow[] = []
  const defectText = normalize(factValue(confirmed, 'defects'))
  const defectRows = componentRows(entries, 'DEFECT')

  for (const tag of tags) {
    if (!DETAIL_DEFECT_TAGS.has(tag)) continue
    const row = findByKey(entries, 'DEFECT', tag)
    if (row && !output.some((value) => value.id === row.id)) output.push(row)
  }

  if (defectText) {
    const naturalHints: Array<[RegExp, string]> = [
      [/keyboard|key.*not|ปุ่ม|คีย์บอร์ด/, 'KEYBOARD_DEFECT'],
      [/touchpad|trackpad|ทัชแพด/, 'TOUCHPAD_DEFECT'],
      [/usb/, 'USB_PORT_DEFECT'],
      [/speaker|ลำโพง/, 'SPEAKER_DEFECT'],
      [/webcam|camera.*not|กล้อง/, 'WEBCAM_DEFECT'],
      [/wifi|wi-fi|bluetooth/, 'WIFI_BT_DEFECT'],
      [/charge|charging|ชาร์จ/, 'CHARGING_PORT_DEFECT'],
      [/fan|พัดลม/, 'FAN_ABNORMAL'],
      [/overheat|ร้อนจัด|ความร้อน/, 'THERMAL_OVERHEAT'],
      [/water|liquid|น้ำเข้า/, 'LIQUID_DAMAGE_HISTORY'],
      [/board.*repair|ซ่อมบอร์ด|รีบอล/, 'BOARD_REPAIR_HISTORY'],
      [/ดับเอง|เปิดติดบ้าง|intermittent/, 'INTERMITTENT_POWER'],
    ]
    const raw = clean(factValue(confirmed, 'defects'), 1000).toLocaleLowerCase('en-US')
    for (const [pattern, key] of naturalHints) {
      if (!pattern.test(raw)) continue
      const row = defectRows.find((entry) => entry.lookup_key === key)
      if (row && !output.some((value) => value.id === row.id)) output.push(row)
    }
  }

  return output.slice(0, 3)
}

function choosePcSystemClass(entries: SpecEntryRow[], explicit: string, searchText: string) {
  const direct = matchEntry(entries, 'SYSTEM_CLASS', explicit, searchText, { searchFallback: false })
  if (direct) return direct
  const search = clean(searchText).toLocaleLowerCase('en-US')
  if (/workstation|precision|z\d{3}|xeon|quadro/.test(search)) {
    const row = findByKey(entries, 'SYSTEM_CLASS', 'LEGACY_WORKSTATION')
    if (row) return { entry: row, reason: 'DERIVED_WORKSTATION' }
  }
  const gaming = findByKey(entries, 'SYSTEM_CLASS', 'BALANCED_GAMING')
  return gaming ? { entry: gaming, reason: 'DERIVED_BALANCED_GAMING' } : null
}

function pcBroadMatch(entries: SpecEntryRow[], type: string, explicit: string) {
  const direct = matchEntry(entries, type, explicit, '', { searchFallback: false })
  if (direct) return direct
  const normalized = normalize(explicit)
  if (!normalized) return null

  if (type === 'PSU') {
    const raw = clean(explicit).toLocaleLowerCase('en-US')
    const watt = psuWatt(explicit)
    const rated = /bronze|gold|platinum|titanium|80\s*plus|80\+/.test(raw)
    if (watt && !rated) {
      const unknown = findByKey(entries, 'PSU', 'No-name / unknown')
      if (unknown) return { entry: unknown, reason: 'PSU_UNRATED_CONSERVATIVE' }
    }
  }

  const candidates = componentRows(entries, type).map((entry) => {
    const label = clean(entry.lookup_key)
    const variants = label.split(/[\/|]/).map(normalize).filter((value) => value.length >= 3)
    const hit = variants.filter((value) => normalized.includes(value))
    return {
      entry,
      score: hit.length ? Math.max(...hit.map((value) => value.length)) : 0,
    }
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score)

  return candidates[0] ? { entry: candidates[0].entry, reason: 'BROAD_CLASS_MATCH' } : null
}

function buildNotebook(
  entries: SpecEntryRow[],
  setting: SpecSettingRow,
  facts: ReturnType<typeof aggregateFacts>,
) {
  const brand = matchEntry(entries, 'BRAND', factValue(facts.confirmed, 'brand'), facts.searchText, { searchFallback: true })
  const series = matchEntry(entries, 'SERIES', factValue(facts.confirmed, 'series'), facts.searchText, { searchFallback: true })
  const cpu = matchEntry(entries, 'CPU', factValue(facts.confirmed, 'cpu'), facts.searchText, { searchFallback: true })
  const gpu = matchEntry(entries, 'GPU', factValue(facts.confirmed, 'gpu'), facts.searchText, { searchFallback: true })
  const ram = matchEntry(entries, 'RAM', factValue(facts.confirmed, 'ram'), '', { searchFallback: false })
  const ssd = matchEntry(entries, 'SSD', factValue(facts.confirmed, 'storage'), '', { searchFallback: false })
  const display = matchEntry(entries, 'DISPLAY', factValue(facts.confirmed, 'display'), '', { searchFallback: false })
  const warranty = matchEntry(entries, 'WARRANTY', factValue(facts.confirmed, 'warranty'), '', { searchFallback: false })
    || (findByKey(entries, 'WARRANTY', 'None')
      ? { entry: findByKey(entries, 'WARRANTY', 'None') as SpecEntryRow, reason: 'DEFAULT_NONE' }
      : null)

  const missing = [
    ['brand', brand], ['series', series], ['cpu', cpu], ['gpu', gpu], ['ram', ram], ['storage', ssd],
  ].filter(([, value]) => !value).map(([key]) => key)

  const unmappedDisplay = !display && Boolean(factValue(facts.confirmed, 'display'))
  if (missing.length || unmappedDisplay) {
    return {
      ok: false as const,
      reason: missing.length ? 'SPEC_REQUIRED_COMPONENT_MISSING' : 'SPEC_COMPONENT_UNMAPPED',
      detail: { missing, unmappedDisplay },
    }
  }

  const traces = [
    trace(brand, 'BRAND'),
    trace(series, 'SERIES'),
    trace(cpu, 'CPU'),
    trace(gpu, 'GPU'),
    trace(ram, 'RAM'),
    trace(ssd, 'SSD'),
    trace(display, 'DISPLAY'),
    trace(warranty, 'WARRANTY'),
  ].filter(Boolean) as ComponentTrace[]

  const lowCore = traces.filter((item) => ['CPU','GPU'].includes(item.type) && item.confidence === 'LOW')
  if (lowCore.length) {
    return {
      ok: false as const,
      reason: 'SPEC_LOW_CONFIDENCE_COMPONENT',
      detail: { components: lowCore.map((item) => ({ type: item.type, key: item.key })) },
    }
  }

  const conditionEntries: SpecEntryRow[] = []
  for (const tag of facts.tags) {
    const mapped = CONDITION_TAG_MAP[tag]
    if (!mapped) continue
    const row = findByKey(entries, 'CONDITION', mapped)
    if (row && !conditionEntries.some((item) => item.id === row.id)) conditionEntries.push(row)
  }
  const explicitCondition = factValue(facts.confirmed, 'condition')
  const conditionMatch = explicitCondition
    ? matchEntry(entries, 'CONDITION', explicitCondition, '', { searchFallback: false })
    : null
  if (conditionMatch && !conditionEntries.some((item) => item.id === conditionMatch.entry.id)) {
    conditionEntries.push(conditionMatch.entry)
  }

  const defects = parseDefectText(entries, facts.confirmed, facts.tags)
  const reviewEntries = [...conditionEntries, ...defects].filter(isReviewEntry)
  if (facts.tags.some((tag) => HARD_REVIEW_TAGS.has(tag)) || reviewEntries.length) {
    return {
      ok: false as const,
      reason: 'SPEC_COMPLEX_CONDITION_REQUIRES_ADMIN',
      detail: {
        tags: facts.tags,
        reviewKeys: reviewEntries.map((entry) => entry.lookup_key),
      },
    }
  }

  const adjustmentTraces: ComponentTrace[] = [
    ...conditionEntries.map((entry) => ({
      type: 'CONDITION',
      key: entry.lookup_key,
      amount: numberValue(entry.numeric_value),
      confidence: entry.confidence,
      reason: 'PRICING_TAG_OR_EXPLICIT',
    })),
    ...defects.map((entry) => ({
      type: 'DEFECT',
      key: entry.lookup_key,
      amount: numberValue(entry.numeric_value),
      confidence: entry.confidence,
      reason: 'DEFECT',
    })),
  ]

  const allTraces = [...traces, ...adjustmentTraces]
  const preLiquidity = numberValue(setting.base_value)
    + allTraces.reduce((sum, item) => sum + item.amount, 0)
  const liquidityFactor = Math.max(
    0.5,
    Math.min(1.2, numberValue(series?.entry.metadata?.liquidityFactor, 1)),
  )
  const estimatedResale = roundTo(preLiquidity * liquidityFactor, setting.rounding_step)

  return {
    ok: true as const,
    estimatedResale,
    traces: allTraces,
    liquidityFactor,
    componentConfidence: allTraces.length
      ? allTraces.reduce((sum, item) => sum + confidenceScore(item.confidence), 0) / allTraces.length
      : 0,
    notes: display ? [] : ['DISPLAY_BASELINE_ZERO'],
  }
}

function buildDesktop(
  entries: SpecEntryRow[],
  setting: SpecSettingRow,
  facts: ReturnType<typeof aggregateFacts>,
) {
  const cpu = matchEntry(entries, 'CPU', factValue(facts.confirmed, 'cpu'), facts.searchText, { searchFallback: true })
  const gpu = matchEntry(entries, 'GPU', factValue(facts.confirmed, 'gpu'), facts.searchText, { searchFallback: true })
  const ram = matchEntry(entries, 'RAM', factValue(facts.confirmed, 'ram'), '', { searchFallback: false })
  const storage = matchEntry(entries, 'STORAGE', factValue(facts.confirmed, 'primary_storage') || factValue(facts.confirmed, 'storage'), '', { searchFallback: false })
  const motherboard = pcBroadMatch(entries, 'MOTHERBOARD', factValue(facts.confirmed, 'motherboard'))
  const psu = pcBroadMatch(entries, 'PSU', factValue(facts.confirmed, 'psu'))
  const pcCase = pcBroadMatch(entries, 'CASE', factValue(facts.confirmed, 'case'))
    || (findByKey(entries, 'CASE', 'Old/basic')
      ? { entry: findByKey(entries, 'CASE', 'Old/basic') as SpecEntryRow, reason: 'DEFAULT_BASIC' }
      : null)
  const cooler = pcBroadMatch(entries, 'COOLER', factValue(facts.confirmed, 'cooler'))
    || (findByKey(entries, 'COOLER', 'Stock / basic')
      ? { entry: findByKey(entries, 'COOLER', 'Stock / basic') as SpecEntryRow, reason: 'DEFAULT_BASIC' }
      : null)
  const systemClass = choosePcSystemClass(entries, factValue(facts.confirmed, 'system_class'), facts.searchText)

  const missing = [
    ['cpu', cpu], ['gpu', gpu], ['ram', ram], ['storage', storage],
    ['motherboard', motherboard], ['psu', psu], ['system_class', systemClass],
  ].filter(([, value]) => !value).map(([key]) => key)

  if (missing.length) {
    return { ok: false as const, reason: 'SPEC_REQUIRED_COMPONENT_MISSING', detail: { missing } }
  }

  if (facts.tags.some((tag) => HARD_REVIEW_TAGS.has(tag))) {
    return {
      ok: false as const,
      reason: 'SPEC_COMPLEX_CONDITION_REQUIRES_ADMIN',
      detail: { tags: facts.tags },
    }
  }

  const traces = [
    trace(cpu, 'CPU'),
    trace(gpu, 'GPU'),
    trace(motherboard, 'MOTHERBOARD'),
    trace(ram, 'RAM'),
    trace(storage, 'STORAGE'),
    trace(psu, 'PSU'),
    trace(pcCase, 'CASE'),
    trace(cooler, 'COOLER'),
    trace(systemClass, 'SYSTEM_CLASS'),
  ].filter(Boolean) as ComponentTrace[]

  const lowCore = traces.filter((item) => ['CPU','GPU'].includes(item.type) && item.confidence === 'LOW')
  if (lowCore.length) {
    return {
      ok: false as const,
      reason: 'SPEC_LOW_CONFIDENCE_COMPONENT',
      detail: { components: lowCore.map((item) => ({ type: item.type, key: item.key })) },
    }
  }

  const explicitCondition = factValue(facts.confirmed, 'condition')
  const condition = explicitCondition
    ? matchEntry(entries, 'CONDITION', explicitCondition, '', { searchFallback: false })
    : null
  if (condition?.entry && isReviewEntry(condition.entry)) {
    return {
      ok: false as const,
      reason: 'SPEC_COMPLEX_CONDITION_REQUIRES_ADMIN',
      detail: { condition: condition.entry.lookup_key },
    }
  }
  if (condition) {
    const item = trace(condition, 'CONDITION')
    if (item) traces.push(item)
  }

  const preLiquidity = numberValue(setting.base_value)
    + traces.reduce((sum, item) => sum + item.amount, 0)
  const liquidityFactor = Math.max(
    0.5,
    Math.min(1.2, numberValue(systemClass?.entry.metadata?.liquidityFactor, 1)),
  )
  const estimatedResale = roundTo(preLiquidity * liquidityFactor, setting.rounding_step)

  return {
    ok: true as const,
    estimatedResale,
    traces,
    liquidityFactor,
    componentConfidence: traces.length
      ? traces.reduce((sum, item) => sum + confidenceScore(item.confidence), 0) / traces.length
      : 0,
    notes: [
      ...(pcCase?.reason === 'DEFAULT_BASIC' ? ['CASE_DEFAULT_BASIC'] : []),
      ...(cooler?.reason === 'DEFAULT_BASIC' ? ['COOLER_DEFAULT_BASIC'] : []),
    ],
  }
}

async function createDecision(
  env: PricingEnv,
  input: {
    caseId: string
    versionId: string
    estimatedResale: number
    opening: number
    target: number
    hardMax: number
    confidence: number
    traces: ComponentTrace[]
    rationale: Record<string, unknown>
  },
) {
  const rows = await readRows<PricingDecision>(await supabaseRequest(env, 'ai_buyer_pricing_decisions', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      case_id: input.caseId,
      price_source: 'PRICE_BOOK',
      price_book_version_id: input.versionId,
      price_book_entry_id: null,
      estimated_resale: input.estimatedResale,
      opening_offer: input.opening,
      target_buy: input.target,
      hard_max: input.hardMax,
      current_authorized_offer: input.opening,
      pricing_confidence: clamp01(input.confidence),
      adjustments: input.traces,
      comparables: [],
      rationale: input.rationale,
    }),
  }))
  if (!rows[0]) throw new Error('SPEC_PRICING_DECISION_CREATE_EMPTY')
  return rows[0]
}

async function setPricingSuccess(
  env: PricingEnv,
  caseRow: CaseRow,
  decision: PricingDecision,
  version: VersionRow,
) {
  await patchRows(env, 'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseRow.id), {
    state: 'PRICING',
    metadata: {
      ...(caseRow.metadata || {}),
      pricingDecisionId: decision.id,
      pricingSource: 'PRICE_BOOK_SPEC',
      pricingReadyAt: new Date().toISOString(),
      priceBookVersion: version.version_name,
      priceBookSourceChecksum: version.source_checksum,
    },
  })
}

async function escalate(
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

  const existing = await readRows<{ id: string }>(await supabaseRequest(env, [
    'ai_buyer_admin_tasks?select=id',
    'case_id=eq.' + encodeURIComponent(caseRow.id),
    'task_type=eq.PRICING_REVIEW',
    'status=in.(ACTION_REQUIRED,IN_PROGRESS)',
    'limit=1',
  ].join('&')))

  if (!existing[0]) {
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
    if (!task.ok) console.error('AI BUYER spec pricing review task insert failed', task.status)
  }

  return { ok: false as const, humanReview: true as const, reason }
}

export async function runSpecPricingForCase(
  env: PricingEnv,
  caseId: string,
): Promise<SpecPricingResult> {
  const caseRow = await loadCase(env, caseId)
  if (!caseRow) return { handled: true, result: { ok: false, reason: 'CASE_NOT_FOUND' } }

  if (caseRow.category !== 'NOTEBOOK' && caseRow.category !== 'DESKTOP_PC') {
    return { handled: false }
  }

  const category = caseRow.category as SpecCategory
  if (caseRow.state !== 'READY_TO_PRICE' && caseRow.state !== 'PRICING') {
    return { handled: true, result: { ok: false, reason: 'CASE_NOT_READY' } }
  }

  const identityGate = category === 'DESKTOP_PC' ? 0.65 : 0.80
  if (numberValue(caseRow.identity_confidence) < identityGate) {
    return {
      handled: true,
      result: await escalate(env, caseRow, 'PRICING_GATE_NOT_MET', {
        identityConfidence: caseRow.identity_confidence,
        requiredIdentityConfidence: identityGate,
        conditionCompleteness: caseRow.condition_completeness,
        policy: 'SPEC_COMPLETE_CAN_PRICE_WITH_CONDITION_UNKNOWN',
      }),
    }
  }

  const [version, observations] = await Promise.all([
    loadVersion(env),
    loadObservations(env, caseId),
  ])

  if (!version) {
    return {
      handled: true,
      result: await escalate(env, caseRow, 'SPEC_PRICE_BOOK_NOT_CONFIGURED', { activeVersion: null }),
    }
  }

  const [setting, entries] = await Promise.all([
    loadSetting(env, version.id, category),
    loadEntries(env, version.id, category),
  ])

  if (!setting || !entries.length) {
    return {
      handled: true,
      result: await escalate(env, caseRow, 'SPEC_PRICE_BOOK_NOT_CONFIGURED', {
        activeVersion: version.version_name,
        setting: Boolean(setting),
        entryCount: entries.length,
      }),
    }
  }

  const facts = aggregateFacts(caseRow, observations)
  if (facts.tags.some((tag) => HARD_REVIEW_TAGS.has(tag))) {
    return {
      handled: true,
      result: await escalate(env, caseRow, 'SPEC_COMPLEX_CONDITION_REQUIRES_ADMIN', {
        tags: facts.tags,
      }),
    }
  }

  const built = category === 'NOTEBOOK'
    ? buildNotebook(entries, setting, facts)
    : buildDesktop(entries, setting, facts)

  if (!built.ok) {
    return {
      handled: true,
      result: await escalate(env, caseRow, built.reason, built.detail),
    }
  }

  if (built.estimatedResale <= 0) {
    return {
      handled: true,
      result: await escalate(env, caseRow, 'SPEC_PRICE_NONPOSITIVE'),
    }
  }

  const target = roundTo(
    built.estimatedResale * numberValue(setting.target_buy_percent) - numberValue(setting.risk_reserve),
    setting.rounding_step,
  )
  const hardMax = roundTo(
    built.estimatedResale * numberValue(setting.hard_max_percent) - numberValue(setting.risk_reserve),
    setting.rounding_step,
  )
  const opening = roundTo(
    target * (1 - numberValue(setting.opening_discount_percent)),
    setting.rounding_step,
  )
  const prices = normalizeMoney(opening, target, hardMax)

  const confidence = Math.min(
    0.98,
    0.69
      + clamp01(caseRow.identity_confidence) * 0.10
      + clamp01(caseRow.condition_completeness) * 0.03
      + clamp01(built.componentConfidence) * 0.18,
  )

  if (confidence < numberValue(setting.confidence_gate, 0.90) || prices.hardMax <= 0) {
    return {
      handled: true,
      result: await escalate(env, caseRow, 'SPEC_PRICING_CONFIDENCE_LOW', {
        confidence,
        required: setting.confidence_gate,
        componentConfidence: built.componentConfidence,
      }),
    }
  }

  const decision = await createDecision(env, {
    caseId,
    versionId: version.id,
    estimatedResale: built.estimatedResale,
    opening: prices.opening,
    target: prices.target,
    hardMax: prices.hardMax,
    confidence,
    traces: built.traces,
    rationale: {
      mode: 'SPEC_COMPONENTS_V1',
      category,
      version: version.version_name,
      sourceName: version.source_name,
      sourceChecksum: version.source_checksum,
      liquidityFactor: built.liquidityFactor,
      notes: [
        ...built.notes,
        ...(numberValue(caseRow.condition_completeness) < 0.75 ? ['CONDITION_NOT_FULLY_VERIFIED'] : []),
      ],
      conditionCompleteness: numberValue(caseRow.condition_completeness),
      formula: {
        baseValue: setting.base_value,
        targetBuyPercent: setting.target_buy_percent,
        hardMaxPercent: setting.hard_max_percent,
        openingDiscountPercent: setting.opening_discount_percent,
        riskReserve: setting.risk_reserve,
        roundingStep: setting.rounding_step,
      },
      specs: {
        brand: factValue(facts.confirmed, 'brand'),
        series: factValue(facts.confirmed, 'series'),
        cpu: factValue(facts.confirmed, 'cpu'),
        gpu: factValue(facts.confirmed, 'gpu'),
        ram: factValue(facts.confirmed, 'ram'),
        storage: factValue(facts.confirmed, 'storage'),
        display: factValue(facts.confirmed, 'display'),
        motherboard: factValue(facts.confirmed, 'motherboard'),
        psu: factValue(facts.confirmed, 'psu'),
      },
    },
  })

  await setPricingSuccess(env, caseRow, decision, version)
  return {
    handled: true,
    result: {
      ok: true as const,
      source: 'PRICE_BOOK_SPEC' as const,
      decision,
      version: version.version_name,
      traces: built.traces,
    },
  }
}
