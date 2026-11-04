import {useCallback,useEffect,useMemo,useState} from 'react';
import {listPb28Drafts,listPb28Entries,type Pb28Draft} from '../lib/priceBookV28Admin';
import {parseChatPriceProposal,prepareChatPriceDiff,type ChatPricePreview} from '../lib/aiBuyerChatPriceControl';
import {applyChatPriceDiff,listChatPriceBatches,type ChatPriceBatch} from '../lib/aiBuyerChatPriceControlData';

const panel:React.CSSProperties={padding:13,border:'1px solid #71809a66',borderRadius:12,marginTop:12};
const button:React.CSSProperties={padding:'9px 12px',border:'1px solid #71809a88',borderRadius:8,cursor:'pointer'};
const control:React.CSSProperties={padding:9,border:'1px solid #71809a88',borderRadius:8,width:'100%',minWidth:0,boxSizing:'border-box',background:'transparent',color:'inherit'};
const money=(n:number)=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(n);
const fieldNames:Record<string,string>={
 estimated_resale:'ราคาขายต่อ',opening_offer:'ราคาเปิดรับ',target_buy:'ราคารับเป้าหมาย',hard_max:'เพดานรับซื้อ'
};
const example=JSON.stringify({
 version:1,instruction:'ตัวอย่างประกอบการทดสอบเท่านั้น ไม่ใช่ราคาที่แนะนำจริง',
 items:[{category:'NOTEBOOK',brand:'Lenovo',model:'Lenovo LOQ 15IRX9 i5-13450HX RTX3050 16/512',
 model_code:'15IRX9',condition_key:'NORMAL',estimated_resale:16900,opening_offer:10300,target_buy:11300,hard_max:12300}]
},null,2);

