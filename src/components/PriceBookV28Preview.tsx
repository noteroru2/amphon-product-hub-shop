import { useMemo, useState } from "react";
import { previewPriceV28, type PriceInput } from "../lib/pricebookV28";

const initial:PriceInput={
 versionId:"v2.8-draft-local",versionStatus:"DRAFT",entryId:"",
 modelConfirmed:false,conditionConfirmed:false,ownershipClear:false,
 resale:0,targetProfit:0,processing:0,warranty:0,
 deductions:[],logistics:{method:"IN_STORE",verified:true},
};
const money=(x:number|null)=>x==null?"—":new Intl.NumberFormat("th-TH",{maximumFractionDigits:0}).format(x)+" บาท";
const number=(s:string)=>s.trim()===""?undefined:Number(s);
function Amount({label,value,onChange}:{label:string;value?:number;onChange:(next:number|undefined)=>void}){
 return <label style={{display:"grid",gap:4,fontSize:13}}><span>{label}</span>
  <input type="number" inputMode="decimal" min={0} step={1} value={value??""} onChange={e=>onChange(number(e.target.value))}
    style={{width:"100%",padding:"9px 10px",border:"1px solid #9aa4af",borderRadius:8,background:"transparent",color:"inherit"}} />
 </label>;
}
/** Manual preview, never loads or updates customer, LINE, or live PriceBook data. */
export function PriceBookV28Preview(){
 const [expanded,setExpanded]=useState(false);
 const [form,setForm]=useState<PriceInput>(initial);
 const [repair,setRepair]=useState<number|undefined>();
 const [residual,setResidual]=useState<number|undefined>();
 const [defectCode,setDefectCode]=useState("");
 const [province,setProvince]=useState("");
 const [transport,setTransport]=useState<number|undefined>();
 const change=<K extends keyof PriceInput>(key:K,value:PriceInput[K])=>setForm(old=>({...old,[key]:value}));
 const result=useMemo(()=>previewPriceV28({...form,deductions:defectCode.trim()?[{code:defectCode.trim(),repairCost:repair??0,residualLoss:residual??0}]:[],logistics:{...form.logistics,province,shipping:transport}}),[form,defectCode,repair,residual,province,transport]);
 return <section style={{margin:"14px 0",padding:16,border:"1px solid var(--border,#8885)",borderRadius:14}}>
  <button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded} style={{fontWeight:700,padding:"7px 0",background:"transparent",border:0,color:"inherit",cursor:"pointer"}}>
   PriceBook V2.8 — ทดลองสูตรราคา ({expanded?"ซ่อน":"แสดง"})
  </button>
  <p style={{fontSize:12,opacity:.8,margin:"4px 0 12px"}}>โหมดทดลองเฉพาะในเครื่อง: ไม่บันทึก ไม่ส่ง LINE ไม่ใช้เป็นราคารับจริง และไม่ปรับ V2.7</p>
  {expanded&&<>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:12}}>
    <label style={{display:"grid",gap:4,fontSize:13}}>รหัสรายการ PriceBook (จำลอง)<input value={form.entryId??""} onChange={e=>change("entryId",e.target.value)} style={{padding:9,borderRadius:8,border:"1px solid #999"}}/></label>
    <Amount label="ราคาขายต่อคาดการณ์" value={form.resale} onChange={v=>change("resale",v)}/>
    <Amount label="กำไรเป้าหมาย" value={form.targetProfit} onChange={v=>change("targetProfit",v)}/>
    <Amount label="ต้นทุนเตรียมขาย" value={form.processing} onChange={v=>change("processing",v)}/>
    <Amount label="เงินสำรองประกัน" value={form.warranty} onChange={v=>change("warranty",v)}/>
    <Amount label="เพดานอ้างอิงตลาด (ถ้ามี)" value={form.marketCeiling} onChange={v=>change("marketCeiling",v)}/>
    <label style={{display:"grid",gap:4,fontSize:13}}>รหัสตำหนิ<input value={defectCode} onChange={e=>setDefectCode(e.target.value)} style={{padding:9,borderRadius:8,border:"1px solid #999"}}/></label>
    <Amount label="ค่าซ่อม" value={repair} onChange={setRepair}/>
    <Amount label="มูลค่าลดลงหลังซ่อม" value={residual} onChange={setResidual}/>
    <label style={{display:"grid",gap:4,fontSize:13}}>วิธีรับสินค้า<select value={form.logistics.method} onChange={e=>change("logistics",{...form.logistics,method:e.target.value as "IN_STORE"|"PARCEL"|"PICKUP",verified:e.target.value==="IN_STORE"})} style={{padding:9,borderRadius:8}}>
      <option value="IN_STORE">หน้าร้าน</option><option value="PARCEL">พัสดุ</option><option value="PICKUP">นัดรับ</option></select></label>
    {form.logistics.method!=="IN_STORE"&&<><label style={{display:"grid",gap:4,fontSize:13}}>จังหวัดต้นทาง<input value={province} onChange={e=>setProvince(e.target.value)} style={{padding:9,borderRadius:8,border:"1px solid #999"}}/></label><Amount label="ค่าขนส่ง" value={transport} onChange={setTransport}/></>}
   </div>
   <div style={{display:"flex",flexWrap:"wrap",gap:16,margin:"12px 0"}}>
    {([["modelConfirmed","ยืนยันรุ่น"],["conditionConfirmed","ตรวจสภาพแล้ว"],["ownershipClear","ตรวจสิทธิ์เจ้าของแล้ว"]] as const).map(([k,label])=><label key={k}><input type="checkbox" checked={form[k]} onChange={e=>change(k,e.target.checked)}/> {label}</label>)}
    {form.logistics.method!=="IN_STORE"&&<label><input type="checkbox" checked={form.logistics.verified===true} onChange={e=>change("logistics",{...form.logistics,verified:e.target.checked})}/> ยืนยันค่าใช้จ่ายต่างจังหวัด</label>}
   </div>
   <div style={{padding:12,borderRadius:10,background:"var(--surface-secondary,#80808015)"}}>
    <strong>เพดานคำนวณ: {money(result.maximumBuy)}</strong>
    <p style={{margin:"5px 0",fontSize:13}}>สถานะ: {result.status==="BLOCKED"?"ระงับ":result.status==="PREVIEW_ONLY"?"จำลองเท่านั้น":"รออนุมัติ"} · ส่ง LINE ไม่ได้ทุกกรณี</p>
    {result.reasons.length>0&&<small>สาเหตุ: {result.reasons.join(", ")}</small>}
   </div>
   <button type="button" onClick={()=>{setForm(initial);setRepair(undefined);setResidual(undefined);setDefectCode("");setProvince("");setTransport(undefined)}} style={{marginTop:10}}>ล้างค่าทดลอง</button>
  </>}
 </section>;
}
