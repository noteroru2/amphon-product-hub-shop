import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleOff, LoaderCircle, RefreshCw, ShoppingBag, Unplug } from 'lucide-react'
import { loadMerchantDiagnostics, type MerchantAccountIssue, type MerchantFeedDiagnostic, type MerchantSyncState } from '../lib/merchantDiagnostics'

function baht(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('th-TH', { style:'currency', currency:'THB', maximumFractionDigits:0 }).format(value)
}

export function MerchantDiagnosticsCenter({ onBack }: { onBack: () => void }) {
  const [feed, setFeed] = useState<MerchantFeedDiagnostic[]>([])
  const [issues, setIssues] = useState<MerchantAccountIssue[]>([])
  const [sync, setSync] = useState<MerchantSyncState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const result = await loadMerchantDiagnostics()
      setFeed(result.feedItems)
      setIssues(result.accountIssues)
      setSync(result.syncState)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const summary = useMemo(() => ({
    pass: feed.filter((item) => item.severity === 'PASS').length,
    warning: feed.filter((item) => item.severity === 'WARNING').length,
    error: feed.filter((item) => item.severity === 'ERROR').length,
    excluded: feed.filter((item) => item.severity === 'EXCLUDED').length,
    eligible: feed.filter((item) => item.feedEligible).length,
  }), [feed])

  const attention = feed.filter((item) => item.severity === 'ERROR' || item.severity === 'WARNING')

  return (
    <section className="screen page-pad merchant-diagnostics-screen">
      <header className="topbar seo-opportunity-topbar">
        <button className="icon-btn" onClick={onBack} aria-label="กลับ"><ArrowLeft /></button>
        <div>
          <p className="eyebrow">GOOGLE MERCHANT</p>
          <h1>Merchant Diagnostics</h1>
        </div>
        <button className="refresh-button" onClick={() => void load()} aria-label="รีเฟรช"><RefreshCw className={loading ? 'spin' : ''} /></button>
      </header>

      <div className={`merchant-connector-card ${sync?.connected ? 'connected' : 'disconnected'}`}>
        {sync?.connected ? <CheckCircle2 /> : <Unplug />}
        <div>
          <strong>{sync?.connected ? 'เชื่อม Google Merchant diagnostics แล้ว' : 'ยังไม่ได้เชื่อม Merchant account diagnostics'}</strong>
          <span>{sync?.statusMessage || 'Local feed diagnostics ยังทำงานได้ตามปกติ'}</span>
          {!sync?.connected && <small>Feed Production และ local preflight ทำงานต่อได้ แต่ Disapproval/Account issue จาก Google ต้องเชื่อมบัญชี Merchant ก่อน</small>}
        </div>
      </div>

      <div className="merchant-summary-grid">
        <div><span>Feed eligible</span><strong>{summary.eligible}</strong></div>
        <div className="pass"><span>PASS</span><strong>{summary.pass}</strong></div>
        <div className="warning"><span>Warning</span><strong>{summary.warning}</strong></div>
        <div className="error"><span>Error</span><strong>{summary.error}</strong></div>
        <div><span>Excluded</span><strong>{summary.excluded}</strong></div>
      </div>

      {error && <div className="inline-error"><span>{error}</span><button onClick={() => void load()}>ลองใหม่</button></div>}
      {loading && !feed.length ? <div className="seo-action-loading"><LoaderCircle className="spin" /> กำลังตรวจ Feed...</div> : null}

      {issues.length > 0 && (
        <section className="merchant-section">
          <div className="section-head"><h2>Google account issues</h2><span>{issues.length} รายการ</span></div>
          <div className="merchant-issue-list">
            {issues.map((issue) => (
              <article className={`merchant-issue-card issue-${issue.severity.toLowerCase()}`} key={issue.id}>
                <AlertTriangle size={17} />
                <div>
                  <strong>{issue.issueTitle}</strong>
                  <span>{issue.sku || issue.itemId || issue.issueCode}</span>
                  {issue.issueDetail && <p>{issue.issueDetail}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="merchant-section">
        <div className="section-head">
          <h2>Local Feed Preflight</h2>
          <span>{feed.length} รายการ</span>
        </div>
        {attention.length ? (
          <div className="merchant-product-list">
            {attention.map((item) => (
              <article className="merchant-product-card" key={item.productId}>
                <div className="merchant-product-main">
                  <span className={`merchant-severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.sku || 'ไม่มี SKU'} • {baht(item.price)} • {item.imageCount} รูป</small>
                  </div>
                </div>
                <div className="merchant-issue-chips">
                  {item.issueCodes.map((code) => <span key={code}>{code}</span>)}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="merchant-all-clear"><CheckCircle2 /><div><strong>ไม่มี Feed error/warning ที่ต้องแก้ตอนนี้</strong><span>สินค้าที่ผ่านเกณฑ์พร้อมส่งต่อให้ Google ตรวจ account-side ต่อ</span></div></div>
        )}
      </section>

      {summary.excluded > 0 && (
        <details className="merchant-excluded">
          <summary><CircleOff size={16} /> ดูสินค้าที่ถูก Exclude {summary.excluded} รายการ</summary>
          <div>
            {feed.filter((item) => item.severity === 'EXCLUDED').map((item) => (
              <p key={item.productId}><strong>{item.sku}</strong> — {item.title} <small>{item.issueCodes.join(' • ')}</small></p>
            ))}
          </div>
        </details>
      )}

      <div className="merchant-feed-link">
        <ShoppingBag size={18} />
        <div><strong>Production Feed</strong><span>https://shop.amphon.co.th/google-merchant.xml</span></div>
      </div>
    </section>
  )
}
