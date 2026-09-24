import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, ClipboardCopy, LoaderCircle, RefreshCw, ShieldCheck, Star, XCircle } from 'lucide-react'
import { listTrustReviews, moderateTrustReview, type TrustReviewRow } from '../lib/trustReviews'

function reviewUrl(token: string) {
  return `https://shop.amphon.co.th/review/${token}/`
}

export function TrustReviewCenter({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<TrustReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setRows(await listTrustReviews())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const summary = useMemo(() => ({
    invites: rows.length,
    pending: rows.filter((row) => row.reviewStatus === 'PENDING').length,
    approved: rows.filter((row) => row.reviewStatus === 'APPROVED').length,
    unused: rows.filter((row) => !row.usedAt && !row.reviewId).length,
  }), [rows])

  async function copyInvite(row: TrustReviewRow) {
    await navigator.clipboard.writeText(reviewUrl(row.publicToken))
    setNotice(`คัดลอกลิงก์รีวิว ${row.sku} แล้ว`)
    window.setTimeout(() => setNotice(null), 2400)
  }

  async function moderate(row: TrustReviewRow, status: 'APPROVED' | 'REJECTED') {
    if (!row.reviewId || busyId) return
    const action = status === 'APPROVED' ? 'เผยแพร่' : 'ไม่เผยแพร่'
    if (!window.confirm(`ยืนยัน${action}รีวิวของ ${row.sku} หรือไม่?`)) return
    setBusyId(row.reviewId)
    setError(null)
    try {
      await moderateTrustReview(row.reviewId, status)
      await load()
      setNotice(status === 'APPROVED' ? 'อนุมัติรีวิวแล้ว' : 'ปฏิเสธรีวิวแล้ว')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="screen page-pad trust-review-screen">
      <header className="topbar seo-opportunity-topbar">
        <button className="icon-btn" onClick={onBack} aria-label="กลับ"><ArrowLeft /></button>
        <div>
          <p className="eyebrow">VERIFIED TRUST</p>
          <h1>Buyer Reviews</h1>
        </div>
        <button className="refresh-button" onClick={() => void load()} aria-label="รีเฟรช"><RefreshCw className={loading ? 'spin' : ''} /></button>
      </header>

      {notice && <div className="trust-review-notice">{notice}</div>}

      <div className="seo-action-guard">
        <ShieldCheck size={20} />
        <div>
          <strong>Verified-only เปิดอยู่</strong>
          <span>สร้างลิงก์รีวิวได้เฉพาะคำสั่งซื้อที่ชำระและ Completed แล้ว รีวิวทุกชิ้นเริ่มที่ PENDING และไม่มีการสร้างคะแนนตัวอย่าง</span>
        </div>
      </div>

      <div className="trust-review-summary">
        <div><span>Invite ทั้งหมด</span><strong>{summary.invites}</strong></div>
        <div><span>ยังไม่ใช้</span><strong>{summary.unused}</strong></div>
        <div><span>รอตรวจ</span><strong>{summary.pending}</strong></div>
        <div><span>เผยแพร่</span><strong>{summary.approved}</strong></div>
      </div>

      {error && <div className="inline-error"><span>{error}</span><button onClick={() => void load()}>ลองใหม่</button></div>}
      {loading && !rows.length ? <div className="seo-action-loading"><LoaderCircle className="spin" /> กำลังโหลดรีวิว...</div> : null}

      <div className="trust-review-list">
        {rows.map((row) => (
          <article className="trust-review-card" key={row.inviteId}>
            <div className="trust-review-card-head">
              <div>
                <strong>{row.productTitle}</strong>
                <small>{row.sku}</small>
              </div>
              <span className={`review-admin-status status-${(row.reviewStatus || (row.usedAt ? 'USED' : 'INVITED')).toLowerCase()}`}>
                {row.reviewStatus || (row.usedAt ? 'USED' : 'INVITED')}
              </span>
            </div>

            {row.reviewId ? (
              <div className="trust-review-content">
                <div className="trust-review-rating"><Star size={15} /> {row.rating}/5 • ยืนยันจากคำสั่งซื้อ</div>
                {row.reviewTitle && <strong>{row.reviewTitle}</strong>}
                <p>{row.reviewBody}</p>
                <small>แสดงชื่อ: {row.displayName}</small>
              </div>
            ) : (
              <div className="trust-review-invite">
                <span>ลิงก์นี้ใช้ได้เฉพาะผู้ซื้อของคำสั่งซื้อนี้และใช้ได้ครั้งเดียว</span>
                <button className="secondary-wide" onClick={() => void copyInvite(row)}>
                  <ClipboardCopy size={16} /> คัดลอกลิงก์รีวิว
                </button>
              </div>
            )}

            {row.reviewStatus === 'PENDING' && row.reviewId && (
              <div className="trust-review-actions">
                <button className="seo-action-dismiss" disabled={busyId === row.reviewId} onClick={() => void moderate(row, 'REJECTED')}>
                  <XCircle size={15} /> ไม่เผยแพร่
                </button>
                <button className="seo-action-approve" disabled={busyId === row.reviewId} onClick={() => void moderate(row, 'APPROVED')}>
                  {busyId === row.reviewId ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />} อนุมัติรีวิว
                </button>
              </div>
            )}
          </article>
        ))}
        {!loading && !rows.length && (
          <div className="empty-state">
            <ShieldCheck />
            <strong>ยังไม่มีคำสั่งซื้อที่มีสิทธิ์ส่งรีวิว</strong>
            <span>ระบบจะสร้าง Invite อัตโนมัติเมื่อคำสั่งซื้อ Paid + Completed เท่านั้น</span>
          </div>
        )}
      </div>
    </section>
  )
}
