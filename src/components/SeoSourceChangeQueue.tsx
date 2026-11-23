import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldAlert, ExternalLink, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

type SourceProposal={
 id: string
 site_id: string
 job_id: number
 target_page: string
 focus_query: string
 target_repository: string
 target_branch: string
 expected_base_sha: string
 requested_paths: string[]
 change_kind: string
 summary: string
 rationale: string
 proposed_change: string
 status: 'REVIEW_REQUIRED'|'APPROVED_FOR_DRAFT_PR'|'REJECTED'
 created_at: string
 reviewed_at: string|null
 review_note: string|null
}

export function SeoSourceChangeQueue({isOwner}:{isOwner:boolean}) {
 const [rows,setRows]=useState<SourceProposal[]>([])
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [note,setNote]=useState('')
 const [selectedId,setSelectedId]=useState<string|null>(null)
 const [busy,setBusy]=useState(false)
 const [refresh,setRefresh]=useState(0)

 useEffect(()=>{
  let active=true
  setLoading(true)
  if(!supabase) {
   setError('ยังไม่ได้เชื่อม Supabase')
   setLoading(false)
   return
  }
  void supabase.from('commerce_seo_source_change_requests')
   .select('id,site_id,job_id,target_page,focus_query,target_repository,target_branch,expected_base_sha,requested_paths,change_kind,summary,rationale,proposed_change,status,created_at,reviewed_at,review_note')
   .order('created_at',{ascending:false}).limit(50)
   .then(({data,error:readError})=>{
    if(!active)return
    if(readError) {setError('ยังอ่านคิว Source Change ไม่ได้: '+readError.message);setRows([])}
    else {setRows((data||[]) as SourceProposal[]);setError('')}
   })
   .finally(()=>{if(active)setLoading(false)})
  return ()=>{active=false}
 },[refresh])

 async function review(item:SourceProposal,decision:'APPROVE_FOR_DRAFT_PR'|'REJECT') {
  if(!isOwner||!supabase)return
  if(selectedId!==item.id) {setSelectedId(item.id);setNote('');return}
  setBusy(true);setError('');setNotice('')
  try {
   const {data,error:reviewError}=await supabase.rpc('review_seo_source_change_request',{
    p_request_id:item.id,p_decision:decision,p_note:note.trim()||null,
   })
   if(reviewError)throw reviewError
   const result=data as {status?:string}|null
   setNotice(result?.status==='APPROVED_FOR_DRAFT_PR'
    ? 'อนุมัติเฉพาะการเตรียม Draft PR แล้ว ยังไม่ได้สร้าง PR หรือ Deploy'
    : 'ปฏิเสธคำขอเรียบร้อย')
   setSelectedId(null);setNote('')
   setRefresh(v=>v+1)
  } catch(e) {
   setError(e instanceof Error?e.message:'Review ไม่สำเร็จ')
  } finally {setBusy(false)}
 }

 return <section className="seo-dev-requests" aria-label="SEO Source Change Requests">
  <div className="seo-dev-heading">
   <div><h3>Source Change Requests</h3><p>AI เสนอการแก้ไข → เจ้าของตรวจหลักฐาน → อนุมัติเฉพาะ Draft PR</p></div>
   <button disabled={loading} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={15}/> โหลดคิว</button>
  </div>
  <div className="seo-dev-warning">
   <ShieldAlert size={18}/>
   <div><strong>ไม่มีสิทธิ์ Merge / Deploy จากคิวนี้</strong>
    <p>Approval เป็นเพียงการอนุญาตให้เตรียม Pull Request เท่านั้น GitHub ต้องตรวจ SHA, Diff และ CI แยกต่างหาก</p>
   </div>
  </div>
  {loading&&<p role="status">กำลังอ่านคิว Source Change…</p>}
  {error&&<p role="alert" className="seo-dev-error">{error}</p>}
  {notice&&<p role="status" className="seo-dev-footnote">{notice}</p>}
  {!loading&&!error&&rows.length===0&&<p className="seo-dev-footnote">ยังไม่มีคำขอแก้ Source Code ที่ผ่านการตรวจหลักฐานเบื้องต้น</p>}
  <div className="seo-dev-request-list">
  {rows.map(item=><article key={item.id} className="seo-dev-request">
   <header className="seo-dev-request-head">
    <div><strong>{item.site_id} · {item.change_kind}</strong>
     <small>{new Date(item.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'})}</small></div>
    <span className={'seo-dev-request-status '+item.status.toLowerCase()}>{item.status==='REVIEW_REQUIRED'?'รอเจ้าของตรวจ':item.status==='APPROVED_FOR_DRAFT_PR'?'อนุมัติร่าง PR':'ไม่อนุมัติ'}</span>
   </header>
   <h4>{item.summary}</h4>
   <a href={item.target_page} target="_blank" rel="noopener noreferrer">{item.focus_query} <ExternalLink size={13}/></a>
   <p>{item.rationale}</p>
   <details>
    <summary>ตรวจรายละเอียดและไฟล์ที่เสนอแก้</summary>
    <p><b>Repository:</b> {item.target_repository} · <b>Branch:</b> {item.target_branch}</p>
    <p><b>Base SHA ที่ต้องตรวจซ้ำ:</b> <code>{item.expected_base_sha}</code></p>
    <p><b>ไฟล์:</b> {item.requested_paths.join(', ')}</p>
    <div className="seo-dev-proposal-text">{item.proposed_change}</div>
    <small>ข้อความนี้เป็นคำเสนอแก้ไขจาก AI ไม่ใช่คำสั่งให้ระบบรันโค้ด</small>
   </details>
   {item.status==='REVIEW_REQUIRED'&&isOwner&&<div className="seo-dev-review">
    {selectedId!==item.id?(
     <button onClick={()=>{setSelectedId(item.id);setNote('')}}>ตรวจและตัดสินใจ</button>
    ):(
     <>
      <label>บันทึกเหตุผลอนุมัติหรือปฏิเสธ
       <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} rows={2} placeholder="เหตุผลหรือข้อจำกัดที่ต้องให้ AI ตรวจ" />
      </label>
      <div>
       <button disabled={busy} onClick={()=>void review(item,'APPROVE_FOR_DRAFT_PR')}><CheckCircle2 size={15}/> อนุมัติให้เตรียม Draft PR</button>
       <button disabled={busy} onClick={()=>void review(item,'REJECT')}>ปฏิเสธ</button>
       <button disabled={busy} onClick={()=>setSelectedId(null)}>ยกเลิก</button>
      </div>
     </>
    )}
   </div>}
   {item.reviewed_at&&<small>ตรวจแล้วเมื่อ {new Date(item.reviewed_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})} · {item.review_note||'ไม่มีบันทึก'}</small>}
  </article>)}
  </div>
 </section>
}
