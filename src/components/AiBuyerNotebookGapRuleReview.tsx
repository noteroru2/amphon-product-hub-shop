import {useEffect,useState} from 'react';
import {decideNotebookGapBatch,listNotebookGapBatches,type NotebookGapBatch} from '../lib/aiBuyerNotebookGapRules';
const button:React.CSSProperties={padding:'8px 12px',border:'1px solid #71809a88',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
const money=(n:number|null)=>n===null?'รายรุ่น':new Intl.NumberFormat('th-TH').format(n);
export function AiBuyerNotebookGapRuleReview(){
 const [open,setOpen]=useState(false),[batches,setBatches]=useState<NotebookGapBatch[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{setBusy(true);setError('');
  try{setBatches(await listNotebookGapBatches())}catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 useEffect(()=>{if(open)void load()},[open]);
 const decide=async(id:string,action:'APPROVE_DRAFT'|'DISMISS')=>{
  const b=batches.find(x=>x.id===id);if(!b)return;
  if(!window.confirm(action==='APPROVE_DRAFT'
   ?'ยืนยันข้อเสนอเติมช่องว่างราคา '+b.rules.length+' กลุ่ม เป็น APPROVED_DRAFT เท่านั้น? ข้อเสนอจากประวัติยังต้องตรวจสเปกจริงและราคาขายก่อนเสนอแก่ลูกค้า ไม่เปิด LINE AUTO หรือแก้ V2.7'
   :'ยกเลิกข้อเสนอช่องว่างราคาทั้งชุดโดยไม่เปลี่ยนราคา?'))return;
  setBusy(true);setError('');setNotice('');
  try{await decideNotebookGapBatch(id,action);await load();
   setNotice(action==='APPROVE_DRAFT'?'อนุมัติเป็นกฎร่างแล้ว ไม่เปิดใช้ราคากับ LINE หรือ Active':'ยกเลิกข้อเสนอแล้ว');
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 return <section style={{border:'1px solid #8290a166',borderRadius:12,padding:12,margin:'12px 0'}}>
  <button style={{...button,width:'100%',textAlign:'left',fontWeight:700}} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   Historical Pricing Gaps — ข้อเสนอจากสต๊อกจริง ({batches[0]?.rules.length??'11'} กลุ่ม) {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.8}}>กลุ่มที่ยังไม่มีราคาและเคยรับซื้อจริง · ข้อเสนอจากหลักฐาน ไม่ใช่ราคาที่ Owner อนุมัติแล้ว · แยกจากราคา Gaming/Office/Business ที่มีอยู่</p>
  {open&&<>
   <button style={button} disabled={busy} onClick={()=>void load()}>{busy?'กำลังโหลด':'รีเฟรชข้อเสนอ'}</button>
   {!batches.length&&<p>ยังไม่มีข้อเสนอเติมช่องว่างราคา</p>}
   {batches.map((batch,index)=><div key={batch.id} style={{borderTop:'1px solid #8290a155',marginTop:12,paddingTop:10}}>
    <strong>{batch.title}</strong>
    <p style={{fontSize:12,opacity:.75}}>สถานะ: {batch.status==='PENDING'?'รอ Owner อนุมัติ':batch.status==='APPROVED_DRAFT'?'อนุมัติเป็นกฎร่างแล้ว':'ยกเลิก'} · {batch.rules.length} กลุ่ม {index>0?'· ประวัติชุดก่อน':''}</p>
    <div style={{overflowX:'auto'}}>
     <table style={{minWidth:760,width:'100%',fontSize:12,borderCollapse:'collapse'}}>
      <thead><tr><th>กลุ่ม</th><th>CPU</th><th>GPU</th><th>เปิดรับเสนอใหม่</th><th>หลักฐาน / ความเสี่ยง</th></tr></thead>
      <tbody>{batch.rules.map(r=><tr key={r.key} style={{borderTop:'1px solid #8290a144'}}>
       <td>{r.category.replace('NOTEBOOK_','')}</td><td>{r.cpu}</td><td>{r.gpu}</td>
       <td style={{whiteSpace:'nowrap'}}><strong>{r.review_type==='PER_MODEL'?'รายรุ่น':money(r.opening_min)+'–'+money(r.opening_max)+' บาท'}</strong></td>
       <td><div style={{fontWeight:r.risk==='HIGH'?700:400}}>{r.risk==='HIGH'?'ข้อมูลน้อย ต้องตรวจพิเศษ':r.risk==='CAUTION'?'ระวังราคา':'หลักฐานประกอบ'} · {r.sample_count} เครื่อง</div>
        <div style={{opacity:.75}}>{r.notes}</div><div style={{fontSize:10,opacity:.7}}>{r.evidence.join(', ')}</div>
       </td>
      </tr>)}</tbody>
     </table>
    </div>
    {batch.status==='PENDING'&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
     <button style={button} disabled={busy} onClick={()=>void decide(batch.id,'APPROVE_DRAFT')}>Owner ยืนยันเป็นกฎร่าง {batch.rules.length} กลุ่ม</button>
     <button style={button} disabled={busy} onClick={()=>void decide(batch.id,'DISMISS')}>ยกเลิกข้อเสนอชุดนี้</button>
    </div>}
   </div>)}
   {notice&&<p role="status" style={{color:'#0a8e75'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#c45b45'}}>{error}</p>}
  </>}
 </section>;
}