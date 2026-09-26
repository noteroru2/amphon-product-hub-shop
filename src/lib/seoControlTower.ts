import { supabase } from './supabase'

export type SeoAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL'
export type SeoAlertStatus = 'OPEN' | 'RESOLVED'

export interface SeoControlTowerSummary {
  activeExperiments: number
  waiting7d: number
  waiting14d: number
  waiting28d: number
  improved: number
  regressed: number
  contaminated: number
  externalShift: number
  rollbackActive: number
  rollbackProblem: number
  recoveryMonitoring: number
  learningHigh: number
  priorFavor: number
  priorCaution: number
  humanReview: number
  openAlerts: number
  unreadAlerts: number
  criticalAlerts: number
  generatedAt: string
}

export interface SeoControlTowerExperiment {
  executionId: string
  actionId: string
  primaryQuery: string
  page: string
  actionType: string
  opportunityType: string
  appliedAt: string
  monitorStatus: string
  rollbackStatus: string
  rolledBackAt: string | null
  recoveryStatus: string
  recoveryFinalVerdict: string | null
  recoveryLockUntil: string | null
  nextCheckpointDays: number | null
  nextCheckpointDueAt: string | null
  latestCheckpointDays: number | null
  latestMeasuredAt: string | null
  latestVerdict: string | null
  latestIntegrityStatus: string | null
  latestPositionDelta: number | null
  latestCtrDelta: number | null
  latestCausalStatus: string | null
  latestVolatilityStatus: string | null
  contaminatingCommitCount: number
  volatilityPeerCount: number
  volatilityMedianPositionDelta: number | null
  latestRecoveryCheckpointDays: number | null
  latestRecoveryMaturity: string | null
  latestRecoveryMeasuredAt: string | null
  latestRecoveryVerdict: string | null
  latestRecoveryIntegrityStatus: string | null
  latestRecoveryCausalStatus: string | null
  latestRecoveryVolatilityStatus: string | null
  riskMode: string | null
  guardCode: string | null
  priorState: string | null
  priorScore: number | null
  learningSignal: string | null
  learningConfidence: string | null
  evidenceCount: number
}

export interface SeoControlTowerAlert {
  id: string
  dedupeKey: string
  alertType: string
  severity: SeoAlertSeverity
  status: SeoAlertStatus
  generation: number
  actionId: string | null
  executionId: string | null
  sourceId: string | null
  primaryQuery: string | null
  page: string | null
  title: string
  message: string
  metadata: Record<string, any>
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
  acknowledged: boolean
  acknowledgedAt: string | null
}

function mapSummary(row: Record<string, any> | null): SeoControlTowerSummary {
  return {
    activeExperiments: Number(row?.active_experiments || 0),
    waiting7d: Number(row?.waiting_7d || 0),
    waiting14d: Number(row?.waiting_14d || 0),
    waiting28d: Number(row?.waiting_28d || 0),
    improved: Number(row?.improved || 0),
    regressed: Number(row?.regressed || 0),
    contaminated: Number(row?.contaminated || 0),
    externalShift: Number(row?.external_shift || 0),
    rollbackActive: Number(row?.rollback_active || 0),
    rollbackProblem: Number(row?.rollback_problem || 0),
    recoveryMonitoring: Number(row?.recovery_monitoring || 0),
    learningHigh: Number(row?.learning_high || 0),
    priorFavor: Number(row?.prior_favor || 0),
    priorCaution: Number(row?.prior_caution || 0),
    humanReview: Number(row?.human_review || 0),
    openAlerts: Number(row?.open_alerts || 0),
    unreadAlerts: Number(row?.unread_alerts || 0),
    criticalAlerts: Number(row?.critical_alerts || 0),
    generatedAt: String(row?.generated_at || ''),
  }
}

