import {useCallback,useEffect,useState} from 'react';
import {
 HISTORY_FILE_SPECS,parseHistoryCostCsv,importHistoryCostBatch,loadHistoryCostSummary,
 type HistoryKind,type HistoryRow,
} from '../lib/aiBuyerCostHistory';

const button:React.CSSProperties={border:'1px solid #7a879681',borderRadius:8,padding:'9px 12px',cursor:'pointer'};
const money=(value:number)=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(value);
type Preview={kind:HistoryKind;rows:HistoryRow[];warnings:string[];filename:string};
export function AiBuyerCostHistoryImporter(){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
 const [done,setDone]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [summary,setSummary]=useState<Record<HistoryKind,number>|null>(null);
 const reload=useCallback(async()=>{setSummary(await loadHistoryCostSummary())},[]);
 useEffect(()=>{if(!open)return;void reload().catch(e=>setError(String(e?.message||e)))},[open,reload]);
 const pick=async(file:File|null)=>{
  setPreview(null);setDone(0);setError('');setNotice('');
  if(!file)return;
  if(file.size>2_000_000){setError('ไฟล์มีขนาดเกิน 2 MB');return}
  try{
   const parsed=parseHistoryCostCsv(await file.text());
   setPreview({...parsed,filename:file.name});
  }catch(e){setError(e instanceof Error?e.message:String(e))}
 };
 const start=async()=>{
  if(!preview)return;
  if(!window.confirm('ยืนยันนำเข้าประวัติ '+preview.rows.length+' รายการใน AI Buyer Learning History เท่านั้น โดยไม่แก้ PriceBook V2.7 หรือส่ง LINE?'))return;
  setBusy(true);setError('');setNotice('');setDone(0);
  try{
   let total=0;
   for(let i=0;i<preview.rows.length;i+=100){
    total+=await importHistoryCostBatch(preview.kind,preview.rows.slice(i,i+100));
    setDone(total);
   }
   await reload();
   setNotice('นำเข้าประวัติ '+total+' รายการแล้ว ระบบเก็บรหัสแหล่งข้อมูลเพื่อป้องกันการนำเข้าซ้ำ');
   setPreview(null);
  }catch(e){setError('นำเข้าไม่ครบ: '+(e instanceof Error?e.message:String(e))+' · รายการที่สำเร็จก่อนหน้าอัปเดตซ้ำได้อย่างปลอดภัย')}
  finally{setBusy(false)}
 };
 return <section style={{padding:15,margin:'16px 0',border:'1px solid #8894a677',borderRadius:14}}>
  <button type="button" style={{...button,fontWeight:700,width:'100%',textAlign:'left'}} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
   AMPHON System → AI Buyer: นำเข้าประวัติทุน {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.82,marginTop:7}}>นำเข้าเฉพาะประวัติซื้อ–ขาย ไม่ใช่ราคาสำหรับเสนอให้ลูกค้า · ไม่แตะ V2.7 · ไม่เปิด LINE AUTO</p>
  {open&&<>
   {summary&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,marginBottom:12}}>
    {(['INVENTORY','SALE','FIELD'] as const).map(kind=><div key={kind} style={{border:'1px solid #8894a633',borderRadius:9,padding:10}}>
     <div style={{fontSize:12,opacity:.78}}>{HISTORY_FILE_SPECS[kind].title}</div>
     <strong>{money(summary[kind])} รายการ</strong>
    </div>)}
   </div>}
   <p style={{fontSize:13}}>เลือกไฟล์ CSV ที่ส่งออกจาก Hetzner: <code>inventory_cost_history.csv</code>, <code>sales_learning_history.csv</code> หรือ <code>field_purchase_history.csv</code></p>
   <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>void pick(e.target.files?.[0]??null)} style={{maxWidth:'100%'}}/>
   {preview&&<div style={{marginTop:12,padding:12,border:'1px solid #8894a655',borderRadius:9}}>
    <strong>Import Preview: {HISTORY_FILE_SPECS[preview.kind].title}</strong>
    <p style={{fontSize:13}}>{preview.filename} · {preview.rows.length} รายการ · ข้อมูลไม่ส่งไป LINE</p>
    {preview.warnings.map((warning,i)=><p key={i} style={{fontSize:12,color:'#b77a20'}}>{warning}</p>)}
    <div style={{overflowX:'auto',marginBottom:10}}>
     <table style={{minWidth:400,width:'100%',fontSize:12}}><thead><tr><th>รหัส</th><th>สินค้า</th><th>ต้นทุน (บาท)</th></tr></thead>
      <tbody>{preview.rows.slice(0,7).map((r,i)=><tr key={i}><td>{preview.kind==='SALE'?r.id:r.code}</td>
       <td>{(preview.kind==='INVENTORY'?r.name:preview.kind==='SALE'?r.itemName:[r.brand,r.model].join(' ')).slice(0,70)}</td>
       <td>{money(Number(preview.kind==='FIELD'?(r.approvedBuyPrice||r.buyPrice):r.cost))}</td></tr>)}</tbody>
     </table>
    </div>
    <button style={button} type="button" disabled={busy} onClick={()=>void start()}>ยืนยันนำเข้าประวัติ {preview.rows.length} รายการ</button>
   </div>}
   {busy&&<p role="status">กำลังนำเข้า {done}/{preview?.rows.length??done} รายการ · สามารถนำเข้าไฟล์เดิมซ้ำได้โดยไม่สร้างรายการซ้ำ</p>}
   {error&&<p role="alert" style={{color:'#d65b43'}}>{error}</p>}
   {notice&&<p role="status" style={{color:'#0b926d'}}>{notice}</p>}
  </>}
 </section>;
}
