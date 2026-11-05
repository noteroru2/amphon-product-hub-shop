import {useEffect,useState} from 'react';
import {decideBusinessNotebookRules,listBusinessNotebookRules,type BusinessNotebookRuleBatch} from '../lib/aiBuyerBusinessNotebookRules';
const btn:React.CSSProperties={padding:'9px 12px',border:'1px solid #71809a88',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
const fmt=(n:number|null)=>n===null?'ตามรุ่นจริง':new Intl.NumberFormat('th-TH').format(n);
export function AiBuyerBusinessNotebookRuleReview(){
 const [batches,setBatches]=useState<BusinessNotebookRuleBatch[]>([]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [family,setFamily]=useState('ALL');
 const load=async()=>{setBusy(true);setError('');try{setBatches(await listBusinessNotebookRules())}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 useEffect(()=>{if(open)void load()},[open]);
 const decide=async(id:string,action:'APPROVE_DRAFT'|'DISMISS')=>{
  const batch=batches.find(b=>b.id===id);if(!batch)return;
  if(!window.confirm(action==='APPROVE_DRAFT'
   ?'ยืนยันกฎราคาเปิดรับ '+batch.rules.length+' กลุ่ม โดยบัญชี Owner? จะบันทึกเป็น APPROVED_DRAFT เท่านั้น ไม่เปิด LINE AUTO หรือแก้ V2.7'
   :'ยกเลิกข้อเสนอทั้งชุดโดยไม่เปลี่ยนราคาหรือไม่?'))return;
  setBusy(true);setError('');setNotice('');
  try{await decideBusinessNotebookRules(id,action);await load();
   setNotice(action==='APPROVE_DRAFT'?'Owner อนุมัติเป็นกฎร่างแล้ว ไม่มีการแก้ราคา Active หรือ LINE':'ยกเลิกข้อเสนอแล้ว');
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 return <section style={{border:'1px solid #71809a66',borderRadius:12,padding:12,marginTop:12}}>
  <button style={{...btn,width:'100%',fontWeight:700,textAlign:'left'}} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   Business Notebook — ราคาเปิดรับ i5/i7/Core Ultra ({batches[0]?.rules.length??'14'} กลุ่ม) {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.76}}>ข้อเสนอ Business Notebook ฉบับลดราคา ที่ Owner ยืนยันใน ChatGPT · เน้นราคาขายต่อและการหมุนสต๊อก · ไม่ใช่ราคาใน LINE หรือเพดานรับซื้อ</p>
  {open&&<>
   <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:10}}>
    <button style={btn} disabled={busy} onClick={()=>void load()}>{busy?'กำลังโหลด':'รีเฟรชข้อเสนอ'}</button>
    <label style={{fontSize:12}}>ดูหมวด:
     <select value={family} onChange={e=>setFamily(e.target.value)} style={{...btn,marginLeft:6}}>
      <option value="ALL">ทั้งหมด</option>
      {[...new Set(batches.flatMap(b=>b.rules.map(r=>r.family)))].map(x=><option key={x} value={x}>{x}</option>)}
     </select>
    </label>
   </div>
   {!batches.length&&<p>ยังไม่มีชุดราคา Business Notebook จากแชท</p>}
   {batches.map((batch,index)=><div key={batch.id} style={{borderTop:'1px solid #71809a44',marginTop:12,paddingTop:10}}>
    <strong>{batch.title}</strong>
    <p style={{fontSize:12,opacity:.74}}>สถานะ: {batch.status==='PENDING'?'รอ Owner อนุมัติ':batch.status==='APPROVED_DRAFT'?'อนุมัติเป็นกฎร่างแล้ว':'ยกเลิก'} · {batch.rules.length} กลุ่ม · {new Date(batch.created_at).toLocaleString('th-TH')}{index>0?' · ประวัติข้อเสนอ':''}</p>
    <div style={{overflowX:'auto'}}>
     <table style={{minWidth:660,width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr><th>CPU</th><th>ช่วงราคาเปิดรับ</th><th>เงื่อนไข</th><th>การตรวจ</th></tr></thead>
      <tbody>{batch.rules.filter(r=>family==='ALL'||r.family===family).map(r=><tr key={r.key} style={{borderTop:'1px solid #71809a44'}}>
       <td>{r.cpu}<div style={{fontSize:11,opacity:.7}}>{r.family}</div></td>
       <td style={{whiteSpace:'nowrap'}}>{r.review_type==='PER_MODEL'?'ตีราคารายรุ่น':fmt(r.opening_min)+'–'+fmt(r.opening_max)+' บาท'}</td>
       <td>ออนบอร์ด · ตรวจสภาพและราคาขาย</td>
       <td>{r.review==='OWNER_CONFIRMED'?'ราคาที่ Owner ยืนยัน':'ตรวจสภาพและราคาขาย'}</td>
      </tr>)}</tbody>
     </table>
    </div>
    {batch.status==='PENDING'&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
     <button style={btn} disabled={busy} onClick={()=>void decide(batch.id,'APPROVE_DRAFT')}>Owner ยืนยันกฎร่าง {batch.rules.length} กลุ่ม</button>
     <button style={btn} disabled={busy} onClick={()=>void decide(batch.id,'DISMISS')}>ยกเลิกชุดนี้</button>
    </div>}
   </div>)}
   {notice&&<p role="status" style={{color:'#0b8d72'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#cb604a'}}>{error}</p>}
  </>}
 </section>;
}