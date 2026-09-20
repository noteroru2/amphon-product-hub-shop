export interface HubAdminEnv {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
  AI_BUYER_HUB_ORIGINS?: string
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

    if (!caseIds.length) {
      const modes = await modesPromise
      return hubAdminResponse(request, env, {
        ok: true,
        viewer: { displayName: profile.display_name || 'Admin', role: profile.role },
        summary: { total: 0, priced: 0, humanReview: 0, actionRequired: 0, accepted: 0 },
        modes,
        cases: [],
        generatedAt: new Date().toISOString(),
      })
    }

    const inCases = caseIds.join(',')
    const inCustomers = customerIds.join(',')

    const [customers, pricing, offers, tasks, images, messages, modes] = await Promise.all([
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
