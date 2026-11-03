import {useCallback,useEffect,useMemo,useState} from 'react';
import {
 listPb28Drafts,listPb28Entries,listPb28Audit,createPb28Draft,savePb28Entry,deletePb28Entry,
 bulkPb28Edit,importPb28Rows,managePb28Draft,type Pb28Draft,type Pb28Entry,type Pb28Row,type Pb28Audit,
} from '../lib/priceBookV28Admin';
import {validatePricebookV28Csv,PRICEBOOK_V28_HEADERS,type PricebookV28CsvResult} from '../lib/pricebookV28Csv';

const empty:Pb28Row={category:'NOTEBOOK',brand:'',model:'',model_code:'',condition_key:'NORMAL',
 estimated_resale:0,opening_offer:0,target_buy:0,hard_max:0,active:true,note:'',aliases:[],spec_match:{},adjustments:{}};
const fmt=(n:number)=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(n);
const date=(v:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));
const baseInput:React.CSSProperties={minWidth:0,width:'100%',boxSizing:'border-box',padding:'9px 10px',
 border:'1px solid #8894a677',borderRadius:8,background:'transparent',color:'inherit'};
const button:React.CSSProperties={padding:'9px 13px',borderRadius:8,border:'1px solid #8894a677',cursor:'pointer'};
const grid:React.CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10};
const alert:React.CSSProperties={padding:10,border:'1px solid #a8794288',borderRadius:9,marginTop:9};
const inputFields:[keyof Pb28Row,string][]=[
 ['category','หมวดสินค้า'],['brand','ยี่ห้อ'],['model','รุ่น'],['model_code','รหัสรุ่น'],['condition_key','สภาพ'],
 ['estimated_resale','ราคาขายต่อ'],['opening_offer','ราคาเปิดรับ'],['target_buy','ราคารับเป้าหมาย'],['hard_max','เพดานราคารับ'],
];
const numericFields=new Set<keyof Pb28Row>(['estimated_resale','opening_offer','target_buy','hard_max']);
const bulkFields:('estimated_resale'|'opening_offer'|'target_buy'|'hard_max')[]=['estimated_resale','opening_offer','target_buy','hard_max'];
const toNum=(value:string)=>value.trim()?Number(value):0;
const blankCsv=():{file:string;result:PricebookV28CsvResult|null}=>({file:'',result:null});

