import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  TrendingUp,
  WandSparkles,
  XCircle,
} from 'lucide-react'
import {
  listSeoActions,
  loadSeoOpsDetails,
  retrySeoExecutorJob,
  setSeoActionStatus,
  type SeoAction,
  type SeoActionStatus,
  type SeoActionType,
  type SeoActionExecution,
  type SeoActionPrior,
  type SeoExecutorJob,
  type SeoLearningLedger,
  type SeoRecoveryDiagnostic,
} from '../lib/seoOpportunities'

const TYPE_META: Record<SeoActionType, { label: string; tone: string; icon: typeof TrendingUp }> = {
  META_REVIEW: { label: 'CTR / Meta', tone: 'violet', icon: WandSparkles },
  INTERNAL_LINK_BOOST: { label: 'Internal Link', tone: 'blue', icon: Link2 },
  RECOVERY_PLAN: { label: 'Recovery', tone: 'amber', icon: SearchCheck },
  PROTECT_PAGE: { label: 'Protect', tone: 'green', icon: ShieldCheck },
  BRAND_WATCH: { label: 'Brand Watch', tone: 'slate', icon: ShieldCheck },
  WATCH: { label: 'Watch', tone: 'slate', icon: TrendingUp },
}

type Filter = 'ALL' | SeoActionType

function percent(value: number) {
  return new Intl.NumberFormat('th-TH', { style: 'percent', maximumFractionDigits: 2 }).format(value)
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value)
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 10) : '—'
}

const EXECUTOR_MODE_LABEL: Record<SeoExecutorJob['riskMode'], string> = {
  AUTO_DEPLOY: 'AUTO DEPLOY',
  PR_ONLY: 'PR ONLY',
  HUMAN_REVIEW: 'HUMAN REVIEW',
  PROTECT: 'NO MUTATION',
  OBSERVE: 'OBSERVE',
}

