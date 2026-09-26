import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import {
  acknowledgeAllSeoAlerts,
  acknowledgeSeoAlert,
  loadSeoControlTower,
  type SeoControlTowerAlert,
  type SeoControlTowerExperiment,
  type SeoControlTowerSummary,
} from '../lib/seoControlTower'

const EMPTY_SUMMARY: SeoControlTowerSummary = {
  activeExperiments: 0,
  waiting7d: 0,
  waiting14d: 0,
  waiting28d: 0,
  improved: 0,
  regressed: 0,
  contaminated: 0,
  externalShift: 0,
  rollbackActive: 0,
  rollbackProblem: 0,
  recoveryMonitoring: 0,
  learningHigh: 0,
  priorFavor: 0,
  priorCaution: 0,
  humanReview: 0,
  openAlerts: 0,
  unreadAlerts: 0,
  criticalAlerts: 0,
  generatedAt: '',
}

function number(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('th-TH', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('th-TH', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value)
}

function when(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function pageLabel(value: string) {
  try {
    const url = new URL(value)
    return decodeURIComponent(url.pathname)
  } catch {
    return value
  }
}

function dueLabel(experiment: SeoControlTowerExperiment) {
  if (!experiment.nextCheckpointDays || !experiment.nextCheckpointDueAt) return 'Measurement cycle complete'
  const due = new Date(experiment.nextCheckpointDueAt).getTime()
  const diff = due - Date.now()
  const days = Math.ceil(Math.abs(diff) / 86_400_000)
  if (diff > 0) return `${experiment.nextCheckpointDays}D อีกประมาณ ${days} วัน`
  return `${experiment.nextCheckpointDays}D เกินกำหนด ${days} วัน`
}

function severityRank(alert: SeoControlTowerAlert) {
  if (alert.severity === 'CRITICAL') return 0
  if (alert.severity === 'WARNING') return 1
  return 2
}

export function SeoControlTower({
  onBack,
  onOpenActions,
  onAlertCountChange,
}: {
  onBack: () => void
  onOpenActions: () => void
  onAlertCountChange?: (count: number) => void
}) {
  const [summary, setSummary] = useState<SeoControlTowerSummary>(EMPTY_SUMMARY)
  const [experiments, setExperiments] = useState<SeoControlTowerExperiment[]>([])
  const [alerts, setAlerts] = useState<SeoControlTowerAlert[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyAlert, setBusyAlert] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await loadSeoControlTower()
      setSummary(data.summary)
      setExperiments(data.experiments)
      setAlerts(data.alerts)
      onAlertCountChange?.(data.summary.unreadAlerts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 60_000)
    return () => window.clearInterval(timer)
    // load once and then refresh visible state every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleAlerts = useMemo(
    () => alerts
      .filter((alert) => showResolved || alert.status === 'OPEN')
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'OPEN' ? -1 : 1
        const severity = severityRank(a) - severityRank(b)
        if (severity) return severity
        return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
      }),
    [alerts, showResolved],
  )

  const activeExperiments = useMemo(
    () => experiments.filter((item) =>
      ['MONITORING', 'ROLLBACK_REVIEW'].includes(item.monitorStatus) ||
      item.recoveryStatus === 'MONITORING',
    ),
    [experiments],
  )

  async function acknowledge(alertId: string) {
    setBusyAlert(alertId)
    setError(null)
    try {
      await acknowledgeSeoAlert(alertId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAlert(null)
    }
  }

  async function acknowledgeAll() {
    setBusyAlert('ALL')
    setError(null)
    try {
      await acknowledgeAllSeoAlerts()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAlert(null)
    }
  }

  return (
    <section className="screen page-pad seo-control-tower-screen">
      <header className="topbar seo-control-tower-topbar">
        <button className="icon-btn" onClick={onBack} aria-label="กลับ">
          <ArrowLeft />
        </button>
        <div>
          <p className="eyebrow">SEO OPERATIONS</p>
          <h1>Control Tower</h1>
        </div>
        <button className="refresh-button" onClick={() => void load()} aria-label="รีเฟรช">
          <RefreshCw className={loading ? 'spin' : ''} />
        </button>
      </header>

      <div className={`seo-tower-health ${summary.criticalAlerts > 0 ? 'critical' : summary.openAlerts > 0 ? 'warning' : 'healthy'}`}>
        {summary.criticalAlerts > 0 ? <ShieldAlert size={21} /> : summary.openAlerts > 0 ? <AlertTriangle size={21} /> : <CheckCircle2 size={21} />}
        <div>
          <strong>
            {summary.criticalAlerts > 0
              ? `มี Critical Alert ${summary.criticalAlerts} รายการ`
              : summary.openAlerts > 0
                ? `มี Alert ที่ต้องติดตาม ${summary.openAlerts} รายการ`
                : 'SEO Automation ทำงานปกติ'}
          </strong>
          <span>
            Active {summary.activeExperiments} • Human Review {summary.humanReview} • HIGH Learning {summary.learningHigh}
          </span>
        </div>
        {summary.unreadAlerts > 0 && <b>{summary.unreadAlerts}</b>}
      </div>

      <div className="seo-tower-kpis">
        <div><Activity /><span>Experiments</span><strong>{summary.activeExperiments}</strong></div>
        <div><Clock3 /><span>รอ 7D / 14D / 28D</span><strong>{summary.waiting7d}/{summary.waiting14d}/{summary.waiting28d}</strong></div>
        <div><RotateCcw /><span>Rollback / Recovery</span><strong>{summary.rollbackActive}/{summary.recoveryMonitoring}</strong></div>
        <div><BrainCircuit /><span>Learning HIGH</span><strong>{summary.learningHigh}</strong></div>
      </div>

      <div className="seo-tower-signal-row">
        <span className="signal-good">Improved {summary.improved}</span>
        <span className="signal-bad">Regressed {summary.regressed}</span>
        <span className="signal-warn">Contaminated {summary.contaminated}</span>
        <span className="signal-warn">External Shift {summary.externalShift}</span>
        <span>Prior FAVOR {summary.priorFavor}</span>
        <span>Prior CAUTION {summary.priorCaution}</span>
      </div>

      <button className="seo-tower-action-center" onClick={onOpenActions}>
        <div>
          <strong>เปิด SEO Action Center</strong>
          <span>อนุมัติ Action • Human Review • Executor • Evidence</span>
        </div>
        <ChevronRight />
      </button>

      <section className="seo-tower-section">
        <div className="section-head">
          <div>
            <h2><Bell size={16} /> Alerts</h2>
            <span>{summary.unreadAlerts} ยังไม่รับทราบ</span>
          </div>
          <div className="seo-tower-section-actions">
            <button onClick={() => setShowResolved((value) => !value)}>
              {showResolved ? 'ซ่อน Resolved' : 'ดู Resolved'}
            </button>
            {summary.unreadAlerts > 0 && (
              <button disabled={busyAlert === 'ALL'} onClick={() => void acknowledgeAll()}>
                รับทราบทั้งหมด
              </button>
            )}
          </div>
        </div>

        {visibleAlerts.length === 0 ? (
          <div className="seo-tower-empty">
            <CheckCircle2 />
            <strong>ไม่มี SEO Alert</strong>
            <span>ระบบจะสร้าง Alert อัตโนมัติเมื่อพบ regression, rollback failure, contamination, volatility หรือ checkpoint เกินกำหนด</span>
          </div>
        ) : (
          <div className="seo-tower-alert-list">
            {visibleAlerts.map((alert) => (
              <article
                className={`seo-tower-alert severity-${alert.severity.toLowerCase()} ${alert.acknowledged ? 'acknowledged' : 'unread'} ${alert.status.toLowerCase()}`}
                key={`${alert.id}:${alert.generation}`}
              >
                <div className="seo-tower-alert-head">
                  <div>
                    <span>{alert.severity}</span>
                    <strong>{alert.title}</strong>
                  </div>
                  <small>{when(alert.lastSeenAt)}</small>
                </div>
                {alert.primaryQuery && <h3>{alert.primaryQuery}</h3>}
                <p>{alert.message}</p>
                {alert.page && (
                  <a href={alert.page} target="_blank" rel="noreferrer">
                    {pageLabel(alert.page)} <ExternalLink size={11} />
                  </a>
                )}
                <div className="seo-tower-alert-footer">
                  <span>{alert.alertType.replaceAll('_', ' ')}</span>
                  {alert.status === 'OPEN' && !alert.acknowledged && (
                    <button
                      disabled={busyAlert === alert.id}
                      onClick={() => void acknowledge(alert.id)}
                    >
                      รับทราบ
                    </button>
                  )}
                  {alert.status === 'OPEN' && alert.acknowledged && <b>รับทราบแล้ว</b>}
                  {alert.status === 'RESOLVED' && <b>RESOLVED</b>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="seo-tower-section">
        <div className="section-head">
          <div>
            <h2><Activity size={16} /> Active Experiments</h2>
            <span>{activeExperiments.length} รายการ</span>
          </div>
        </div>

        {activeExperiments.length === 0 ? (
          <div className="seo-tower-empty compact">
            <span>ไม่มี Experiment ที่กำลังวัดผล</span>
          </div>
        ) : (
          <div className="seo-tower-experiment-list">
            {activeExperiments.map((experiment) => (
              <article className="seo-tower-experiment" key={experiment.executionId}>
                <div className="seo-tower-experiment-head">
                  <div>
                    <strong>{experiment.primaryQuery}</strong>
                    <a href={experiment.page} target="_blank" rel="noreferrer">
                      {pageLabel(experiment.page)} <ExternalLink size={10} />
                    </a>
                  </div>
                  <span className={`monitor-${experiment.monitorStatus.toLowerCase()}`}>
                    {experiment.recoveryStatus === 'MONITORING' ? 'RECOVERY' : experiment.monitorStatus}
                  </span>
                </div>

                <div className="seo-tower-timeline">
                  <div className="done"><b>Execute</b><small>{when(experiment.appliedAt)}</small></div>
                  <div className={experiment.latestCheckpointDays ? 'done' : 'current'}>
                    <b>Measure</b>
                    <small>{experiment.latestCheckpointDays ? `${experiment.latestCheckpointDays}D ${experiment.latestVerdict || ''}` : dueLabel(experiment)}</small>
                  </div>
                  <div className={experiment.rollbackStatus !== 'NONE' ? 'done' : ''}>
                    <b>Rollback</b><small>{experiment.rollbackStatus}</small>
                  </div>
                  <div className={experiment.recoveryStatus !== 'NONE' ? 'done' : ''}>
                    <b>Recovery</b><small>{experiment.recoveryStatus}</small>
                  </div>
                </div>

                <div className="seo-tower-experiment-signals">
                  <span>Guard {experiment.guardCode || '—'}</span>
                  <span>Prior {experiment.priorState || '—'}</span>
                  <span>Learning {experiment.learningSignal || '—'} / {experiment.learningConfidence || '—'}</span>
                </div>

                {experiment.latestVerdict && (
                  <div className="seo-tower-latest-measurement">
                    <strong>{experiment.latestCheckpointDays}D • {experiment.latestVerdict}</strong>
                    <span>
                      Integrity {experiment.latestIntegrityStatus || '—'}
                      {' • '}Causal {experiment.latestCausalStatus || '—'}
                      {' • '}Sitewide {experiment.latestVolatilityStatus || '—'}
                    </span>
                    <small>
                      Δ Position {number(experiment.latestPositionDelta, 2)}
                      {' • '}Δ CTR {percent(experiment.latestCtrDelta)}
                      {' • '}Peers {experiment.volatilityPeerCount}
                    </small>
                  </div>
                )}

                {experiment.recoveryStatus === 'MONITORING' && (
                  <div className="seo-tower-recovery-line">
                    Recovery lock {experiment.recoveryLockUntil ? `ถึงไม่เกิน ${when(experiment.recoveryLockUntil)}` : 'กำลังวัดผล'}
                    {experiment.latestRecoveryCheckpointDays
                      ? ` • ${experiment.latestRecoveryCheckpointDays}D ${experiment.latestRecoveryVerdict || ''}`
                      : ''}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="seo-tower-section seo-tower-learning-section">
        <div className="section-head">
          <div>
            <h2><BrainCircuit size={16} /> Learning & Review</h2>
            <span>ระบบยังไม่เร่ง Prior จนกว่าจะมี HIGH evidence เพียงพอ</span>
          </div>
        </div>
        <div className="seo-tower-learning-grid">
          <div><span>HIGH evidence</span><strong>{summary.learningHigh}</strong></div>
          <div><span>Prior FAVOR</span><strong>{summary.priorFavor}</strong></div>
          <div><span>Prior CAUTION</span><strong>{summary.priorCaution}</strong></div>
          <div><span>Human Review</span><strong>{summary.humanReview}</strong></div>
        </div>
      </section>

      <small className="seo-tower-updated">
        อัปเดต {summary.generatedAt ? when(summary.generatedAt) : '—'} • Alert engine ประเมินทุก 15 นาที
      </small>
    </section>
  )
}
