import { supabase } from './supabase'

const DEFAULT_AI_BUYER_API = 'https://amphon-ai-buyer.noteroru2.workers.dev'
const apiBase = String(import.meta.env.VITE_AI_BUYER_API || DEFAULT_AI_BUYER_API).replace(/\/$/, '')

export type AiBuyerRolloutMode = {
  category: string
  mode: 'SHADOW' | 'APPROVAL' | 'AUTO'
  max_negotiation_rounds: number
  active: boolean
  updated_at?: string
}

export type AiBuyerDashboardCase = {
  id: string
  title: string
  category: string | null
  state: string
  controlMode: string
  confidence: {
    identity: number | null
    spec: number | null
    condition: number | null
    pricingReadiness: number | null
  }
  acceptedPrice: number | null
  acceptedAt: string | null
  customer: {
    displayName: string
    pictureUrl: string | null
    phone: string | null
  } | null
  pricing: {
    id: string
    source: string
    estimatedResale: number | null
    openingOffer: number | null
    targetBuy: number | null
    hardMax: number | null
    currentAuthorizedOffer: number | null
    confidence: number | null
    rationale: Record<string, unknown> | null
    createdAt: string
  } | null
  offer: {
    id: string
    amount: number | null
    status: string
    round: number
    deliveredAt: string | null
    createdAt: string
  } | null
  task: {
    id: string
    type: string
    status: string
    priority: string
    createdAt: string
    updatedAt: string
  } | null
  imageCount: number
  lastMessage: {
    type: string
    text: string | null
    createdAt: string
  } | null
  createdAt: string
  updatedAt: string
}


export type AiBuyerOpenAISpend = {
  status: 'live' | 'not_configured' | 'unavailable'
  scope: 'organization'
  currency: string
  timezone: string
  today: number | null
  last7Days: number | null
  monthToDate: number | null
  requestsMonthToDate: number | null
  tokensMonthToDate: {
    input: number | null
    cachedInput: number | null
    output: number | null
    total: number | null
  }
  byModel: Array<{
    model: string
    requests: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    totalTokens: number
  }>
  daily: Array<{ date: string; amount: number }>
  updatedAt: string
  error: string | null
}

export type AiBuyerDashboardData = {
  ok: true
  viewer: { displayName: string; role: 'owner' | 'admin' }
  summary: {
    total: number
    priced: number
    humanReview: number
    actionRequired: number
    accepted: number
  }
  openai?: AiBuyerOpenAISpend
  modes: AiBuyerRolloutMode[]
  cases: AiBuyerDashboardCase[]
  generatedAt: string
}

async function currentAccessToken() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session?.access_token) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
  return data.session.access_token
}

export async function loadAiBuyerDashboard(limit = 120): Promise<AiBuyerDashboardData> {
  const token = await currentAccessToken()
  const response = await fetch(
    `${apiBase}/v1/hub/admin/dashboard?limit=${Math.max(10, Math.min(200, limit))}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    },
  )
  const body = await response.json().catch(() => ({})) as AiBuyerDashboardData | { error?: string }
  if (!response.ok) {
    const code = 'error' in body ? body.error : null
    if (response.status === 403) throw new Error('หน้านี้เปิดให้เฉพาะ Owner / Admin')
    if (response.status === 401) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
    throw new Error(code || `AI Buyer API failed (${response.status})`)
  }
  return body as AiBuyerDashboardData
}
