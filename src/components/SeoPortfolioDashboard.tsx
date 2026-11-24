import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { gscAction } from '../lib/seoGsc'
import { latestRankSnapshots, rankStatusText, type SeoRankSnapshot } from '../lib/seoRankLedger'
import '../styles/seo-portfolio.css'

type WindowDays = 7 | 14 | 28
interface Site { id: string; label: string; origin: string }
interface Project { site_id: string; repo_candidates: string[]; production_repo: string | null; hosting_provider: string; mapping_status: string; central_deploy_allowed: boolean }
interface Metric { site_id: string; window_days: WindowDays; start_date: string; end_date: string; clicks: number; impressions: number; ctr: number | null; position: number | null; dates_present: number; provenance: string }
interface Keyword { site_id: string; keyword: string; role: string; approval_status: string; distinct_value: string; target_page: string | null }
interface Release { id: string; site_id: string; repository: string; commit_sha: string; environment: string; event_kind: string; provider: string; event_at: string; qa_status: string }
interface Funnel { site_id: string; contact_events: number; confirmed_contact_events: number; verified_purchases: number; verified_units: number; verified_sales: number; realized_gross_profit: number }
interface AttributionReadiness {
  site_id: string; site_enabled: boolean; contact_click_events: number;
  organic_search_labeled_clicks: number; unknown_channel_clicks: number;
  owner_confirmed_leads: number; evidence_verified_purchases: number;
  evidence_verified_units: number; evidence_verified_sales: number;
  evidence_verified_realized_gross_profit: number;
  cross_site_contact_link_warnings: number; evidence_stage: string; measurement_warning: string
}
interface Ingest { site_id: string; window_days: WindowDays; end_date: string; rows_written: number; data_complete: boolean; status: string; error_class: string | null }
interface Query { site_id: string; window_days: WindowDays; query: string; page: string; clicks: number; impressions: number; position: number | null; partial_window: boolean; source: string; end_date: string }
interface PortfolioResponse { sites: Site[]; projects: Project[]; windows: Metric[]; roles: Keyword[]; releases: Release[]; funnel: Funnel[]; attribution_readiness?: AttributionReadiness[]; ingests: Ingest[]; queries: Query[]; rank_snapshots?: SeoRankSnapshot[]; rank_source?: string; selectedSite: string; selectedWindow: WindowDays }
const n = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(Number(value))
  ? '—' : Number(value).toLocaleString('th-TH',{maximumFractionDigits:digits})
