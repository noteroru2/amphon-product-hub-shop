import {useCallback,useEffect,useMemo,useState} from 'react';
import {loadCostLearningRecords,loadCostSpecReviews} from '../lib/aiBuyerCostLearningData';
import {generateCostSpecReviewQueue,REVIEW_CATEGORIES,type CostReviewQueueEntry,type ReviewCategory} from '../lib/aiBuyerCostReviewRules';
import {saveCostSpecReview,revokeCostSpecReview,loadCostReviewAudit} from '../lib/aiBuyerCostReviewAdmin';

const btn:React.CSSProperties={border:'1px solid #7a879677',borderRadius:8,background:'transparent',color:'inherit',padding:'8px 12px',cursor:'pointer'};
const input:React.CSSProperties={width:'100%',minWidth:0,boxSizing:'border-box',padding:9,border:'1px solid #7a879677',borderRadius:8,background:'transparent',color:'inherit'};
const labels:Record<ReviewCategory,string>={
 NOTEBOOK:'โน๊ตบุ๊ค',MACBOOK:'MacBook',DESKTOP_PC:'คอมตั้งโต๊ะ',SMARTPHONE:'สมาร์ตโฟน',
 TABLET:'แท็บเล็ต',CAMERA:'กล้อง',OTHER:'สินค้าไอทีอื่นๆ'
};
type AuditRow={actor_id:string;action:string;before_data:unknown;after_data:unknown;changed_at:string};

