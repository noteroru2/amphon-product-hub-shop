import {applyCostSpecReviews} from '../lib/aiBuyerCostReviewRules';
import {AiBuyerNotebookSpecVerification} from './AiBuyerNotebookSpecVerification';
import {listNotebookGapBatches,type NotebookGapBatch} from '../lib/aiBuyerNotebookGapRules';
import {listNotebookRuleBatches,type NotebookSpecOfferBatch} from '../lib/aiBuyerNotebookRuleBatches';
import {listOfficeNotebookRules,type OfficeNotebookRuleBatch} from '../lib/aiBuyerOfficeNotebookRules';
import {listBusinessNotebookRules,type BusinessNotebookRuleBatch} from '../lib/aiBuyerBusinessNotebookRules';
import {matchNotebookCoveragePrice} from '../lib/aiBuyerNotebookCoveragePrices';
import {useEffect,useMemo,useState} from 'react';
import {loadCostLearningRecords,loadCostSpecReviews} from '../lib/aiBuyerCostLearningData';
import {analyzeNotebookCoverage,type NotebookCoverage,type NotebookBucket} from '../lib/aiBuyerNotebookCoverage';
const fmt=(v:number|null)=>v===null?'ไม่มีข้อมูล':new Intl.NumberFormat('th-TH').format(v)+' ฿';
const labels:Record<NotebookBucket['kind'],string>={GAMING:'Gaming',GENERAL:'ทำงานทั่วไป',BUSINESS:'Business',MACBOOK:'MacBook',REVIEW:'ตรวจสเปก'};
const btn:React.CSSProperties={padding:'8px 11px',border:'1px solid #8290a188',borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'};
export function AiBuyerNotebookCoverage(){
 const [open,setOpen]=useState(false),[report,setReport]=useState<NotebookCoverage|null>(null);
 const [rules,setRules]=useState<{gaming:NotebookSpecOfferBatch[];office:OfficeNotebookRuleBatch[];business:BusinessNotebookRuleBatch[];gaps:NotebookGapBatch[]}>({gaming:[],office:[],business:[],gaps:[]});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loadedAt,setLoadedAt]=useState<Date|null>(null);
 const [kind,setKind]=useState('ALL'),[search,setSearch]=useState(''),[limit,setLimit]=useState(40);
 const [coverageView,setCoverageView]=useState<'OBSERVED'|'UNPRICED'|'REVIEW'|'ALL'>('OBSERVED');
 const load=async()=>{setBusy(true);setError('');
  try{const [records,reviews,gaming,office,business,gaps]=await Promise.all([loadCostLearningRecords(),loadCostSpecReviews(),listNotebookRuleBatches(),listOfficeNotebookRules(),listBusinessNotebookRules(),listNotebookGapBatches()]);setReport(analyzeNotebookCoverage(applyCostSpecReviews(records,reviews)));setRules({gaming,office,business,gaps});setLoadedAt(new Date())}
  catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}};
 useEffect(()=>{if(open)void load()},[open]);
 const rows=useMemo(()=>report?.buckets.filter(r=>
  (kind==='ALL'||r.kind===kind)&&
  (coverageView==='ALL'||r.count>0)&&
  (coverageView!=='UNPRICED'||matchNotebookCoveragePrice(r,rules)===null)&&
  (coverageView!=='REVIEW'||(r.kind==='REVIEW'||r.kind==='MACBOOK'||r.gpu==='RTX3050_UNSPEC'))&&
  [r.cpu,r.gpu,r.family,...r.examples].join(' ').toLowerCase().includes(search.toLowerCase().trim())
 )??[],[report,kind,search,coverageView,rules]);
 const money=(v:number|null)=>v===null?'รายรุ่น':new Intl.NumberFormat('th-TH').format(v);
 const match=(r:NotebookBucket)=>matchNotebookCoveragePrice(r,rules);
 const counts=useMemo(()=>{
  const observed=report?.buckets.filter(r=>r.count>0)??[];
  const priced=observed.filter(r=>matchNotebookCoveragePrice(r,rules)!==null).length;
  const missing=observed.filter(r=>matchNotebookCoveragePrice(r,rules)===null);
  const ambiguous=missing.filter(r=>r.kind==='REVIEW'||r.gpu==='RTX3050_UNSPEC'||r.kind==='MACBOOK').length;
  const latest=(items:{created_at:string;rules:unknown[]}[])=>[...items].sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]?.rules.length??0;
  return {priced,unpriced:missing.length,ambiguous,gaming:latest(rules.gaming),office:latest(rules.office),business:latest(rules.business),gaps:latest(rules.gaps)};
 },[report,rules]);
 const missingReason=(r:NotebookBucket)=>{
  if(r.kind==='REVIEW')return 'ข้อมูล CPU/GPU หรือประเภทเครื่องไม่ครบ ต้องตรวจสเปก';
  if(r.kind==='MACBOOK')return 'MacBook ต้องตรวจ Air/Pro, ชิป, ปี, หน้าจอ, RAM/SSD และ PriceBook รายรุ่น';
  if(r.gpu==='RTX3050_UNSPEC')return 'RTX 3050 ยังไม่ทราบ VRAM 4GB/6GB — ไม่สามารถใช้ราคาอัตโนมัติ';
  if(r.count===0)return 'ไม่มีประวัติซื้อจริงและยังไม่มีกฎตรงรุ่น';
  return 'ไม่พบกฎที่ตรง CPU/GPU หรือเป็นรุ่นที่ต้องตรวจรายเครื่อง';
 };
 const copy=()=>{const message=rows.map(r=>{const price=match(r);return labels[r.kind]+' / '+r.cpu+' / '+r.gpu+' | ทุนกลาง '+fmt(r.medianBuy)+' | '+(price?('ราคาเปิดรับร่าง '+money(price.low)+'–'+money(price.high)+' บาท ['+price.status+'] ตรวจสเปกก่อนใช้'):missingReason(r));}).join('\n');
  void navigator.clipboard.writeText(message).catch(()=>setError('คัดลอกไม่สำเร็จ'));};
 return <section style={{margin:'12px 0',border:'1px solid #8290a166',borderRadius:12,padding:12}}>
  <button style={{...btn,width:'100%',textAlign:'left',fontWeight:700}} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Notebook Coverage — ครอบคลุมทุก CPU/GPU ที่พบ {open?'▴':'▾'}</button>
  <div style={{fontSize:11,opacity:.8,margin:'8px 0'}}>
   Coverage UI: Spec Verification + Historical Gaps · 2026-11-06
   {loadedAt?' · โหลดข้อมูลล่าสุด '+loadedAt.toLocaleString('th-TH'):' · ยังไม่ได้โหลดข้อมูล'}
  </div>
  <AiBuyerNotebookSpecVerification />
  <p style={{fontSize:12,opacity:.75}}>ข้อมูลอ้างอิงหลังนำ Owner Spec Review Overlay มาประกอบ พร้อมราคาเปิดรับจากกฎร่างและข้อเสนอเติมช่องว่างจากสต๊อกจริงที่จับคู่ CPU/GPU ได้ · สถานะ PENDING/APPROVED_DRAFT ไม่ใช่ราคา LINE AUTO · สเปกไม่ครบต้องตรวจเพิ่ม</p>
  {open&&<>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'10px 0'}}>
    <strong>พบโน๊ตบุ๊ค {report?.inventory??'…'} เครื่อง</strong>
    <span>ต้องตรวจสเปก {report?.unknown??'…'} เครื่อง</span>
    <span>{report?.buckets.filter(r=>r.count>0).length??'…'} กลุ่มมีประวัติ / {report?.buckets.length??'…'} กลุ่มในแคตตาล็อก</span>
    <button style={btn} disabled={busy} onClick={()=>void load()}>{busy?'กำลังโหลด':'รีเฟรช'}</button>
    <span style={{fontSize:12}}>กฎร่าง Gaming {counts.gaming} / Office {counts.office} / Business {counts.business} / Gap {counts.gaps} · มีประวัติ {counts.priced+counts.unpriced} กลุ่ม · พบกฎเสนอราคา {counts.priced} · ยังไม่มีราคา {counts.unpriced} (ต้องตรวจสเปก/ MacBook {counts.ambiguous}, กลุ่มอื่น {counts.unpriced-counts.ambiguous})</span>
   </div>
   <div style={{display:'flex',gap:7,flexWrap:'wrap',margin:'8px 0'}}>
    <select style={btn} value={kind} onChange={e=>{setKind(e.target.value);setLimit(40)}}>
     <option value="ALL">ทุกหมวด</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
    </select>
    <select aria-label="กรองการครอบคลุมราคา" style={btn} value={coverageView} onChange={e=>{setCoverageView(e.target.value as typeof coverageView);setLimit(40)}}>
     <option value="OBSERVED">เฉพาะรุ่นที่มีประวัติ</option>
     <option value="UNPRICED">ยังไม่มีราคา (มีประวัติ)</option>
     <option value="REVIEW">ต้องตรวจสเปก / MacBook</option>
     <option value="ALL">ทุกกลุ่มรวมไม่มีประวัติ</option>
    </select>
    <input style={{...btn,flex:1,minWidth:150}} placeholder="ค้นหา CPU/GPU/รุ่น" value={search} onChange={e=>{setSearch(e.target.value);setLimit(40)}}/>
    <button style={btn} disabled={!rows.length} onClick={copy}>คัดลอกสเปกไปตั้งราคากับ ChatGPT</button>
   </div>
   <div style={{overflowX:'auto'}}><table style={{minWidth:940,width:'100%',fontSize:12,borderCollapse:'collapse'}}>
    <thead><tr><th>ประเภท</th><th>CPU</th><th>GPU</th><th>เครื่อง</th><th>ขายแล้ว</th><th>ทุนกลางย้อนหลัง*</th><th>กฎราคารับซื้อ</th></tr></thead>
    <tbody>{rows.slice(0,limit).map(r=><tr key={r.key} style={{borderTop:'1px solid #8290a144'}}>
     <td>{labels[r.kind]}</td><td><strong>{r.cpu}</strong>
      {r.count>0&&<details><summary style={{cursor:'pointer',opacity:.8}}>ดูตัวอย่างรุ่น</summary>
       {r.examples.map((name,i)=><div key={i} style={{fontSize:11,marginTop:4}}>{name}</div>)}
      </details>}
     </td><td>{r.gpu}</td><td>{r.count}</td><td>{r.sold}</td><td>{fmt(r.medianBuy)}</td>
     <td>{(()=>{const p=match(r);if(p)return <div>
      <strong>{p.low===null?'ตีราคารายรุ่น':money(p.low)+'–'+money(p.high)+' บาท'}</strong>
      <div style={{fontSize:11,color:p.status==='PENDING'?'#bf8732':'#39856b'}}>{p.status==='PENDING'?'รอ Owner อนุมัติ':'อนุมัติเป็นกฎร่าง'} · {p.source}</div>
      <div style={{fontSize:11,opacity:.7}}>{p.warning}</div>
     </div>;
     return <span style={{fontSize:12,opacity:.77}}>{missingReason(r)} </span>})()}</td>
    </tr>)}</tbody>
   </table></div>
   {rows.length>limit&&<button style={{...btn,marginTop:8}} onClick={()=>setLimit(n=>n+40)}>แสดงเพิ่ม ({rows.length-limit})</button>}
   <p style={{fontSize:11,opacity:.75}}>*ทุนกลางจากประวัติซื้อจริงที่ไม่ใช่ FORFEIT และไม่มีคำบ่งชี้เครื่องเสีย เป็นเพียงหลักฐานต้นทุน ไม่ใช่ราคาตลาดหรือราคาที่ AI อนุมัติแล้ว</p>
   {error&&<p role="alert" style={{color:'#bd5b45'}}>{error}</p>}
  </>}
 </section>;
}