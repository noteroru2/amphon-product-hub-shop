import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy, CheckCircle2, AlertTriangle, RefreshCw, ExternalLink, ShieldCheck } from 'lucide-react'
import { gscAction } from '../lib/seoGsc'
import {
  assessDevelopmentReadiness, buildDevelopmentMilestones,
  type DevelopmentPortfolio, type DevelopmentMilestoneState, type DevelopmentSiteStatus,
} from '../../supabase/functions/seo-connector/developmentStatus'
import '../styles/seoDevelopmentCenter.css'

type WindowDays = 7 | 14 | 28
interface PortfolioPayload extends DevelopmentPortfolio {
  queries: Array<{ site_id: string; window_days: number; query: string; page: string; clicks: number; impressions: number; position: number | null; source: string; end_date: string }>
}
const milestoneState: Record<DevelopmentMilestoneState, string> = {
  COMPLETE: 'ตรวจเกณฑ์ผ่าน',
  PARTIAL: 'ยังไม่ครบ',
  PENDING_RELEASE: 'รอเผยแพร่ / ยืนยัน',
  PLANNED: 'ยังไม่เสร็จ',
}
const readinessLabel: Record<DevelopmentSiteStatus, string> = {
  NEEDS_REPO_MAPPING: 'รอยืนยัน Repo',
  NEEDS_KEYWORD_APPROVAL: 'รอ Keyword Ownership',
  NEEDS_FINAL_GSC: 'รอหลักฐาน GSC Final',
  READY_FOR_PAGE_EVIDENCE: 'เริ่มตรวจหลักฐานหน้าได้',
}
const daysOptions: WindowDays[] = [7, 14, 28]

