import { supabase } from './supabase'

export interface GrowthOpportunity {
  id: number; site_id: string; query: string; page: string
  kind: 'NEAR_FIRST_PAGE' | 'LOW_CTR_REVIEW' | 'OWNERSHIP_REVIEW'
  clicks: number; impressions: number; ctr: number | null; position: number | null
  priority: number; recommendation: string; status: string; source_at: string
}
export interface KeywordOwner {
  keyword: string; site_id: string; primary_page: string; confirmed: boolean; note: string
}
export interface LeadGuard {
  id: number; site_id: string; page: string; basis: string; confirmed: boolean
  guard_state: string; requested_at: string | null; completed_at: string | null
  status_code: number | null; error: string | null; noindex: boolean | null
  canonical: string | null; title: string | null; h1_count: number | null; changed: boolean
}
export async function loadSeoGrowth() {
  if (!supabase) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
  const [opportunities, owners, pages] = await Promise.all([
    supabase.from('commerce_seo_growth_opportunities').select('*').neq('status', 'STALE').order('priority', { ascending: false }).order('id').limit(300),
    supabase.from('commerce_seo_keyword_owners').select('*').order('keyword').limit(500),
    supabase.from('commerce_seo_lead_guard_v').select('*').order('site_id').order('id').limit(500),
  ])
  for (const result of [opportunities, owners, pages]) if (result.error) throw new Error(result.error.message)
  return { opportunities: (opportunities.data || []) as GrowthOpportunity[], owners: (owners.data || []) as KeywordOwner[], pages: (pages.data || []) as LeadGuard[] }
}
export async function manageSeoGrowth(action: string, data: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
  const result = await supabase.rpc('seo_growth_manage', { p_action: action, p_data: data })
  if (result.error) throw new Error(result.error.message)
}