function mapExperiment(row: Record<string, any>): SeoControlTowerExperiment {
  return {
    executionId: String(row.execution_id),
    actionId: String(row.action_id),
    primaryQuery: String(row.primary_query || ''),
    page: String(row.page || ''),
    actionType: String(row.action_type || ''),
    opportunityType: String(row.opportunity_type || ''),
    appliedAt: String(row.applied_at || ''),
    monitorStatus: String(row.monitor_status || ''),
    rollbackStatus: String(row.rollback_status || ''),
    rolledBackAt: row.rolled_back_at ? String(row.rolled_back_at) : null,
    recoveryStatus: String(row.recovery_status || 'NONE'),
    recoveryFinalVerdict: row.recovery_final_verdict ? String(row.recovery_final_verdict) : null,
    recoveryLockUntil: row.recovery_lock_until ? String(row.recovery_lock_until) : null,
    nextCheckpointDays: row.next_checkpoint_days === null ? null : Number(row.next_checkpoint_days),
    nextCheckpointDueAt: row.next_checkpoint_due_at ? String(row.next_checkpoint_due_at) : null,
    latestCheckpointDays: row.latest_checkpoint_days === null ? null : Number(row.latest_checkpoint_days),
    latestMeasuredAt: row.latest_measured_at ? String(row.latest_measured_at) : null,
    latestVerdict: row.latest_verdict ? String(row.latest_verdict) : null,
    latestIntegrityStatus: row.latest_integrity_status ? String(row.latest_integrity_status) : null,
    latestPositionDelta: row.latest_position_delta === null ? null : Number(row.latest_position_delta),
    latestCtrDelta: row.latest_ctr_delta === null ? null : Number(row.latest_ctr_delta),
    latestCausalStatus: row.latest_causal_status ? String(row.latest_causal_status) : null,
    latestVolatilityStatus: row.latest_volatility_status ? String(row.latest_volatility_status) : null,
    contaminatingCommitCount: Number(row.contaminating_commit_count || 0),
    volatilityPeerCount: Number(row.volatility_peer_count || 0),
    volatilityMedianPositionDelta: row.volatility_median_position_delta === null ? null : Number(row.volatility_median_position_delta),
    latestRecoveryCheckpointDays: row.latest_recovery_checkpoint_days === null ? null : Number(row.latest_recovery_checkpoint_days),
    latestRecoveryMaturity: row.latest_recovery_maturity ? String(row.latest_recovery_maturity) : null,
    latestRecoveryMeasuredAt: row.latest_recovery_measured_at ? String(row.latest_recovery_measured_at) : null,
    latestRecoveryVerdict: row.latest_recovery_verdict ? String(row.latest_recovery_verdict) : null,
    latestRecoveryIntegrityStatus: row.latest_recovery_integrity_status ? String(row.latest_recovery_integrity_status) : null,
    latestRecoveryCausalStatus: row.latest_recovery_causal_status ? String(row.latest_recovery_causal_status) : null,
    latestRecoveryVolatilityStatus: row.latest_recovery_volatility_status ? String(row.latest_recovery_volatility_status) : null,
    riskMode: row.risk_mode ? String(row.risk_mode) : null,
    guardCode: row.guard_code ? String(row.guard_code) : null,
    priorState: row.prior_state ? String(row.prior_state) : null,
    priorScore: row.prior_score === null ? null : Number(row.prior_score),
    learningSignal: row.learning_signal ? String(row.learning_signal) : null,
    learningConfidence: row.learning_confidence ? String(row.learning_confidence) : null,
    evidenceCount: Number(row.evidence_count || 0),
  }
}

function mapAlert(row: Record<string, any>): SeoControlTowerAlert {
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key || ''),
    alertType: String(row.alert_type || ''),
    severity: row.severity,
    status: row.status,
    generation: Number(row.generation || 1),
    actionId: row.action_id ? String(row.action_id) : null,
    executionId: row.execution_id ? String(row.execution_id) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    primaryQuery: row.primary_query ? String(row.primary_query) : null,
    page: row.page ? String(row.page) : null,
    title: String(row.title || ''),
    message: String(row.message || ''),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    firstSeenAt: String(row.first_seen_at || ''),
    lastSeenAt: String(row.last_seen_at || ''),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    acknowledged: Boolean(row.acknowledged),
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
  }
}

export async function loadSeoControlTower() {
  if (!supabase) throw new Error('Supabase is not configured')

  const [summaryResult, experimentResult, alertResult] = await Promise.all([
    supabase
      .from('commerce_seo_control_tower_summary_v')
      .select('*')
      .maybeSingle(),
    supabase
      .from('commerce_seo_control_tower_experiments_v')
      .select('*')
      .order('applied_at', { ascending: false })
      .limit(50),
    supabase
      .from('commerce_seo_alert_inbox_v')
      .select('*')
      .order('status', { ascending: true })
      .order('severity', { ascending: true })
      .order('last_seen_at', { ascending: false })
      .limit(100),
  ])

  if (summaryResult.error) throw summaryResult.error
  if (experimentResult.error) throw experimentResult.error
  if (alertResult.error) throw alertResult.error

  return {
    summary: mapSummary(summaryResult.data as Record<string, any> | null),
    experiments: ((experimentResult.data || []) as Array<Record<string, any>>).map(mapExperiment),
    alerts: ((alertResult.data || []) as Array<Record<string, any>>).map(mapAlert),
  }
}

export async function loadSeoAlertUnreadCount() {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('commerce_seo_alert_inbox_v')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'OPEN')
    .eq('acknowledged', false)
  if (error) throw error
  return Number(count || 0)
}

export async function acknowledgeSeoAlert(alertId: string) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('acknowledge_commerce_seo_alert', {
    p_alert_id: alertId,
  })
  if (error) throw error
}

export async function acknowledgeAllSeoAlerts() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('acknowledge_all_commerce_seo_alerts')
  if (error) throw error
  return Number(data || 0)
}
