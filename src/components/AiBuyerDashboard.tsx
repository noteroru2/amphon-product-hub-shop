import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import type { Profile } from '../types/product'
import {
  loadAiBuyerDashboard,
  type AiBuyerDashboardCase,
  type AiBuyerDashboardData,
  type AiBuyerOpenAISpend,
} from '../lib/aiBuyerAdmin'
import '../styles/aiBuyerDashboard.css'

type Props = {
  profile: Profile
  onBack: () => void
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('th-TH', {
    maximumFractionDigits: 0,
  }).format(Number(value)) + ' ฿'
}


function usd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: Number(value) > 0 && Number(value) < 0.01 ? 4 : 2,
  }).format(Number(value))
}

function compactNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('th-TH', {
    notation: Number(value) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Number(value))
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Math.round(Number(value) * 100) + '%'
}

function relativeTime(value: string) {
  const stamp = new Date(value).getTime()
  if (!Number.isFinite(stamp)) return '—'
  const diff = Math.max(0, Date.now() - stamp)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชม.ที่แล้ว`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} วันที่แล้ว`
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  }).format(new Date(value))
}

function stateTone(state: string) {
  if (state === 'HUMAN_REVIEW') return 'danger'
  if (state === 'ACTION_REQUIRED' || state === 'ADMIN_ASSIGNED') return 'warn'
  if (state === 'COMPLETED' || state === 'ACCEPTED') return 'success'
  if (state === 'OFFERED' || state === 'NEGOTIATING' || state === 'COLLECTING_FULFILLMENT') return 'blue'
  return 'neutral'
}

function stateLabel(state: string) {
  const labels: Record<string, string> = {
    NEW: 'เคสใหม่',
    IDENTIFYING_PRODUCT: 'กำลังระบุสินค้า',
    COLLECTING_PHOTOS: 'รอรูป',
    ANALYZING: 'กำลังวิเคราะห์',
    NEED_MORE_INFO: 'รอข้อมูลเพิ่ม',
    READY_TO_PRICE: 'พร้อมตีราคา',
    PRICING: 'กำลังตีราคา',
    OFFERED: 'มีราคาแล้ว',
    NEGOTIATING: 'กำลังต่อรอง',
    ACCEPTED: 'ตกลงราคา',
    COLLECTING_FULFILLMENT: 'เก็บข้อมูลรับสินค้า',
    ACTION_REQUIRED: 'ต้องดำเนินการ',
    ADMIN_ASSIGNED: 'แอดมินรับแล้ว',
    COMPLETED: 'เสร็จสิ้น',
    HUMAN_REVIEW: 'ต้องตรวจเอง',
    CUSTOMER_DECLINED: 'ลูกค้าไม่ขาย',
    EXPIRED: 'หมดอายุ',
    CANCELLED: 'ยกเลิก',
  }
  return labels[state] || state
}

function categoryLabel(category: string | null) {
  const labels: Record<string, string> = {
    NOTEBOOK: 'Notebook',
    MACBOOK: 'MacBook',
    DESKTOP_PC: 'Desktop PC',
    SMARTPHONE: 'Smartphone',
    TABLET: 'Tablet',
    CAMERA: 'Camera',
    OTHER: 'Other',
  }
  return category ? labels[category] || category : 'ยังไม่ระบุ'
}

function confidenceTone(value: number | null | undefined) {
  if (value == null) return 'neutral'
  if (value >= 0.9) return 'good'
  if (value >= 0.75) return 'mid'
  return 'low'
}


