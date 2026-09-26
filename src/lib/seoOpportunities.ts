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
    .in('status', ['OPEN', 'APPROVED', 'PROTECTED', 'APPLIED'])
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

export async function retrySeoExecutorJob(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('retry_gsc_executor_job', { p_job_id: id })
  if (error) throw error
}

export interface SeoRecoveryDiagnostic {
  actionId: string
  diagnosisType: string
  competingPageCount: number
  leaderPage: string | null
  currentShare: number
  leaderShare: number
  autoSafeInternalLink: boolean
  requiresHumanReview: boolean
  recommendedChecks: string
  checkedAt: string
}

export interface SeoExecutionMeasurement {
  checkpointDays: number
  verdict: 'IMPROVED' | 'NEUTRAL' | 'REGRESSED' | 'INSUFFICIENT_DATA'
  rollbackRecommended: boolean
  ctrDelta: number
  positionDelta: number
  clicksDelta: number
  impressionsDelta: number
  integrityStatus: 'PASS' | 'BLOCKED'
  integrityCodes: string[]
  integrityReason: string | null
  dataAgeHours: number | null
  baselineAgeHours: number | null
  exposureDays: number | null
  baselineQueryShare: number | null
  currentQueryShare: number | null
  queryShareShift: number | null
  trafficRatio: number | null
  measuredAt: string
}

export interface SeoActionExecution {
  id: string
  actionId: string
  executionKind: string
  repository: string | null
  pullRequestNumber: number | null
  commitSha: string | null
  baseCommitSha: string | null
  rollbackCommitSha: string | null
  diffSha256: string | null
  changedFiles: string[]
  riskMode: string | null
  liveUrl: string | null
  appliedAt: string
  monitorStatus: 'MONITORING' | 'ROLLBACK_REVIEW' | 'COMPLETE' | 'STOPPED'
  rollbackReviewReason: string | null
  rollbackStatus: 'NONE' | 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'ROLLED_BACK' | 'BLOCKED' | 'FAILED'
  rollbackTriggerMeasurementId: string | null
  rollbackActualCommitSha: string | null
  rollbackActualDiffSha256: string | null
  rolledBackAt: string | null
  rollbackError: string | null
  measurements: SeoExecutionMeasurement[]
}

export interface SeoExecutorJob {
  id: string
  actionId: string
  riskMode: 'AUTO_DEPLOY' | 'PR_ONLY' | 'HUMAN_REVIEW' | 'PROTECT' | 'OBSERVE'
  status: 'QUEUED' | 'RUNNING' | 'VERIFYING' | 'PR_READY' | 'APPLIED' | 'BLOCKED' | 'PROTECTED' | 'FAILED' | 'CANCELLED'
  targetRepository: string
  executionKind: string
  reason: string
  attempts: number
  baseCommitSha: string | null
  patchCommitSha: string | null
  rollbackCommitSha: string | null
  diffSha256: string | null
  changedFiles: string[]
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  liveVerifiedAt: string | null
  lastError: string | null
  guardCode: 'READY' | 'PAGE_EXPERIMENT_LOCK' | 'ACTION_BUDGET' | 'RISK_GATE' | 'PROTECTED'
  guardReason: string | null
  nextEligibleAt: string | null
  budgetUsed24h: number
  budgetLimit24h: number
  activePageExperiments: number
  pageLockExecutionId: string | null
  updatedAt: string
}

export interface SeoOpsDetailBundle {
  recoveryByAction: Record<string, SeoRecoveryDiagnostic>
  executionsByAction: Record<string, SeoActionExecution[]>
  executorByAction: Record<string, SeoExecutorJob>
}

