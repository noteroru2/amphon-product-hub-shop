import {useState} from 'react'
import {supabase} from '../lib/supabase'
import type {TradeEvidence, TradeEvidenceImage} from '../lib/tradeEvidence'
import {validatePublicationTargets, type PublicationTarget} from '../lib/evidencePublisherPolicy'

type Receipt = {id:string;site_id:string;page_path:string;status:string}
const workerUrl=(import.meta.env.VITE_EVIDENCE_PUBLISHER_API || '').replace(/\/+$/,'')

export function EvidencePublisherPanel({evidence,sites}:{evidence:TradeEvidence;sites:{id:string;origin:string}[]}) {
  const [imageId,setImageId]=useState('')
  const [targets,setTargets]=useState<PublicationTarget[]>([])
  const [working,setWorking]=useState(false)
  const [error,setError]=useState('')
  const [receipt,setReceipt]=useState<{claim_kind:string;requests:Receipt[];status:string;media_public:boolean}|null>(null)
  const images=(evidence.trade_evidence_images || []).filter((im:TradeEvidenceImage)=>im.approved_for_public)
  function toggle(site_id:string,checked:boolean) {
    setReceipt(null)
    setTargets(previous=>checked?[...previous,{site_id,page_path:'/'}]:previous.filter(x=>x.site_id!==site_id))
  }
  function path(site_id:string,value:string) {
    setReceipt(null)
    setTargets(previous=>previous.map(x=>x.site_id===site_id?{...x,page_path:value}:x))
  }
  async function submit() {
    setError('');setReceipt(null)
    if(!workerUrl){setError('ยังไม่ได้ตั้งค่า VITE_EVIDENCE_PUBLISHER_API สำหรับ Hub');return}
    if(!imageId){setError('เลือกภาพที่ตรวจแล้ว');return}
    let safeTargets:PublicationTarget[]
    try {safeTargets=validatePublicationTargets(targets)}
    catch {setError('กรุณาเลือกเว็บไซต์และกรอกพาธหน้าที่ถูกต้อง เช่น /บริการ/รับซื้อโน๊ตบุ๊ค');return}
    if(!window.confirm('ยืนยันให้สร้างไฟล์ WebP ในคลังส่วนตัวและส่งคิว Draft PR ตามหน้าที่เลือก? ภาพจะไม่เผยแพร่สาธารณะ และไม่มีการ Merge หรือ Deploy'))return
    setWorking(true)
    try {
      if(!supabase)throw Error('ยังไม่เชื่อมต่อ Supabase')
      const {data,error:authError}=await supabase.auth.getSession()
      if(authError||!data.session?.access_token)throw Error('กรุณาเข้าสู่ระบบใหม่')
      const res=await fetch(workerUrl+'/api/stage',{
        method:'POST',headers:{'authorization':'Bearer '+data.session.access_token,
          'content-type':'application/json'},
        body:JSON.stringify({evidence_id:evidence.id,image_id:imageId,targets:safeTargets})
      })
      const body=await res.json()
      if(!res.ok)throw Error('Publisher: '+String(body.error||res.status))
      setReceipt(body)
    }catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setWorking(false)}
  }
  if(evidence.status!=='APPROVED')return null
  return <section className="evidence-share" aria-label="Evidence Publisher">
    <h3>เตรียมหลักฐานส่วนตัวเข้าสู่คิว Draft PR (Owner)</h3>
    <p>ขั้นตอนนี้สร้าง WebP ในคลังส่วนตัวและเข้าคิวเตรียม Draft PR เท่านั้น ไม่เปิดเผยรูปจริง ไม่แก้หน้าเว็บ ไม่ Merge หรือ Deploy</p>
    <p>สถานะธุรกรรม: <strong>{evidence.transaction_verified?'เจ้าของยืนยันซื้อ/ขายจริง':'เคสประเมินเท่านั้น ยังไม่ยืนยันซื้อ/ขายจริง'}</strong></p>
    {!evidence.permission_confirmed||!evidence.privacy_reviewed
      ? <p role="alert">ต้องอนุมัติสิทธิ์และตรวจความเป็นส่วนตัวก่อน</p>
      : <>
        <label>ภาพหลักฐานที่ผ่านการตรวจ
          <select value={imageId} onChange={e=>{setImageId(e.target.value);setReceipt(null)}}>
            <option value="">เลือกภาพ</option>
            {images.map((im,i)=><option key={im.id} value={im.id}>ภาพ {i+1}: {im.alt_text||'ไม่ระบุคำอธิบาย'}</option>)}
          </select>
        </label>
        <p>เลือกเว็บไซต์และกรอก URL path ที่จะใช้หลักฐาน (ไม่ใช่ช่องแหล่งที่มาของลูกค้า)</p>
        {sites.map(site=>{
          const chosen=targets.find(t=>t.site_id===site.id)
          return <div key={site.id} className="evidence-block">
            <label><input type="checkbox" checked={!!chosen} onChange={e=>toggle(site.id,e.target.checked)}/> {site.origin}</label>
            {chosen&&<label>พาธปลายทาง
              <input value={chosen.page_path} placeholder="/บริการ/รับซื้อโน๊ตบุ๊ค"
                onChange={e=>path(site.id,e.target.value)}/>
            </label>}
          </div>
        })}
        {error&&<p className="evidence-error" role="alert">{error}</p>}
        {receipt&&<div role="status">
          <p>จัดเก็บภาพในคลังส่วนตัวและส่งคิวแล้ว ({receipt.claim_kind}) — ไม่มี URL ภาพสาธารณะ ไม่ได้สร้าง PR หรือเผยแพร่เว็บไซต์</p>
          {receipt.requests.map(r=><p key={r.id}>{r.site_id} {r.page_path} — {r.status} · {r.id}</p>)}
        </div>}
        <button className="evidence-approve" disabled={working||!images.length||!targets.length} onClick={()=>void submit()}>
          {working?'กำลังสร้างคิว...':'ส่งคิวเตรียม Draft PR (ภาพยังเป็นส่วนตัว)'}
        </button>
      </>}
    <p>ห้ามใส่ URL ของภาพส่วนตัวหรือ Signed URL ลงใน Draft PR ภาพสาธารณะต้องได้รับอนุมัติอีกครั้งแยกต่างหาก</p>
  </section>
}