function OpenAICostPanel({ spend }: { spend: AiBuyerOpenAISpend | undefined }) {
  const live = spend?.status === 'live'

  return (
    <section className="ai-cost-panel" aria-label="ค่าใช้จ่าย OpenAI API">
      <div className="ai-cost-head">
        <div className="ai-cost-title">
          <CircleDollarSign size={22} />
          <div>
            <strong>ค่า OpenAI API</strong>
            <span>ยอดจริงจาก OpenAI · {spend?.timezone || 'UTC'}</span>
          </div>
        </div>
        <span className={`ai-cost-status ai-cost-status-${spend?.status || 'loading'}`}>
          {live ? 'LIVE' : spend?.status === 'not_configured' ? 'NOT CONNECTED' : spend ? 'UNAVAILABLE' : 'LOADING'}
        </span>
      </div>

      {live && spend ? (
        <>
          <div className="ai-cost-hero">
            <span>เดือนนี้</span>
            <strong>{usd(spend.monthToDate)}</strong>
            <small>Organization total · USD</small>
          </div>

          <div className="ai-cost-metrics">
            <div>
              <span>วันนี้</span>
              <strong>{usd(spend.today)}</strong>
            </div>
            <div>
              <span>7 วันล่าสุด</span>
              <strong>{usd(spend.last7Days)}</strong>
            </div>
            <div>
              <span>Requests เดือนนี้</span>
              <strong>{compactNumber(spend.requestsMonthToDate)}</strong>
            </div>
            <div>
              <span>Tokens เดือนนี้</span>
              <strong>{compactNumber(spend.tokensMonthToDate.total)}</strong>
            </div>
          </div>

          {spend.byModel.length > 0 && (
            <div className="ai-cost-models">
              <span>การใช้งานตามโมเดล</span>
              <div>
                {spend.byModel.slice(0, 3).map((item) => (
                  <span className="ai-cost-model-chip" key={item.model}>
                    <strong>{item.model}</strong>
                    <small>{compactNumber(item.requests)} req · {compactNumber(item.totalTokens)} tokens</small>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="ai-cost-foot">
            <span>
              Input {compactNumber(spend.tokensMonthToDate.input)}
              {' · '}Cached {compactNumber(spend.tokensMonthToDate.cachedInput)}
              {' · '}Output {compactNumber(spend.tokensMonthToDate.output)}
            </span>
            <span>อัปเดต {relativeTime(spend.updatedAt)}</span>
          </div>
        </>
      ) : (
        <div className="ai-cost-empty">
          <CircleDollarSign size={28} />
          <div>
            <strong>
              {spend?.status === 'not_configured'
                ? 'ยังไม่ได้เชื่อม Cost API'
                : spend?.status === 'unavailable'
                  ? 'ดึงค่าใช้จ่าย OpenAI ไม่สำเร็จ'
                  : 'กำลังเชื่อมข้อมูลค่าใช้จ่าย'}
            </strong>
            <span>
              {spend?.status === 'not_configured'
                ? 'เพิ่ม OPENAI_ADMIN_KEY ที่ระบบ Deploy แล้วหน้านี้จะแสดงยอดจริงอัตโนมัติ'
                : 'ข้อมูล AI Buyer ส่วนอื่นยังใช้งานได้ตามปกติ'}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

function CaseCard({ item }: { item: AiBuyerDashboardCase }) {
  const [expanded, setExpanded] = useState(false)
  const confidence = item.pricing?.confidence ?? item.confidence.pricingReadiness

  return (
    <article className="ai-case-card">
      <button className="ai-case-main" onClick={() => setExpanded((value) => !value)}>
        <div className="ai-case-head">
          <div className="ai-case-avatar">
            {item.customer?.pictureUrl ? (
              <img src={item.customer.pictureUrl} alt="" />
            ) : (
              <Bot size={20} />
            )}
          </div>
          <div className="ai-case-title">
            <div className="ai-case-title-line">
              <strong>{item.title}</strong>
              <span className={`ai-state ai-state-${stateTone(item.state)}`}>
                {stateLabel(item.state)}
              </span>
            </div>
            <div className="ai-case-meta">
              <span>{categoryLabel(item.category)}</span>
              <span>·</span>
              <span>{item.customer?.displayName || 'ลูกค้า LINE'}</span>
              <span>·</span>
              <span>{relativeTime(item.updatedAt)}</span>
            </div>
          </div>
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>

        <div className="ai-price-strip">
          <div>
            <small>ขายคาดการณ์</small>
            <strong>{money(item.pricing?.estimatedResale)}</strong>
          </div>
          <div>
            <small>Opening</small>
            <strong>{money(item.pricing?.openingOffer)}</strong>
          </div>
          <div>
            <small>Target</small>
            <strong>{money(item.pricing?.targetBuy)}</strong>
          </div>
          <div className="hard-max">
            <small>Hard Max</small>
            <strong>{money(item.pricing?.hardMax)}</strong>
          </div>
        </div>

        <div className="ai-case-footer">
          <span className={`ai-confidence ai-confidence-${confidenceTone(confidence)}`}>
            Confidence {percent(confidence)}
          </span>
          <span>
            <ImageIcon size={14} /> {item.imageCount} รูป
          </span>
          {item.task && (
            <span className="ai-task-chip">
              <TriangleAlert size={14} /> {item.task.type}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="ai-case-detail">
          <div className="ai-detail-grid">
            <div>
              <small>Identity</small>
              <strong>{percent(item.confidence.identity)}</strong>
            </div>
            <div>
              <small>Spec</small>
              <strong>{percent(item.confidence.spec)}</strong>
            </div>
            <div>
              <small>Condition</small>
              <strong>{percent(item.confidence.condition)}</strong>
            </div>
            <div>
              <small>Pricing readiness</small>
              <strong>{percent(item.confidence.pricingReadiness)}</strong>
            </div>
          </div>

          <div className="ai-detail-lines">
            <div>
              <span>Pricing source</span>
              <strong>{item.pricing?.source || '—'}</strong>
            </div>
            <div>
              <span>Control mode</span>
              <strong>{item.controlMode}</strong>
            </div>
            <div>
              <span>Offer ล่าสุด</span>
              <strong>
                {money(item.offer?.amount)}
                {item.offer ? ` · ${item.offer.status}` : ''}
              </strong>
            </div>
            <div>
              <span>ราคาที่ตกลง</span>
              <strong>{money(item.acceptedPrice)}</strong>
            </div>
            {item.customer?.phone && (
              <div>
                <span>เบอร์ลูกค้า</span>
                <strong>{item.customer.phone}</strong>
              </div>
            )}
          </div>

          {item.lastMessage?.text && (
            <div className="ai-last-message">
              <small>ข้อความล่าสุดจากลูกค้า</small>
              <p>{item.lastMessage.text}</p>
            </div>
          )}

          {item.task && (
            <div className="ai-task-box">
              <TriangleAlert size={18} />
              <div>
                <strong>{item.task.type}</strong>
                <span>
                  {item.task.status} · {item.task.priority}
                </span>
              </div>
            </div>
          )}

          <div className="ai-case-id">Case {item.id}</div>
        </div>
      )}
    </article>
  )
}

export function AiBuyerDashboard({ profile, onBack }: Props) {
  const [data, setData] = useState<AiBuyerDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('ALL')
  const [state, setState] = useState('ALL')

  const allowed = ['owner', 'admin'].includes(profile.role)

  async function load() {
    if (!allowed) return
    setLoading(true)
    setError(null)
    try {
      setData(await loadAiBuyerDashboard())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.role])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.cases || []).filter((item) => {
      if (category !== 'ALL' && item.category !== category) return false
      if (state !== 'ALL' && item.state !== state) return false
      if (!needle) return true
      return [
        item.title,
        item.category || '',
        item.state,
        item.customer?.displayName || '',
        item.customer?.phone || '',
        item.lastMessage?.text || '',
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [data, query, category, state])

  const categories = useMemo(
    () => Array.from(new Set((data?.cases || []).map((item) => item.category).filter(Boolean))) as string[],
    [data],
  )
  const states = useMemo(
    () => Array.from(new Set((data?.cases || []).map((item) => item.state))).sort(),
    [data],
  )
  const shadowCount = data?.modes.filter((mode) => mode.mode === 'SHADOW' && mode.active).length || 0

  if (!allowed) {
    return (
      <section className="screen page-pad ai-buyer-screen">
        <header className="ai-page-header">
          <button className="ai-back" onClick={onBack}><ArrowLeft /></button>
          <div>
            <p className="eyebrow">ADMIN ONLY</p>
            <h1>AI Buyer</h1>
          </div>
        </header>
        <div className="ai-access-denied">
          <ShieldCheck size={32} />
          <strong>เฉพาะ Owner / Admin</strong>
          <p>บัญชีนี้ไม่มีสิทธิ์ดูข้อมูล AI Buyer</p>
        </div>
      </section>
    )
  }

  return (
    <section className="screen page-pad ai-buyer-screen">
      <header className="ai-page-header">
        <button className="ai-back" onClick={onBack} aria-label="กลับ">
          <ArrowLeft />
        </button>
        <div className="ai-page-heading">
          <p className="eyebrow">ADMIN · BUYBACK CONTROL</p>
          <h1>AI Buyer</h1>
          <span>Shadow Monitoring Dashboard</span>
        </div>
        <button className="ai-refresh" onClick={() => void load()} disabled={loading} aria-label="รีเฟรช">
          <RefreshCw className={loading ? 'spin' : ''} />
        </button>
      </header>

      <div className="ai-shadow-banner">
        <div>
          <ShieldCheck size={20} />
          <strong>SHADOW MODE</strong>
        </div>
        <span>{shadowCount}/{data?.modes.length || 7} หมวดยังไม่ส่งราคาอัตโนมัติ</span>
      </div>

      {error && (
        <div className="ai-error">
          <TriangleAlert size={18} />
          <span>{error}</span>
          <button onClick={() => void load()}>ลองใหม่</button>
        </div>
      )}

      <OpenAICostPanel spend={data?.openai} />

      <div className="ai-kpi-grid">
        <div className="ai-kpi">
          <Bot />
          <span>เคสล่าสุด</span>
          <strong>{data?.summary.total ?? '—'}</strong>
        </div>
        <div className="ai-kpi">
          <CircleDollarSign />
          <span>มีราคาแล้ว</span>
          <strong>{data?.summary.priced ?? '—'}</strong>
        </div>
        <div className="ai-kpi ai-kpi-warn">
          <TriangleAlert />
          <span>Human Review</span>
          <strong>{data?.summary.humanReview ?? '—'}</strong>
        </div>
        <div className="ai-kpi ai-kpi-success">
          <CheckCircle2 />
          <span>Action Required</span>
          <strong>{data?.summary.actionRequired ?? '—'}</strong>
        </div>
      </div>

      <div className="ai-toolbar">
        <label className="ai-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหารุ่น ลูกค้า เบอร์ หรือสถานะ"
          />
        </label>
        <div className="ai-filter-row">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="ALL">ทุกหมวด</option>
            {categories.map((value) => (
              <option key={value} value={value}>{categoryLabel(value)}</option>
            ))}
          </select>
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="ALL">ทุกสถานะ</option>
            {states.map((value) => (
              <option key={value} value={value}>{stateLabel(value)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ai-list-head">
        <div>
          <strong>เคส AI Buyer</strong>
          <span>{filtered.length} รายการ</span>
        </div>
        {data?.generatedAt && (
          <span className="ai-generated">
            <Clock3 size={14} /> {relativeTime(data.generatedAt)}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="ai-loading">
          <LoaderCircle className="spin" />
          <strong>กำลังโหลด AI Buyer</strong>
        </div>
      ) : filtered.length ? (
        <div className="ai-case-list">
          {filtered.map((item) => <CaseCard key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="ai-empty">
          <Bot size={32} />
          <strong>ยังไม่พบเคส</strong>
          <span>เมื่อ LINE AI Buyer เริ่มรับเคส ผลจะขึ้นที่หน้านี้</span>
        </div>
      )}
    </section>
  )
}
