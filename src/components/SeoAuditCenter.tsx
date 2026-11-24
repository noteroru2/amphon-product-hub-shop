import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, ClipboardCopy, ExternalLink, FileSearch, Filter, ListChecks, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import {
  buildAuditWorkOrder,loadAuditCenter,loadAuditTasks,matchingAuditCatalog,setAuditTaskStatus,startAuditRun,
  type AuditCategory,type AuditCenterData,type AuditPriority,type AuditRun,type AuditTask,
} from '../lib/seoAuditCenter'
import '../styles/seoAuditCenter.css'

const categoryNames:Record<AuditCategory,string>={
  ALL:'ทุกด้าน',CONTENT:'Content / บทความ',UX_UI:'UX/UI และ Conversion',
  TECHNICAL:'Technical SEO',AEO_GEO:'AEO / GEO',MEASUREMENT:'Measurement',
}
const statusNames:Record<AuditTask['status'],string>={
  OPEN:'รอจัดลำดับ',BRIEF_READY:'เตรียม AI Work Order แล้ว',DISMISSED:'พักงาน',
}
function prettyDate(raw:string|null|undefined){
  if(!raw)return '—'
  const d=new Date(raw)
  return Number.isNaN(d.getTime())?raw:d.toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'})
}
const format=(num:number|null|undefined)=>Number.isFinite(Number(num))?Number(num).toLocaleString('th-TH'):'—'
const SOURCE_ISSUE='https://github.com/noteroru2/amphon-product-hub-shop/issues/177'

