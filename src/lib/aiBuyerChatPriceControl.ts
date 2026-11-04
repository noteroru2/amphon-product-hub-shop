import type {Pb28Entry} from './priceBookV28Admin';

export type ChatPriceChange={
 category?:string;brand?:string;model:string;model_code?:string;condition_key?:string;
 estimated_resale?:number;opening_offer?:number;target_buy?:number;hard_max?:number;
 note?:string;
};
export type ChatPriceProposal={version:1;instruction?:string;items:ChatPriceChange[]};
export type ChatPricePrepared={
 category:string;brand:string;model:string;model_code:string;condition_key:string;
 estimated_resale:number;opening_offer:number;target_buy:number;hard_max:number;
 active:false;note:string;
 expected_entry_id:string|null;expected_updated_at:string|null;
 expected_estimated_resale:number|null;expected_opening_offer:number|null;
 expected_target_buy:number|null;expected_hard_max:number|null;
};
export type ChatPricePreview={before:Pb28Entry|null;after:ChatPricePrepared;changed:string[]};
const numeric=['estimated_resale','opening_offer','target_buy','hard_max'] as const;
const identity=['category','brand','model','model_code','condition_key'] as const;
function trim(s:unknown){return typeof s==='string'?s.trim():''}
function norm(s:string){return s.trim().toLocaleLowerCase()}
export function parseChatPriceProposal(text:string):ChatPriceProposal{
 if(text.length>12000)throw new Error('ข้อความยาวเกินไป กรุณาปรับทีละไม่เกิน 20 รุ่น');
 let raw=text.trim();
 const fenced=raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
 if(fenced)raw=fenced[1];
 let data:unknown;
 try{data=JSON.parse(raw)}catch{throw new Error('กรุณาวางชุดราคา JSON ที่ผมจัดให้จากแชทนี้ (ไม่ใช่ข้อความคำสั่งทั่วไป)')}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('รูปแบบชุดราคาไม่ถูกต้อง');
 const body=data as Record<string,unknown>;
 if(body.version!==1||!Array.isArray(body.items)||body.items.length<1||body.items.length>20)throw new Error('ชุดราคาต้องเป็น version 1 และมี 1–20 รายการ');
 if(body.instruction!==undefined&&(typeof body.instruction!=='string'||body.instruction.length>2000))throw new Error('คำสั่งยาวเกินไป');
 const items:ChatPriceChange[]=[];
 for(let i=0;i<body.items.length;i++){
  const r=body.items[i];
  if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('รูปแบบรายการ '+(i+1)+' ไม่ถูกต้อง');
  const v=r as Record<string,unknown>;
  const allowed=new Set(['category','brand','model','model_code','condition_key','estimated_resale','opening_offer','target_buy','hard_max','note']);
  if(Object.keys(v).some(k=>!allowed.has(k)))throw new Error('รายการ '+(i+1)+' มีฟิลด์ที่ไม่อนุญาต');
  if(!trim(v.model)||trim(v.model).length>180)throw new Error('ระบุชื่อรุ่นสำหรับรายการ '+(i+1));
  const item:ChatPriceChange={model:trim(v.model)};
  for(const k of ['category','brand','model_code','condition_key','note'] as const){
   if(v[k]!==undefined){if(typeof v[k]!=='string')throw new Error('รูปแบบ '+k+' ผิด');item[k]=trim(v[k])}
  }
  for(const key of numeric){
   if(v[key]!==undefined){
    if(typeof v[key]!=='number'||!Number.isFinite(v[key])||v[key]<0||v[key]>10000000)
     throw new Error('ราคา '+key+' ในรายการ '+(i+1)+' ไม่ถูกต้อง');
    item[key]=v[key];
   }
  }
  items.push(item);
 }
 return {version:1,instruction:typeof body.instruction==='string'?body.instruction:'',items};
}
export function prepareChatPriceDiff(proposal:ChatPriceProposal,existing:Pb28Entry[]):ChatPricePreview[]{
 const used=new Set<string>();
 return proposal.items.map((item,i)=>{
  // Allow a short model-only update only when it resolves to exactly one row in selected Draft.
  const matches=existing.filter(e=>norm(e.model)===norm(item.model)
   &&(item.category===undefined||norm(e.category)===norm(item.category))
   &&(item.brand===undefined||norm(e.brand)===norm(item.brand))
   &&(item.model_code===undefined||norm(e.model_code)===norm(item.model_code))
   &&(item.condition_key===undefined||norm(e.condition_key)===norm(item.condition_key)));
  if(matches.length>1)throw new Error('รุ่น '+item.model+' มีหลายสเปกใน Draft กรุณาระบุยี่ห้อ/รหัสรุ่น/สภาพเพื่อไม่ให้ปรับผิดรุ่น');
  const before=matches[0]??null;
  if(!before&&(!item.category||!item.brand))throw new Error('รุ่นใหม่ '+item.model+' ต้องระบุ category และ brand');
  const key=identity.map(k=>norm(String(item[k]??before?.[k]??(k==='condition_key'?'NORMAL':'')))).join('|');
  if(used.has(key))throw new Error('มีรายการปรับซ้ำ: '+item.model);
  used.add(key);
  const prices=Object.fromEntries(numeric.map(k=>[k,item[k]??before?.[k]])) as Record<(typeof numeric)[number],number|undefined>;
  if(numeric.some(k=>prices[k]===undefined))throw new Error('รุ่นใหม่ '+item.model+' ต้องระบุราคาขายต่อ ราคาเปิดรับ เป้าหมาย และเพดานทั้งหมด');
  const [r,o,t,h]=numeric.map(k=>prices[k] as number);
  if(!(r>0&&o>=0&&o<=t&&t<=h&&h<=r))throw new Error('ลำดับราคาผิดใน '+item.model+': เปิดรับ ≤ เป้าหมาย ≤ เพดาน ≤ ขายต่อ');
  const after:ChatPricePrepared={
   category:item.category??before?.category??'',brand:item.brand??before?.brand??'',model:before?.model??item.model,
   model_code:item.model_code??before?.model_code??'',condition_key:item.condition_key??before?.condition_key??'NORMAL',
   estimated_resale:r,opening_offer:o,target_buy:t,hard_max:h,active:false,
   note:item.note??before?.note??'Chat Price Control — owner reviewed',
   expected_entry_id:before?.id??null,expected_updated_at:before?.updated_at??null,
   expected_estimated_resale:before?.estimated_resale??null,
   expected_opening_offer:before?.opening_offer??null,
   expected_target_buy:before?.target_buy??null,
   expected_hard_max:before?.hard_max??null
  };
  if(after.note.length>800)throw new Error('หมายเหตุยาวเกินไป: '+item.model);
  const changed:string[]=numeric.filter(k=>before?.[k]!==after[k]);
  if(!before)changed.unshift('NEW_ENTRY');
  if(!changed.length)throw new Error('รายการ '+(i+1)+' ไม่มีราคาเปลี่ยนแปลง');
  return {before,after,changed};
 });
}
