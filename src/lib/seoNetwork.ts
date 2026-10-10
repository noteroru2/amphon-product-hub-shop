import { supabase } from './supabase'

export interface SeoNetworkSite {
  id: string
  label: string
  sitemap_path?: string
  origin: string
  gsc_property: string
  tracked_queries: string[]
  next_check_at: string
  gsc_state: string
  gsc_note: string
  source_at: string | null
  data_start_date?: string | null
  data_end_date?: string | null
  last_data_date?: string | null
  clicks: number | null
  impressions: number | null
  ctr: number | null
  position: number | null
  query_rows: number | null
  coverage: string | null
  previous_source_at: string | null
  clicks_delta: number | null
  position_delta: number | null
  last_check_at: string | null
  completed_at: string | null
  home_status: number | null
  robots_status: number | null
  robots_error: string | null
  sitemap_status: number | null
  sitemap_error: string | null
  health_error: string | null
  noindex: boolean | null
  canonical: string | null
  robots_blocks_all: boolean | null
  robots_changed: boolean
  sitemap_changed: boolean
  health_state: string
}

export interface SeoNetworkQuery {
  query: string
  page: string
  clicks: number
  impressions: number
  position: number | null
}

export interface SeoNetworkSnapshot {
  id: number
  source_at: string
  captured_at: string
  window_days: number
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
  coverage: string
  queries: SeoNetworkQuery[]
  data_start_date?: string | null
  data_end_date?: string | null
  last_data_date?: string | null
  query_truncated?: boolean | null
}

export async function loadSeoNetwork(): Promise<SeoNetworkSite[]> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อข้อมูล')
  const { data, error } = await supabase.from('commerce_seo_network_overview_v').select('*').order('id')
  if (error) throw new Error(error.message)
  return (data || []) as SeoNetworkSite[]
}

export async function loadSeoNetworkHistory(siteId: string): Promise<SeoNetworkSnapshot[]> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อข้อมูล')
  const { data, error } = await supabase.from('commerce_seo_network_snapshots')
    .select('id,source_at,captured_at,window_days,clicks,impressions,ctr,position,coverage,data_start_date,data_end_date,last_data_date,query_truncated')
    .eq('site_id', siteId).order('source_at', { ascending: false }).limit(12)
  if (error) throw new Error(error.message)
  const rows = (data || []).map(row => ({ ...row, queries: [] })) as SeoNetworkSnapshot[]
  const latest = rows[0]
  if (!latest) return rows
  const previous = rows.find(row => Date.parse(latest.source_at) - Date.parse(row.source_at) >= 3 * 86_400_000 && row.coverage === latest.coverage)
  const { data: details, error: detailError } = await supabase.from('commerce_seo_network_snapshots')
    .select('id,queries').in('id', [latest.id, ...(previous ? [previous.id] : [])]).eq('site_id', siteId)
  if (detailError) throw new Error(detailError.message)
  const queries = new Map((details || []).map(row => [row.id, row.queries as SeoNetworkQuery[]]))
  return rows.map(row => ({ ...row, queries: queries.get(row.id) || [] }))
}