function pageLabel(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`
  } catch {
    return url
  }
}

export function SeoOpportunityCenter({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<SeoAction[]>([])
  const [filter, setFilter] = useState<Filter>('ALL')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recoveryByAction, setRecoveryByAction] = useState<Record<string, SeoRecoveryDiagnostic>>({})
  const [executionsByAction, setExecutionsByAction] = useState<Record<string, SeoActionExecution[]>>({})
  const [executorByAction, setExecutorByAction] = useState<Record<string, SeoExecutorJob>>({})
  const [learningByAction, setLearningByAction] = useState<Record<string, SeoLearningLedger>>({})
  const [priorByAction, setPriorByAction] = useState<Record<string, SeoActionPrior>>({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const nextItems = await listSeoActions()
      setItems(nextItems)
      const details = await loadSeoOpsDetails(nextItems.map((item) => item.id))
      setRecoveryByAction(details.recoveryByAction)
      setExecutionsByAction(details.executionsByAction)
      setExecutorByAction(details.executorByAction)
      setLearningByAction(details.learningByAction)
      setPriorByAction(details.priorByAction)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const visible = useMemo(
    () => filter === 'ALL' ? items : items.filter((item) => item.actionType === filter),
    [items, filter],
  )

  const summary = useMemo(() => {
    const learning = Object.values(learningByAction)
    const priors = Object.values(priorByAction)
    return {
      open: items.filter((item) => item.status === 'OPEN').length,
      protect: items.filter((item) => item.status === 'PROTECTED').length,
      meta: items.filter((item) => item.actionType === 'META_REVIEW').length,
      favor: priors.filter((item) => item.priorState === 'FAVOR').length,
      caution: priors.filter((item) => item.priorState === 'CAUTION').length,
      learned: learning.filter((item) => item.confidence === 'HIGH').length,
    }
  }, [items, learningByAction, priorByAction])

  async function setStatus(item: SeoAction, status: Exclude<SeoActionStatus, 'STALE'>) {
    setBusyId(item.id)
    setError(null)
    try {
      await setSeoActionStatus(item.id, status)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function retryExecutor(job: SeoExecutorJob) {
    setBusyId(job.actionId)
    setError(null)
    try {
      await retrySeoExecutorJob(job.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="screen page-pad seo-opportunity-screen">
      <header className="topbar seo-opportunity-topbar">
        <button className="icon-btn" onClick={onBack} aria-label="กลับ">
          <ArrowLeft />
        </button>
        <div>
          <p className="eyebrow">SEARCH CONSOLE</p>
          <h1>SEO Action Center</h1>
        </div>
        <button className="refresh-button" onClick={() => void load()} aria-label="รีเฟรช">
          <RefreshCw className={loading ? 'spin' : ''} />
        </button>
      </header>

      <div className="seo-action-guard">
        <ShieldCheck size={20} />
        <div>
          <strong>Guard เปิดอยู่</strong>
          <span>Measurement Integrity • Prior-aware Selector (ขั้นต่ำ 3 HIGH) • Page Lock • Action Budget 4/24h • Auto Rollback → Recovery → Learning Ledger</span>
        </div>
      </div>

      <div className="seo-action-summary">
        <div><span>รอดำเนินการ</span><strong>{summary.open}</strong></div>
        <div><span>Protect</span><strong>{summary.protect}</strong></div>
        <div><span>CTR</span><strong>{summary.meta}</strong></div>
        <div><span>Prior FAVOR</span><strong>{summary.favor}</strong></div>
        <div><span>Prior CAUTION</span><strong>{summary.caution}</strong></div>
        <div><span>Learned High</span><strong>{summary.learned}</strong></div>
      </div>

      <div className="seo-action-filters" role="tablist" aria-label="ตัวกรอง SEO">
        {([
          ['ALL', 'ทั้งหมด'],
          ['META_REVIEW', 'CTR'],
          ['INTERNAL_LINK_BOOST', 'Link'],
          ['RECOVERY_PLAN', 'Recovery'],
          ['PROTECT_PAGE', 'Protect'],
        ] as Array<[Filter,string]>).map(([value,label]) => (
          <button
            key={value}
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="inline-error"><span>{error}</span><button onClick={() => void load()}>ลองใหม่</button></div>}

      {loading && !items.length ? (
        <div className="seo-action-loading"><LoaderCircle className="spin" /> กำลังอ่าน GSC Action Queue...</div>
      ) : (
        <div className="seo-action-list">
          {visible.map((item) => {
            const meta = TYPE_META[item.actionType]
            const Icon = meta.icon
            const busy = busyId === item.id
            return (
              <article className="seo-action-card" key={item.id}>
                <div className="seo-action-card-head">
                  <span className={`seo-action-type tone-${meta.tone}`}><Icon size={15} /> {meta.label}</span>
                  <span className={`seo-action-status status-${item.status.toLowerCase()}`}>{item.status}</span>
                </div>

                <h2>{item.primaryQuery}</h2>
                <a className="seo-action-page" href={item.page} target="_blank" rel="noreferrer">
                  {pageLabel(item.page)} <ExternalLink size={13} />
                </a>

                <div className="seo-action-metrics">
                  <div><span>Impressions</span><strong>{number(item.impressions)}</strong></div>
                  <div><span>Clicks</span><strong>{number(item.clicks)}</strong></div>
                  <div><span>CTR</span><strong>{percent(item.ctr)}</strong></div>
                  <div><span>Position</span><strong>{number(item.position, 2)}</strong></div>
                </div>

                <div className="seo-action-plan">
                  <strong>ระบบแนะนำ</strong>
                  <p>{item.recommendedAction}</p>
                  {item.queryCount > 1 && <small>รวม {item.queryCount} query variants ที่ชี้ URL เดียวกัน</small>}
                </div>

                {priorByAction[item.id] && (() => {
                  const prior = priorByAction[item.id]
                  return (
                    <div className={`seo-prior-selector state-${prior.priorState.toLowerCase()}`}>
                      <div className="seo-recovery-head">
                        <strong>Prior-aware Action Selector</strong>
                        <span>{prior.priorState.replaceAll('_', ' ')}</span>
                      </div>
                      <p>{prior.priorReason}</p>
                      <small>
                        Scope {prior.priorScope.replaceAll('_', ' ')}
                        {' • '}Score {number(prior.priorScore, 3)}
                        {' • '}HIGH {prior.highConfidenceExperiments}/{prior.experiments}
                      </small>
                      <small>
                        Benefit {prior.benefitConfirmed}
                        {' • '}Harm directional {prior.harmDirectional}
                        {' • '}Priority {number(item.priorityScore, 1)} → {number(prior.priorAdjustedPriority, 1)}
                      </small>
                      {prior.priorState === 'FAVOR' && (
                        <small>ใช้ prior เพื่อจัดคิวงานที่ผ่าน hard guards แล้วให้มาก่อนเท่านั้น — ไม่ปลด safety guard</small>
                      )}
                      {prior.priorState === 'CAUTION' && (
                        <small>ระบบลดระดับ mutation อัตโนมัติเป็น Human Review จนกว่าจะมีหลักฐานใหม่เปลี่ยน prior</small>
                      )}
                    </div>
                  )
                })()}

                {recoveryByAction[item.id] && (
                  <div className={`seo-recovery-diagnostic ${recoveryByAction[item.id].requiresHumanReview ? 'review-required' : 'auto-safe'}`}>
                    <div className="seo-recovery-head">
                      <strong>Recovery Diagnosis</strong>
                      <span>{recoveryByAction[item.id].diagnosisType.replaceAll('_', ' ')}</span>
                    </div>
                    <p>{recoveryByAction[item.id].recommendedChecks}</p>
                    <small>
                      Query owner pages: {recoveryByAction[item.id].competingPageCount}
                      {' • '}Current share {percent(recoveryByAction[item.id].currentShare)}
                      {recoveryByAction[item.id].autoSafeInternalLink ? ' • ผ่าน Auto-link guard' : ' • ต้องตรวจ ownership ก่อน'}
                    </small>
                  </div>
                )}

                {executorByAction[item.id] && (() => {
                  const job = executorByAction[item.id]
                  const retryable = job.status === 'FAILED' && (job.riskMode === 'AUTO_DEPLOY' || job.riskMode === 'PR_ONLY')
                  return (
                    <div className={`seo-executor-panel mode-${job.riskMode.toLowerCase()} status-${job.status.toLowerCase()}`}>
                      <div className="seo-recovery-head">
                        <strong>SEO Action Executor</strong>
                        <span>{EXECUTOR_MODE_LABEL[job.riskMode]} • {job.status}</span>
                      </div>
                      <p>{job.reason}</p>
                      <div className={`seo-executor-prior state-${job.priorState.toLowerCase()}`}>
                        <div className="seo-auto-rollback-head">
                          <strong>Prior snapshot</strong>
                          <span>{job.priorState}</span>
                        </div>
                        {job.priorReason && <small>{job.priorReason}</small>}
                        <small>
                          {job.priorScope.replaceAll('_', ' ')}
                          {' • '}score {number(job.priorScore, 3)}
                          {' • '}HIGH {job.priorHighConfidenceExperiments}/{job.priorExperiments}
                        </small>
                      </div>
                      <div className={`seo-executor-guard guard-${job.guardCode.toLowerCase()}`}>
                        <div className="seo-auto-rollback-head">
                          <strong>Execution Safety Guard</strong>
                          <span>{job.guardCode.replaceAll('_', ' ')}</span>
                        </div>
                        {job.guardReason && <small>{job.guardReason}</small>}
                        <small>
                          Action Budget {job.budgetUsed24h}/{job.budgetLimit24h} ใน 24 ชม.
                          {' • '}Active experiment URL นี้ {job.activePageExperiments}
                        </small>
                        {job.nextEligibleAt && (
                          <small>คาดว่าตรวจใหม่ได้หลัง {new Date(job.nextEligibleAt).toLocaleString('th-TH')}</small>
                        )}
                      </div>
                      <div className="seo-executor-artifacts">
                        <span>Repo <strong>{job.targetRepository}</strong></span>
                        {job.patchCommitSha && <span>Commit <code>{shortSha(job.patchCommitSha)}</code></span>}
                        {job.rollbackCommitSha && <span>Rollback <code>{shortSha(job.rollbackCommitSha)}</code></span>}
                        {job.diffSha256 && <span>Diff SHA <code>{shortSha(job.diffSha256)}</code></span>}
                        {job.changedFiles.length > 0 && <span>Files <strong>{job.changedFiles.join(', ')}</strong></span>}
                        {job.liveVerifiedAt && <span>Live verified <strong>{new Date(job.liveVerifiedAt).toLocaleString('th-TH')}</strong></span>}
                      </div>
                      {job.pullRequestUrl && (
                        <a className="seo-executor-pr" href={job.pullRequestUrl} target="_blank" rel="noreferrer">
                          ตรวจ PR #{job.pullRequestNumber} <ExternalLink size={12} />
                        </a>
                      )}
                      {job.lastError && <div className="seo-executor-error">{job.lastError}</div>}
                      {retryable && (
                        <button
                          className="seo-executor-retry"
                          disabled={busy}
                          onClick={() => void retryExecutor(job)}
                        >
                          {busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} ลอง Executor อีกครั้ง
                        </button>
                      )}
                    </div>
                  )
                })()}

                {(executionsByAction[item.id] || []).slice(0, 1).map((execution) => (
                  <div className={`seo-measurement-panel monitor-${execution.monitorStatus.toLowerCase()}`} key={execution.id}>
                    <div className="seo-recovery-head">
                      <strong>Execute → Measure</strong>
                      <span>{execution.monitorStatus}</span>
                    </div>
                    <p>
                      Deploy แล้ว {new Date(execution.appliedAt).toLocaleDateString('th-TH')}
                      {execution.repository ? ` • ${execution.repository}` : ''}
                      {execution.pullRequestNumber ? ` • PR #${execution.pullRequestNumber}` : ''}
                    </p>
                    {execution.measurements.length > 0 ? (
                      <div className="seo-measurement-chips">
                        {execution.measurements.map((measurement) => (
                          <div className="seo-measurement-entry" key={measurement.checkpointDays}>
                            <span className={`verdict-${measurement.verdict.toLowerCase()}`}>
                              {measurement.checkpointDays}D {measurement.verdict}
                              {' • '}Pos {measurement.positionDelta > 0 ? '+' : ''}{number(measurement.positionDelta, 2)}
                              {' • '}CTR {measurement.ctrDelta > 0 ? '+' : ''}{percent(measurement.ctrDelta)}
                            </span>
                            <small className={`seo-integrity-status integrity-${measurement.integrityStatus.toLowerCase()}`}>
                              Integrity {measurement.integrityStatus}
                              {measurement.integrityCodes.length > 0 ? ` • ${measurement.integrityCodes.join(', ')}` : ''}
                              {measurement.exposureDays !== null ? ` • exposure ${number(measurement.exposureDays, 1)}d` : ''}
                            </small>
                            {measurement.integrityReason && measurement.integrityStatus === 'BLOCKED' && (
                              <small className="seo-integrity-reason">{measurement.integrityReason}</small>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <small>รอ checkpoint 7 / 14 / 28 วันจาก GSC</small>
                    )}
                    {execution.rollbackStatus !== 'NONE' && (
                      <div className={`seo-auto-rollback status-${execution.rollbackStatus.toLowerCase()}`}>
                        <div className="seo-auto-rollback-head">
                          <strong>Auto Rollback</strong>
                          <span>{execution.rollbackStatus}</span>
                        </div>
                        {execution.rollbackActualCommitSha && (
                          <small>Revert commit <code>{shortSha(execution.rollbackActualCommitSha)}</code></small>
                        )}
                        {execution.rollbackActualDiffSha256 && (
                          <small>Rollback diff <code>{shortSha(execution.rollbackActualDiffSha256)}</code></small>
                        )}
                        {execution.rolledBackAt && (
                          <small>คืนค่าบนเว็บแล้ว {new Date(execution.rolledBackAt).toLocaleString('th-TH')}</small>
                        )}
                        {execution.rollbackError && <div className="seo-executor-error">{execution.rollbackError}</div>}
                      </div>
                    )}
                    {execution.recoveryStatus !== 'NONE' && (
                      <div className={`seo-recovery-measurement status-${execution.recoveryStatus.toLowerCase()}`}>
                        <div className="seo-auto-rollback-head">
                          <strong>Rollback Recovery Measurement</strong>
                          <span>{execution.recoveryStatus}</span>
                        </div>
                        {execution.recoveryLockUntil && (
                          <small>Page Lock ถึงไม่เกิน {new Date(execution.recoveryLockUntil).toLocaleString('th-TH')} หรือปลดก่อนเมื่อ 28D ผ่าน</small>
                        )}
                        {execution.recoveryMeasurements.length > 0 ? (
                          <div className="seo-measurement-chips">
                            {execution.recoveryMeasurements.map((measurement) => (
                              <div className="seo-measurement-entry" key={measurement.checkpointDays}>
                                <span className={`recovery-verdict-${measurement.verdict.toLowerCase()}`}>
                                  {measurement.checkpointDays}D {measurement.maturity} • {measurement.verdict}
                                  {' • '}Pos vs trigger {measurement.positionDeltaVsTrigger > 0 ? '+' : ''}{number(measurement.positionDeltaVsTrigger, 2)}
                                </span>
                                <small className={`seo-integrity-status integrity-${measurement.integrityStatus.toLowerCase()}`}>
                                  Integrity {measurement.integrityStatus}
                                  {' • '}28D window purity {percent(measurement.windowPurity)}
                                  {measurement.postRollbackExposureDays !== null ? ` • exposure ${number(measurement.postRollbackExposureDays, 1)}d` : ''}
                                </small>
                                {measurement.integrityCodes.length > 0 && (
                                  <small className="seo-integrity-reason">{measurement.integrityCodes.join(', ')}</small>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <small>รอ Recovery checkpoint 7 / 14 / 28 วันหลัง rollback</small>
                        )}
                        {execution.recoveryFinalVerdict && (
                          <small>Final recovery: <strong>{execution.recoveryFinalVerdict}</strong></small>
                        )}
                      </div>
                    )}
                    {execution.rollbackReviewReason && <div className="seo-rollback-note">{execution.rollbackReviewReason}</div>}
                  </div>
                ))}

                {learningByAction[item.id] && (() => {
                  const learning = learningByAction[item.id]
                  return (
                    <div className={`seo-learning-ledger signal-${learning.learningSignal.toLowerCase()}`}>
                      <div className="seo-recovery-head">
                        <strong>SEO Learning Ledger</strong>
                        <span>{learning.learningSignal.replaceAll('_', ' ')}</span>
                      </div>
                      <small>
                        Confidence {learning.confidence}
                        {' • '}Evidence {learning.evidenceCount}
                        {learning.latestActionCheckpointDays ? ` • Action ${learning.latestActionCheckpointDays}D ${learning.latestActionVerdict || ''}` : ''}
                      </small>
                      {learning.rollbackTriggered && (
                        <small>
                          Rollback trigger {learning.rollbackTriggerCheckpointDays || '—'}D
                          {learning.latestRecoveryCheckpointDays ? ` • Recovery ${learning.latestRecoveryCheckpointDays}D ${learning.latestRecoveryVerdict || ''}` : ' • รอ Recovery evidence'}
                        </small>
                      )}
                      <small>
                        Learning weight {number(learning.signalWeight, 2)}
                        {' • '}Confidence weight {number(learning.confidenceWeight, 2)}
                      </small>
                    </div>
                  )
                })()}

                {(item.candidateTitle || item.candidateDescription || item.candidateNotes) && (
                  <div className="seo-action-candidate">
                    <span>Candidate พร้อมตรวจ</span>
                    {item.candidateTitle && <strong>{item.candidateTitle}</strong>}
                    {item.candidateDescription && <p>{item.candidateDescription}</p>}
                    {item.candidateNotes && <small>{item.candidateNotes}</small>}
                  </div>
                )}

                <div className="seo-action-footer">
                  <span>Priority {number(item.priorityScore, 1)}</span>
                  <div>
                    {item.executionMode === 'REVIEW' && item.status === 'OPEN' && (
                      <>
                        <button
                          className="seo-action-dismiss"
                          disabled={busy}
                          onClick={() => void setStatus(item, 'DISMISSED')}
                        >
                          <XCircle size={15} /> ข้าม
                        </button>
                        <button
                          className="seo-action-approve"
                          disabled={busy}
                          onClick={() => void setStatus(item, 'APPROVED')}
                        >
                          {busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
                          อนุมัติแผน
                        </button>
                      </>
                    )}
                    {item.status === 'APPROVED' && <span className="seo-approved-note"><CheckCircle2 size={15} /> อนุมัติแล้ว</span>}
                    {item.status === 'PROTECTED' && <span className="seo-protect-note"><ShieldCheck size={15} /> ล็อก Protect</span>}
                  </div>
                </div>
              </article>
            )
          })}
          {!visible.length && !loading && <div className="empty-state"><SearchCheck /><strong>ไม่มี Action ในกลุ่มนี้</strong></div>}
        </div>
      )}
    </section>
  )
}
