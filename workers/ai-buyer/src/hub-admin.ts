export interface HubAdminEnv {
  IMAGES: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  AI_BUYER_HUB_ORIGINS?: string
  OPENAI_ADMIN_KEY?: string
  LINE_CHANNEL_ACCESS_TOKEN: string
}

type HubUser = { id: string; email?: string | null }
type HubProfile = {
  id: string
  display_name?: string | null
  role: 'owner' | 'admin' | 'sales' | 'technician'
  active: boolean
}

type CaseRow = {
  id: string
  conversation_id: string
  customer_id: string
  state: string
  category: string | null
  title: string | null
  control_mode: string
  identity_confidence: number
  spec_completeness: number
  condition_completeness: number
  pricing_readiness: number
  accepted_price: number | null
  accepted_at: string | null
  created_at: string
  updated_at: string
}


type OpenAICostBucket = {
  start_time: number
  end_time: number
  results?: Array<{
    amount?: { value?: number | string; currency?: string }
    line_item?: string | null
    project_id?: string | null
  }>
}

type OpenAIUsageBucket = {
  start_time: number
  end_time: number
  results?: Array<{
    input_tokens?: number
    output_tokens?: number
    input_cached_tokens?: number
    num_model_requests?: number
    model?: string | null
  }>
}

type OpenAIPage<T> = {
  data?: T[]
  has_more?: boolean
  next_page?: string | null
}

function utcDayStartSeconds(now = new Date()) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000)
}

function utcMonthStartSeconds(now = new Date()) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000)
}

async function openAIOrganizationPages<T>(
  env: HubAdminEnv,
  path: string,
  params: Record<string, string>,
): Promise<T[]> {
  const adminKey = clean(env.OPENAI_ADMIN_KEY, 3000)
  if (!adminKey) throw new Error('OPENAI_ADMIN_KEY_NOT_CONFIGURED')

  const rows: T[] = []
  let page: string | null = null
  for (let index = 0; index < 10; index += 1) {
    const url = new URL('https://api.openai.com' + path)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    if (page) url.searchParams.set('page', page)

    const result = await fetch(url.toString(), {
      headers: {
        authorization: 'Bearer ' + adminKey,
        accept: 'application/json',
      },
    })
    const raw = await result.text()
    if (!result.ok) {
      throw new Error('OPENAI_ORG_' + result.status + ':' + raw.slice(0, 300))
    }
    const body = raw ? JSON.parse(raw) as OpenAIPage<T> : {}
    if (Array.isArray(body.data)) rows.push(...body.data)
    if (!body.has_more || !body.next_page) break
    page = body.next_page
  }
  return rows
}

function blankOpenAISpend(status: 'not_configured' | 'unavailable', error?: string) {
  return {
    status,
    scope: 'organization' as const,
    currency: 'usd',
    timezone: 'UTC',
    today: null,
    last7Days: null,
    monthToDate: null,
    requestsMonthToDate: null,
    tokensMonthToDate: {
      input: null,
      cachedInput: null,
      output: null,
      total: null,
    },
    byModel: [] as Array<{
      model: string
      requests: number
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
      totalTokens: number
    }>,
    daily: [] as Array<{ date: string; amount: number }>,
    updatedAt: new Date().toISOString(),
    error: error ? clean(error, 300) : null,
  }
}

