import {useEffect,useMemo,useState} from 'react';
import {loadCostLearningRecords} from '../lib/aiBuyerCostLearningData';
import {analyzeNotebookCoverage,type NotebookCoverage,type NotebookBucket} from '../lib/aiBuyerNotebookCoverage';
const fmt=(v:number|null)=>v===null?'ไม่มีข้อมูล':new Intl.NumberFormat('th-TH').format(v)+' ฿';
const labels:Record<NotebookBucket['kind'],string>={GAMING:'Gaming',GENERAL:'ทำงานทั่วไป',BUSINESS:'Business',MACBOOK:'MacBook',REVIEW:'ตรวจสเปก'};
const btn:React.CSSProperties={padding:'8px 11px',border:'1px solid #8290a188',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
export function AiBuyerNotebookCoverage(){
 const [open,setOpen]=useState(false),[report,setReport]=useState<NotebookCoverage|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [kind,setKind]=useState('ALL'),[search,setSearch]=useState(''),[limit,setLimit]=useState(40);
 const load=async()=>{setBusy(true);setError('');
  try{setReport(analyzeNotebookCoverage(await loadCostLearningRecords()))}
  catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}};
 useEffect(()=>{if(open)void load()},[open]);
 const rows=useMemo(()=>report?.buckets.filter(r=>(kind==='ALL'||r.kind===kind)&&[r.cpu,r.gpu,r.family,...r.examples].join(' ').toLowerCase().includes(search.toLowerCase().trim()))??[],[report,kind,search]);
 const copy=()=>{const message=rows.map(r=>labels[r.kind]+' / '+r.cpu+' / '+r.gpu+' | ตัวอย่างทุนกลาง '+fmt(r.medianBuy)+' จาก '+r.count+' เครื่อง | ราคาเปิดรับที่ Owner ต้องการ: ยังไม่กำหนด').join('\n');
  void navigator.clipboard.writeText(message).catch(()=>setError('คัดลอกไม่สำเร็จ'));};
 return <section style={{margin:'12px 0',border:'1px solid #8290a166',borderRadius:12,padding:12}}>
  <button style={{...btn,width:'100%',textAlign:'left',fontWeight:700}} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Notebook Coverage — ครอบคลุมทุก CPU/GPU ที่พบ {open?'▴':'▾'}</button>
  <p style={{fontSize:12,opacity:.75}}>ข้อมูลอ้างอิงเท่านั้น: ไม่อนุมานราคาซื้อจากทุนกลาง และไม่เปิด LINE AUTO</p>
  {open&&<>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'10px 0'}}>
    <strong>พบโน๊ตบุ๊ค {report?.inventory??'…'} เครื่อง</strong>
    <span>ต้องตรวจสเปก {report?.unknown??'…'} เครื่อง</span>
    <span>{report?.buckets.length??'…'} กลุ่ม</span>
    <button style={btn} disabled={busy} onClick={()=>void load()}>{busy?'กำลังโหลด':'รีเฟรช'}</button>
   </div>
   <div style={{display:'flex',gap:7,flexWrap:'wrap',margin:'8px 0'}}>
    <select style={btn} value={kind} onChange={e=>{setKind(e.target.value);setLimit(40)}}>
     <option value="ALL">ทุกหมวด</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
    </select>
    <input style={{...btn,flex:1,minWidth:150}} placeholder="ค้นหา CPU/GPU/รุ่น" value={search} onChange={e=>setSearch(e.target.value)}/>
    <button style={btn} disabled={!rows.length} onClick={copy}>คัดลอกสเปกไปตั้งราคากับ ChatGPT</button>
   </div>
   <div style={{overflowX:'auto'}}><table style={{minWidth:760,width:'100%',fontSize:12,borderCollapse:'collapse'}}>
    <thead><tr><th>ประเภท</th><th>CPU</th><th>GPU</th><th>เครื่อง</th><th>ขายแล้ว</th><th>ทุนกลางย้อนหลัง*</th><th>กฎราคารับซื้อ</th></tr></thead>
    <tbody>{rows.slice(0,limit).map(r=><tr key={r.key} style={{borderTop:'1px solid #8290a144'}}>
     <td>{labels[r.kind]}</td><td>{r.cpu}</td><td>{r.gpu}</td><td>{r.count}</td><td>{r.sold}</td><td>{fmt(r.medianBuy)}</td>
     <td>{r.kind==='REVIEW'?'ต้องตรวจสเปกก่อน':'ใช้กฎที่ Owner อนุมัติ / ยังไม่มีกฎให้ตรวจเพิ่ม'}</td>
    </tr>)}</tbody>
   </table></div>
   {rows.length>limit&&<button style={{...btn,marginTop:8}} onClick={()=>setLimit(n=>n+40)}>แสดงเพิ่ม ({rows.length-limit})</button>}
   <p style={{fontSize:11,opacity:.75}}>*ทุนกลางจากประวัติซื้อจริงที่ไม่ใช่ FORFEIT และไม่มีคำบ่งชี้เครื่องเสีย เป็นเพียงหลักฐานต้นทุน ไม่ใช่ราคาตลาดหรือราคาที่ AI อนุมัติแล้ว</p>
   {error&&<p role="alert" style={{color:'#bd5b45'}}>{error}</p>}
  </>}
 </section>;
}