export function SeoDevelopmentCenter({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [siteId, setSiteId] = useState('amphon')
  const [days, setDays] = useState<WindowDays>(28)
  const [data, setData] = useState<PortfolioPayload | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    setBusy(true)
    void gscAction<PortfolioPayload>('portfolio', { site_id: siteId, window_days: days })
      .then((result) => {
        if (!active) return
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (!active) return
        setData(null)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [siteId, days, refreshSignal, tick])

  const readiness = useMemo(() => data
    ? assessDevelopmentReadiness(data, days) : [], [data, days])
  const milestones = useMemo(() => data
    ? buildDevelopmentMilestones(data, readiness, false) : [], [data, readiness])
  const selected = data?.sites.find((site) => site.id === siteId)
  const selectedGate = readiness.find((row) => row.siteId === siteId)
  const finished = milestones.filter((item) => item.state === 'COMPLETE').length
  const partial = milestones.filter((item) => item.state === 'PARTIAL').length
  const blocked = milestones.filter((item) => item.state !== 'COMPLETE' && item.state !== 'PARTIAL').length

  async function copyWorkOrder() {
    if (!data || !selected || !selectedGate) return
    const project = data.projects.find((p) => p.site_id === siteId) ?? null
    const gsc = data.windows.filter((w) => w.site_id === siteId && w.window_days === days)
      .sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null
    const packet = {
      schema: 'amphon.seo.ai-work-order.v1',
      assembled_at: new Date().toISOString(),
      portfolio_source: 'HUB_GSC_FINAL_AND_RELEASE_LEDGER',
      site: selected,
      source_repository: project,
      selected_window_days: days,
      gsc_snapshot: gsc,
      gsc_ingest_receipts: data.ingests.filter((i) => i.site_id === siteId && [7, 14].includes(i.window_days)),
      approved_and_proposed_keyword_ownership: data.roles.filter((r) => r.site_id === siteId),
      release_evidence: data.releases.filter((r) => r.site_id === siteId).slice(0, 12),
      review_gate: selectedGate,
      available_query_page_sample: data.queries
        .filter((q) => q.site_id === siteId && q.window_days === days).slice(0, 30),
      mandatory_instructions: [
        'ตรวจ SEO จากหลักฐานที่มีวันที่จริงเท่านั้น และอ้างอิง URL/Query แยก',
        'GSC Position เป็นค่าเฉลี่ย ไม่ใช่อันดับสด ณ เวลาปัจจุบัน',
        'ถ้า Repo ไม่ VERIFIED หยุดงานแก้ Source และรายงานความเสี่ยง',
        'ถ้า Keyword Ownership ไม่ APPROVED ให้เสนออนุมัติก่อน ไม่เปลี่ยนหน้าแม่เอง',
        'ใช้ GitHub อ่าน Source จริงและตรวจ Commit SHA ก่อนสร้าง Patch',
        'เสนอแผน/ทำ Branch/เปิด Draft PR ได้เฉพาะเมื่อหลักฐานหน้าเป้าหมายยืนยันแล้ว',
        'ต้องรัน Build/Tests/SEO Regression และให้เจ้าของอนุมัติ Merge/Deploy ทุกครั้ง',
        'ห้ามสร้างข้อมูลผลงานรับซื้อ ราคาหรือหลักฐานลูกค้าโดยไม่มีที่มา',
        'ห้ามอ่านข้อมูลลูกค้า/ธุรกรรมส่วนตัวจากสิทธิ์ SEO',
      ],
      excluded_permissions: ['merge', 'production_deploy', 'dns_change', 'customer_data_access'],
    }
    try {
      await navigator.clipboard.writeText(
        'ตรวจเว็บไซต์นี้ด้วย ChatGPT และ GitHub ที่เชื่อมอยู่ ใช้ข้อมูลด้านล่างเพื่อจัดลำดับการแก้ไขและเสนอ PR ที่ผ่าน QA โดยห้าม Merge หรือ Deploy ก่อนอนุมัติ\n' +
        JSON.stringify(packet, null, 2),
      )
      setNotice('คัดลอก AI Work Order พร้อมหลักฐานแล้ว')
    } catch {
      setNotice('คัดลอกไม่ได้ กรุณาอนุญาตสิทธิ์ Clipboard')
    }
  }

  return (
    <section className="seo-dev-screen" aria-label="AI Website Development Progress">
      <header className="seo-dev-heading">
        <div>
          <h2>AI Website Development</h2>
          <p>สถานะโครงการจริง · Source Readiness · Work Order สำหรับ ChatGPT</p>
        </div>
        <button type="button" disabled={busy} onClick={() => setTick((v) => v + 1)}>
          <RefreshCw size={16} aria-hidden /> โหลดสถานะล่าสุด
        </button>
      </header>
      <div className="seo-dev-warning">
        <ShieldCheck size={19} aria-hidden />
        <div>
          <strong>โหมดวางแผนและตรวจหลักฐานเท่านั้น</strong>
          <p>ยังไม่อนุญาต AI แก้ Production, Merge, เปลี่ยน DNS หรือ Deploy อัตโนมัติ แม้ Repo จะ VERIFIED แล้วก็ตาม</p>
        </div>
      </div>
      {busy && !data && <p role="status">กำลังอ่านสถานะจากทะเบียนกลางและ GSC ของ HUB…</p>}
      {error && <p role="alert" className="seo-dev-error">อ่านข้อมูลไม่สำเร็จ: {error}</p>}
      {data && (
        <>
          <div className="seo-dev-stats">
            <div><small>งานทั้งหมด</small><strong>{milestones.length}</strong></div>
            <div><small>ผ่านเกณฑ์</small><strong>{finished}</strong></div>
            <div><small>ทำได้บางส่วน</small><strong>{partial}</strong></div>
            <div><small>รอ Release / ยังไม่เสร็จ</small><strong>{blocked}</strong></div>
          </div>
          <p className="seo-dev-footnote">นับตามเกณฑ์แต่ละงาน ไม่ใช่เปอร์เซ็นต์คุณภาพ SEO หรือการรับรองว่า Production พร้อม • สถานะ MCP ยังรอยืนยันหลัง Deploy</p>
          <div className="seo-dev-milestones">
            {milestones.map((item, idx) => (
              <article key={item.id} className={'seo-dev-milestone status-' + item.state.toLowerCase()}>
                <div className="seo-dev-milestone-head">
                  <span className="seo-dev-number">{String(idx + 1).padStart(2, '0')}</span>
                  <strong>{item.name}</strong>
                  <span className="seo-dev-status">{item.state === 'COMPLETE' ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}{milestoneState[item.state]}</span>
                </div>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
          <div className="seo-dev-heading seo-dev-sites-title">
            <div><h3>ความพร้อมรายเว็บไซต์</h3><p>เริ่มตรวจ Source ได้เมื่อผ่าน Mapping, Keyword และ GSC แต่ยังต้องมีหลักฐาน URL ก่อน Patch</p></div>
          </div>
          <div className="seo-dev-tools">
            <label>เว็บไซต์
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {data.sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}
              </select>
            </label>
            <label>ช่วง GSC
              <select value={days} onChange={(e) => setDays(Number(e.target.value) as WindowDays)}>
                {daysOptions.map((value) => <option key={value} value={value}>{value} วัน</option>)}
              </select>
            </label>
            <button type="button" disabled={!selectedGate || busy} onClick={() => void copyWorkOrder()}>
              <ClipboardCopy size={16} aria-hidden /> คัดลอก AI Work Order
            </button>
          </div>
          {notice && <p role="status" className="seo-dev-footnote">{notice}</p>}
          {selectedGate && (
            <div className="seo-dev-selected">
              <div className="seo-dev-selected-title">
                <strong>{selectedGate.label}</strong>
                <a href={selectedGate.origin} target="_blank" rel="noopener noreferrer" aria-label="เปิดเว็บไซต์ที่เลือก"><ExternalLink size={16}/></a>
              </div>
              <div className="seo-dev-selected-grid">
                <div><small>Repository</small><strong>{selectedGate.repositoryVerified ? selectedGate.repository : 'ยังยืนยันไม่ได้'}</strong></div>
                <div><small>Keyword Ownership อนุมัติ</small><strong>{selectedGate.approvedKeywordCount}/{selectedGate.mappedKeywordCount}</strong></div>
                <div><small>ข้อมูล GSC ล่าสุด</small><strong>{selectedGate.gscWindowEnd ?? 'ยังไม่พบ'}</strong></div>
                <div><small>Query/Page Receipt</small><strong>{selectedGate.gscReceiptConfirmed ? 'มีหลักฐาน' : 'ยังยืนยันไม่ได้'}</strong></div>
              </div>
              <p className="seo-dev-next"><b>{readinessLabel[selectedGate.status]}</b> — {selectedGate.nextAction}</p>
              <p className="seo-dev-footnote">Ready for page evidence = เริ่มตรวจข้อมูลเพิ่มเติมได้เท่านั้น ไม่ได้หมายถึงอนุมัติแก้ Source หรือ Deploy</p>
            </div>
          )}
          <div className="seo-dev-site-list">
            {readiness.map((row) => (
              <div key={row.siteId} className="seo-dev-site-row">
                <span>{row.label}</span>
                <span className="seo-dev-site-state">{readinessLabel[row.status]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