export function SeoAuditCenter({onOpenDevelopment,refreshSignal=0}:{onOpenDevelopment:()=>void;refreshSignal?:number}){
  const [data,setData]=useState<AuditCenterData|null>(null)
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [tasks,setTasks]=useState<AuditTask[]>([])
  const [site,setSite]=useState('ALL')
  const [category,setCategory]=useState<AuditCategory>('ALL')
  const [priority,setPriority]=useState<AuditPriority>('P0')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [selectedTaskId,setSelectedTaskId]=useState<number|null>(null)
  const [brief,setBrief]=useState('')
  const [taskNote,setTaskNote]=useState('')
  const reload=useCallback(async()=>{
    const next=await loadAuditCenter()
    setData(next)
    setSelectedId(previous=>previous&&next.runs.some(r=>r.id===previous)?previous:next.runs[0]?.id||null)
  },[])
  useEffect(()=>{
    let mounted=true
    void loadAuditCenter().then(next=>{
      if(!mounted)return
      setData(next);setSelectedId(next.runs[0]?.id||null);setError('')
    }).catch(e=>{if(mounted)setError(e instanceof Error?e.message:String(e))})
      .finally(()=>{if(mounted)setLoading(false)})
    return ()=>{mounted=false}
  },[])
  useEffect(()=>{
    let mounted=true
    if(!selectedId){setTasks([]);return}
    void loadAuditTasks(selectedId).then(rows=>{if(mounted)setTasks(rows)})
      .catch(e=>{if(mounted)setError(e instanceof Error?e.message:String(e))})
    return ()=>{mounted=false}
  },[selectedId])
  useEffect(()=>{if(refreshSignal>0)void reload().catch(e=>setError(e instanceof Error?e.message:String(e)))},[refreshSignal,reload])
  const validSiteIds=useMemo(()=>new Set(data?.sites.map(s=>s.id)||[]),[data])
  const preview=useMemo(()=>
    matchingAuditCatalog(data?.catalog||[],site,category,priority,validSiteIds),
    [data,site,category,priority,validSiteIds])
  const activeRun=data?.runs.find(r=>r.id===selectedId)
  const currentTask=tasks.find(t=>t.id===selectedTaskId)
  const taskCounts=useMemo(()=>({
    open:tasks.filter(t=>t.status==='OPEN').length,
    ready:tasks.filter(t=>t.status==='BRIEF_READY').length,
    dismissed:tasks.filter(t=>t.status==='DISMISSED').length,
  }),[tasks])
  async function start(){
    setBusy(true);setError('');setNotice('')
    try{
      if(!data||data.catalog.length!==22)throw new Error('รายการ Audit #177 ไม่ครบ 22 งาน กรุณาตรวจ Migration')
      const created=await startAuditRun(site,category,priority)
      await reload()
      setSelectedId(created.id);setTasks(await loadAuditTasks(created.id))
      setSelectedTaskId(null);setBrief('')
      setNotice('สร้างคิว Audit #177 จริง '+created.tasks+' งานแล้ว · อ้างอิง GSC FINAL ที่มี ไม่ได้สั่ง Crawl/AI หรือ Deploy เว็บไซต์')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  async function taskAction(t:AuditTask,status:AuditTask['status']){
    setBusy(true);setError('');setNotice('')
    try{
      await setAuditTaskStatus(t.id,status,taskNote.trim())
      if(activeRun)setTasks(await loadAuditTasks(activeRun.id))
      setNotice('บันทึกสถานะ '+t.template_code+' เป็น '+statusNames[status]+' แล้ว โดยยังไม่เปลี่ยนเว็บไซต์')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  async function queueAndCopy(t:AuditTask){
    if(!activeRun)return
    setBusy(true);setError('');setNotice('')
    try{
      if(t.status!=='BRIEF_READY')await setAuditTaskStatus(t.id,'BRIEF_READY',taskNote.trim())
      const workOrder=buildAuditWorkOrder(t,activeRun,data?.sites.find(s=>s.id===t.site_id))
      setBrief(workOrder);setSelectedTaskId(t.id)
      if(activeRun)setTasks(await loadAuditTasks(activeRun.id))
      try{
        await navigator.clipboard.writeText(workOrder)
        setNotice('บันทึกคิวและคัดลอก AI Work Order แล้ว นำไปวางใน ChatGPT เพื่อวิเคราะห์ Source จริงก่อนทำ PR')
      }catch{
        setNotice('บันทึกคิวแล้ว แต่คัดลอกไม่ได้ เลือกข้อความ Work Order ด้านล่างเพื่อคัดลอกด้วยตนเอง')
      }
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  return <section className="seo-audit-center" aria-label="SEO Audit & AI Improvement Center">
    <header className="seo-audit-heading">
      <div>
        <span className="seo-audit-eyebrow"><Sparkles size={14}/> AMPHON · EVIDENCE-FIRST</span>
        <h2>SEO Audit & AI Improvement Center</h2>
        <p>สั่งสร้างคิวปรับเว็บไซต์จากรายงาน Audit #177 · เชื่อมหลักฐาน GSC Final และการอนุมัติ Source Change เดิม</p>
      </div>
      <button type="button" onClick={()=>void reload().catch(e=>setError(e.message))} disabled={loading||busy} className="seo-audit-refresh"><RefreshCw size={16}/> โหลดล่าสุด</button>
    </header>
    <div className="seo-audit-safety"><ShieldCheck size={19} aria-hidden/>
      <div><strong>โหมดจัดทำแผนและเตรียมงาน · ไม่มีการแก้เว็บไซต์อัตโนมัติ</strong>
        <p>ปุ่มสร้างแผนอ่าน Audit #177 และ Snapshot GSC ที่มีอยู่ ไม่ใช่การ Crawl ใหม่ ไม่เรียก AI อัตโนมัติ ไม่สร้าง PR/Merge/Deploy</p>
      </div>
      <a href={SOURCE_ISSUE} target="_blank" rel="noreferrer">Audit #177 <ExternalLink size={14}/></a>
    </div>
    {loading&&<p role="status">กำลังอ่าน Audit Catalog และคิวงานจากฐานข้อมูล…</p>}
    {error&&<p className="seo-audit-error" role="alert">{error}</p>}
    {notice&&<p className="seo-audit-notice" role="status"><CheckCircle2 size={16}/>{notice}</p>}
    {data&&<div className="seo-audit-stats">
      <div><small>เว็บไซต์เปิดใช้งาน</small><strong>{data.sites.length}</strong></div>
      <div><small>รายการ Audit ครั้งที่ 1</small><strong>{data.catalog.length}</strong></div>
      <div><small>Audit Runs ที่บันทึก</small><strong>{data.runs.length}</strong></div>
      <div><small>งานที่เลือกเตรียม Brief</small><strong>{taskCounts.ready}</strong></div>
    </div>}
    <section className="seo-audit-panel">
      <div className="seo-audit-section-title"><div><h3><FileSearch size={18}/> สร้างชุดงานตรวจและปรับปรุง</h3>
        <p>เลือกเว็บไซต์ ประเภทงาน และลำดับความสำคัญ แล้วสร้างคิวจากรายการที่ตรวจพบจริงในรอบแรก</p></div>
      </div>
      <div className="seo-audit-form">
        <label>เว็บไซต์
          <select value={site} onChange={e=>setSite(e.target.value)} disabled={busy||!data}>
            <option value="ALL">ทั้งหมด {data?.sites.length||13} เว็บไซต์</option>
            {data?.sites.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label>งานที่ต้องการ
          <select value={category} onChange={e=>setCategory(e.target.value as AuditCategory)} disabled={busy||!data}>
            {(Object.keys(categoryNames) as AuditCategory[]).map(k=><option key={k} value={k}>{categoryNames[k]}</option>)}
          </select>
        </label>
        <label>ระดับ
          <select value={priority} onChange={e=>setPriority(e.target.value as AuditPriority)} disabled={busy||!data}>
            {(['P0','P1','P2','ALL'] as AuditPriority[]).map(k=><option key={k} value={k}>{k==='ALL'?'ทุกระดับ':k}</option>)}
          </select>
        </label>
        <button type="button" onClick={()=>void start()} disabled={busy||loading||!data||!preview.length} className="seo-audit-primary">
          <ListChecks size={17}/>{busy?'กำลังจัดทำคิว…':'สร้างแผนงาน '+preview.length+' รายการ'}
        </button>
      </div>
      <div className="seo-audit-preview"><Filter size={15}/> พบงานเข้าขอบเขต {preview.length} รายการจาก Audit #177
        <span>P0 {preview.filter(t=>t.priority==='P0').length} · P1 {preview.filter(t=>t.priority==='P1').length} · P2 {preview.filter(t=>t.priority==='P2').length}</span>
      </div>
    </section>
    {data&&<section className="seo-audit-panel">
      <div className="seo-audit-section-title"><div><h3><BookOpen size={18}/> ประวัติ Audit และคิวงาน</h3>
        <p>แยกงานตาม Run เพื่อรักษา Baseline และไม่ปะปนข้อมูลก่อน–หลัง Release</p></div></div>
      <label className="seo-audit-run-select">เลือกรอบที่ต้องการดู
        <select value={selectedId||''} onChange={e=>{setSelectedId(e.target.value);setBrief('');setSelectedTaskId(null);setTaskNote('')}}>
          {!data.runs.length&&<option value="">ยังไม่มีรอบที่บันทึก</option>}
          {data.runs.map(r=><option key={r.id} value={r.id}>
            {prettyDate(r.created_at)} · {r.site_filter==='ALL'?'ทุกเว็บ':r.site_filter} · {r.priority_filter}/{categoryNames[r.category_filter]}
          </option>)}
        </select>
      </label>
      {!activeRun?<p className="seo-audit-empty">ยังไม่มีคิว Audit — เลือกตัวกรองด้านบนแล้วกด “สร้างแผนงาน”</p>:
      <>
        <div className="seo-audit-run-context">
          <strong>Audit #177 · ข้อมูลต้นทางวันที่ {activeRun.source_as_of}</strong>
          <span>สร้าง {prettyDate(activeRun.created_at)} · ข้อมูล GSC เป็น Snapshot Final คนละช่วงวันที่ได้ ไม่ใช่การ Crawl สด</span>
          <div className="seo-audit-gsc-rows">
          {activeRun.gsc_snapshot.length?activeRun.gsc_snapshot.map(m=><div key={m.site_id}>
            <b>{data.sites.find(s=>s.id===m.site_id)?.label||m.site_id}</b>
            <span>{format(m.clicks)} คลิก · {format(m.impressions)} การแสดงผล</span>
            <small>GSC {m.start_date}–{m.end_date} · Avg pos {m.position==null?'—':Number(m.position).toFixed(1)}</small>
          </div>):<p>ไม่มี GSC Final Snapshot ของขอบเขตนี้ · ต้องตรวจข้อมูลก่อนใช้ตัดสินใจปรับ SEO</p>}
          </div>
        </div>
        <div className="seo-audit-stats seo-audit-task-stats">
          <div><small>งานในรอบนี้</small><strong>{tasks.length}</strong></div>
          <div><small>รอจัดลำดับ</small><strong>{taskCounts.open}</strong></div>
          <div><small>เตรียม Brief แล้ว</small><strong>{taskCounts.ready}</strong></div>
          <div><small>พักงาน</small><strong>{taskCounts.dismissed}</strong></div>
        </div>
        <div className="seo-audit-task-list">
        {tasks.map(t=><article className={'seo-audit-task seo-audit-task-'+t.status.toLowerCase()} key={t.id}>
          <div className="seo-audit-task-top">
            <div><span className={'seo-audit-level seo-audit-level-'+t.priority.toLowerCase()}>{t.priority}</span>
              <span className="seo-audit-code">{t.template_code}</span>
              <span className="seo-audit-type">{categoryNames[t.category]}</span></div>
            <span className="seo-audit-task-status">{statusNames[t.status]}</span>
          </div>
          <h4>{t.title}</h4>
          <p className="seo-audit-finding">{t.finding}</p>
          <details><summary>แนวทางแก้ไขและเกณฑ์ QA</summary>
            <p><b>แนวทาง:</b> {t.recommendation}</p><p><b>เกณฑ์ผ่าน:</b> {t.acceptance}</p>
            {t.focus_query&&<p><b>คำค้น:</b> {t.focus_query}</p>}
            {t.target_page&&<a href={t.target_page} target="_blank" rel="noopener noreferrer">เปิดหน้าที่เกี่ยวข้อง <ExternalLink size={13}/></a>}
            <p><small>หลักฐาน: {t.evidence_kind} · ยังไม่ได้ตรวจทุกราย URL</small></p>
          </details>
          <div className="seo-audit-task-actions">
            <button type="button" disabled={busy} className="seo-audit-action-primary" onClick={()=>void queueAndCopy(t)}><ClipboardCopy size={15}/> เตรียม AI Work Order</button>
            {t.status==='DISMISSED'?
              <button type="button" disabled={busy} onClick={()=>void taskAction(t,'OPEN')}>เปิดงานอีกครั้ง</button>:
              <button type="button" disabled={busy} onClick={()=>void taskAction(t,'DISMISSED')}>พักงาน</button>}
            <button type="button" disabled={busy} onClick={()=>{setSelectedTaskId(t.id);setTaskNote(t.review_note);setBrief('')}}>บันทึกเหตุผล</button>
          </div>
          {selectedTaskId===t.id&&<div className="seo-audit-work-order">
            <label>บันทึกการตรวจของผู้ดูแล (ไม่ใช่การอนุมัติ Deploy)
              <textarea rows={2} maxLength={1200} value={taskNote} onChange={e=>setTaskNote(e.target.value)} placeholder="ข้อจำกัด หลักฐานเพิ่มเติม หรือสิ่งที่ต้องตรวจ"/>
            </label>
            <button type="button" disabled={busy} onClick={()=>void taskAction(t,t.status)}>บันทึกหมายเหตุ</button>
            {brief&&<><label>AI Work Order — คัดลอกไป ChatGPT เพื่อเตรียม Diff
              <textarea readOnly rows={12} value={brief} onFocus={e=>e.currentTarget.select()}/></label>
              <button type="button" onClick={onOpenDevelopment}>เปิด AI Development / Source Change Review</button>
            </>}
          </div>}
        </article>)}
        </div>
        {tasks.length===0&&<p>ไม่มีรายการในขอบเขตที่เลือก</p>}
      </>}
    </section>}
    <footer className="seo-audit-footer">
      <AlertTriangle size={18}/>
      <span>AI Work Order เป็นข้อมูลเพื่อส่งตรวจ ChatGPT ไม่ใช่คำสั่งที่ดำเนินการแล้ว · ปรับ Source ต้องผ่านการยืนยัน Repository, Keyword, GSC, เจ้าของอนุมัติ Draft PR, CI และ Release แยกต่างหาก</span>
    </footer>
  </section>
}
