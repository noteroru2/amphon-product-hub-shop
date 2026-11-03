import {useCallback,useEffect,useMemo,useState} from 'react';
import {loadCostLearningReport} from '../lib/aiBuyerCostLearningData';
import {listPb28Drafts,listPb28Entries,savePb28Entry,type Pb28Draft,type Pb28Row} from '../lib/priceBookV28Admin';
import type {CostLearningCohort,LearningReport} from '../lib/aiBuyerCostLearning';

const fmt=(n:number|null)=>n==null?'—':new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(n);
const btn:React.CSSProperties={padding:'9px 12px',border:'1px solid #7a87968a',borderRadius:8,cursor:'pointer',background:'transparent',color:'inherit'};
const fld:React.CSSProperties={boxSizing:'border-box',padding:'9px',border:'1px solid #7a87968a',borderRadius:8,width:'100%',minWidth:0,background:'transparent',color:'inherit'};
type PriceFields={estimatedResale:string;openingOffer:string;targetBuy:string;hardMax:string;model:string;brand:string;category:string;modelCode:string};
function initial(c:CostLearningCohort):PriceFields {
 return {
  estimatedResale:c.qualified&&c.estimatedResale!==null?String(c.estimatedResale):'',
  openingOffer:c.qualified&&c.openingOffer!==null?String(c.openingOffer):'',
  targetBuy:c.qualified&&c.targetBuy!==null?String(c.targetBuy):'',
  hardMax:c.qualified&&c.hardMax!==null?String(c.hardMax):'',
  model:c.model,brand:c.brand,category:c.pricebookCategory,modelCode:'',
 };
}
export function AiBuyerCostLearning(){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[report,setReport]=useState<LearningReport|null>(null);
 const [drafts,setDrafts]=useState<Pb28Draft[]>([]),[draftId,setDraftId]=useState('');
 const [search,setSearch]=useState(''),[onlySold,setOnlySold]=useState(true),[limit,setLimit]=useState(25);
 const [selected,setSelected]=useState<CostLearningCohort|null>(null),[fields,setFields]=useState<PriceFields|null>(null);
 const [verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');
  try{const [r,d]=await Promise.all([loadCostLearningReport(),listPb28Drafts()]);setReport(r);setDrafts(d);setDraftId(id=>d.some(x=>x.id===id&&x.status==='DRAFT')?id:(d.find(x=>x.status==='DRAFT')?.id??''))}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}
 },[]);
 useEffect(()=>{if(open)void load()},[open,load]);
 const shown=useMemo(()=>report?.cohorts.filter(c=>(!onlySold||c.soldItems>0)&&(!search.trim()||[c.model,c.rawCategory,c.brand,c.inventoryCodes.join(' ')].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).slice(0,limit)??[],[report,onlySold,search,limit]);
 const edit=(cohort:CostLearningCohort)=>{setSelected(cohort);setFields(initial(cohort));setVerified(false);setNotice('');setError('')};
 const onSave=async()=>{
  if(!selected||!fields||!verified||!draftId){setError('กรุณาเลือก Draft และยืนยันว่าตรวจรุ่น สเปก สภาพ และราคาตลาดแล้ว');return}
  const e=Number(fields.estimatedResale),o=Number(fields.openingOffer),t=Number(fields.targetBuy),h=Number(fields.hardMax);
  if(!fields.model.trim()||!fields.category.trim()||![fields.estimatedResale,fields.openingOffer,fields.targetBuy,fields.hardMax].every(x=>x.trim()!=='')||![e,o,t,h].every(Number.isFinite)||!(e>0&&o>=0&&o<=t&&t<=h&&h<=e)){
   setError('ตรวจตัวเลขอีกครั้ง ต้องเป็น ราคาเปิดรับ ≤ เป้าหมาย ≤ เพดาน ≤ ราคาขายต่อ และราคาขายต่อมากกว่า 0');return;
  }
  if(fields.category==='OTHER'&&!window.confirm('หมวด OTHER อาจไม่ตรงกับรุ่นจริง ตรวจสอบหมวดแล้วใช่ไหม?'))return;
  const draft=drafts.find(d=>d.id===draftId);
  if(draft?.status!=='DRAFT'){setError('ต้องเลือก Draft ที่เปิดให้แก้ไขเท่านั้น');return}
  if(!window.confirm('บันทึกข้อเสนอที่คุณตรวจแล้วลง '+draft.title+' เท่านั้น? จะไม่ Activate ราคาและไม่ส่ง LINE'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const existing=await listPb28Entries(draftId);
   const match=existing.find(x=>[x.category,x.brand,x.model,x.model_code,x.condition_key].map(s=>s.trim().toLowerCase()).join('|')===
     [fields.category,fields.brand,fields.model,fields.modelCode,'NORMAL'].map(s=>s.trim().toLowerCase()).join('|'));
   if(match)throw new Error('พบรายการรุ่นนี้ใน Draft อยู่แล้ว กรุณาตรวจและแก้ไขจากหน้า PriceBook Admin เพื่อไม่ให้ทับราคาเดิม');
   const refs=selected.inventoryCodes.slice(0,8).join(',');
   const note='Owner reviewed Cost Learning V1 | sample units '+selected.purchaseSamples+
     ' | sold units '+selected.soldItems+' | sale events '+selected.saleEvents+
     ' | purchase codes '+refs+' | raw '+selected.model.slice(0,140);
   const row:Pb28Row={
    category:fields.category.trim(),brand:fields.brand.trim(),model:fields.model.trim(),model_code:fields.modelCode.trim(),condition_key:'NORMAL',
    estimated_resale:e,opening_offer:o,target_buy:t,hard_max:h,active:false,
    note:note.slice(0,800),aliases:[],spec_match:{},adjustments:{}
   };
   await savePb28Entry(draftId,null,row);
   setNotice('บันทึกลง Draft แล้ว (สถานะรายการปิดไว้จนกว่าคุณเปิดตรวจใน PriceBook Admin)');setSelected(null);setFields(null);setVerified(false);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 return <section style={{border:'1px solid #7a879680',borderRadius:14,padding:14,margin:'16px 0'}}>
  <button style={{...btn,width:'100%',textAlign:'left',fontWeight:700}} aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
   AI Buyer Cost Learning V1 — วิเคราะห์ทุนจริงและเตรียมข้อเสนอ {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.78}}>อ่านประวัติจริงเท่านั้น · ห้ามใช้ราคาเก่าเสนอให้ลูกค้าโดยอัตโนมัติ · บันทึกได้เฉพาะ PriceBook V2.8 Draft ที่เจ้าของเลือก</p>
  {open&&<>
   <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}>
    <button style={btn} disabled={loading||busy} onClick={()=>void load()}>{loading?'กำลังตรวจ…':'คำนวณจากประวัติล่าสุด'}</button>
    <label>Draft ที่ต้องการบันทึก
     <select style={{...fld,maxWidth:370}} value={draftId} onChange={e=>setDraftId(e.target.value)}>
      <option value="">-- สร้าง Draft ก่อนใน PriceBook Admin --</option>
      {drafts.filter(d=>d.status==='DRAFT').map(d=><option key={d.id} value={d.id}>{d.title}</option>)}
     </select>
    </label>
   </div>
   {report&&<>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:9,margin:'12px 0'}}>
     {([['สต๊อก',report.summary.inventory],['บันทึกขาย',report.summary.sales],['ซื้อขายจับคู่',report.summary.saleMatched],['หลุดขายฝาก',report.summary.forfeit],['ไม่ระบุหมวด',report.summary.uncategorized],['กลุ่มรุ่น',report.summary.cohorts],['แยกสเปกครบ',report.summary.structuredComplete],['ต้องตรวจสเปก',report.summary.structuredPartial+report.summary.structuredUnknown],['ผ่านเกณฑ์',report.summary.qualified]] as [string,number][]).map(([name,count])=>
      <div key={name} style={{border:'1px solid #7a87964a',borderRadius:9,padding:10}}><div style={{fontSize:12,opacity:.7}}>{name}</div><strong style={{fontSize:21}}>{fmt(count)}</strong></div>
     )}
    </div>
    <p style={{fontSize:12,opacity:.8}}>ความมั่นใจสูงกำหนดให้มีสินค้าคนละรหัสอย่างน้อย 3 เครื่องที่ซื้อและขายจริง รุ่นและหมวดตรงกัน มีการขายใน 180 วัน และผลต่างทุน–ขายเป็นบวก · ไม่รวมหลุดขายฝาก/Field Draft และไม่นับหลายการขายของรหัสเดียวเป็นหลายเครื่อง</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'12px 0'}}>
     <input style={{...fld,maxWidth:330}} placeholder="ค้นหารุ่น / หมวด / รหัสสต๊อก" value={search} onChange={e=>{setSearch(e.target.value);setLimit(25)}}/>
     <label style={{display:'flex',gap:5,alignItems:'center'}}><input type="checkbox" checked={onlySold} onChange={e=>setOnlySold(e.target.checked)}/> เฉพาะกลุ่มที่มีหลักฐานขาย</label>
    </div>
    <div style={{overflowX:'auto'}}>
     <table style={{width:'100%',minWidth:780,fontSize:12,borderCollapse:'collapse'}}>
      <thead><tr><th>รุ่น</th><th>รับซื้อ (รหัส)</th><th>ขายจริง (รหัส/เหตุการณ์)</th><th>ทุนมัธยฐาน</th><th>ขายมัธยฐาน</th><th>ส่วนต่างขั้นต้น</th><th>การใช้ข้อมูล</th></tr></thead>
      <tbody>{shown.map(c=><tr key={c.id} style={{borderTop:'1px solid #7a879644'}}>
       <td style={{maxWidth:260,overflowWrap:'anywhere'}}>{c.model}
        <div style={{opacity:.7}}>{c.rawCategory} · {c.structured.confidence==='COMPLETE'?'จับคู่สเปกครบ':c.structured.confidence==='PARTIAL'?'สเปกบางส่วน':'ยังระบุสเปกไม่ได้'}</div>
        <div style={{fontSize:11,opacity:.76}}>CPU {c.structured.cpu??'?'} · GPU {c.structured.gpu??'?'} · RAM {c.structured.ramGb??'?'}GB · SSD {c.structured.storageGb??'?'}GB</div>
       </td>
       <td style={{textAlign:'center'}}>{c.purchaseSamples}</td><td style={{textAlign:'center'}}>{c.soldItems} / {c.saleEvents}</td>
       <td style={{textAlign:'right'}}>{fmt(c.buyMedian)}</td><td style={{textAlign:'right'}}>{fmt(c.saleMedian)}</td><td style={{textAlign:'right'}}>{fmt(c.realizedGrossSpreadMedian)}</td>
       <td><div style={{fontWeight:600}}>{c.qualified?'มีข้อเสนอเบื้องต้น':'ต้องตรวจราคาด้วยตนเอง'}</div><button style={btn} onClick={()=>edit(c)}>ดูหลักฐาน / ทำ Draft</button></td>
      </tr>)}</tbody>
     </table>
     {shown.length===0&&<p>ยังไม่พบกลุ่มรุ่นตามเงื่อนไข</p>}
    </div>
    {report.cohorts.length>limit&&<button style={{...btn,marginTop:10}} onClick={()=>setLimit(l=>l+25)}>แสดงเพิ่มเติม</button>}
   </>}
   {selected&&fields&&<div style={{border:'1px solid #b78c5690',borderRadius:10,padding:13,marginTop:14}}>
    <strong>หลักฐานก่อนสร้าง Draft: {selected.model}</strong>
    <p style={{fontSize:12}}>รับซื้อ {selected.purchaseSamples} รหัส · ขายจริง {selected.soldItems} รหัส · {selected.saleEvents} เหตุการณ์ · ทุนมัธยฐาน {fmt(selected.buyMedian)} บาท · ขายมัธยฐาน {fmt(selected.saleMedian)} บาท</p>
    <p style={{fontSize:12}}>{selected.reason} {selected.daysToSellMedian!==null?' · วันถือครองมัธยฐาน '+selected.daysToSellMedian:''}</p>
    <p style={{fontSize:12}}>สเปกที่แยกได้: {selected.structured.brand||'ไม่พบยี่ห้อ'} · {selected.structured.family??'ไม่ทราบตระกูล'} · รหัสรุ่น {selected.structured.modelCode??'ไม่พบ'} · CPU {selected.structured.cpu??'?'} · GPU {selected.structured.gpu??'?'} · RAM {selected.structured.ramGb??'?'}GB · SSD {selected.structured.storageGb??'?'}GB</p>
    <p style={{fontSize:12}}>การจับคู่: {selected.matchMethod==='STRUCTURED_EXACT'?'รหัสรุ่นและสเปกตรงกันครบ':'ตรงชื่อสินค้าดั้งเดิมเท่านั้น'} · ความครบถ้วน {selected.structured.confidence}</p>
    {!!selected.structured.warnings.length&&<p style={{fontSize:12,color:'#b9842e'}}>จุดที่ต้องตรวจ: {selected.structured.warnings.join(', ')}</p>}
    <p style={{fontSize:11,overflowWrap:'anywhere'}}>หลักฐานรหัสสต๊อก: {selected.inventoryCodes.slice(0,15).join(', ')}</p>
    {!selected.qualified&&<p role="status" style={{fontSize:12,color:'#b9842e'}}>ยังไม่พอสำหรับสร้างราคาจากสูตรอัตโนมัติ — ต้องกรอกตัวเลขเองหลังตรวจราคาตลาด สเปก และตำหนิ</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10}}>
     {([
      ['category','หมวด PriceBook'],['brand','ยี่ห้อ'],['model','ชื่อรุ่น / สเปกเต็ม'],['modelCode','รหัสรุ่น (ถ้ามี)'],
      ['estimatedResale','ราคาขายต่อที่ตรวจแล้ว'],['openingOffer','ราคาเปิดรับ'],['targetBuy','ราคารับเป้าหมาย'],['hardMax','เพดานรับซื้อ'],
     ] as [keyof PriceFields,string][]).map(([key,label])=><label key={key} style={{fontSize:12,display:'grid',gap:4}}>
      {label}<input style={fld} value={fields[key]} type={['estimatedResale','openingOffer','targetBuy','hardMax'].includes(key)?'number':'text'} min={['estimatedResale','openingOffer','targetBuy','hardMax'].includes(key)?0:undefined} onChange={e=>setFields(s=>s?{...s,[key]:e.target.value}:s)}/>
     </label>)}
    </div>
    <label style={{display:'flex',gap:8,margin:'12px 0',alignItems:'flex-start',fontSize:13}}>
     <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>
     ฉันตรวจสเปก สภาพ ราคาขายตลาดปัจจุบัน ค่าซ่อม และความเหมาะสมของราคาด้วยตนเองแล้ว
    </label>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button style={btn} disabled={busy||!verified||!draftId} onClick={()=>void onSave()}>บันทึกเป็นรายการปิดใน Draft (ไม่ Activate)</button>
     <button style={btn} onClick={()=>{setSelected(null);setFields(null)}}>ยกเลิก</button>
    </div>
   </div>}
   {notice&&<p role="status" style={{color:'#0b8f73'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#da5945'}}>{error}</p>}
  </>}
 </section>;
}