async function loadOpenAISpend(env: HubAdminEnv) {
  if (!clean(env.OPENAI_ADMIN_KEY, 3000)) return blankOpenAISpend('not_configured')

  const now = new Date()
  const todayStart = utcDayStartSeconds(now)
  const monthStart = utcMonthStartSeconds(now)
  const last7Start = todayStart - (6 * 86400)
  const costStart = Math.min(monthStart, last7Start)
  const endTime = Math.floor(now.getTime() / 1000) + 1

  try {
    const costBuckets = await openAIOrganizationPages<OpenAICostBucket>(
      env,
      '/v1/organization/costs',
      {
        start_time: String(costStart),
        end_time: String(endTime),
        bucket_width: '1d',
        limit: '60',
      },
    )

    const daily = costBuckets.map((bucket) => ({
      date: new Date(bucket.start_time * 1000).toISOString().slice(0, 10),
      startTime: bucket.start_time,
      amount: (bucket.results || []).reduce((sum, item) => {
        const value = Number(item.amount?.value ?? 0)
        return sum + (Number.isFinite(value) ? value : 0)
      }, 0),
    }))

    const sumSince = (start: number) => daily
      .filter((item) => item.startTime >= start)
      .reduce((sum, item) => sum + item.amount, 0)

    let requests = 0
    let inputTokens = 0
    let cachedInputTokens = 0
    let outputTokens = 0
    const modelMap = new Map<string, {
      model: string
      requests: number
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
      totalTokens: number
    }>()

    try {
      const usageBuckets = await openAIOrganizationPages<OpenAIUsageBucket>(
        env,
        '/v1/organization/usage/completions',
        {
          start_time: String(monthStart),
          end_time: String(endTime),
          bucket_width: '1d',
          limit: '31',
          group_by: 'model',
        },
      )
      for (const bucket of usageBuckets) {
        for (const item of bucket.results || []) {
          const model = clean(item.model, 120) || 'unknown'
          const requestCount = Number(item.num_model_requests || 0)
          const input = Number(item.input_tokens || 0)
          const cached = Number(item.input_cached_tokens || 0)
          const output = Number(item.output_tokens || 0)
          requests += Number.isFinite(requestCount) ? requestCount : 0
          inputTokens += Number.isFinite(input) ? input : 0
          cachedInputTokens += Number.isFinite(cached) ? cached : 0
          outputTokens += Number.isFinite(output) ? output : 0

          const current = modelMap.get(model) || {
            model,
            requests: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          }
          current.requests += Number.isFinite(requestCount) ? requestCount : 0
          current.inputTokens += Number.isFinite(input) ? input : 0
          current.cachedInputTokens += Number.isFinite(cached) ? cached : 0
          current.outputTokens += Number.isFinite(output) ? output : 0
          current.totalTokens = current.inputTokens + current.outputTokens
          modelMap.set(model, current)
        }
      }
    } catch (usageError) {
      console.warn('AI BUYER OpenAI usage read failed', usageError)
    }

    return {
      status: 'live' as const,
      scope: 'organization' as const,
      currency: 'usd',
      timezone: 'UTC',
      today: sumSince(todayStart),
      last7Days: sumSince(last7Start),
      monthToDate: sumSince(monthStart),
      requestsMonthToDate: requests,
      tokensMonthToDate: {
        input: inputTokens,
        cachedInput: cachedInputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      byModel: Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
      daily: daily
        .filter((item) => item.startTime >= monthStart)
        .map(({ date, amount }) => ({ date, amount })),
      updatedAt: new Date().toISOString(),
      error: null,
    }
  } catch (error) {
    console.error('AI BUYER OpenAI cost read failed', error)
    return blankOpenAISpend(
      'unavailable',
      String((error as Error)?.message || error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]'),
    )
  }
}

function clean(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function origins(env: HubAdminEnv) {
  return clean(env.AI_BUYER_HUB_ORIGINS || 'https://hub.amphon.co.th,http://localhost:5173,http://127.0.0.1:5173', 1000)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function corsOrigin(request: Request, env: HubAdminEnv) {
  const origin = request.headers.get('origin') || ''
  if (!origin) return ''
  return origins(env).includes(origin) ? origin : ''
}

export function hubAdminResponse(
  request: Request,
  env: HubAdminEnv,
  data: unknown,
  status = 200,
) {
  const origin = corsOrigin(request, env)
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'vary': 'Origin',
  }
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-methods'] = 'GET,POST,OPTIONS'
    headers['access-control-allow-headers'] = 'authorization,content-type'
    headers['access-control-max-age'] = '86400'
  }
  return new Response(JSON.stringify(data), { status, headers })
}

export function handleHubAdminPreflight(request: Request, env: HubAdminEnv) {
  const origin = corsOrigin(request, env)
  if (!origin) return hubAdminResponse(request, env, { ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403)
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-max-age': '86400',
      'vary': 'Origin',
    },
  })
}

function serviceHeaders(env: HubAdminEnv) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
    accept: 'application/json',
  }
}

async function serviceRows<T>(env: HubAdminEnv, path: string): Promise<T[]> {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    headers: serviceHeaders(env),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error('AI_BUYER_HUB_DB_' + response.status + ':' + detail.slice(0, 500))
  }
  const text = await response.text()
  return text ? JSON.parse(text) as T[] : []
}

async function serviceWrite<T>(
  env: HubAdminEnv,
  path: string,
  init: RequestInit,
): Promise<T[]> {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    ...init,
    headers: {
      ...serviceHeaders(env),
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error('AI_BUYER_HUB_DB_' + response.status + ':' + detail.slice(0, 800))
  }
  const text = await response.text()
  return text ? JSON.parse(text) as T[] : []
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function moneyValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

async function authenticateAdmin(request: Request, env: HubAdminEnv) {
  const authorization = request.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED')
  const userResponse = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
    headers: {
      authorization,
      apikey: env.SUPABASE_SECRET_KEY,
      accept: 'application/json',
    },
  })
  if (!userResponse.ok) throw new Error('AUTH_INVALID')
  const user = await userResponse.json() as HubUser
  if (!user?.id) throw new Error('AUTH_INVALID')

  const profiles = await serviceRows<HubProfile>(
    env,
    'profiles?id=eq.' + encodeURIComponent(user.id)
      + '&select=id,display_name,role,active&limit=1',
  )
  const profile = profiles[0]
  if (!profile?.active || !['owner', 'admin'].includes(profile.role)) {
    throw new Error('ADMIN_ACCESS_DENIED')
  }
  return { user, profile }
}

function numberValue(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function firstByCase<T extends { case_id: string }>(rows: T[]) {
  const map = new Map<string, T>()
  for (const row of rows) if (!map.has(row.case_id)) map.set(row.case_id, row)
  return map
}

function countByCase<T extends { case_id: string }>(rows: T[]) {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.case_id, (map.get(row.case_id) || 0) + 1)
  return map
}