export async function loadSeoOpsDetails(actionIds: string[]): Promise<SeoOpsDetailBundle> {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!actionIds.length) return { recoveryByAction: {}, executionsByAction: {}, executorByAction: {} }

  const [
    { data: recoveryData, error: recoveryError },
    { data: executionData, error: executionError },
    { data: executorData, error: executorError },
  ] = await Promise.all([
    supabase
      .from('commerce_gsc_recovery_diagnostics')
      .select('*')
      .in('action_id', actionIds),
    supabase
      .from('commerce_gsc_action_executions')
      .select('*')
      .in('action_id', actionIds)
      .order('applied_at', { ascending: false }),
    supabase
      .from('commerce_gsc_executor_jobs')
      .select('*')
      .in('action_id', actionIds),
  ])
  if (recoveryError) throw recoveryError
  if (executionError) throw executionError
  if (executorError) throw executorError

  const executions = (executionData || []) as Array<Record<string, any>>
  const executionIds = executions.map((row) => String(row.id))
  let measurementData: Array<Record<string, any>> = []
  if (executionIds.length) {
    const result = await supabase
      .from('commerce_gsc_action_measurements')
      .select('*')
      .in('execution_id', executionIds)
      .order('checkpoint_days', { ascending: true })
    if (result.error) throw result.error
    measurementData = (result.data || []) as Array<Record<string, any>>
  }

  const recoveryByAction: Record<string, SeoRecoveryDiagnostic> = {}
  for (const row of (recoveryData || []) as Array<Record<string, any>>) {
    recoveryByAction[String(row.action_id)] = {
      actionId: String(row.action_id),
      diagnosisType: String(row.diagnosis_type),
      competingPageCount: Number(row.competing_page_count || 0),
      leaderPage: row.leader_page ? String(row.leader_page) : null,
      currentShare: Number(row.current_share || 0),
      leaderShare: Number(row.leader_share || 0),
      autoSafeInternalLink: Boolean(row.auto_safe_internal_link),
      requiresHumanReview: Boolean(row.requires_human_review),
      recommendedChecks: String(row.recommended_checks || ''),
      checkedAt: String(row.checked_at || ''),
    }
  }

  const measurementsByExecution = new Map<string, SeoExecutionMeasurement[]>()
  for (const row of measurementData) {
    const executionId = String(row.execution_id)
    const items = measurementsByExecution.get(executionId) || []
    items.push({
      checkpointDays: Number(row.checkpoint_days || 0),
      verdict: row.verdict,
      rollbackRecommended: Boolean(row.rollback_recommended),
      ctrDelta: Number(row.ctr_delta || 0),
      positionDelta: Number(row.position_delta || 0),
      clicksDelta: Number(row.clicks_delta || 0),
      impressionsDelta: Number(row.impressions_delta || 0),
      integrityStatus: row.integrity_status || 'BLOCKED',
      integrityCodes: Array.isArray(row.integrity_codes) ? row.integrity_codes.map(String) : [],
      integrityReason: row.integrity_reason ? String(row.integrity_reason) : null,
      dataAgeHours: row.data_age_hours === null ? null : Number(row.data_age_hours),
      baselineAgeHours: row.baseline_age_hours === null ? null : Number(row.baseline_age_hours),
      exposureDays: row.exposure_days === null ? null : Number(row.exposure_days),
      baselineQueryShare: row.baseline_query_share === null ? null : Number(row.baseline_query_share),
      currentQueryShare: row.current_query_share === null ? null : Number(row.current_query_share),
      queryShareShift: row.query_share_shift === null ? null : Number(row.query_share_shift),
      trafficRatio: row.traffic_ratio === null ? null : Number(row.traffic_ratio),
      measuredAt: String(row.measured_at || ''),
    })
    measurementsByExecution.set(executionId, items)
  }

  const executionsByAction: Record<string, SeoActionExecution[]> = {}
  for (const row of executions) {
    const actionId = String(row.action_id)
    const item: SeoActionExecution = {
      id: String(row.id),
      actionId,
      executionKind: String(row.execution_kind || ''),
      repository: row.repository ? String(row.repository) : null,
      pullRequestNumber: row.pull_request_number === null ? null : Number(row.pull_request_number),
      commitSha: row.commit_sha ? String(row.commit_sha) : null,
      baseCommitSha: row.base_commit_sha ? String(row.base_commit_sha) : null,
      rollbackCommitSha: row.rollback_commit_sha ? String(row.rollback_commit_sha) : null,
      diffSha256: row.diff_sha256 ? String(row.diff_sha256) : null,
      changedFiles: Array.isArray(row.changed_files) ? row.changed_files.map(String) : [],
      riskMode: row.risk_mode ? String(row.risk_mode) : null,
      liveUrl: row.live_url ? String(row.live_url) : null,
      appliedAt: String(row.applied_at || ''),
      monitorStatus: row.monitor_status,
      rollbackReviewReason: row.rollback_review_reason ? String(row.rollback_review_reason) : null,
      rollbackStatus: row.rollback_status || 'NONE',
      rollbackTriggerMeasurementId: row.rollback_trigger_measurement_id ? String(row.rollback_trigger_measurement_id) : null,
      rollbackActualCommitSha: row.rollback_actual_commit_sha ? String(row.rollback_actual_commit_sha) : null,
      rollbackActualDiffSha256: row.rollback_actual_diff_sha256 ? String(row.rollback_actual_diff_sha256) : null,
      rolledBackAt: row.rolled_back_at ? String(row.rolled_back_at) : null,
      rollbackError: row.rollback_error ? String(row.rollback_error) : null,
      measurements: measurementsByExecution.get(String(row.id)) || [],
    }
    ;(executionsByAction[actionId] ||= []).push(item)
  }

  const executorByAction: Record<string, SeoExecutorJob> = {}
  for (const row of (executorData || []) as Array<Record<string, any>>) {
    executorByAction[String(row.action_id)] = {
      id: String(row.id),
      actionId: String(row.action_id),
      riskMode: row.risk_mode,
      status: row.status,
      targetRepository: String(row.target_repository || ''),
      executionKind: String(row.execution_kind || ''),
      reason: String(row.reason || ''),
      attempts: Number(row.attempts || 0),
      baseCommitSha: row.base_commit_sha ? String(row.base_commit_sha) : null,
      patchCommitSha: row.patch_commit_sha ? String(row.patch_commit_sha) : null,
      rollbackCommitSha: row.rollback_commit_sha ? String(row.rollback_commit_sha) : null,
      diffSha256: row.diff_sha256 ? String(row.diff_sha256) : null,
      changedFiles: Array.isArray(row.changed_files) ? row.changed_files.map(String) : [],
      pullRequestNumber: row.pull_request_number === null ? null : Number(row.pull_request_number),
      pullRequestUrl: row.pull_request_url ? String(row.pull_request_url) : null,
      liveVerifiedAt: row.live_verified_at ? String(row.live_verified_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      guardCode: row.guard_code || 'READY',
      guardReason: row.guard_reason ? String(row.guard_reason) : null,
      nextEligibleAt: row.next_eligible_at ? String(row.next_eligible_at) : null,
      budgetUsed24h: Number(row.budget_used_24h || 0),
      budgetLimit24h: Number(row.budget_limit_24h || 4),
      activePageExperiments: Number(row.active_page_experiments || 0),
      pageLockExecutionId: row.page_lock_execution_id ? String(row.page_lock_execution_id) : null,
      updatedAt: String(row.updated_at || ''),
    }
  }

  return { recoveryByAction, executionsByAction, executorByAction }
}
