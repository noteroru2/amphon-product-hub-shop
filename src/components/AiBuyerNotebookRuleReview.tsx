import {useEffect,useState} from 'react';
import {decideNotebookRuleBatch,listNotebookRuleBatches,type NotebookSpecOfferBatch} from '../lib/aiBuyerNotebookRuleBatches';
const btn:React.CSSProperties={padding:'8px 12px',border:'1px solid #71809a88',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
const fmt=(n:number)=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(Number(n));
export function AiBuyerNotebookRuleReview(){
 const [batches,setBatches]=useState<NotebookSpecOfferBatch[]>([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{setLoading(true);setError('');try{setBatches(await listNotebookRuleBatches())}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);
 const decide=async(id:string,action:'APPROVE_DRAFT'|'DISMISS')=>{
  const b=batches.find(x=>x.id===id);if(!b)return;
  const message=action==='APPROVE_DRAFT'?
   'ยืนยันบันทึก '+b.rules.length+' กฎเสนอเปิดรับเป็นกฎร่างที่ Owner ตรวจแล้วเท่านั้น? ไม่เปิดใช้งาน PriceBook V2.7 หรือ LINE AUTO':
   'ยกเลิกข้อเสนอชุด '+b.rules.length+' กฎ โดยไม่แก้ราคา?';
  if(!window.confirm(message))return;
  setLoading(true);setError('');setNotice('');
  try{await decideNotebookRuleBatch(id,action);await load();
   setNotice(action==='APPROVE_DRAFT'?'บันทึก APPROVED_DRAFT แล้ว · ไม่ส่งราคาไป LINE และไม่มีการแก้ PriceBook Active':'ยกเลิกข้อเสนอแล้ว');
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setLoading(false)}
 };
 return <section style={{border:'1px solid #71809a66',borderRadius:10,padding:12,margin:'12px 0'}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
   <strong>กฎเปิดรับโน๊ตบุ๊คเกมมิ่งแยกตามสเปก</strong>
   <button style={btn} disabled={loading} onClick={()=>void load()}>รีเฟรช</button>
  </div>
  <p style={{fontSize:12,opacity:.75}}>ข้อเสนอจาก ChatGPT เป็นช่วงราคาเริ่มเจรจา · กฎนี้ไม่ทำงานใน LINE/Worker แม้ Owner อนุมัติเป็น Draft</p>
  {batches.length===0?<p style={{fontSize:12}}>ยังไม่มีข้อเสนอช่วงราคาแบบหลายสเปก</p>:
   batches.map(batch=><div key={batch.id} style={{borderTop:'1px solid #71809a55',padding:'10px 0'}}>
    <strong>{batch.title}</strong>
    <p style={{fontSize:12,opacity:.75}}>สถานะ: {batch.status==='PENDING'?'รออนุมัติ':batch.status==='APPROVED_DRAFT'?'อนุมัติเป็นกฎร่างแล้ว':'ยกเลิก'} · {new Date(batch.created_at).toLocaleString('th-TH')}</p>
    <div style={{overflowX:'auto'}}>
     <table style={{minWidth:690,width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr><th>สเปก</th><th>ช่วงเปิดรับ</th><th>ความเสี่ยง</th><th>เหตุผล</th></tr></thead>
      <tbody>{batch.rules.map(rule=><tr key={rule.key} style={{borderTop:'1px solid #71809a44'}}>
       <td style={{minWidth:220}}>{rule.spec}</td>
       <td style={{whiteSpace:'nowrap',textAlign:'right'}}>{fmt(rule.opening_min)}{rule.opening_max!==rule.opening_min?'–'+fmt(rule.opening_max):''} บาท</td>
       <td>{rule.review==='HIGH'?'ตรวจพิเศษ':rule.review==='CAUTION'?'ระวัง':'ปกติ'}</td>
       <td style={{minWidth:210}}>{rule.note}</td>
      </tr>)}</tbody>
     </table>
    </div>
    {batch.status==='PENDING'&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
     <button style={btn} disabled={loading} onClick={()=>void decide(batch.id,'APPROVE_DRAFT')}>ยืนยันกฎร่าง {batch.rules.length} กลุ่ม</button>
     <button style={btn} disabled={loading} onClick={()=>void decide(batch.id,'DISMISS')}>ยกเลิกชุดนี้</button>
    </div>}
   </div>)}
  {notice&&<p role="status" style={{color:'#0b9274'}}>{notice}</p>}
  {error&&<p role="alert" style={{color:'#c65947'}}>{error}</p>}
 </section>;
}
