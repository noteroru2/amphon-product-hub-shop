export interface HubAdminEnv {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  AI_BUYER_HUB_ORIGINS?: string
  OPENAI_ADMIN_KEY?: string
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
    headers['access-control-allow-methods'] = 'GET,OPTIONS'
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
      'access-control-allow-methods': 'GET,OPTIONS',
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

export async function handleHubAdminDashboard(request: Request, env: HubAdminEnv) {
  try {
    const { profile } = await authenticateAdmin(request, env)
    const url = new URL(request.url)
    const limit = Math.max(10, Math.min(200, Math.floor(Number(url.searchParams.get('limit') || 100) || 100)))
    const state = clean(url.searchParams.get('state'), 50)
    const category = clean(url.searchParams.get('category'), 50)

    let casePath = 'ai_buyer_valuation_cases?select=id,conversation_id,customer_id,state,category,title,control_mode,identity_confidence,spec_completeness,condition_completeness,pricing_readiness,accepted_price,accepted_at,created_at,updated_at'
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
    const openAIPromise = loadOpenAISpend(env)

    if (!caseIds.length) {
      const [modes, openai] = await Promise.all([modesPromise, openAIPromise])
      return hubAdminResponse(request, env, {
        ok: true,
        viewer: { displayName: profile.display_name || 'Admin', role: profile.role },
        summary: { total: 0, priced: 0, humanReview: 0, actionRequired: 0, accepted: 0 },
        openai,
        modes,
        cases: [],
        generatedAt: new Date().toISOString(),
      })
    }

    const inCases = caseIds.join(',')
    const inCustomers = customerIds.join(',')

    const [customers, pricing, offers, tasks, images, messages, modes, openai] = await Promise.all([
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
      modesPromise,
      openAIPromise,
    ])

    const customerById = new Map(customers.map((row: any) => [String(row.id), row]))
    const pricingByCase = firstByCase(pricing)
    const offerByCase = firstByCase(offers)
    const taskByCase = firstByCase(tasks)
    const lastMessageByCase = firstByCase(messages)
    const imageCountByCase = countByCase(images)

    const items = cases.map((row) => {
      const customer = customerById.get(row.customer_id) || null
      const decision: any = pricingByCase.get(row.id) || null
      const offer: any = offerByCase.get(row.id) || null
      const task: any = taskByCase.get(row.id) || null
      const message: any = lastMessageByCase.get(row.id) || null
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
      },
      openai,
      modes,
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
