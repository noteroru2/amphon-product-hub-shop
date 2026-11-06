import {useEffect,useMemo,useState} from 'react';
import {loadCostLearningRecords,loadCostSpecReviews} from '../lib/aiBuyerCostLearningData';
import {applyCostSpecReviews} from '../lib/aiBuyerCostReviewRules';
import {saveCostSpecReview} from '../lib/aiBuyerCostReviewAdmin';
import {buildNotebookSpecVerificationQueue,parseNotebookVerification,type NotebookVerificationRow,type NotebookSpecIssue} from '../lib/aiBuyerNotebookSpecVerification';
const btn:React.CSSProperties={padding:'8px 12px',border:'1px solid #8290a188',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
const inp:React.CSSProperties={...btn,width:'100%',boxSizing:'border-box'};
const labels:Record<NotebookSpecIssue,string>={
 RTX3050_VRAM_MISSING:'RTX 3050 ไม่ทราบ VRAM (4/6GB)',
 RTX3050_VRAM_CONFLICT:'ข้อมูล VRAM ขัดแย้ง',
 MAC_FAMILY_MISSING:'ไม่ทราบ Air / Pro / Neo',
 MAC_CHIP_OR_YEAR_MISSING:'ไม่ทราบชิปหรือปี',
 MAC_RAM_MISSING:'ไม่ทราบ RAM',
 MAC_STORAGE_MISSING:'ไม่ทราบ SSD',
 MAC_SCREEN_MISSING:'ไม่ทราบขนาดจอ'
};
export function AiBuyerNotebookSpecVerification(){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<NotebookVerificationRow[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<NotebookVerificationRow|null>(null),[name,setName]=useState(''),[note,setNote]=useState('');
 const [verified,setVerified]=useState(false),[filter,setFilter]=useState('ALL');
 const [limit,setLimit]=useState(30);
 const load=async()=>{
  setBusy(true);setError('');
  try{const [records,reviews]=await Promise.all([loadCostLearningRecords(),loadCostSpecReviews()]);
   setRows(buildNotebookSpecVerificationQueue(applyCostSpecReviews(records,reviews)));
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 useEffect(()=>{if(open)void load()},[open]);
 const filtered=useMemo(()=>rows.filter(r=>filter==='ALL'||(filter==='RTX3050'?r.issues.some(i=>i.startsWith('RTX3050')):r.issues.some(i=>i.startsWith('MAC_')))),[rows,filter]);
 const choose=(r:NotebookVerificationRow)=>{setSelected(r);setName(r.product_name);setNote('');setVerified(false);setError('');setNotice('')};
 const save=async()=>{
  if(!selected||!verified)return;
  const parsed=buildNotebookSpecVerificationQueue([{
   source_kind:'INVENTORY',source_key:selected.source_key,inventory_code:selected.inventory_code,
   product_name:name,category:selected.category,source_type:selected.source_type,source_status:selected.source_status,
   buy_cost:0,actual_sale:null,actual_profit:null,quantity:1,occurred_at:null,details:{}
  }]);
  const current=parseCheck(name);
  if(!current){setError('ข้อมูลที่แก้ไขยังขาดสเปกจำเป็น: กรุณาตรวจ VRAM หรือ Air/Pro, ชิป/ปี, RAM, SSD, ขนาดจอจากเครื่องจริง');return;}
  if(!window.confirm('ตรวจสเปกจริงและหลักฐานแล้วใช่หรือไม่? บันทึกเป็น Owner Review Overlay เท่านั้น ไม่เปลี่ยนรายการสินค้า ต้นทุน ราคา หรือ LINE AUTO'))return;
  setBusy(true);setError('');
  try{await saveCostSpecReview({sourceKey:selected.source_key,sourceName:originals[selected.source_key]?.name??selected.product_name,
    sourceCategory:originals[selected.source_key]?.category??selected.category,
    reviewedName:name,reviewedCategory:selected.issues.some(i=>i.startsWith('MAC_'))?'MACBOOK':'NOTEBOOK',note:note.trim()});
   await load();setSelected(null);setVerified(false);setNotice('บันทึกการตรวจสเปกแล้ว พร้อม Audit Log (ไม่แก้สต๊อกต้นทาง)');
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 };
 const [originals,setOriginals]=useState<Record<string,{name:string;category:string}>>({});
 const refresh=async()=>{await load()};
 function parseCheck(n:string){
  const p=parseNotebookVerification(n);
  if(!selected)return false;
  if(selected.issues.some(i=>i.startsWith('RTX3050'))&&!(p.gpu==='RTX3050'&&p.vramGb))return false;
  if(selected.issues.some(i=>i.startsWith('MAC_'))&&!(p.macFamily&&(p.chip||p.year)&&p.ramGb&&p.ssdGb&&p.screenInches))return false;
  return p.issues.length===0;
 }
 return <section style={{border:'1px solid #8290a166',borderRadius:12,padding:12,margin:'12px 0'}}>
  <button style={{...btn,width:'100%',textAlign:'left',fontWeight:700}} aria-expanded={open} onClick={()=>setOpen(o=>!o)}>Notebook Spec Verification — RTX3050 VRAM / MacBook รุ่นและความจุ {open?'▴':'▾'}</button>
  <p style={{fontSize:12,opacity:.8}}>คิวจากข้อมูลสต๊อกจริง · ไม่เดา VRAM จากชื่อรุ่นและไม่สมมติ RAM/SSD ให้ MacBook · ผลตรวจบันทึกเป็น Overlay พร้อม Audit เท่านั้น</p>
  {open&&<>
   <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
    <strong>รอตรวจ {rows.length} เครื่อง</strong>
    <span>RTX3050: {rows.filter(r=>r.issues.some(i=>i.startsWith('RTX3050'))).length}</span>
    <span>MacBook: {rows.filter(r=>r.issues.some(i=>i.startsWith('MAC_'))).length}</span>
    <button style={btn} disabled={busy} onClick={()=>void refresh()}>รีเฟรช</button>
    <select style={inp} value={filter} onChange={e=>{setFilter(e.target.value);setLimit(30)}}>
     <option value="ALL">ทุกกลุ่ม</option><option value="RTX3050">RTX 3050</option><option value="MACBOOK">MacBook</option>
    </select>
   </div>
   <div style={{overflowX:'auto',marginTop:10}}><table style={{width:'100%',minWidth:680,fontSize:12,borderCollapse:'collapse'}}>
    <thead><tr><th>รหัส</th><th>สเปกต้นฉบับ</th><th>ต้องยืนยัน</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead>
    <tbody>{filtered.slice(0,limit).map(r=><tr key={r.source_key} style={{borderTop:'1px solid #8290a144'}}>
     <td>{r.inventory_code}</td><td>{r.product_name}</td><td>{r.issues.map(i=>labels[i]).join(', ')}</td>
     <td>{r.source_status==='IN_STOCK'?'อยู่ในสต๊อก':'ประวัติย้อนหลัง'}</td>
     <td><button style={btn} disabled={busy} onClick={()=>choose(r)}>ตรวจสเปก</button></td>
    </tr>)}</tbody>
   </table></div>
   {filtered.length>limit&&<button style={btn} onClick={()=>setLimit(n=>n+30)}>ดูเพิ่มอีก ({filtered.length-limit})</button>}
   {selected&&<div style={{border:'1px solid #8290a155',borderRadius:10,padding:12,marginTop:12}}>
    <strong>ยืนยันจากเครื่องจริง: {selected.inventory_code}</strong>
    <p style={{fontSize:12}}>ชื่อเดิม: {selected.product_name}</p>
    <label style={{display:'grid',gap:4,fontSize:12}}>ชื่อรุ่นและสเปกที่ตรวจครบ (VRAM สำหรับ RTX3050 หรือ Air/Pro + ชิป/ปี + RAM/SSD + จอ สำหรับ MacBook)
     <input style={inp} value={name} maxLength={300} onChange={e=>{setName(e.target.value);setVerified(false)}}/>
    </label>
    <label style={{display:'grid',gap:4,marginTop:8,fontSize:12}}>หลักฐานประกอบ เช่น GPU-Z, System Information, About This Mac (ไม่ใส่ข้อมูลลูกค้า)
     <input style={inp} value={note} maxLength={800} onChange={e=>{setNote(e.target.value);setVerified(false)}}/>
    </label>
    <p style={{fontSize:12}}>{parseCheck(name)?'สเปกสำคัญครบตามกฎตรวจ':'ยังขาด: '+parseNotebookVerification(name).issues.map(i=>labels[i]).join(', ')}</p>
    <label style={{display:'flex',gap:8,fontSize:13,margin:'12px 0'}}>
     <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> ตรวจจากหลักฐานจริงแล้ว ไม่ได้เดา
    </label>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button style={btn} disabled={busy||!verified||!parseCheck(name)||note.trim().length<5} onClick={()=>void save()}>บันทึกผลตรวจพร้อม Audit</button>
     <button style={btn} onClick={()=>setSelected(null)}>ปิด</button>
    </div>
   </div>}
   {notice&&<p role="status" style={{color:'#0a8e75'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#bd5b45'}}>{error}</p>}
  </>}
 </section>;
}
