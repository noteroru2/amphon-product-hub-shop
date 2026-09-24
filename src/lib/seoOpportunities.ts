import { supabase } from './supabase'

export type SeoActionType =
  | 'META_REVIEW'
  | 'INTERNAL_LINK_BOOST'
  | 'RECOVERY_PLAN'
  | 'PROTECT_PAGE'
  | 'BRAND_WATCH'
  | 'WATCH'

export type SeoActionStatus =
  | 'OPEN'
  | 'APPROVED'
  | 'APPLIED'
  | 'DISMISSED'
  | 'PROTECTED'
  | 'STALE'

export interface SeoAction {
  id: string
  property: string
  page: string
  actionType: SeoActionType
  executionMode: 'REVIEW' | 'AUTO_GUARD'
  status: SeoActionStatus
  primaryQuery: string
  queryCount: number
  clicks: number
  impressions: number
  ctr: number
  position: number
  priorityScore: number
  opportunityType: string
  recommendedAction: string
  candidateFocusQuery: string | null
  candidateTitle: string | null
  candidateDescription: string | null
  candidateNotes: string | null
  candidateGeneratedAt: string | null
  ownerNote: string | null
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
  updatedAt: string
}

type SeoActionRow = {
  id: string
  property: string
  page: string
  action_type: SeoActionType
  execution_mode: 'REVIEW' | 'AUTO_GUARD'
  status: SeoActionStatus
  primary_query: string
  query_count: number | string
  clicks: number | string
  impressions: number | string
  ctr: number | string
  position: number | string
  priority_score: number | string
  opportunity_type: string
  recommended_action: string
  candidate_focus_query: string | null
  candidate_title: string | null
  candidate_description: string | null
  candidate_notes: string | null
  candidate_generated_at: string | null
  owner_note: string | null
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  updated_at: string
}

function mapAction(row: SeoActionRow): SeoAction {
  return {
    id: row.id,
    property: row.property,
    page: row.page,
    actionType: row.action_type,
    executionMode: row.execution_mode,
    status: row.status,
    primaryQuery: row.primary_query,
    queryCount: Number(row.query_count || 0),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
    priorityScore: Number(row.priority_score || 0),
    opportunityType: row.opportunity_type,
    recommendedAction: row.recommended_action,
    candidateFocusQuery: row.candidate_focus_query,
    candidateTitle: row.candidate_title,
    candidateDescription: row.candidate_description,
    candidateNotes: row.candidate_notes,
    candidateGeneratedAt: row.candidate_generated_at,
    ownerNote: row.owner_note,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  }
}

export async function listSeoActions(limit = 100): Promise<SeoAction[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('commerce_gsc_action_queue')
    .select('*')
    .in('status', ['OPEN', 'APPROVED', 'PROTECTED'])
    .order('priority_score', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data || []) as SeoActionRow[]).map(mapAction)
}

export async function setSeoActionStatus(
  id: string,
  status: Exclude<SeoActionStatus, 'STALE'>,
  note?: string,
): Promise<SeoAction> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('set_gsc_action_status', {
    p_id: id,
    p_status: status,
    p_note: note?.trim() || null,
  })
  if (error) throw error
  return mapAction(data as SeoActionRow)
}
