import {supabase} from './supabase';
export type HistoryKind='INVENTORY'|'SALE'|'FIELD';
export type HistoryRow=Record<string,string>;
export const HISTORY_FILE_SPECS:Record<HistoryKind,{title:string;required:string[];allowed:string[]}> = {
 INVENTORY:{title:'ทุนสต๊อก AMPHON System',required:['id','code','name','cost','quantity','sourceType','status'],allowed:['id','code','name','category','condition','sourceType','status','quantity','quantitySold','cost','sellingPrice','grossProfit','createdAt','updatedAt']},
 SALE:{title:'ผลขายจริงและกำไร',required:['id','inventoryCode','itemName','cost','actualUnitPrice','actualProfit','soldAt'],allowed:['id','inventoryItemId','inventoryCode','itemName','category','sourceType','cost','quantity','actualUnitPrice','actualRevenue','actualProfit','actualRoi','stockAgeDays','saleChannel','soldAt']},
 FIELD:{title:'ประวัติรับซื้อนอกสถานที่',required:['id','code','brand','model','buyPrice','status'],allowed:['id','code','inventoryItemId','productType','brand','model','spec','conditionNote','defectNote','buyPrice','approvedBuyPrice','travelExpense','shippingExpense','fieldCommission','repairEstimate','otherExpense','totalCost','status','approvedAt','stockedAt','createdAt']},
};
export function splitHistoryCsv(csv:string):string[][] {
 const rows:string[][]=[];let fields:string[]=[];let field='';let quoted=false;
 for(let i=0;i<csv.length;i++){
  const c=csv[i];
  if(quoted){if(c==='"'&&csv[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
  else if(c==='"'){if(field!=='')throw new Error('CSV_INVALID_QUOTE');quoted=true;}
  else if(c===','){fields.push(field);field='';}
  else if(c==='\n'){fields.push(field.replace(/\r$/,''));rows.push(fields);fields=[];field='';}
  else field+=c;
 }
 if(quoted)throw new Error('CSV_UNCLOSED_QUOTE');
 if(fields.length||field){fields.push(field.replace(/\r$/,''));rows.push(fields)}
 return rows.filter(row=>row.some(c=>c.trim()!==''));
}
export function parseHistoryCostCsv(csv:string):{kind:HistoryKind;rows:HistoryRow[];warnings:string[]}{
 if(csv.length>2_000_000)throw new Error('ไฟล์ใหญ่กว่า 2 MB');
 const parsed=splitHistoryCsv(csv.replace(/^\uFEFF/,''));
 if(parsed.length<2)throw new Error('ไม่มีข้อมูลในไฟล์ CSV');
 const headers=parsed[0].map(s=>s.trim());
 if(new Set(headers).size!==headers.length)throw new Error('มีชื่อคอลัมน์ซ้ำ');
 const candidates=(Object.keys(HISTORY_FILE_SPECS) as HistoryKind[]).filter(kind=>HISTORY_FILE_SPECS[kind].required.every(name=>headers.includes(name)));
 if(candidates.length!==1)throw new Error('ไม่รู้จักรูปแบบไฟล์ กรุณาใช้ไฟล์ CSV ที่ส่งออกจาก AMPHON System');
 const kind=candidates[0],spec=HISTORY_FILE_SPECS[kind],warnings:string[]=[];
 const rows:HistoryRow[]=[];const found=new Set<string>();
 for(let i=1;i<parsed.length;i++){
  const values=parsed[i];
  if(values.length!==headers.length)throw new Error('แถว '+(i+1)+' จำนวนคอลัมน์ไม่ถูกต้อง');
  const raw=Object.fromEntries(headers.map((h,index)=>[h,values[index].trim()]));
  const row=Object.fromEntries(spec.allowed.map(key=>[key,raw[key]??'']));
  const key=kind==='SALE'?row.id:row.code||row.id;
  const name=kind==='INVENTORY'?row.name:kind==='SALE'?row.itemName:[row.brand,row.model].join(' ').trim();
  const amount=Number(kind==='FIELD'?(row.approvedBuyPrice||row.buyPrice):row.cost);
  const qty=Number(row.quantity||1);
  if(!key||!name||!Number.isFinite(amount)||amount<=0||!Number.isInteger(qty)||qty<1)throw new Error('แถว '+(i+1)+' ข้อมูลทุนหรือรหัสรายการไม่ถูกต้อง');
  if(found.has(key))throw new Error('พบรหัสซ้ำในไฟล์: '+key);
  found.add(key);rows.push(row);
 }
 if(!rows.length)throw new Error('ไม่มีรายการสำหรับนำเข้า');
 if(kind==='INVENTORY'){
  const missing=rows.filter(row=>!row.category).length;
  if(missing)warnings.push('สินค้าที่ยังไม่ระบุหมวด '+missing+' รายการ — ต้องจับคู่หมวดก่อนให้ AI ใช้');
  const forfeits=rows.filter(row=>row.sourceType==='FORFEIT').length;
  if(forfeits)warnings.push('รายการหลุดขายฝาก '+forfeits+' รายการ — เก็บแยกจากราคาซื้อปกติ');
 }else if(kind==='SALE'){
  warnings.push('ประวัติขายต้องเชื่อมด้วย inventoryCode เพื่อไม่ให้นับทุนซ้ำ');
 }else{
  const drafts=rows.filter(row=>row.status==='DRAFT').length;
  if(drafts)warnings.push('รับซื้อนอกสถานะ Draft '+drafts+' รายการ — ไม่ใช่หลักฐานซื้อจริง');
 }
 return {kind,rows,warnings};
}
export async function importHistoryCostBatch(kind:HistoryKind,rows:HistoryRow[]){
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 if(rows.length<1||rows.length>100)throw new Error('นำเข้าครั้งละ 1–100 รายการ');
 const {data,error}=await supabase.rpc('ai_buyer_cost_history_import',{p_source_kind:kind,p_rows:rows});
 if(error)throw new Error(error.message);
 return Number(data);
}
export async function loadHistoryCostSummary(){
 if(!supabase)throw new Error('Supabase ไม่ได้เชื่อมต่อ');
 const {data,error}=await supabase.from('ai_buyer_cost_history').select('source_kind,source_status,source_type').limit(2000);
 if(error)throw new Error(error.message);
 const results={INVENTORY:0,SALE:0,FIELD:0};
 for(const row of data||[])if(row.source_kind in results)results[row.source_kind as HistoryKind]++;
 return results;
}
