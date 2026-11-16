import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { gscAction } from '../lib/seoGsc'
import '../styles/seo-portfolio.css'

type WindowDays = 7 | 14 | 28
interface Site { id: string; label: string; origin: string }
interface Project { site_id: string; repo_candidates: string[]; production_repo: string | null; hosting_provider: string; mapping_status: string; central_deploy_allowed: boolean }
interface Metric { site_id: string; window_days: WindowDays; start_date: string; end_date: string; clicks: number; impressions: number; ctr: number | null; position: number | null; dates_present: number; provenance: string }
interface Keyword { site_id: string; keyword: string; role: string; approval_status: string; distinct_value: string; target_page: string | null }
interface Release { id: string; site_id: string; repository: string; commit_sha: string; environment: string; event_kind: string; provider: string; event_at: string; qa_status: string }
interface Funnel { site_id: string; contact_events: number; confirmed_contact_events: number; verified_purchases: number; verified_units: number; verified_sales: number; realized_gross_profit: number }
interface Ingest { site_id: string; window_days: WindowDays; end_date: string; rows_written: number; data_complete: boolean; status: string; error_class: string | null }
interface Query { site_id: string; window_days: WindowDays; query: string; page: string; clicks: number; impressions: number; position: number | null; partial_window: boolean; source: string; end_date: string }
interface PortfolioResponse { sites: Site[]; projects: Project[]; windows: Metric[]; roles: Keyword[]; releases: Release[]; funnel: Funnel[]; ingests: Ingest[]; queries: Query[]; selectedSite: string; selectedWindow: WindowDays }
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
  const sites = useMemo(()=>[...(data?.sites||[])].sort((a,b)=>Number(metrics.get(b.id)?.clicks||0)-Number(metrics.get(a.id)?.clicks||0)),[data,metrics])
  const selected = data?.sites.find(v=>v.id===siteId)
  const totalClicks = sites.reduce((sum,v)=>sum+Number(metrics.get(v.id)?.clicks||0),0)
  const totalImp = sites.reduce((sum,v)=>sum+Number(metrics.get(v.id)?.impressions||0),0)
  const selectedMetric = metrics.get(siteId)
  const selectedProject = projects.get(siteId)
  const selectedFunnel = funnels.get(siteId)
  const selectedRoles = (data?.roles||[]).filter(v=>v.site_id===siteId)
  const selectedReleases = (data?.releases||[]).filter(v=>v.site_id===siteId).slice(0,12)
  const receipt = (data?.ingests||[]).find(v=>v.site_id===siteId && v.window_days===days)
  return <div className="seo-portfolio">
    <div className="seo-portfolio-head">
      <div><h2>AMPHON SEO Command Center</h2><p>Keyword Ownership · GSC Final · Release Evidence · Conversion • อ่านอย่างเดียว</p></div>
      <button onClick={()=>setTick(v=>v+1)} disabled={loading}><RefreshCw size={16}/> โหลดข้อมูล</button>
    </div>
    {error && <p role="alert" className="seo-network-warning">โหลด Portfolio ไม่สำเร็จ: {error}</p>}
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
            <p>CTA Events: <strong>{n(selectedFunnel?.contact_events)}</strong></p>
            <p>Lead ยืนยัน: <strong>{n(selectedFunnel?.confirmed_contact_events)}</strong></p>
            <p>ดีลซื้อที่ผูกหลักฐาน: <strong>{n(selectedFunnel?.verified_purchases)}</strong></p>
            <p>เครื่องซื้อเข้า: <strong>{n(selectedFunnel?.verified_units)}</strong></p>
            <p>กำไรขั้นต้นหลังขายที่ผูกหลักฐาน: <strong>{n(selectedFunnel?.realized_gross_profit,2)} บาท</strong></p>
            <small>ศูนย์หมายถึงไม่มีรายการที่ยืนยันใน Attribution Ledger ไม่ได้หมายความว่าร้านไม่มีการขายจริง</small>
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
