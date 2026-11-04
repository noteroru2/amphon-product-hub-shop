import {useCallback,useEffect,useMemo,useState} from 'react';
import {listPb28Drafts,type Pb28Draft} from '../lib/priceBookV28Admin';
import {
 loadChatPriceProposals,loadChatPriceEntries,loadChatPriceAudit,decideChatPriceProposal,
 chatPriceDiff,chatPriceIsStale,validateChatPriceValues,type ChatPriceProposal,
 type ChatPriceEntrySnapshot,
} from '../lib/aiBuyerChatPriceControl';
const btn:React.CSSProperties={border:'1px solid #80909f80',borderRadius:8,padding:'9px 12px',cursor:'pointer',background:'transparent',color:'inherit'};
const fmt=(n:number)=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(n);
const date=(v:string)=>new Date(v).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});

export function AiBuyerChatPriceControl(){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [proposals,setProposals]=useState<ChatPriceProposal[]>([]),[drafts,setDrafts]=useState<Pb28Draft[]>([]);
 const [entries,setEntries]=useState<Map<string,ChatPriceEntrySnapshot>>(new Map());
 const [selectedId,setSelectedId]=useState(''),[onlyPending,setOnlyPending]=useState(true);
 const [confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [audit,setAudit]=useState<Array<{action:string;actor_id:string;recorded_at:string}>>([]);
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const [ps,ds]=await Promise.all([loadChatPriceProposals(),listPb28Drafts()]);
   const es=await loadChatPriceEntries(ps.map(p=>p.entry_id));
   setProposals(ps);setDrafts(ds);setEntries(new Map(es.map(e=>[e.id,e])));
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{if(open)void refresh()},[open,refresh]);
 const selected=proposals.find(p=>p.id===selectedId);
 const current=selected?entries.get(selected.entry_id)??null:null;
 const draft=selected?drafts.find(d=>d.id===selected.draft_id):null;
 const stale=selected?chatPriceIsStale(selected,current):false;
 const expired=selected?Date.parse(selected.expires_at)<=Date.now():false;
 const invalid=selected?validateChatPriceValues(selected.proposed_prices):'';
 const editable=!!selected&&selected.status==='PENDING'&&!expired&&!stale&&draft?.status==='DRAFT'&&!invalid;
 const listing=useMemo(()=>proposals.filter(p=>!onlyPending||p.status==='PENDING'),[proposals,onlyPending]);
 const choose=async(p:ChatPriceProposal)=>{
  setSelectedId(p.id);setConfirmed(false);setNotice('');setError('');setAudit([]);
  try{const rows=await loadChatPriceAudit(p.id);setAudit(rows as typeof audit)}
  catch(e){setError(e instanceof Error?e.message:String(e))}
 };
 const decide=async(action:'APPROVE'|'REJECT')=>{
  if(!selected)return;
  if(action==='APPROVE'&&(!editable||!confirmed)){
   setError('ต้องตรวจ Diff และยืนยันด้วย Owner ก่อน');return;
  }
  const prompt=action==='APPROVE'
   ?'ยืนยันแก้ราคา 4 ช่องใน PriceBook V2.8 Draft เท่านั้น? ไม่เปลี่ยน V2.7/LINE AUTO'
   :'ปฏิเสธคำขอแก้ราคานี้?';
  if(!window.confirm(prompt))return;
  setBusy(true);setNotice('');setError('');
  try{
   // Always refresh live data immediately before approval.
   const [ps,es,ds]=await Promise.all([
    loadChatPriceProposals(),loadChatPriceEntries([selected.entry_id]),listPb28Drafts()
   ]);
   const latest=ps.find(p=>p.id===selected.id);
   if(!latest||latest.status!=='PENDING'||latest.preview_hash!==selected.preview_hash)throw Error('คำขอเปลี่ยน กรุณาโหลดใหม่');
   if(action==='APPROVE'&&(chatPriceIsStale(latest,es[0]??null)||ds.find(x=>x.id===latest.draft_id)?.status!=='DRAFT'))
    throw Error('ราคาเดิมถูกแก้ไขหรือ Draft ไม่พร้อมแล้ว ไม่อนุมัติรายการเก่า');
   await decideChatPriceProposal(selected.id,action,selected.preview_hash);
   setNotice(action==='APPROVE'?'Owner อนุมัติและบันทึกลง V2.8 Draft พร้อม Audit Log แล้ว':'Owner ปฏิเสธคำขอเรียบร้อย');
   setSelectedId('');setConfirmed(false);await refresh();
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };
 return <section style={{border:'1px solid #80909f75',borderRadius:14,padding:15,margin:'16px 0'}}>
  <button style={{...btn,width:'100%',textAlign:'left',fontWeight:700}} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
   Chat Price Control — ปรับราคาจาก ChatGPT {open?'▴':'▾'}
  </button>
  <p style={{fontSize:12,opacity:.8}}>แชทสร้างคำขอรออนุมัติ · ตรวจราคาเดิมและราคาเสนอใหม่ · Owner ยืนยันใน Hub · บันทึกเฉพาะ V2.8 Draft</p>
  {open&&<>
   <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',margin:'10px 0'}}>
    <button style={btn} disabled={busy||loading} onClick={()=>void refresh()}>{loading?'กำลังตรวจ…':'โหลดคำขอจาก ChatGPT'}</button>
    <label style={{fontSize:13}}><input type="checkbox" checked={onlyPending} onChange={e=>setOnlyPending(e.target.checked)}/> เฉพาะรออนุมัติ</label>
    <strong>{proposals.filter(p=>p.status==='PENDING'&&Date.parse(p.expires_at)>Date.now()).length} คำขอรออนุมัติ</strong>
   </div>
   {!listing.length&&<p style={{fontSize:13}}>ยังไม่มีคำขอจาก ChatGPT — สามารถบอกชื่อรุ่นและราคาใหม่ในแชทนี้เพื่อให้ผมจัดทำคำขอได้</p>}
   <div style={{display:'grid',gap:8}}>
    {listing.map(p=><button key={p.id} style={{...btn,textAlign:'left',background:selectedId===p.id?'#80909f22':'transparent'}} onClick={()=>void choose(p)}>
     <div style={{display:'flex',gap:8,justifyContent:'space-between',flexWrap:'wrap'}}>
      <strong>{p.before_snapshot.brand} {p.before_snapshot.model}</strong>
      <span>{p.status==='PENDING'&&Date.parse(p.expires_at)<=Date.now()?'หมดอายุ':p.status}</span>
     </div>
     <div style={{fontSize:12,opacity:.8}}>เป้าหมาย {fmt(Number(p.before_snapshot.target_buy))} → {fmt(Number(p.proposed_prices.target_buy))} บาท · {date(p.created_at)}</div>
     <div style={{fontSize:11,opacity:.75}}>{p.summary||p.reason||'คำขอแก้ราคา'}</div>
    </button>)}
   </div>
   {selected&&<div style={{border:'1px solid #a38b6577',padding:13,borderRadius:10,marginTop:14}}>
    <strong>ตรวจคำขอ: {selected.before_snapshot.brand} {selected.before_snapshot.model}</strong>
    <p style={{fontSize:12,opacity:.8}}>หมวด {selected.before_snapshot.category} · Model code {selected.before_snapshot.model_code||'—'} · สภาพ {selected.before_snapshot.condition_key} · Draft {draft?.title||'ไม่พบ'}</p>
    <p style={{fontSize:12}}>เหตุผลจากแชท: {selected.reason||'ไม่ได้ระบุ'} · หมดอายุ {date(selected.expires_at)}</p>
    <div style={{overflowX:'auto'}}>
     <table style={{width:'100%',minWidth:400,fontSize:13,borderCollapse:'collapse'}}>
      <thead><tr><th style={{textAlign:'left'}}>รายการ</th><th style={{textAlign:'right'}}>ราคาเดิม</th><th style={{textAlign:'right'}}>ราคาเสนอใหม่</th><th style={{textAlign:'right'}}>เปลี่ยน</th></tr></thead>
      <tbody>{chatPriceDiff(selected).map(d=><tr key={d.key} style={{borderTop:'1px solid #80909f40'}}>
       <td>{d.label}</td><td style={{textAlign:'right'}}>{fmt(d.before)}</td>
       <td style={{textAlign:'right',fontWeight:700}}>{fmt(d.after)}</td>
       <td style={{textAlign:'right'}}>{d.delta>0?'+':''}{fmt(d.delta)}</td>
      </tr>)}</tbody>
     </table>
    </div>
    {selected.status!=='PENDING'&&<p role="status">สถานะ: {selected.status} · {selected.reviewed_at?date(selected.reviewed_at):'—'}</p>}
    {expired&&selected.status==='PENDING'&&<p role="alert" style={{color:'#c06d36'}}>คำขอหมดอายุ ต้องให้ ChatGPT สร้างคำขอใหม่</p>}
    {stale&&selected.status==='PENDING'&&<p role="alert" style={{color:'#c06d36'}}>ข้อมูลรายการหรือราคาเดิมเปลี่ยนไปแล้ว ต้องสร้างคำขอใหม่ ไม่อนุญาตให้เขียนทับ</p>}
    {invalid&&<p role="alert" style={{color:'#c06d36'}}>{invalid}</p>}
    {draft?.status!=='DRAFT'&&selected.status==='PENDING'&&<p role="alert">Draft ถูก Freeze หรือ Archive ไม่สามารถบันทึกได้</p>}
    {editable&&<label style={{display:'flex',gap:8,alignItems:'start',fontSize:13,margin:'12px 0'}}>
     <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     ฉันเป็น Owner และได้ตรวจรุ่น สเปก ราคาเดิม ราคาใหม่ และความเหมาะสมของกำไรแล้ว ยืนยันให้แก้เฉพาะ Draft
    </label>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
     <button style={btn} disabled={busy||!editable||!confirmed} onClick={()=>void decide('APPROVE')}>Owner อนุมัติบันทึกลง Draft</button>
     <button style={btn} disabled={busy||selected.status!=='PENDING'||expired||draft?.status!=='DRAFT'} onClick={()=>void decide('REJECT')}>ปฏิเสธคำขอ</button>
     <button style={btn} onClick={()=>{setSelectedId('');setConfirmed(false)}}>ปิด</button>
    </div>
    {!!audit.length&&<details style={{marginTop:12}}><summary>Audit Log ({audit.length})</summary>
     {audit.map((a,i)=><div key={i} style={{fontSize:12,marginTop:6}}>{a.action} · {date(a.recorded_at)} · ผู้ดำเนินการ {a.actor_id.slice(0,8)}…</div>)}
    </details>}
   </div>}
   {notice&&<p role="status" style={{color:'#138c69'}}>{notice}</p>}
   {error&&<p role="alert" style={{color:'#cc5e45'}}>{error}</p>}
  </>}
 </section>;
}