export function PriceBookV28Admin(){
 const [open,setOpen]=useState(false),[drafts,setDrafts]=useState<Pb28Draft[]>([]);
 const [selectedId,setSelectedId]=useState(''),[entries,setEntries]=useState<Pb28Entry[]>([]),[audit,setAudit]=useState<Pb28Audit[]>([]);
 const [title,setTitle]=useState('AMPHON PriceBook V2.8 Draft'),[clone,setClone]=useState(true);
 const [editingId,setEditingId]=useState<string|null>(null),[entry,setEntry]=useState<Pb28Row>({...empty});
 const [advanced,setAdvanced]=useState({aliases:'[]',spec_match:'{}',adjustments:'{}'});
 const [query,setQuery]=useState(''),[checked,setChecked]=useState<string[]>([]);
 const [bulkField,setBulkField]=useState<(typeof bulkFields)[number]>('target_buy'),[delta,setDelta]=useState('');
 const [csv,setCsv]=useState(blankCsv),[tab,setTab]=useState<'entries'|'audit'>('entries');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const selected=drafts.find(d=>d.id===selectedId);
 const reload=useCallback(async(id=selectedId)=>{
  const [ds,es,as]=await Promise.all([listPb28Drafts(),id?listPb28Entries(id):Promise.resolve([]),id?listPb28Audit(id):Promise.resolve([])]);
  setDrafts(ds);setEntries(es);setAudit(as);
 },[selectedId]);
 useEffect(()=>{if(!open)return;let live=true;listPb28Drafts().then(ds=>{if(live)setDrafts(ds)}).catch(e=>{if(live)setError(String(e.message||e))});return()=>{live=false}},[open]);
 useEffect(()=>{if(!open||!selectedId){setEntries([]);setAudit([]);return;}let live=true;
  Promise.all([listPb28Entries(selectedId),listPb28Audit(selectedId)]).then(([es,as])=>{if(live){setEntries(es);setAudit(as)}}).catch(e=>{if(live)setError(String(e.message||e))});
  return()=>{live=false};
 },[open,selectedId]);
 const filtered=useMemo(()=>entries.filter(r=>[r.category,r.brand,r.model,r.model_code,r.condition_key].join(' ').toLowerCase().includes(query.toLowerCase().trim())),[entries,query]);
 const projected=useMemo(()=>checked.map(id=>entries.find(e=>e.id===id)).filter((e):e is Pb28Entry=>Boolean(e)).map(e=>{
  const n=Number(delta);const next={...e,[bulkField]:e[bulkField]+(Number.isFinite(n)?n:0)};
  return {...next,ok:next.opening_offer>=0&&next.opening_offer<=next.target_buy&&next.target_buy<=next.hard_max&&next.hard_max<=next.estimated_resale&&next.estimated_resale>0};
 }),[entries,checked,bulkField,delta]);
 const handle=async(action:()=>Promise<unknown>,success:string,nextId?:string)=>{
  setBusy(true);setError('');setNotice('');
  try{await action();if(nextId!==undefined)setSelectedId(nextId);await reload(nextId);setNotice(success);}
  catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 const create=async()=>{let id='';await handle(async()=>{id=await createPb28Draft(title.trim(),clone)},'สร้าง Draft สำเร็จ');if(id){setSelectedId(id);setChecked([])}};
 const save=async()=>{if(!selectedId)return;
  let row:Pb28Row;
  try{
   const aliases=JSON.parse(advanced.aliases),spec_match=JSON.parse(advanced.spec_match),adjustments=JSON.parse(advanced.adjustments);
   if(!Array.isArray(aliases)||!aliases.every(x=>typeof x==='string')||!spec_match||Array.isArray(spec_match)||typeof spec_match!=='object'||!adjustments||Array.isArray(adjustments)||typeof adjustments!=='object')throw new Error('JSON รูปแบบไม่ถูกต้อง');
   row={...entry,aliases,spec_match,adjustments};
  }catch(e){setError('ตรวจ JSON ของชื่อรุ่นเพิ่มเติม / สเปก / กฎปรับราคา: '+(e instanceof Error?e.message:String(e)));return;}
  setBusy(true);setError('');setNotice('');
  try{await savePb28Entry(selectedId,editingId,row);await reload();setNotice('บันทึกรายการพร้อม Audit Log แล้ว');setEntry({...empty});setAdvanced({aliases:'[]',spec_match:'{}',adjustments:'{}'});setEditingId(null)}
  catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 const remove=async(r:Pb28Entry)=>{if(!window.confirm('ลบรายการ '+r.model+' จาก Draft นี้?'))return;
  await handle(()=>deletePb28Entry(selectedId,r.id),'ลบรายการจาก Draft แล้ว');
  setChecked(a=>a.filter(id=>id!==r.id));if(editingId===r.id){setEntry({...empty});setEditingId(null)}
 };
 const bulk=async()=>{const n=Number(delta);
  if(!checked.length||!delta.trim()||!Number.isFinite(n)||projected.some(r=>!r.ok)){setError('กรุณาเลือกสินค้าและตรวจผลลัพธ์ก่อนแก้ไขเป็นชุด');return}
  if(!window.confirm('แก้ '+bulkField+' จำนวน '+checked.length+' รายการ เป็น '+(n>=0?'+':'')+n+' บาท?'))return;
  await handle(()=>bulkPb28Edit(selectedId,checked,bulkField,n),'แก้ไขราคาเป็นชุดสำเร็จ พร้อมบันทึก Audit Log');setChecked([]);setDelta('');
 };
 const parseCsv=async(f:File|null)=>{if(!f){setCsv(blankCsv());return}
  if(f.size>1_000_000){setCsv({file:f.name,result:{rows:[],valid:false,errors:['FILE_TOO_LARGE']}});return}
  const text=await f.text();setCsv({file:f.name,result:validatePricebookV28Csv(text)});
 };
 const applyImport=async()=>{
  const result=csv.result;if(!result?.valid||!selectedId)return;
  if(result.rows.length>250){setError('Import จำกัดครั้งละ 250 รายการ โปรดแบ่งไฟล์ก่อน');return}
  if(!window.confirm('นำเข้า '+result.rows.length+' รายการใน Draft เท่านั้น? ไม่มีการเปิดใช้งาน LINE'))return;
  const rows:Pb28Row[]=result.rows.map(row=>({
   category:row.category,brand:row.brand,model:row.model,model_code:row.model_code,
   condition_key:row.condition_key,estimated_resale:Number(row.estimated_resale),
   opening_offer:Number(row.opening_offer),target_buy:Number(row.target_buy),hard_max:Number(row.hard_max),
   active:true,note:'CSV draft import',aliases:[],spec_match:{},adjustments:{},
  }));
  await handle(()=>importPb28Rows(selectedId,rows),'นำเข้า Draft สำเร็จ ไม่กระทบ V2.7');setCsv(blankCsv());
 };
 const exportCsv=()=>{
  const rows=[PRICEBOOK_V28_HEADERS.join(','),...entries.map(r=>PRICEBOOK_V28_HEADERS.map(key=>{
   const value=String(r[key]??'');const safe=/^[=+@\-]/.test(value)?"'"+value:value;
   return '"'+safe.replace(/"/g,'""')+'"';
  }).join(','))];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='pricebook-v28-draft.csv';a.click();URL.revokeObjectURL(url);
 };
 return <section style={{border:'1px solid #8894a677',borderRadius:14,padding:14,margin:'16px 0'}}>
  <button type="button" style={{...button,fontWeight:700,width:'100%',textAlign:'left'}} onClick={()=>setOpen(!open)} aria-expanded={open}>
   PriceBook V2.8 — จัดการร่างราคา {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.85,margin:'8px 0'}}>Owner/Admin เท่านั้น · ทำงานบน Draft แยกต่างหาก · ไม่มีการแก้ V2.7 หรือส่ง LINE AUTO</p>
  {open&&<>
   <div style={grid}>
    <label style={{display:'grid',gap:4}}>ชื่อร่าง<input style={baseInput} value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/></label>
    <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={clone} onChange={e=>setClone(e.target.checked)}/> คัดลอกจาก PriceBook Active เพื่อปรับราคาในร่าง</label>
    <button style={button} disabled={busy||title.trim().length<3} onClick={()=>void create()}>+ สร้าง Draft ใหม่</button>
   </div>
   <div style={{...grid,marginTop:12}}>
    <label style={{display:'grid',gap:4}}>เลือกร่างที่จะแก้ไข
     <select style={baseInput} value={selectedId} onChange={e=>{setSelectedId(e.target.value);setChecked([]);setEntry({...empty});setAdvanced({aliases:'[]',spec_match:'{}',adjustments:'{}'});setEditingId(null);setCsv(blankCsv())}}>
      <option value="">-- เลือก Draft --</option>{drafts.map(d=><option key={d.id} value={d.id}>{d.title} · {date(d.updated_at)}</option>)}
     </select>
    </label>
    <button style={button} disabled={busy} onClick={()=>void handle(async()=>{},'โหลดข้อมูลล่าสุดแล้ว')}>รีเฟรชข้อมูล</button>
   </div>
   {error&&<p role="alert" style={{...alert,color:'#d65b43'}}>{error}</p>}
   {notice&&<p role="status" style={alert}>{notice}</p>}
   {selected&&<>
    <p style={{fontSize:13,marginTop:12}}>เวอร์ชันร่าง: <strong>{selected.title}</strong> · {entries.length} รายการ · สถานะ {selected.status} · ไม่พร้อมเผยแพร่โดยอัตโนมัติ</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
      {selected.status==='DRAFT'&&<>
       <button style={button} disabled={busy} onClick={()=>{const next=window.prompt('แก้ชื่อ Draft',selected.title);if(next!==null)void handle(()=>managePb28Draft(selectedId,'RENAME',next),'เปลี่ยนชื่อ Draft แล้ว')}}>เปลี่ยนชื่อ</button>
       <button style={button} disabled={busy} onClick={()=>void handle(()=>managePb28Draft(selectedId,'FREEZE'),'ล็อกร่างเพื่อรอตรวจแล้ว')}>ล็อกร่าง (Freeze)</button>
      </>}
      {selected.status==='FROZEN'&&<button style={button} disabled={busy} onClick={()=>void handle(()=>managePb28Draft(selectedId,'REOPEN'),'เปิดร่างให้แก้ไขได้อีกครั้ง')}>เปิดให้แก้ไข (Reopen)</button>}
      {selected.status!=='ARCHIVED'&&<button style={button} disabled={busy} onClick={()=>{if(window.confirm('Archive Draft นี้? ข้อมูลและ Audit Log จะยังเก็บไว้ และจะกลับมาแก้ไขไม่ได้'))void handle(()=>managePb28Draft(selectedId,'ARCHIVE'),'เก็บ Draft ลง Archive แล้ว')}}>Archive Draft</button>}
    </div>
    {selected.status!=='DRAFT'&&<p role="status" style={alert}>ร่างนี้เป็นแบบอ่านอย่างเดียว กรุณา Reopen หากต้องการแก้ไข หรือสร้างร่างใหม่</p>}
    <div style={grid}>
     {inputFields.map(([key,label])=><label key={key} style={{display:'grid',gap:4,fontSize:13}}>
      {label}<input style={baseInput} type={numericFields.has(key)?'number':'text'} min={numericFields.has(key)?0:undefined} step={numericFields.has(key)?1:undefined}
       value={String(entry[key])} onChange={e=>setEntry(prev=>({...prev,[key]:numericFields.has(key)?toNum(e.target.value):e.target.value}))}/>
     </label>)}
     <label style={{display:'grid',gap:4,fontSize:13}}>บันทึกเพิ่มเติม<input style={baseInput} value={entry.note} maxLength={800} onChange={e=>setEntry(p=>({...p,note:e.target.value}))}/></label>
     <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={entry.active} onChange={e=>setEntry(p=>({...p,active:e.target.checked}))}/> เปิดรายการในร่าง</label>
    </div>
    <details style={{marginTop:12}}>
      <summary style={{cursor:'pointer',fontWeight:600}}>ข้อมูลจับคู่รุ่นและกฎปรับราคา (ขั้นสูง)</summary>
      <p style={{fontSize:12,opacity:.8}}>รูปแบบ JSON · คัดลอกจาก V2.7 โดยไม่ลบเงื่อนไขเดิม · ตรวจสอบก่อนบันทึก</p>
      <div style={grid}>
       {(['aliases','spec_match','adjustments'] as const).map(key=><label key={key} style={{display:'grid',gap:4,fontSize:12}}>
        {key}<textarea style={{...baseInput,minHeight:80,fontFamily:'monospace'}} value={advanced[key]} onChange={e=>setAdvanced(p=>({...p,[key]:e.target.value}))}/>
       </label>)}
      </div>
    </details>
    <div style={{display:'flex',gap:8,margin:'12px 0',flexWrap:'wrap'}}>
     <button style={button} disabled={busy||selected.status!=='DRAFT'||!entry.model.trim()||!entry.category.trim()} onClick={()=>void save()}>{editingId?'บันทึกแก้ไขรายการ':'เพิ่มรายการใน Draft'}</button>
     <button style={button} disabled={busy} onClick={()=>{setEditingId(null);setEntry({...empty});setAdvanced({aliases:'[]',spec_match:'{}',adjustments:'{}'})}}>ล้างฟอร์ม</button>
    </div>
    <section style={alert}>
     <strong>Import CSV — ตรวจ Preview ก่อนนำเข้า</strong>
     <p style={{fontSize:12}}>คอลัมน์: {PRICEBOOK_V28_HEADERS.join(', ')} · สูงสุด 250 รายการต่อครั้ง · ไม่กระทบ V2.7</p>
     <input type="file" accept=".csv,text/csv" onChange={e=>void parseCsv(e.target.files?.[0]??null)}/>
     {csv.result&&<div style={{marginTop:8}}>
      <strong>{csv.result.valid?'ผ่านรูปแบบ':'ไม่ผ่านรูปแบบ'}</strong> · {csv.result.rows.length} แถว
      {csv.result.errors.slice(0,8).map((x,i)=><div key={i} style={{fontSize:12,color:'#d65b43'}}>{x}</div>)}
      {csv.result.valid&&<div style={{overflowX:'auto',marginTop:8}}><table style={{fontSize:12,width:'100%'}}>
       <thead><tr><th>รุ่น</th><th>Opening</th><th>Target</th><th>Hard Max</th></tr></thead>
       <tbody>{csv.result.rows.slice(0,8).map((r,i)=><tr key={i}><td>{r.model}</td><td>{fmt(Number(r.opening_offer))}</td><td>{fmt(Number(r.target_buy))}</td><td>{fmt(Number(r.hard_max))}</td></tr>)}</tbody>
      </table></div>}
      <button style={{...button,marginTop:8}} disabled={busy||selected.status!=='DRAFT'||!csv.result.valid||csv.result.rows.length>250} onClick={()=>void applyImport()}>ยืนยัน Import เข้า Draft</button>
     </div>}
    </section>
    <div style={{display:'flex',gap:8,margin:'14px 0',flexWrap:'wrap'}}>
     <button style={button} onClick={()=>setTab('entries')}>รายการราคา ({entries.length})</button>
     <button style={button} onClick={()=>setTab('audit')}>Audit Log ({audit.length})</button>
     <button style={button} disabled={!entries.length} onClick={exportCsv}>Export CSV</button>
    </div>
    {tab==='entries'?<>
     <input style={baseInput} placeholder="ค้นหาหมวด ยี่ห้อ รุ่น รหัสรุ่น" value={query} onChange={e=>setQuery(e.target.value)}/>
     <div style={{...grid,margin:'12px 0'}}>
      <label style={{display:'grid',gap:4}}>ฟิลด์ Bulk Edit
       <select style={baseInput} value={bulkField} onChange={e=>setBulkField(e.target.value as typeof bulkField)}>
        {bulkFields.map(f=><option key={f} value={f}>{f}</option>)}
       </select>
      </label>
      <label style={{display:'grid',gap:4}}>เพิ่ม / ลด (บาท)<input style={baseInput} type="number" value={delta} onChange={e=>setDelta(e.target.value)}/></label>
      <div style={{alignSelf:'end'}}><button style={button} disabled={busy||selected.status!=='DRAFT'||!checked.length||!delta.trim()||projected.some(p=>!p.ok)} onClick={()=>void bulk()}>Bulk Edit {checked.length} รายการ</button></div>
     </div>
     {!!projected.length&&<small>Preview: {projected.slice(0,5).map(e=>e.model+': '+fmt(e[bulkField])+(e.ok?'':' (ผิดเงื่อนไข)')).join(' · ')}</small>}
     <div style={{overflowX:'auto',marginTop:10}}>
      <table style={{minWidth:720,width:'100%',borderCollapse:'collapse',fontSize:12}}>
       <thead><tr><th><input type="checkbox" checked={filtered.length>0&&filtered.every(e=>checked.includes(e.id))} onChange={e=>setChecked(e.target.checked?Array.from(new Set([...checked,...filtered.map(e=>e.id)])):checked.filter(id=>!filtered.some(r=>r.id===id)))}/></th><th>หมวด / รุ่น</th><th>สภาพ</th><th>เปิดรับ</th><th>เป้าหมาย</th><th>เพดาน</th><th>ดำเนินการ</th></tr></thead>
       <tbody>{filtered.map(r=><tr key={r.id} style={{borderTop:'1px solid #8894a633'}}>
        <td><input type="checkbox" checked={checked.includes(r.id)} onChange={e=>setChecked(p=>e.target.checked?[...p,r.id]:p.filter(id=>id!==r.id))}/></td>
        <td>{r.category} · {r.brand} {r.model}<div style={{opacity:.7}}>{r.model_code} {r.active?'':'(ปิด)'}</div></td>
        <td>{r.condition_key}</td><td>{fmt(r.opening_offer)}</td><td>{fmt(r.target_buy)}</td><td>{fmt(r.hard_max)}</td>
        <td><button style={button} onClick={()=>{setEditingId(r.id);setEntry({...r});setAdvanced({aliases:JSON.stringify(r.aliases??[],null,2),spec_match:JSON.stringify(r.spec_match??{},null,2),adjustments:JSON.stringify(r.adjustments??{},null,2)});window.scrollTo({top:0,behavior:'smooth'})}}>แก้</button> <button style={button} disabled={busy||selected.status!=='DRAFT'} onClick={()=>void remove(r)}>ลบ</button></td>
       </tr>)}</tbody>
      </table>
      {!filtered.length&&<p style={{opacity:.7}}>ไม่พบรายการ</p>}
     </div>
    </>:<div style={{overflowX:'auto'}}>
     <table style={{width:'100%',minWidth:520,fontSize:12}}><thead><tr><th>เวลา</th><th>การเปลี่ยนแปลง</th><th>รายการ</th><th>ค่าก่อน / หลัง</th></tr></thead>
      <tbody>{audit.map(a=><tr key={a.id} style={{borderTop:'1px solid #8894a633'}}>
       <td>{date(a.created_at)}<div style={{opacity:.7}}>ผู้ดำเนินการ: {a.actor_id.slice(0,8)}</div></td><td>{a.action}</td><td>{a.entry_id?.slice(0,8)??'Draft'}</td>
       <td>
        <div>{a.before_data?.['hard_max']!=null?String(a.before_data['hard_max']):'—'} → {a.after_data?.['hard_max']!=null?String(a.after_data['hard_max']):'—'}</div>
        <details><summary style={{cursor:'pointer'}}>ดูข้อมูลก่อน / หลัง</summary>
         <div style={{display:'grid',gap:6,gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))'}}>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}}>{JSON.stringify(a.before_data,null,2)??'ไม่มี'}</pre>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}}>{JSON.stringify(a.after_data,null,2)??'ไม่มี'}</pre>
         </div>
        </details>
       </td>
      </tr>)}</tbody>
     </table>{!audit.length&&<p>ยังไม่มีประวัติ</p>}
    </div>}
   </>}
  </>}
 </section>;
}
