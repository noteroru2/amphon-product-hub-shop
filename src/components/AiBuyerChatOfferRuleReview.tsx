import {useEffect,useState} from 'react';
import {listChatOfferRules,decideChatOfferRule,type ChatOfferRule} from '../lib/aiBuyerChatOfferRules';
const btn:React.CSSProperties={padding:'8px 12px',border:'1px solid #71809a88',borderRadius:8,cursor:'pointer'};
export function AiBuyerChatOfferRuleReview(){
 const [rules,setRules]=useState<ChatOfferRule[]>([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{setLoading(true);setError('');try{setRules(await listChatOfferRules())}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);
 const decide=async(id:string,action:'APPROVE_DRAFT'|'DISMISS')=>{
  const r=rules.find(x=>x.id===id);if(!r)return;
  if(!window.confirm(action==='APPROVE_DRAFT'
   ?'ยืนยันเก็บกฎราคาเสนอเปิดรับ '+r.opening_min.toLocaleString('th-TH')+'–'+r.opening_max.toLocaleString('th-TH')+' บาทในชุดร่างเท่านั้น? กฎนี้ยังไม่ใช้ตอบ LINE หรือเปลี่ยน V2.7'
   :'ยกเลิกกฎราคาที่เสนอโดยไม่เปลี่ยนระบบ?'))return;
  setLoading(true);setError('');setNotice('');
  try{await decideChatOfferRule(id,action);await load();
   setNotice(action==='APPROVE_DRAFT'?'อนุมัติบันทึกเป็นกฎร่างแล้ว (ยังไม่เชื่อมกับระบบตอบราคาอัตโนมัติ)':'ยกเลิกข้อเสนอแล้ว');
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setLoading(false)}
 };
 return <div style={{margin:'12px 0',border:'1px solid #71809a66',borderRadius:10,padding:12}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
   <strong>กฎเสนอราคารับซื้อแบบมีเงื่อนไข</strong>
   <button style={btn} disabled={loading} onClick={()=>void load()}>รีเฟรช</button>
  </div>
  <p style={{fontSize:12,opacity:.75}}>กฎทั้งหมวดหรือหลายรุ่นไม่ใช่ราคาใน PriceBook รายรุ่น — เก็บแยกเป็น Draft Rule และต้องตรวจสเปกจริงก่อนใช้</p>
  {rules.length===0?<p style={{fontSize:12}}>ยังไม่มีกฎราคาที่เสนอจากแชท</p>:rules.map(r=><div key={r.id} style={{padding:'10px 0',borderTop:'1px solid #71809a55'}}>
    <strong>{r.title}</strong>
    <p style={{fontSize:12}}>CPU: i5 Gen {r.cpu_generation} · GPU: {r.gpu_model} · RAM {r.ram_options.join(' หรือ ')} GB · SSD {r.ssd_gb} GB</p>
    <p style={{fontSize:14,fontWeight:650}}>เสนอเปิดรับ {Number(r.opening_min).toLocaleString('th-TH')}–{Number(r.opening_max).toLocaleString('th-TH')} บาท</p>
    <p style={{fontSize:12}}>{r.description}</p>
    <p style={{fontSize:12,opacity:.75}}>สถานะ: {r.status==='PENDING'?'รอ Owner ตรวจ':r.status==='APPROVED_DRAFT'?'กฎร่างที่อนุมัติแล้ว (ยังไม่ใช้งานจริง)':'ยกเลิกแล้ว'} · {new Date(r.created_at).toLocaleString('th-TH')}</p>
    {r.status==='PENDING'&&<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button style={btn} disabled={loading} onClick={()=>void decide(r.id,'APPROVE_DRAFT')}>อนุมัติเป็นกฎร่าง</button>
     <button style={btn} disabled={loading} onClick={()=>void decide(r.id,'DISMISS')}>ยกเลิก</button>
    </div>}
   </div>)}
  {error&&<p role="alert" style={{color:'#c65542'}}>{error}</p>}
  {notice&&<p role="status" style={{color:'#0d9474'}}>{notice}</p>}
 </div>;
}