export async function handleHubAdminChatList(request: Request, env: HubAdminEnv) {
  try {
    const auth = await authenticateAdmin(request, env)
    const url = new URL(request.url)
    const rawLimit = Number(url.searchParams.get('limit') || 120)
    const limit = Math.max(20, Math.min(200, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 120))

    const rows = await serviceWrite<any>(
      env,
      'rpc/ai_buyer_chat_list_for_user',
      {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          p_user_id: auth.user.id,
          p_limit: limit,
        }),
      },
    )

    return hubAdminResponse(request, env, {
      ok: true,
      cases: rows.map((row) => ({
        id: row.case_id,
        title: row.title || 'ยังไม่ระบุสินค้า',
        category: row.category || null,
        state: row.state,
        controlMode: row.control_mode,
        customer: {
          displayName: row.display_name || null,
          pictureUrl: row.picture_url || null,
          phone: row.phone || null,
        },
        imageCount: Number(row.image_count || 0),
        lastMessage: row.last_message_type ? {
          type: row.last_message_type,
          text: row.last_message_text || null,
          createdAt: row.last_message_at || null,
        } : null,
        offer: row.latest_offer_amount != null ? {
          amount: numberValue(row.latest_offer_amount),
          status: row.latest_offer_status || null,
          createdAt: row.latest_offer_at || null,
        } : null,
        updatedAt: row.updated_at,
        lastActivityAt: row.last_activity_at || row.updated_at,
        unreadCount: Number(row.unread_count || 0),
      })),
      unreadTotal: rows.reduce((sum, row) => sum + Number(row.unread_count || 0), 0),
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminChatCase(request: Request, env: HubAdminEnv) {
  try {
    await authenticateAdmin(request, env)
    const url = new URL(request.url)
    const caseId = clean(url.searchParams.get('caseId'), 100)
    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }

    const cases = await serviceRows<any>(
      env,
      'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
        + '&select=id,conversation_id,customer_id,state,category,title,control_mode,accepted_price,accepted_at,updated_at&limit=1',
    )
    const caseRow = cases[0]
    if (!caseRow) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_NOT_FOUND' }, 404)
    }

    const [customers, rawMessages, pricing, images] = await Promise.all([
      serviceRows<any>(
        env,
        'ai_buyer_customers?id=eq.' + encodeURIComponent(caseRow.customer_id)
          + '&select=id,display_name,picture_url,phone&limit=1',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_messages?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,line_message_id,direction,message_type,text_content,metadata,line_timestamp,created_at'
          + '&order=created_at.desc&limit=121',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_pricing_decisions?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,current_authorized_offer,target_buy,hard_max,created_at'
          + '&order=created_at.desc&limit=1',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_case_images?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,message_id,line_message_id,storage_key,mime_type,byte_size,analysis_status,created_at'
          + '&order=created_at.desc&limit=200',
      ),
    ])

    const hasMore = rawMessages.length > 120
    const messages = rawMessages.slice(0, 120).reverse()
    const messageIds = new Set(messages.map((m: any) => m.id))
    const lineIds = new Set(messages.map((m: any) => m.line_message_id).filter(Boolean))
    const visibleImages = images
      .filter((img: any) =>
        (img.message_id && messageIds.has(img.message_id))
        || (img.line_message_id && lineIds.has(img.line_message_id)),
      )
      .reverse()

    return hubAdminResponse(request, env, {
      ok: true,
      case: caseRow,
      customer: customers[0] || null,
      messages,
      pricing: pricing[0] || null,
      images: visibleImages,
      hasMore,
      oldestMessageAt: messages[0]?.created_at || null,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminChatUnread(request: Request, env: HubAdminEnv) {
  try {
    const auth = await authenticateAdmin(request, env)
    const rows = await serviceWrite<any>(
      env,
      'rpc/ai_buyer_chat_unread_total',
      {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({ p_user_id: auth.user.id }),
      },
    )
    const payload = rows as unknown as any
    const total = Number(
      Array.isArray(payload)
        ? (payload[0]?.ai_buyer_chat_unread_total ?? payload[0]?.unread_total ?? payload[0] ?? 0)
        : payload,
    )
    return hubAdminResponse(request, env, {
      ok: true,
      unreadTotal: Number.isFinite(total) ? total : 0,
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminChatMarkRead(request: Request, env: HubAdminEnv) {
  try {
    const auth = await authenticateAdmin(request, env)
    const body = await request.json().catch(() => ({})) as { caseId?: string }
    const caseId = clean(body.caseId, 100)
    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }

    const rows = await serviceWrite<any>(
      env,
      'rpc/ai_buyer_chat_mark_read',
      {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          p_user_id: auth.user.id,
          p_case_id: caseId,
        }),
      },
    )

    return hubAdminResponse(request, env, {
      ok: true,
      caseId,
      unreadCount: Number(rows[0]?.unread_count || 0),
      lastReadAt: rows[0]?.last_read_at || new Date().toISOString(),
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminCaseDetail(request: Request, env: HubAdminEnv) {
  try {
    await authenticateAdmin(request, env)
    const url = new URL(request.url)
    const caseId = clean(url.searchParams.get('caseId'), 100)
    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }

    const cases = await serviceRows<any>(
      env,
      'ai_buyer_valuation_cases?id=eq.' + encodeURIComponent(caseId)
        + '&select=id,conversation_id,customer_id,state,category,title,control_mode,identity_confidence,spec_completeness,condition_completeness,pricing_readiness,accepted_price,accepted_at,metadata,created_at,updated_at&limit=1',
    )
    const caseRow = cases[0]
    if (!caseRow) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_NOT_FOUND' }, 404)
    }

    const [customers, messages, pricing, outcomes, ledger, images, observations] = await Promise.all([
      serviceRows<any>(
        env,
        'ai_buyer_customers?id=eq.' + encodeURIComponent(caseRow.customer_id)
          + '&select=id,display_name,picture_url,phone&limit=1',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_messages?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,line_message_id,direction,message_type,text_content,metadata,line_timestamp,created_at'
          + '&order=created_at.asc&limit=500',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_pricing_decisions?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,price_source,estimated_resale,opening_offer,target_buy,hard_max,current_authorized_offer,pricing_confidence,adjustments,rationale,created_at'
          + '&order=created_at.desc&limit=5',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_case_outcomes?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,final_label,final_agreed_price,purchase_price,reason_code,note,outcome_at,verified,updated_at&limit=1',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_deal_ledger?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=*&order=line_no.asc',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_case_images?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,message_id,line_message_id,storage_key,mime_type,byte_size,analysis_status,created_at&order=created_at.asc',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_product_observations?case_id=eq.' + encodeURIComponent(caseId)
          + '&select=id,source,confirmed,inferred,unknown_fields,model_name,model_code,category,identity_confidence,created_at'
          + '&order=created_at.desc&limit=10',
      ),
    ])

    const summary = await serviceRows<any>(
      env,
      'ai_buyer_deal_ledger_case_v?case_id=eq.' + encodeURIComponent(caseId)
        + '&select=*',
    )

    return hubAdminResponse(request, env, {
      ok: true,
      case: caseRow,
      customer: customers[0] || null,
      messages,
      pricing,
      finalOutcome: outcomes[0] || null,
      ledger,
      dealSummary: summary[0] || null,
      images,
      observations,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminImage(request: Request, env: HubAdminEnv) {
  try {
    await authenticateAdmin(request, env)
    const url = new URL(request.url)
    const imageId = clean(url.searchParams.get('id'), 100)
    if (!validUuid(imageId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'IMAGE_ID_INVALID' }, 400)
    }

    const rows = await serviceRows<{
      id: string
      storage_key: string
      mime_type: string | null
      byte_size: number | null
    }>(
      env,
      'ai_buyer_case_images?id=eq.' + encodeURIComponent(imageId)
        + '&select=id,storage_key,mime_type,byte_size&limit=1',
    )
    const row = rows[0]
    if (!row?.storage_key) {
      return hubAdminResponse(request, env, { ok: false, error: 'IMAGE_NOT_FOUND' }, 404)
    }

    const object = await env.IMAGES.get(row.storage_key)
    if (!object) {
      return hubAdminResponse(request, env, { ok: false, error: 'IMAGE_OBJECT_NOT_FOUND' }, 404)
    }

    const origin = corsOrigin(request, env)
    const headers = new Headers({
      'content-type': row.mime_type || object.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'vary': 'Origin',
    })
    if (origin) headers.set('access-control-allow-origin', origin)
    if (row.byte_size) headers.set('content-length', String(row.byte_size))
    if (object.httpEtag) headers.set('etag', object.httpEtag)

    return new Response(object.body, { status: 200, headers })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminManualReply(request: Request, env: HubAdminEnv) {
  try {
    const { user, profile } = await authenticateAdmin(request, env)
    let body: {
      caseId?: string
      text?: string
      offerAmount?: number | null
      idempotencyKey?: string
    }
    try {
      body = await request.json() as typeof body
    } catch {
      return hubAdminResponse(request, env, { ok: false, error: 'JSON_INVALID' }, 400)
    }

    const caseId = clean(body.caseId, 100)
    const text = clean(body.text, 4200)
    const offerAmount = moneyValue(body.offerAmount)
    const idempotencyKey = validUuid(clean(body.idempotencyKey, 100))
      ? clean(body.idempotencyKey, 100)
      : crypto.randomUUID()

    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }
    if (body.offerAmount != null && offerAmount == null) {
      return hubAdminResponse(request, env, { ok: false, error: 'OFFER_AMOUNT_INVALID' }, 400)
    }
    if (!text && offerAmount == null) {
      return hubAdminResponse(request, env, { ok: false, error: 'MANUAL_REPLY_TEXT_OR_OFFER_REQUIRED' }, 400)
    }

    const offerLine = offerAmount == null
      ? ''
      : 'ราคาที่เสนอรับซื้อ: ' + Math.round(offerAmount).toLocaleString('th-TH') + ' บาท'
    const finalText = clean(
      offerLine
        ? (text ? text + '\n\n' + offerLine : offerLine)
        : text,
      4500,
    )

    const prepared = await serviceWrite<any>(
      env,
      'rpc/ai_buyer_prepare_manual_reply',
      {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          p_case_id: caseId,
          p_actor_user_id: user.id,
          p_actor_name: profile.display_name || 'Owner',
          p_text: finalText,
          p_offer_amount: offerAmount,
          p_idempotency_key: idempotencyKey,
        }),
      },
    )
    const prep = prepared[0]
    if (!prep?.action_id || !prep?.line_user_id) {
      return hubAdminResponse(request, env, { ok: false, error: 'MANUAL_REPLY_PREPARE_EMPTY' }, 500)
    }

    if (prep.action_status === 'SENT') {
      return hubAdminResponse(request, env, {
        ok: true,
        idempotent: true,
        actionId: prep.action_id,
        offerAmount,
      })
    }

    const line = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
        'content-type': 'application/json',
        'X-Line-Retry-Key': idempotencyKey,
      },
      body: JSON.stringify({
        to: prep.line_user_id,
        messages: [{ type: 'text', text: finalText }],
      }),
    })

    const raw = await line.text()
    if (!line.ok) {
      await serviceWrite(
        env,
        'rpc/ai_buyer_fail_manual_reply',
        {
          method: 'POST',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({
            p_action_id: prep.action_id,
            p_error: 'LINE_PUSH_' + line.status + ':' + raw.slice(0, 1200),
          }),
        },
      ).catch(() => [])
      return hubAdminResponse(request, env, {
        ok: false,
        error: 'LINE_PUSH_' + line.status,
        actionId: prep.action_id,
      }, 502)
    }

    let lineMessageId = ''
    try {
      const parsed = raw ? JSON.parse(raw) as { sentMessages?: Array<{ id?: string }> } : {}
      lineMessageId = clean(parsed.sentMessages?.[0]?.id, 200)
    } catch {
      lineMessageId = ''
    }

    const finalized = await serviceWrite<{ ai_buyer_finalize_manual_reply?: Record<string, unknown> }>(
      env,
      'rpc/ai_buyer_finalize_manual_reply',
      {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          p_action_id: prep.action_id,
          p_line_message_id: lineMessageId || null,
        }),
      },
    )

    return hubAdminResponse(request, env, {
      ok: true,
      sent: true,
      actionId: prep.action_id,
      lineMessageId: lineMessageId || null,
      offerAmount,
      sentText: finalText,
      capture: finalized[0]?.ai_buyer_finalize_manual_reply || null,
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

const FINAL_OUTCOME_LABELS = new Set([
  'AGREED_PENDING_HANDOVER',
  'PURCHASED',
  'CUSTOMER_DECLINED_PRICE',
  'CUSTOMER_NO_RESPONSE',
  'SOLD_ELSEWHERE',
  'CONDITION_REJECTED',
  'IDENTITY_MISMATCH',
  'OWNERSHIP_RISK',
  'OUTSIDE_POLICY',
  'CANCELLED_OTHER',
])

export async function handleHubAdminFinalOutcome(request: Request, env: HubAdminEnv) {
  try {
    const { user, profile } = await authenticateAdmin(request, env)
    let body: {
      caseId?: string
      finalLabel?: string
      finalAgreedPrice?: number | null
      purchasePrice?: number | null
      reasonCode?: string | null
      note?: string | null
      outcomeAt?: string | null
    }
    try {
      body = await request.json() as typeof body
    } catch {
      return hubAdminResponse(request, env, { ok: false, error: 'JSON_INVALID' }, 400)
    }

    const caseId = clean(body.caseId, 100)
    const finalLabel = clean(body.finalLabel, 100).toUpperCase()
    const finalAgreedPrice = moneyValue(body.finalAgreedPrice)
    const purchasePrice = moneyValue(body.purchasePrice)
    const outcomeAt = body.outcomeAt && !Number.isNaN(new Date(body.outcomeAt).getTime())
      ? new Date(body.outcomeAt).toISOString()
      : new Date().toISOString()

    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }
    if (!FINAL_OUTCOME_LABELS.has(finalLabel)) {
      return hubAdminResponse(request, env, { ok: false, error: 'FINAL_LABEL_INVALID' }, 400)
    }
    if (finalLabel === 'AGREED_PENDING_HANDOVER' && finalAgreedPrice == null) {
      return hubAdminResponse(request, env, { ok: false, error: 'FINAL_AGREED_PRICE_REQUIRED' }, 400)
    }
    if (finalLabel === 'PURCHASED' && purchasePrice == null && finalAgreedPrice == null) {
      return hubAdminResponse(request, env, { ok: false, error: 'PURCHASE_PRICE_REQUIRED' }, 400)
    }

    const rows = await serviceWrite<any>(
      env,
      'ai_buyer_case_outcomes?on_conflict=case_id',
      {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          case_id: caseId,
          final_label: finalLabel,
          final_agreed_price: finalAgreedPrice,
          purchase_price: purchasePrice,
          reason_code: clean(body.reasonCode, 120) || null,
          note: clean(body.note, 1500) || null,
          outcome_at: outcomeAt,
          labeled_by: user.id,
          source: profile.role === 'owner' ? 'MANUAL_OWNER' : 'MANUAL_ADMIN',
          verified: true,
        }),
      },
    )

    const summary = await serviceRows<any>(
      env,
      'ai_buyer_deal_ledger_case_v?case_id=eq.' + encodeURIComponent(caseId)
        + '&select=*',
    )

    return hubAdminResponse(request, env, {
      ok: true,
      outcome: rows[0] || null,
      deal: summary[0] || null,
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminDealLedger(request: Request, env: HubAdminEnv) {
  try {
    const { user } = await authenticateAdmin(request, env)
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const caseId = clean(url.searchParams.get('caseId'), 100)
      if (!validUuid(caseId)) {
        return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
      }
      const [lines, summary] = await Promise.all([
        serviceRows<any>(
          env,
          'ai_buyer_deal_ledger?case_id=eq.' + encodeURIComponent(caseId)
            + '&select=*&order=line_no.asc',
        ),
        serviceRows<any>(
          env,
          'ai_buyer_deal_ledger_case_v?case_id=eq.' + encodeURIComponent(caseId)
            + '&select=*',
        ),
      ])
      return hubAdminResponse(request, env, {
        ok: true,
        lines,
        summary: summary[0] || null,
      })
    }

    let body: {
      id?: string
      caseId?: string
      lineNo?: number
      productId?: string | null
      itemTitle?: string | null
      category?: string | null
      model?: string | null
      sku?: string | null
      status?: string
      purchasePrice?: number | null
      acquiredAt?: string | null
      repairCost?: number
      partsCost?: number
      transportCost?: number
      warrantyCost?: number
      channelFee?: number
      otherCost?: number
      salePrice?: number | null
      saleChannel?: string | null
      soldAt?: string | null
      salePriceVerified?: boolean
      note?: string | null
    }
    try {
      body = await request.json() as typeof body
    } catch {
      return hubAdminResponse(request, env, { ok: false, error: 'JSON_INVALID' }, 400)
    }

    const caseId = clean(body.caseId, 100)
    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }

    const status = clean(body.status || 'PENDING', 40).toUpperCase()
    if (!['PENDING','ACQUIRED','IN_STOCK','SOLD','RETURNED','WRITE_OFF','CANCELLED'].includes(status)) {
      return hubAdminResponse(request, env, { ok: false, error: 'LEDGER_STATUS_INVALID' }, 400)
    }

    const row = {
      case_id: caseId,
      line_no: Math.max(1, Math.min(100, Math.floor(Number(body.lineNo || 1) || 1))),
      product_id: body.productId && validUuid(clean(body.productId, 100)) ? clean(body.productId, 100) : null,
      item_title: clean(body.itemTitle, 500) || null,
      category: clean(body.category, 80) || null,
      model: clean(body.model, 240) || null,
      sku: clean(body.sku, 120) || null,
      status,
      purchase_price: moneyValue(body.purchasePrice),
      acquired_at: body.acquiredAt && !Number.isNaN(new Date(body.acquiredAt).getTime())
        ? new Date(body.acquiredAt).toISOString()
        : null,
      repair_cost: moneyValue(body.repairCost) || 0,
      parts_cost: moneyValue(body.partsCost) || 0,
      transport_cost: moneyValue(body.transportCost) || 0,
      warranty_cost: moneyValue(body.warrantyCost) || 0,
      channel_fee: moneyValue(body.channelFee) || 0,
      other_cost: moneyValue(body.otherCost) || 0,
      sale_price: moneyValue(body.salePrice),
      sale_channel: clean(body.saleChannel, 100) || null,
      sold_at: body.soldAt && !Number.isNaN(new Date(body.soldAt).getTime())
        ? new Date(body.soldAt).toISOString()
        : null,
      sale_price_source: body.salePriceVerified ? 'MANUAL_VERIFIED' : 'UNKNOWN',
      sale_price_verified: Boolean(body.salePriceVerified),
      note: clean(body.note, 1500) || null,
      updated_by: user.id,
    }

    let saved: any[]
    const id = clean(body.id, 100)
    if (validUuid(id)) {
      saved = await serviceWrite<any>(
        env,
        'ai_buyer_deal_ledger?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: { prefer: 'return=representation' },
          body: JSON.stringify(row),
        },
      )
    } else {
      saved = await serviceWrite<any>(
        env,
        'ai_buyer_deal_ledger?on_conflict=case_id,line_no',
        {
          method: 'POST',
          headers: { prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ ...row, created_by: user.id }),
        },
      )
    }

    await serviceWrite(
      env,
      'rpc/ai_buyer_sync_deal_ledger',
      {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ p_case_id: caseId }),
      },
    ).catch(() => [])

    const summary = await serviceRows<any>(
      env,
      'ai_buyer_deal_ledger_case_v?case_id=eq.' + encodeURIComponent(caseId)
        + '&select=*',
    )

    return hubAdminResponse(request, env, {
      ok: true,
      line: saved[0] || null,
      summary: summary[0] || null,
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminOwnerModel(request: Request, env: HubAdminEnv) {
  try {
    const { profile } = await authenticateAdmin(request, env)

    await serviceWrite<any>(
      env,
      'rpc/ai_buyer_sync_owner_pricebook_reviews',
      {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({}),
      },
    ).catch(() => [])

    const [
      statusRows,
      errorByCategory,
      promotionGate,
      pricePairs,
      pricebookReviews,
      negotiationPaths,
      styleRows,
      economics,
      conversationPairs,
    ] = await Promise.all([
      serviceRows<any>(env, 'ai_buyer_owner_model_v2_status_v?select=*&limit=1'),
      serviceRows<any>(env, 'ai_buyer_owner_error_by_category_v?select=*&order=category.asc'),
      serviceRows<any>(env, 'ai_buyer_owner_promotion_gate_v?select=*&order=category.asc'),
      serviceRows<any>(
        env,
        'ai_buyer_owner_price_pair_v?select=*&order=owner_offer_at.desc&limit=50',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_owner_pricebook_reviews?select=*&order=status.desc,updated_at.desc',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_owner_negotiation_path_v?select=*&order=last_owner_quote_at.desc&limit=50',
      ),
      serviceRows<any>(env, 'ai_buyer_owner_style_profile_v?select=*&limit=1'),
      serviceRows<any>(
        env,
        'ai_buyer_owner_deal_economics_by_category_v?select=*&order=category.asc',
      ),
      serviceRows<any>(
        env,
        'ai_buyer_owner_conversation_pair_v?shadow_id=not.is.null&select=*&order=owner_replied_at.desc&limit=30',
      ),
    ])

    return hubAdminResponse(request, env, {
      ok: true,
      viewer: { displayName: profile.display_name || 'Admin', role: profile.role },
      status: statusRows[0] || null,
      style: styleRows[0] || null,
      errorByCategory,
      promotionGate,
      pricePairs,
      pricebookReviews,
      negotiationPaths,
      economics,
      conversationPairs,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminOwnerPricebookReview(request: Request, env: HubAdminEnv) {
  try {
    const { user } = await authenticateAdmin(request, env)
    let body: {
      caseId?: string
      status?: string
      openingOffer?: number | null
      targetBuy?: number | null
      hardMax?: number | null
      note?: string | null
    }
    try {
      body = await request.json() as typeof body
    } catch {
      return hubAdminResponse(request, env, { ok: false, error: 'JSON_INVALID' }, 400)
    }

    const caseId = clean(body.caseId, 100)
    const reviewStatus = clean(body.status, 20).toUpperCase()
    if (!validUuid(caseId)) {
      return hubAdminResponse(request, env, { ok: false, error: 'CASE_ID_INVALID' }, 400)
    }
    if (!['PENDING','APPROVED','REJECTED'].includes(reviewStatus)) {
      return hubAdminResponse(request, env, { ok: false, error: 'PRICEBOOK_REVIEW_STATUS_INVALID' }, 400)
    }

    const currentRows = await serviceRows<any>(
      env,
      'ai_buyer_owner_pricebook_reviews?case_id=eq.' + encodeURIComponent(caseId)
        + '&select=*&limit=1',
    )
    const current = currentRows[0]
    if (!current) {
      return hubAdminResponse(request, env, { ok: false, error: 'PRICEBOOK_REVIEW_NOT_FOUND' }, 404)
    }

    const openingOffer = moneyValue(body.openingOffer ?? current.final_opening_offer)
    const targetBuy = moneyValue(body.targetBuy ?? current.final_target_buy)
    const hardMax = moneyValue(body.hardMax ?? current.final_hard_max)
    if (openingOffer == null || targetBuy == null || hardMax == null) {
      return hubAdminResponse(request, env, { ok: false, error: 'PRICEBOOK_REVIEW_PRICE_INVALID' }, 400)
    }
    if (openingOffer > targetBuy || targetBuy > hardMax) {
      return hubAdminResponse(request, env, { ok: false, error: 'PRICEBOOK_REVIEW_PRICE_ORDER_INVALID' }, 400)
    }

    const reviewed = reviewStatus === 'PENDING' ? null : new Date().toISOString()
    const rows = await serviceWrite<any>(
      env,
      'ai_buyer_owner_pricebook_reviews?case_id=eq.' + encodeURIComponent(caseId),
      {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          status: reviewStatus,
          final_opening_offer: openingOffer,
          final_target_buy: targetBuy,
          final_hard_max: hardMax,
          reviewed_by: reviewStatus === 'PENDING' ? null : user.id,
          reviewed_at: reviewed,
          review_note: clean(body.note, 1500) || null,
          updated_at: new Date().toISOString(),
        }),
      },
    )

    const training = await serviceRows<any>(
      env,
      'ai_buyer_owner_review_training_v?case_id=eq.' + encodeURIComponent(caseId)
        + '&select=*&limit=1',
    )

    return hubAdminResponse(request, env, {
      ok: true,
      review: rows[0] || null,
      trainingSignal: training[0] || null,
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 1000)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 400
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}

export async function handleHubAdminDashboard(request: Request, env: HubAdminEnv) {
  try {
    const { profile } = await authenticateAdmin(request, env)
    const url = new URL(request.url)
    const limit = Math.max(10, Math.min(200, Math.floor(Number(url.searchParams.get('limit') || 100) || 100)))
    const state = clean(url.searchParams.get('state'), 50)
    const category = clean(url.searchParams.get('category'), 50)

    let casePath = 'ai_buyer_valuation_cases?select=id,conversation_id,customer_id,state,category,title,control_mode,identity_confidence,spec_completeness,condition_completeness,pricing_readiness,accepted_price,accepted_at,metadata,created_at,updated_at'
      + '&order=updated_at.desc&limit=' + limit
    if (state) casePath += '&state=eq.' + encodeURIComponent(state)
    if (category) casePath += '&category=eq.' + encodeURIComponent(category)

    const cases = await serviceRows<CaseRow>(env, casePath)
    const caseIds = cases.map((row) => row.id)
    const customerIds = Array.from(new Set(cases.map((row) => row.customer_id)))

    const modesPromise = serviceRows<Record<string, unknown>>(
      env,
      'ai_buyer_category_automation_modes?select=category,mode,max_negotiation_rounds,active,updated_at&order=category.asc',
    )
    const learningPromise = serviceRows<Record<string, unknown>>(
      env,
      'ai_buyer_learning_capture_status_v?select=*',
    )
    const openAIPromise = loadOpenAISpend(env)

    if (!caseIds.length) {
      const [modes, learningRows, openai] = await Promise.all([modesPromise, learningPromise, openAIPromise])
      return hubAdminResponse(request, env, {
        ok: true,
        viewer: { displayName: profile.display_name || 'Admin', role: profile.role },
        summary: {
          total: 0,
          priced: 0,
          humanReview: 0,
          actionRequired: 0,
          accepted: 0,
          purchased: 0,
          sold: 0,
          grossProfit: 0,
          needsFinalLabel: 0,
        },
        openai,
        modes,
        learning: learningRows[0] || null,
        cases: [],
        generatedAt: new Date().toISOString(),
      })
    }

    const inCases = caseIds.join(',')
    const inCustomers = customerIds.join(',')

    const [customers, pricing, offers, tasks, images, messages, outcomes, dealSummaries, modes, learningRows, openai] = await Promise.all([
      customerIds.length
        ? serviceRows<any>(env,
          'ai_buyer_customers?id=in.(' + inCustomers + ')&select=id,display_name,picture_url,phone')
        : Promise.resolve([]),
      serviceRows<any>(env,
        'ai_buyer_pricing_decisions?case_id=in.(' + inCases + ')'
          + '&select=id,case_id,price_source,price_book_version_id,estimated_resale,opening_offer,target_buy,hard_max,current_authorized_offer,pricing_confidence,rationale,created_at'
          + '&order=created_at.desc'),
      serviceRows<any>(env,
        'ai_buyer_offers?case_id=in.(' + inCases + ')&actor=in.(AI,ADMIN)'
          + '&select=id,case_id,amount,actor,status,round_no,delivered_at,created_at'
          + '&order=created_at.desc'),
      serviceRows<any>(env,
        'ai_buyer_admin_tasks?case_id=in.(' + inCases + ')&status=in.(ACTION_REQUIRED,IN_PROGRESS)'
          + '&select=id,case_id,task_type,status,priority,assigned_to,created_at,updated_at'
          + '&order=created_at.desc'),
      serviceRows<any>(env,
        'ai_buyer_case_images?case_id=in.(' + inCases + ')&select=id,case_id,analysis_status,created_at'),
      serviceRows<any>(env,
        'ai_buyer_messages?case_id=in.(' + inCases + ')&direction=eq.INBOUND'
          + '&select=id,case_id,message_type,text_content,created_at'
          + '&order=created_at.desc&limit=400'),
      serviceRows<any>(env,
        'ai_buyer_case_outcomes?case_id=in.(' + inCases + ')'
          + '&select=id,case_id,final_label,final_agreed_price,purchase_price,reason_code,note,outcome_at,verified,updated_at'),
      serviceRows<any>(env,
        'ai_buyer_deal_ledger_case_v?case_id=in.(' + inCases + ')&select=*'),
      modesPromise,
      learningPromise,
      openAIPromise,
    ])

    const customerById = new Map(customers.map((row: any) => [String(row.id), row]))
    const pricingByCase = firstByCase(pricing)
    const offerByCase = firstByCase(offers)
    const taskByCase = firstByCase(tasks)
    const lastMessageByCase = firstByCase(messages)
    const outcomeByCase = firstByCase(outcomes)
    const dealByCase = firstByCase(dealSummaries)
    const imageCountByCase = countByCase(images)

    const items = cases.map((row) => {
      const customer = customerById.get(row.customer_id) || null
      const decision: any = pricingByCase.get(row.id) || null
      const offer: any = offerByCase.get(row.id) || null
      const task: any = taskByCase.get(row.id) || null
      const message: any = lastMessageByCase.get(row.id) || null
      const outcome: any = outcomeByCase.get(row.id) || null
      const deal: any = dealByCase.get(row.id) || null
      return {
        id: row.id,
        title: row.title || 'ยังไม่ระบุสินค้า',
        category: row.category,
        state: row.state,
        controlMode: row.control_mode,
        confidence: {
          identity: numberValue(row.identity_confidence),
          spec: numberValue(row.spec_completeness),
          condition: numberValue(row.condition_completeness),
          pricingReadiness: numberValue(row.pricing_readiness),
        },
        acceptedPrice: numberValue(row.accepted_price),
        acceptedAt: row.accepted_at,
        customer: customer ? {
          displayName: customer.display_name || 'ลูกค้า LINE',
          pictureUrl: customer.picture_url || null,
          phone: customer.phone || null,
        } : null,
        pricing: decision ? {
          id: decision.id,
          source: decision.price_source,
          estimatedResale: numberValue(decision.estimated_resale),
          openingOffer: numberValue(decision.opening_offer),
          targetBuy: numberValue(decision.target_buy),
          hardMax: numberValue(decision.hard_max),
          currentAuthorizedOffer: numberValue(decision.current_authorized_offer),
          confidence: numberValue(decision.pricing_confidence),
          rationale: decision.rationale || null,
          createdAt: decision.created_at,
        } : null,
        offer: offer ? {
          id: offer.id,
          amount: numberValue(offer.amount),
          status: offer.status,
          round: offer.round_no,
          deliveredAt: offer.delivered_at,
          createdAt: offer.created_at,
        } : null,
        task: task ? {
          id: task.id,
          type: task.task_type,
          status: task.status,
          priority: task.priority,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
        } : null,
        imageCount: imageCountByCase.get(row.id) || 0,
        lastMessage: message ? {
          type: message.message_type,
          text: clean(message.text_content, 220) || null,
          createdAt: message.created_at,
        } : null,
        finalOutcome: outcome ? {
          id: outcome.id,
          label: outcome.final_label,
          finalAgreedPrice: numberValue(outcome.final_agreed_price),
          purchasePrice: numberValue(outcome.purchase_price),
          reasonCode: outcome.reason_code || null,
          note: outcome.note || null,
          outcomeAt: outcome.outcome_at,
          verified: Boolean(outcome.verified),
        } : null,
        needsFinalLabel: !outcome
          && [
            'ACCEPTED','COLLECTING_FULFILLMENT','ACTION_REQUIRED','ADMIN_ASSIGNED',
            'COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED',
          ].includes(row.state)
          && ![
            'CONCURRENT_DUPLICATE_CASE',
            'NON_SELLER_PAWN_OR_DEPOSIT_INQUIRY',
            'NON_SELLER_PAWN_INQUIRY',
            'NON_SELLER_BUYING_INQUIRY',
            'LOGISTICS_ONLY_NO_ACTIVE_PRODUCT',
            'STICKER_ONLY_NO_PRODUCT',
          ].includes(clean((row as any).metadata?.cancelReason, 120)),
        deal: deal ? {
          ledgerLines: Number(deal.ledger_lines || 0),
          purchaseTotal: numberValue(deal.purchase_total),
          totalCost: numberValue(deal.total_cost),
          saleTotal: numberValue(deal.sale_total),
          grossProfit: numberValue(deal.gross_profit),
          soldLines: Number(deal.sold_lines || 0),
          inStockLines: Number(deal.in_stock_lines || 0),
          firstAcquiredAt: deal.first_acquired_at || null,
          lastSoldAt: deal.last_sold_at || null,
        } : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })

    return hubAdminResponse(request, env, {
      ok: true,
      viewer: { displayName: profile.display_name || 'Admin', role: profile.role },
      summary: {
        total: items.length,
        priced: items.filter((item) => item.pricing).length,
        humanReview: items.filter((item) => item.state === 'HUMAN_REVIEW').length,
        actionRequired: items.filter((item) => item.state === 'ACTION_REQUIRED' || item.task?.status === 'ACTION_REQUIRED').length,
        accepted: items.filter((item) => item.acceptedPrice != null).length,
        purchased: items.filter((item) => item.finalOutcome?.label === 'PURCHASED').length,
        sold: items.reduce((sum, item) => sum + Number(item.deal?.soldLines || 0), 0),
        grossProfit: items.reduce((sum, item) => sum + Number(item.deal?.grossProfit || 0), 0),
        needsFinalLabel: items.filter((item) => item.needsFinalLabel).length,
      },
      openai,
      modes,
      learning: learningRows[0] || null,
      cases: items,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const code = clean((error as Error)?.message || error, 300)
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
      ? 401
      : code === 'ADMIN_ACCESS_DENIED'
        ? 403
        : 500
    return hubAdminResponse(request, env, { ok: false, error: code }, status)
  }
}