const pct = (v: number | null | undefined) => v == null ? '—' : n(Number(v)*100,2) + '%'
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium'}) : '—'
const labelStatus: Record<string,string> = {
  APPROVED:'อนุมัติแล้ว', PROPOSED:'ข้อเสนอ • รอตรวจ', REJECTED:'ไม่อนุมัติ',
  PRIMARY:'หน้าแม่หลัก', SUPPORTING:'หน้าข้อมูลเสริม', LOCAL:'พื้นที่', COMMERCE:'หน้าขาย',
  VERIFIED:'ยืนยันคู่ Repo/Hosting แล้ว', CANDIDATE:'Repo ที่คาดว่าใช่', MULTIPLE_CANDIDATES:'มี Repo หลายตัว', UNVERIFIED:'ยังจับคู่ไม่ได้',
  COMMIT_OBSERVED:'พบ Commit (ไม่ใช่ Deploy)', DEPLOY_SUCCEEDED:'Deploy บน Provider สำเร็จ',
  PRODUCTION_VERIFIED:'ยืนยัน Production จริง', DEPLOY_FAILED:'Deploy ล้มเหลว',
}
export function SeoPortfolioDashboard({refreshSignal=0}:{refreshSignal?:number}) {
  const [siteId,setSiteId] = useState('amphon')
  const [days,setDays] = useState<WindowDays>(28)
  const [data,setData] = useState<PortfolioResponse|null>(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [copyStatus,setCopyStatus] = useState('')
  const [tick,setTick] = useState(0)
  useEffect(()=>{
    let active = true
    setLoading(true)
    void gscAction<PortfolioResponse>('portfolio',{site_id:siteId,window_days:days})
      .then(result=>{if(active){setData(result);setError('')}})
      .catch(err=>{if(active)setError(err instanceof Error ? err.message : String(err))})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[siteId,days,refreshSignal,tick])
  const metrics = useMemo(()=>new Map((data?.windows||[]).filter(v=>v.window_days===days).map(v=>[v.site_id,v])),[data,days])
  const projects = useMemo(()=>new Map((data?.projects||[]).map(v=>[v.site_id,v])),[data])
  const funnels = useMemo(()=>new Map((data?.funnel||[]).map(v=>[v.site_id,v])),[data])
  const attributionReadiness = useMemo(()=>new Map((data?.attribution_readiness||[]).map(v=>[v.site_id,v])),[data])
  const sites = useMemo(()=>[...(data?.sites||[])].sort((a,b)=>Number(metrics.get(b.id)?.clicks||0)-Number(metrics.get(a.id)?.clicks||0)),[data,metrics])
  const selected = data?.sites.find(v=>v.id===siteId)
  const totalClicks = sites.reduce((sum,v)=>sum+Number(metrics.get(v.id)?.clicks||0),0)
  const totalImp = sites.reduce((sum,v)=>sum+Number(metrics.get(v.id)?.impressions||0),0)
  const selectedMetric = metrics.get(siteId)
  const selectedProject = projects.get(siteId)
  const selectedFunnel = funnels.get(siteId)
  const selectedAttribution = attributionReadiness.get(siteId)
  const selectedRoles = (data?.roles||[]).filter(v=>v.site_id===siteId)
  const selectedReleases = (data?.releases||[]).filter(v=>v.site_id===siteId).slice(0,12)
  const receipt = (data?.ingests||[]).find(v=>v.site_id===siteId && v.window_days===days)
  const latestRanks = useMemo(()=>latestRankSnapshots(data?.rank_snapshots||[],siteId),[data,siteId])
  const rankCollected = latestRanks.filter(v=>v.status!=='PENDING').length
  const rankPending = latestRanks.filter(v=>v.status==='PENDING').length
  const rankDate = latestRanks.reduce((day,v)=>v.checked_on>day?v.checked_on:day,'')
  async function copyAiPacket() {
    if (!data || !selected) return
    setCopyStatus('')
    const packet = {
      schema: 'amphon.seo.development-brief.v1',
      assembled_at: new Date().toISOString(),
      source: 'HUB_SEO_PORTFOLIO_READ_MODEL',
      site: selected,
      selected_window_days: days,
      gsc_window: selectedMetric ?? null,
      gsc_ingest: receipt ?? null,
      keyword_ownership: selectedRoles,
      production_mapping: selectedProject ?? null,
      releases: selectedReleases,
      aggregated_conversions: selectedFunnel ?? null,
      evidence_verified_conversion_readiness: selectedAttribution ?? null,
      rank_tracking: {source:'UBERSUGGEST_SERP_NOT_GSC',location_id:2764,language:'th',device:'DESKTOP',observations:latestRanks},
      query_page_samples: (data.queries || []).filter(v => v.site_id === siteId && v.window_days === days),
      guardrails: {
        gsc_average_position_not_live_rank: true,
        source_repository_requires_verified_mapping: true,
        keyword_ownership_requires_approval: true,
        changes_require_new_branch_and_pr: true,
        deployment_requires_explicit_owner_approval: true,
        do_not_invent_missing_data: true,
      },
    }
    try {
      await navigator.clipboard.writeText(
        'วิเคราะห์ SEO จากหลักฐาน HUB ต่อไปนี้ แล้วเตรียมแผนและ PR เท่านั้น ห้าม Merge หรือ Deploy โดยไม่ได้รับอนุมัติ\\n' +
        JSON.stringify(packet, null, 2)
      )
      setCopyStatus('คัดลอกชุดข้อมูลพร้อมคำสั่งสำหรับ ChatGPT แล้ว')
    } catch {
      setCopyStatus('คัดลอกไม่ได้ กรุณาตรวจสิทธิ์ Clipboard ของเบราว์เซอร์')
    }
  }

  return <div className="seo-portfolio">
    <div className="seo-portfolio-head">
      <div><h2>AMPHON SEO Command Center</h2><p>Keyword Ownership · GSC Final · Release Evidence · Conversion • อ่านอย่างเดียว</p></div>
      <div className="seo-portfolio-actions">
        <button onClick={() => void copyAiPacket()} disabled={!data || loading}>คัดลอก AI Development Brief</button>
      <button onClick={()=>setTick(v=>v+1)} disabled={loading}><RefreshCw size={16}/> โหลดข้อมูล</button>
      </div>
    </div>
    {error && <p role="alert" className="seo-network-warning">โหลด Portfolio ไม่สำเร็จ: {error}</p>}
    {copyStatus && <p role="status" className="seo-network-note">{copyStatus}</p>}
    {loading && !data && <p role="status">กำลังโหลดข้อมูลจากศูนย์กลาง…</p>}
    {data && <>
      <div className="seo-portfolio-filters">
        <label>ช่วง GSC <select value={days} onChange={e=>setDays(Number(e.target.value) as WindowDays)}>
          <option value={7}>7 วัน</option><option value={14}>14 วัน</option><option value={28}>28 วัน</option>
        </select></label>
        <label>เว็บไซต์ <select value={siteId} onChange={e=>setSiteId(e.target.value)}>
          {(data.sites||[]).map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
        </select></label>
      </div>
      <div className="seo-tower-kpis">
        <div><span>เว็บไซต์ในพอร์ต</span><strong>{data.sites.length}</strong></div>
        <div><span>Organic Clicks ({days} วัน)</span><strong>{n(totalClicks)}</strong></div>
        <div><span>Impressions ({days} วัน)</span><strong>{n(totalImp)}</strong></div>
        <div><span>Repo Mapping ยืนยันจาก Provider</span><strong>{data.projects.filter(x=>x.mapping_status==='VERIFIED').length}/{data.projects.length}</strong></div>
      </div>
      <p className="seo-network-note">ยอดรวมเป็นผลบวกของโฮสต์ที่ติดตาม ไม่ใช่ลูกค้าที่ไม่ซ้ำกัน • Query/Page อาจถูก Google ปกปิดหรือจำกัดจำนวนแถว • ข้อมูล GSC Final ไม่ใช่ข้อมูลสด • ไม่มีสิทธิ์ Deploy เว็บไซต์จากหน้านี้</p>
      {siteId==='amphon' && <section className="seo-portfolio-detail" aria-label="Ubersuggest Rank Checker">
        <h3>Google Rank Checker · Ubersuggest SERP</h3>
        <p className="seo-network-note">
          ตำแหน่ง: ประเทศไทย · ภาษาไทย · Desktop · ตรวจล่าสุด {rankDate||'ยังไม่มีข้อมูล'}
          {' '}· มีหลักฐาน {rankCollected}/{latestRanks.length} คำ · รอผล {rankPending} คำ
        </p>
        <p className="seo-network-note">
          อันดับ SERP มาจากการเก็บผลของ Ubersuggest ไม่ใช่อันดับเฉลี่ย GSC
          {' '}· PENDING หมายถึงยังไม่ได้ผล ไม่ได้หมายถึงอันดับ 0 หรือไม่ติด Google
          {' '}· ตรวจสอบเป็นรอบตามผู้ให้บริการ ไม่ใช่ตำแหน่งสดทุกวินาที
        </p>
        {latestRanks.length===0 ? <p>ยังไม่มีบันทึกอันดับ Ubersuggest ใน Rank Ledger — ไม่ใช่ผลว่าไม่ติดอันดับ</p> :
        <div className="seo-network-table-wrap"><table className="seo-network-table">
          <caption>ประวัติอันดับล่าสุดของแต่ละคำ · จากข้อมูล Ubersuggest ที่ตรวจสอบแหล่งที่มาแล้ว</caption>
          <thead><tr><th>Keyword</th><th>สถานะอันดับ</th><th>SERP เก็บวันที่</th><th>ตรวจระบบเมื่อ</th></tr></thead>
          <tbody>{latestRanks.map(r=><tr key={r.keyword}>
            <th>{r.keyword}</th>
            <td>{rankStatusText(r)}</td>
            <td>{r.serp_date||'ยังไม่มี'}</td>
            <td>{r.checked_on}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>}
      <div className="seo-network-table-wrap"><table className="seo-network-table">
        <caption>ภาพรวม {days} วัน · กดชื่อเว็บเพื่อเจาะรายละเอียด</caption>
        <thead><tr><th>เว็บไซต์</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th>ช่วงข้อมูล</th><th>Deploy Mapping</th><th>CTA events</th></tr></thead>
        <tbody>{sites.map(site=>{
          const row=metrics.get(site.id), project=projects.get(site.id), funnel=funnels.get(site.id)
          return <tr key={site.id} className={site.id===siteId?'selected':''}>
            <th><button onClick={()=>setSiteId(site.id)} aria-pressed={site.id===siteId}>{site.label}</button></th>
            <td>{n(row?.clicks)}</td><td>{n(row?.impressions)}</td><td>{pct(row?.ctr)}</td>
            <td>{n(row?.position,2)}</td><td>{row?.end_date||'—'}<small>{row?.dates_present}/{days} วันที่มีข้อมูล</small></td>
            <td>{labelStatus[project?.mapping_status||'']||'—'}</td><td>{n(funnel?.contact_events)}</td>
          </tr>
        })}</tbody>
      </table></div>
      {selected && <section className="seo-portfolio-detail">
        <h3>{selected.label} <a href={selected.origin} target="_blank" rel="noopener noreferrer" aria-label="เปิดเว็บไซต์"><ExternalLink size={15}/></a></h3>
        <p className="seo-network-note">GSC {selectedMetric?.start_date||'—'} ถึง {selectedMetric?.end_date||'—'} · {selectedMetric?.provenance||'—'} · ข้อมูลครบ {selectedMetric?.dates_present||0}/{days} วัน</p>
        <div className="seo-portfolio-panels">
          <article>
            <h4>Keyword Ownership ({selectedRoles.length})</h4>
            {selectedRoles.length===0 ? <p>ยังไม่กำหนดคำค้นในทะเบียนกลาง</p> :
              <ul>{selectedRoles.map(k=><li key={k.keyword+'-'+k.role}>
                <strong>{k.keyword}</strong><small>{labelStatus[k.role]||k.role} · {labelStatus[k.approval_status]||k.approval_status}</small>
              </li>)}</ul>}
          </article>
          <article>
            <h4>Repository / Release</h4>
            <p>{labelStatus[selectedProject?.mapping_status||'']||'ยังไม่จับคู่'}</p><p>Hosting: {selectedProject?.hosting_provider||'ไม่ทราบ'}</p>
            {(selectedProject?.repo_candidates||[]).map(repo=><p key={repo}>
              <a href={'https://github.com/'+repo} target="_blank" rel="noopener noreferrer">{repo}</a>
            </p>)}
            {selectedReleases.length===0 ? <p>ยังไม่มีหลักฐาน Release ใน Ledger</p> :
              <ul>{selectedReleases.map(r=><li key={r.id}>
                <strong>{labelStatus[r.event_kind]||r.event_kind}</strong>
                <small>{r.provider} · {date(r.event_at)} · {r.commit_sha ? r.commit_sha.slice(0,9) : 'ไม่พบ SHA'}</small>
              </li>)}</ul>}
            <small>Commit ไม่เท่ากับ Production Deploy; Provider READY ไม่ยืนยันโดเมนที่ผู้ใช้เข้าถึงเสมอไป</small>
          </article>
          <article>
            <h4>Conversion (ต้องยืนยันธุรกรรม)</h4>
            <p>คลิกปุ่มติดต่อ (ไม่ใช่จำนวนลูกค้า): <strong>{n(selectedAttribution?.contact_click_events)}</strong></p>
            <p>คลิกที่ถูกจัดหมวด Organic: <strong>{n(selectedAttribution?.organic_search_labeled_clicks)}</strong></p>
            <p>คลิกที่ยังไม่ทราบแหล่งที่มา: <strong>{n(selectedAttribution?.unknown_channel_clicks)}</strong></p>
            <p>ลูกค้าที่มีหลักฐานยืนยัน: <strong>{n(selectedAttribution?.owner_confirmed_leads)}</strong></p>
            <p>ดีลซื้อที่ตรวจหลักฐานแล้ว: <strong>{n(selectedAttribution?.evidence_verified_purchases)}</strong></p>
            <p>จำนวนเครื่องที่ซื้อเข้าและตรวจหลักฐาน: <strong>{n(selectedAttribution?.evidence_verified_units)}</strong></p>
            <p>รายการขายที่ตรวจหลักฐานแล้ว: <strong>{n(selectedAttribution?.evidence_verified_sales)}</strong></p>
            <p>กำไรขั้นต้นหลังขายที่ตรวจหลักฐาน: <strong>{selectedAttribution ? n(selectedAttribution.evidence_verified_realized_gross_profit,2)+' บาท' : '—'}</strong></p>
            {selectedAttribution && <p>สถานะหลักฐาน: <strong>{selectedAttribution.evidence_stage}</strong></p>}
            {Number(selectedAttribution?.cross_site_contact_link_warnings||0)>0 &&
              <p role="alert">พบการจับคู่คลิกข้ามเว็บไซต์ผิดพลาด {n(selectedAttribution?.cross_site_contact_link_warnings)} รายการ ต้องตรวจหลักฐาน</p>}
            <small>คลิกไม่เท่ากับการสนทนา LINE หรือการซื้อขายจริง คำว่า Organic เป็นการจัดหมวดจากแหล่งที่มา ไม่ยืนยันว่าเป็น Google Search คลิก กำไรแสดงเฉพาะรายการที่ผูกหลักฐาน และ 0 ไม่ได้แปลว่าร้านไม่มีการขาย</small>
          </article>
        </div>
        <h4>Top Query + Page ({days} วัน)</h4>
        {days!==28 && <p className="seo-network-note">Ingest ล่าสุด: {receipt ? receipt.end_date+' · '+receipt.rows_written+' แถว'+(receipt.data_complete?' · ถึงหน้าสุดท้ายที่ Google เปิดเผย':' · จำกัด/บางส่วน') : 'ยังไม่มีบันทึก'} {receipt?.status==='FAILED'?' · ดึงข้อมูลผิดพลาด':''}</p>}
        <div className="seo-network-table-wrap"><table className="seo-network-table">
          <thead><tr><th>Query</th><th>หน้า</th><th>Clicks</th><th>Impressions</th><th>Position</th></tr></thead>
          <tbody>{(data.queries||[]).map((row,i)=><tr key={row.query+'-'+row.page+'-'+i}>
            <td>{row.query}</td><td><a href={row.page} target="_blank" rel="noopener noreferrer">{(() => {try{return decodeURI(new URL(row.page).pathname).slice(0,95)||'/'}catch{return row.page.slice(0,95)}})()}</a></td>
            <td>{n(row.clicks)}</td><td>{n(row.impressions)}</td><td>{n(row.position,2)}</td>
          </tr>)}</tbody>
        </table></div>
        {(data.queries||[]).length===0 && <p>ไม่มีแถว Query/Page ที่ Google ส่งกลับมาในช่วงนี้ ไม่ได้ยืนยันว่าไม่มี Impression ทั้งเว็บไซต์</p>}
      </section>}
    </>}
  </div>
}