export function AiBuyerCostReviewQueue(){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<CostReviewQueueEntry[]>([]);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [filter,setFilter]=useState<'PENDING'|'ALL'|'REVIEWED'>('PENDING'),[search,setSearch]=useState(''),[limit,setLimit]=useState(30);
 const [selected,setSelected]=useState<CostReviewQueueEntry|null>(null);
 const [category,setCategory]=useState<ReviewCategory>('OTHER'),[reviewedName,setReviewedName]=useState('');
 const [note,setNote]=useState(''),[verified,setVerified]=useState(false),[history,setHistory]=useState<AuditRow[]>([]);
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{const [records,reviews]=await Promise.all([loadCostLearningRecords(),loadCostSpecReviews()]);
   setRows(generateCostSpecReviewQueue(records,reviews));
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{if(open)void load()},[open,load]);
 const list=useMemo(()=>rows.filter(r=>{
  const done=!!r.review&&!r.stale;
  if(filter==='PENDING'&&done)return false;
  if(filter==='REVIEWED'&&!done)return false;
  const needle=search.trim().toLowerCase();
  return !needle||[r.source_key,r.product_name,r.category,r.condition].join(' ').toLowerCase().includes(needle);
 }),[rows,filter,search]);
 const shown=list.slice(0,limit);
 const pending=rows.filter(r=>!r.review||r.stale).length;
 const high=rows.filter(r=>(!r.review||r.stale)&&r.priority==='HIGH').length;
 const choose=async(item:CostReviewQueueEntry)=>{
  setSelected(item);setCategory(item.review&&!item.stale?item.review.reviewed_category:item.proposedCategory??'OTHER');
  setReviewedName(item.review&&!item.stale?item.review.reviewed_name:item.product_name);
  setNote(item.review&&!item.stale?item.review.review_note:'');
  setVerified(false);setNotice('');setError('');setHistory([]);
  try{setHistory(await loadCostReviewAudit(item.source_key))}catch(e){setError(e instanceof Error?e.message:String(e))}
 };
 const save=async()=>{
  if(!selected||!verified||reviewedName.trim().length<3){setError('ต้องตรวจสเปกจากข้อมูลจริงและยืนยันก่อนบันทึก');return}
  if(!window.confirm('ยืนยันตรวจหมวดและชื่อรุ่นจากหลักฐานจริงแล้วหรือไม่? ระบบจะเก็บคำยืนยันแยกจากประวัติทุนและไม่แก้ราคา V2.7'))return;
  setBusy(true);setError('');setNotice('');
  try{
   await saveCostSpecReview({sourceKey:selected.source_key,sourceName:selected.product_name,
    sourceCategory:selected.category,reviewedName,reviewedCategory:category,note});
   await load();
   setSelected(null);setVerified(false);setHistory([]);setNotice('บันทึกการตรวจสเปกพร้อม Audit Log แล้ว');
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 const revoke=async()=>{
  if(!selected?.review)return;
  if(!window.confirm('ยกเลิกการยืนยันสเปกรายการ '+selected.source_key+'? ประวัติการตรวจจะยังคงอยู่ใน Audit Log'))return;
  setBusy(true);setError('');setNotice('');
  try{await revokeCostSpecReview(selected.source_key);await load();setSelected(null);setHistory([]);setVerified(false);
   setNotice('ยกเลิกผลตรวจแล้ว ระบบจะกลับไปใช้ข้อมูลต้นฉบับ');
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 return <section style={{margin:'16px 0',border:'1px solid #7a879677',borderRadius:14,padding:14}}>
  <button style={{...btn,width:'100%',fontWeight:700,textAlign:'left'}} onClick={()=>setOpen(o=>!o)} aria-expanded={open}>
   คิวตรวจข้อมูลต้นทุนและสเปก — Owner Review {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.78}}>แก้เฉพาะชื่อรุ่นและหมวดที่ใช้เรียนรู้ · ไม่แก้ต้นทุนหรือประวัติซื้อขายต้นฉบับ · ตรวจหลักฐานจริงก่อนกดยืนยัน</p>
  {open&&<>
   <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',margin:'10px 0'}}>
    <strong>รอตรวจ {pending} / {rows.length}</strong>
    <span style={{fontSize:13}}>สำคัญสูง {high}</span>
    <button disabled={busy||loading} style={btn} onClick={()=>void load()}>{loading?'กำลังโหลด…':'โหลดข้อมูลล่าสุด'}</button>
   </div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
    <select style={{...input,maxWidth:190}} value={filter} onChange={e=>{setFilter(e.target.value as typeof filter);setLimit(30)}}>
     <option value="PENDING">รอตรวจ</option><option value="REVIEWED">ตรวจแล้ว</option><option value="ALL">ทั้งหมด</option>
    </select>
    <input style={{...input,maxWidth:300}} placeholder="ค้นหาชื่อรุ่น / รหัส / หมวด" value={search} onChange={e=>{setSearch(e.target.value);setLimit(30)}}/>
   </div>
   <div style={{overflowX:'auto',marginTop:12}}>
    <table style={{minWidth:660,width:'100%',borderCollapse:'collapse',fontSize:12}}>
     <thead><tr><th>ลำดับ</th><th>สินค้า</th><th>คุณภาพข้อมูล</th><th>ขายจริง</th><th>จัดการ</th></tr></thead>
     <tbody>{shown.map(x=><tr key={x.source_key} style={{borderTop:'1px solid #7a87963f'}}>
      <td>{x.priority==='HIGH'?'สูง':x.priority==='MEDIUM'?'กลาง':'ต่ำ'}</td>
      <td><strong>{x.product_name}</strong><div style={{fontSize:11,opacity:.7}}>{x.source_key} · {x.category||'ยังไม่ระบุหมวด'} {x.source_type==='FORFEIT'?'· หลุดขายฝาก':''}</div></td>
      <td>{x.review&&!x.stale?'ตรวจแล้ว':x.stale?'ผลตรวจเก่า':''}
       <div style={{fontSize:11}}>{x.flags.slice(0,3).join(', ')||'—'}</div>
       <div style={{fontSize:11,opacity:.7}}>{x.parsed.confidence}</div>
      </td>
      <td style={{textAlign:'center'}}>{x.soldEvents}</td>
      <td><button style={btn} disabled={busy} onClick={()=>void choose(x)}>{x.review?'ดู / แก้ไข':'ตรวจรายการ'}</button></td>
     </tr>)}</tbody>
    </table>
    {shown.length===0&&<p>ไม่พบรายการในตัวกรองนี้</p>}
   </div>
   {list.length>limit&&<button style={{...btn,marginTop:10}} onClick={()=>setLimit(l=>l+30)}>แสดงเพิ่มเติม ({list.length-limit})</button>}
   {selected&&<div style={{border:'1px solid #b3895a88',padding:14,borderRadius:10,marginTop:15}}>
    <strong>ตรวจ: {selected.source_key}</strong>
    <p style={{fontSize:12}}>ต้นฉบับ: {selected.product_name} · หมวดเดิม: {selected.category||'ไม่ระบุ'}</p>
    {!!selected.condition&&<p style={{fontSize:12}}>สภาพที่ระบุไว้: {selected.condition}</p>}
    <p style={{fontSize:12}}>ระบบอ่านได้: CPU {selected.parsed.cpu??'?'} / GPU {selected.parsed.gpu??'?'} / RAM {selected.parsed.ramGb??'?'} GB / SSD {selected.parsed.storageGb??'?'} GB / รหัสรุ่น {selected.parsed.modelCode??'?'}</p>
    {!!selected.flags.length&&<p style={{fontSize:12,color:'#b78936'}}>ข้อควรตรวจ: {selected.flags.join(', ')}</p>}
    {selected.stale&&<p role="alert" style={{color:'#bc6439',fontSize:12}}>ข้อมูลต้นฉบับเปลี่ยนจากครั้งที่ตรวจล่าสุด ต้องยืนยันใหม่</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
     <label style={{display:'grid',gap:4,fontSize:12}}>หมวดที่ตรวจแล้ว
      <select style={input} value={category} onChange={e=>{setCategory(e.target.value as ReviewCategory);setVerified(false)}}>
       {REVIEW_CATEGORIES.map(c=><option key={c} value={c}>{labels[c]}</option>)}
      </select>
     </label>
     <label style={{display:'grid',gap:4,fontSize:12}}>ชื่อรุ่นและสเปกที่ตรวจแล้ว
      <input style={input} value={reviewedName} maxLength={300} onChange={e=>{setReviewedName(e.target.value);setVerified(false)}}/>
     </label>
     <label style={{display:'grid',gap:4,fontSize:12}}>บันทึกหลักฐานที่ใช้ตรวจ (ไม่ใช่ข้อมูลส่วนตัวลูกค้า)
      <input style={input} value={note} maxLength={800} onChange={e=>setNote(e.target.value)}/>
     </label>
    </div>
    <label style={{display:'flex',gap:8,alignItems:'flex-start',margin:'12px 0',fontSize:13}}>
     <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>
     ผมตรวจหมวดและสเปกจากสินค้าหรือหลักฐานที่เชื่อถือได้แล้ว ไม่ใช่เพียงการคาดเดาของระบบ
    </label>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button style={btn} disabled={busy||!verified||reviewedName.trim().length<3} onClick={()=>void save()}>ยืนยันและบันทึกข้อมูลที่ตรวจแล้ว</button>
     {selected.review&&<button style={btn} disabled={busy} onClick={()=>void revoke()}>ยกเลิกผลตรวจ</button>}
     <button style={btn} disabled={busy} onClick={()=>{setSelected(null);setHistory([])}}>ปิด</button>
    </div>
    {!!history.length&&<details style={{marginTop:10}}>
     <summary>Audit Log ({history.length})</summary>
     {history.map((h,i)=><div key={i} style={{fontSize:12,borderTop:'1px solid #7a87963f',padding:6}}>
      {new Date(h.changed_at).toLocaleString('th-TH')} · {h.action} · {h.actor_id.slice(0,8)}
      <details><summary>ก่อน / หลัง</summary><pre style={{overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{JSON.stringify({before:h.before_data,after:h.after_data},null,2)}</pre></details>
     </div>)}
    </details>}
   </div>}
   {notice&&<p role="status" style={{color:'#0c9071'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#ce5b46'}}>{error}</p>}
  </>}
 </section>;
}