export function AiBuyerChatPriceControl(){
 const [open,setOpen]=useState(false),[drafts,setDrafts]=useState<Pb28Draft[]>([]),[draftId,setDraftId]=useState('');
 const [input,setInput]=useState(''),[preview,setPreview]=useState<ChatPricePreview[]>([]);
 const [snapshot,setSnapshot]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [audit,setAudit]=useState<ChatPriceBatch[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const selected=drafts.find(d=>d.id===draftId);
 const reload=useCallback(async()=>{
  const ds=await listPb28Drafts();setDrafts(ds);
  setDraftId(current=>ds.some(d=>d.id===current&&d.status==='DRAFT')?current:ds.find(d=>d.status==='DRAFT')?.id??'');
 },[]);
 useEffect(()=>{if(!open)return;void reload().catch(e=>setError(String(e.message||e)))},[open,reload]);
 useEffect(()=>{setPreview([]);setSnapshot('');setConfirmed(false);if(!draftId)return;
  void listChatPriceBatches(draftId).then(setAudit).catch(e=>setError(String(e.message||e)));
 },[draftId]);
 const hash=useMemo(()=>draftId+'|'+input,[draftId,input]);
 const display=async()=>{
  setError('');setNotice('');setPreview([]);setConfirmed(false);
  if(!draftId||selected?.status!=='DRAFT'){setError('เลือก PriceBook V2.8 Draft ที่เปิดอยู่ก่อน');return}
  setBusy(true);
  try{
   const proposal=parseChatPriceProposal(input);
   const existing=await listPb28Entries(draftId);
   const rows=prepareChatPriceDiff(proposal,existing);
   setPreview(rows);setSnapshot(hash);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 const approve=async()=>{
  if(!confirmed||!preview.length||snapshot!==hash||selected?.status!=='DRAFT'){
   setError('ข้อมูลเปลี่ยนจาก Preview หรือยังไม่ได้กดยืนยัน กรุณาตรวจรายการอีกครั้ง');return;
  }
  if(!window.confirm('ยืนยันด้วยบัญชี Owner: บันทึกราคา '+preview.length+' รุ่นลง V2.8 Draft เท่านั้น? ราคาในแต่ละรายการจะเป็น active=false และไม่เปลี่ยน V2.7/LINE AUTO'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const payload=parseChatPriceProposal(input);
   const batchId=await applyChatPriceDiff(draftId,preview.map(p=>p.after),payload.instruction??'');
   setNotice('อนุมัติบันทึก Draft แล้ว · Audit ID: '+batchId);
   setPreview([]);setSnapshot('');setConfirmed(false);
   setAudit(await listChatPriceBatches(draftId));
  }catch(e){setError('ยังไม่บันทึก: '+(e instanceof Error?e.message:String(e))+' · หากราคาใน Draft เปลี่ยนไป กรุณากด Preview ใหม่')}
  finally{setBusy(false)}
 };
 return <section style={panel}>
  <button style={{...button,width:'100%',textAlign:'left',fontWeight:700}} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   Chat Price Control — รับชุดราคาจาก ChatGPT และอนุมัติใน Hub {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.78}}>ทางปลอดภัย: ให้ ChatGPT วิเคราะห์ทุนและสร้าง JSON → วางที่นี่ → ตรวจราคาเดิม/ราคาใหม่ → Owner ยืนยัน · ไม่ใช่ LINE AUTO</p>
  {open&&<>
   <div style={{display:'grid',gap:5,marginTop:12}}>
    <label style={{fontSize:13}}>Draft ปลายทาง
     <select style={control} value={draftId} onChange={e=>setDraftId(e.target.value)}>
      <option value="">เลือก Draft</option>
      {drafts.filter(d=>d.status==='DRAFT').map(d=><option key={d.id} value={d.id}>{d.title}</option>)}
     </select>
    </label>
    <label style={{fontSize:13}}>ชุดราคา JSON จากแชท
     <textarea style={{...control,minHeight:160,fontFamily:'monospace',resize:'vertical'}} value={input}
      onChange={e=>{setInput(e.target.value);setPreview([]);setConfirmed(false)}} placeholder="คัดลอก JSON ชุดราคาจากแชท ChatGPT มาวางตรงนี้" />
    </label>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button type="button" style={button} disabled={busy||!input.trim()} onClick={()=>void display()}>ตรวจ Diff ก่อนบันทึก</button>
     <button type="button" style={button} disabled={busy} onClick={()=>{setInput(example);setPreview([]);setConfirmed(false)}}>ดูตัวอย่างรูปแบบ JSON (ไม่ใช่ราคาจริง)</button>
    </div>
   </div>
   {preview.length>0&&<div style={{...panel,border:'1px solid #d6a66d88'}}>
    <strong>Preview: {preview.length} รายการ · บันทึกแล้วจะปิดใช้งานทั้งหมด</strong>
    <div style={{overflowX:'auto',marginTop:10}}>
     <table style={{minWidth:730,width:'100%',fontSize:12,borderCollapse:'collapse'}}>
      <thead><tr><th>สินค้า / รหัส</th><th>รายการ</th><th style={{textAlign:'right'}}>ราคาเดิม</th><th style={{textAlign:'right'}}>ราคาใหม่</th><th style={{textAlign:'right'}}>เปลี่ยน</th></tr></thead>
      <tbody>{preview.flatMap((p,i)=>Object.entries(fieldNames).map(([key,label])=>{
       const col=key as 'estimated_resale'|'opening_offer'|'target_buy'|'hard_max';
       const from=p.before?.[col]??null,to=p.after[col];
       return <tr key={i+key} style={{borderTop:'1px solid #71809a44'}}>
        <td>{label==='ราคาขายต่อ'?<><strong>{p.after.model}</strong><div>{p.after.model_code||'—'} / {p.after.condition_key}</div></>:''}</td>
        <td>{label}</td><td style={{textAlign:'right'}}>{from===null?'เพิ่มใหม่':money(from)}</td>
        <td style={{textAlign:'right'}}>{money(to)}</td>
        <td style={{textAlign:'right'}}>{from===null?'—':(to>=from?'+':'')+money(to-from)}</td>
       </tr>
      }))}</tbody>
     </table>
    </div>
    <p style={{fontSize:12,opacity:.85}}>รายการเดิมจะถูกตั้งเป็น active=false ใน Draft เพื่อให้ตรวจซ้ำก่อนใช้งานจริง การแก้ไขจะถูกปฏิเสธทั้งชุด หากราคาเดิมเปลี่ยนหลัง Preview</p>
    <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:13}}>
     <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     ผมตรวจรุ่น สเปก สภาพ ราคาตลาด และราคาเดิม/ใหม่ครบแล้ว ยืนยันให้แก้เฉพาะ Draft
    </label>
    <button style={{...button,marginTop:10}} disabled={busy||!confirmed||snapshot!==hash} onClick={()=>void approve()}>ยืนยันบันทึก {preview.length} รุ่น ลง PriceBook V2.8 Draft</button>
   </div>}
   {notice&&<p role="status" style={{color:'#0b9274'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#ce5b46'}}>{error}</p>}
   {!!audit.length&&<details style={{marginTop:12}}>
    <summary>ประวัติชุดราคาที่ Owner อนุมัติ ({audit.length})</summary>
    {audit.map(a=><details key={a.id} style={{borderTop:'1px solid #71809a44',padding:8,fontSize:12}}>
     <summary>{new Date(a.created_at).toLocaleString('th-TH')} · {a.item_count} รุ่น · {a.id.slice(0,8)}</summary>
     <p>{a.request_text||'ไม่มีคำอธิบาย'}</p>
     <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({before:a.before_data,after:a.after_data},null,2)}</pre>
    </details>)}
   </details>}
  </>}
 </section>;
}
