import {extractStructuredSpecs,type StructuredSpecs} from './aiBuyerStructuredSpecs';
// AI Buyer Cost Learning V1: read-only evidence, never an autonomous pricing authority.
// Strict model matching deliberately keeps RAM/SSD/CPU variants separated.
export type CostHistoryRecord = {
 source_kind: 'INVENTORY'|'SALE'|'FIELD';source_key:string;inventory_code:string;
 product_name:string;category:string;source_type:string;source_status:string;
 buy_cost:number;actual_sale:number|null;actual_profit:number|null;quantity:number;
 occurred_at:string|null;details:Record<string,unknown>|null;
};
export type CostLearningCohort = {
 id:string;model:string;rawCategory:string;pricebookCategory:string;brand:string;
 structured:StructuredSpecs;matchMethod:'STRICT_NAME'|'STRUCTURED_EXACT';
 purchaseSamples:number;soldItems:number;saleEvents:number;
 buyMedian:number;soldBuyMedian:number|null;saleMedian:number|null;
 realizedGrossSpreadMedian:number|null;actualProfitMedian:number|null;daysToSellMedian:number|null;
 lastSaleAt:string|null;inventoryCodes:string[];evidenceKeys:string[];
 qualified:boolean;reason:string;estimatedResale:number|null;
 openingOffer:number|null;targetBuy:number|null;hardMax:number|null;
};
export type LearningSummary={
 inventory:number;sales:number;field:number;forfeit:number;fieldDraft:number;uncategorized:number;
 saleMatched:number;saleUnmatched:number;saleForfeit:number;
 cohorts:number;qualified:number;structuredComplete:number;structuredPartial:number;structuredUnknown:number;canonicalizedCohorts:number;
};
export type LearningReport={summary:LearningSummary;cohorts:CostLearningCohort[]};

function median(numbers:number[]):number|null{
 const xs=numbers.filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
 if(xs.length===0)return null;
 const m=Math.floor(xs.length/2);
 return xs.length%2===1?xs[m]:Math.round((xs[m-1]+xs[m])/2);
}
function asNumber(value:unknown){const n=Number(value);return Number.isFinite(n)?n:null;}
export function normalizeCostModel(name:string):string{
 return (name||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
}
export function mapCostHistoryCategory(raw:string,model:string):string{
 const category=normalizeCostModel(raw),name=normalizeCostModel(model);
 if(/macbook|แมคบุ๊ค|แมคบุก/.test(name))return 'MACBOOK';
 if(/iphone|ไอโฟน/.test(name))return 'SMARTPHONE';
 if(/ipad|ไอแพด/.test(name))return 'TABLET';
 if(['โน๊ตบุ๊ค','โน้ตบุ๊ก','notebook','gaming notebook','laptop'].includes(category))return 'NOTEBOOK';
 if(['คอมตั้งโต๊ะ','คอมพิวเตอร์ตั้งโต๊ะ','gaming pc','desktop','desktop_pc'].includes(category))return 'DESKTOP_PC';
 if(['กล้อง','camera','lens'].includes(category))return 'CAMERA';
 if(['แท็บเล็ต','tablet'].includes(category))return 'TABLET';
 if(['โทรศัพท์','โทรศัพท์มือถือ','smartphone','iphone'].includes(category))return 'SMARTPHONE';
 return 'OTHER';
}
export function inferCostBrand(name:string):string{
 const normalized=normalizeCostModel(name);
 const brands:[RegExp,string][]=[
 [/^(lenovo)\b/,'Lenovo'],[/^(asus)\b/,'ASUS'],[/^(acer)\b/,'Acer'],[/^(dell)\b/,'Dell'],
 [/^(hp)\b/,'HP'],[/^(msi)\b/,'MSI'],[/^(apple|macbook|iphone|ipad)\b/,'Apple'],
 [/^(canon)\b/,'Canon'],[/^(fujifilm|fuji)\b/,'Fujifilm'],[/^(nikon)\b/,'Nikon'],
 [/^(sony|ps5|playstation)\b/,'Sony'],[/^(samsung)\b/,'Samsung'],[/^(gigabyte)\b/,'Gigabyte'],
 [/^(jbl)\b/,'JBL'],[/^(wd|western digital)\b/,'Western Digital'],
 ];
 return brands.find(([pattern])=>pattern.test(normalized))?.[1]??'';
}
const round100=(n:number)=>Math.floor(Math.max(0,n)/100)*100;

export function analyzeCostHistory(records:CostHistoryRecord[],now=new Date()):LearningReport{
 const inventories=records.filter(x=>x.source_kind==='INVENTORY'),sales=records.filter(x=>x.source_kind==='SALE'),fields=records.filter(x=>x.source_kind==='FIELD');
 const byCode=new Map(inventories.filter(x=>x.inventory_code).map(x=>[x.inventory_code,x]));
 const soldByCode=new Map<string,CostHistoryRecord[]>();
 for(const sale of sales){
  if(!sale.inventory_code)continue;
  const list=soldByCode.get(sale.inventory_code)??[];list.push(sale);soldByCode.set(sale.inventory_code,list);
 }
 const buckets=new Map<string,CostHistoryRecord[]>();
 const parsedByCode=new Map<string,StructuredSpecs>();
 for(const item of inventories){
  if(item.source_type!=='PURCHASE'||!(Number(item.buy_cost)>0)||!item.product_name?.trim()||!item.category?.trim())continue;
  const parsed=extractStructuredSpecs(item.product_name,mapCostHistoryCategory(item.category,item.product_name));
  parsedByCode.set(item.inventory_code,parsed);
  // Structured equivalence only for known complete model/spec and identical condition labels.
  // Otherwise retain exact-name matching; no fuzzy model mixing or synthetic prices.
  const condition=normalizeCostModel(String(item.details?.condition??''));
  const key=parsed.canonicalKey
   ?'SPEC|'+parsed.canonicalKey+'|CONDITION='+condition
   :'NAME|'+normalizeCostModel(item.category)+'|'+normalizeCostModel(item.product_name);
  const list=buckets.get(key)??[];list.push(item);buckets.set(key,list);
 }
 const cohorts:CostLearningCohort[]=[];
 for(const [key,items] of buckets){
  const itemSales=items.map(item=>({item,sales:(soldByCode.get(item.inventory_code)??[]).filter(s=>Number(s.actual_sale)>0&&Number(s.quantity)>0)}));
  const completed=itemSales.filter(x=>x.sales.length>0);
  const saleEvents=completed.reduce((sum,x)=>sum+x.sales.length,0);
  const buyMedian=median(items.map(x=>Number(x.buy_cost)))??0;
  const soldBuyMedian=median(completed.map(x=>Number(x.item.buy_cost)));
  // One vote per physical inventory record, even when a stock code has many sale events.
  const unitSalePrices=completed.map(({sales:events})=>{
   const units=events.reduce((s,e)=>s+Number(e.quantity),0);
   return events.reduce((s,e)=>s+Number(e.actual_sale)*Number(e.quantity),0)/units;
  });
  const saleMedian=median(unitSalePrices);
  const spreads=completed.map(({item,sales:events},idx)=>{
   const totalExpense=0; // no verified refurb/shipping expense in general inventory snapshots
   return unitSalePrices[idx]-Number(item.buy_cost)-totalExpense;
  });
  const spreadMedian=median(spreads);
  // Actual profitability may include concessions absent from the inventory snapshot.
  // Price suggestions require verified positive recorded profit on independent sold items.
  const profitPerItem=completed.map(({sales:events})=>{
   if(events.some(e=>e.actual_profit===null||!Number.isFinite(Number(e.actual_profit))))return null;
   const units=events.reduce((sum,e)=>sum+Number(e.quantity),0);
   return units>0?events.reduce((sum,e)=>sum+Number(e.actual_profit),0)/units:null;
  });
  const actualProfitMedian=median(profitPerItem.filter((n):n is number=>n!==null));
  const confirmedProfitable=profitPerItem.length>=3&&profitPerItem.every(n=>n!==null&&n>0);
  const days=completed.map(x=>median(x.sales.map(s=>asNumber(s.details?.stock_age_days)).filter((n):n is number=>n!==null))).filter((n):n is number=>n!==null&&n>=0);
  const lastSaleAt=completed.flatMap(x=>x.sales.map(s=>s.occurred_at).filter((v):v is string=>Boolean(v))).sort().at(-1)??null;
  const freshness=lastSaleAt!==null&&new Date(lastSaleAt).getTime()>=now.getTime()-180*86400000&&new Date(lastSaleAt).getTime()<=now.getTime()+86400000;
  const validSale=saleMedian!==null&&saleMedian>0;
  const distinct=completed.length;
  // Even exact legacy names are not sufficient for automated numeric suggestions
  // if CPU/RAM/SSD/model-family or condition remains uncertain.
  const specsVerified=items.every(item=>parsedByCode.get(item.inventory_code)?.confidence==='COMPLETE');
  const qualified=items.length>=3&&distinct>=3&&specsVerified&&freshness&&validSale&&spreadMedian!==null&&spreadMedian>0&&confirmedProfitable;
  const reason=qualified?'ผ่านเกณฑ์ขั้นต่ำ 3 เครื่องซื้อจริงและขายจริงใน 180 วัน (ยังต้องตรวจราคาตลาด)':
    items.length<3||distinct<3?'หลักฐานเครื่องที่ซื้อและขายจริงยังไม่ถึง 3 รหัสสินค้า':
    !specsVerified?'สเปกหรือสภาพไม่ครบถ้วน ต้องตรวจด้วยคนก่อน':!freshness?'ไม่มีหลักฐานขายภายใน 180 วัน':!validSale?'ยังไม่มีราคาขายจริงที่ตรวจได้':!confirmedProfitable?'กำไรจริงไม่ครบหรือไม่เป็นบวกทุกเครื่อง':'ผลต่างทุน–ขายไม่เป็นบวก';
  let estimatedResale:number|null=null,openingOffer:number|null=null,targetBuy:number|null=null,hardMax:number|null=null;
  if(qualified&&saleMedian!==null&&soldBuyMedian!==null){
   estimatedResale=round100(saleMedian);
   hardMax=round100(Math.min(soldBuyMedian*1.05,estimatedResale*.78));
   targetBuy=round100(Math.min(soldBuyMedian,hardMax));
   openingOffer=round100(targetBuy*.92);
   if(!(estimatedResale>0&&hardMax>=targetBuy&&targetBuy>=openingOffer&&targetBuy>0)){
    estimatedResale=null;hardMax=null;targetBuy=null;openingOffer=null;
   }
  }
  cohorts.push({
   id:key,model:items[0].product_name,rawCategory:items[0].category,
   structured:parsedByCode.get(items[0].inventory_code)??extractStructuredSpecs(items[0].product_name,mapCostHistoryCategory(items[0].category,items[0].product_name)),
   matchMethod:key.startsWith('SPEC|')?'STRUCTURED_EXACT':'STRICT_NAME',
   pricebookCategory:mapCostHistoryCategory(items[0].category,items[0].product_name),
   brand:inferCostBrand(items[0].product_name),
   purchaseSamples:items.length,soldItems:distinct,saleEvents,buyMedian,soldBuyMedian,
   saleMedian,realizedGrossSpreadMedian:spreadMedian,actualProfitMedian,daysToSellMedian:median(days),lastSaleAt,
   inventoryCodes:items.map(i=>i.inventory_code),evidenceKeys:completed.flatMap(x=>x.sales.map(s=>s.source_key)),
   qualified:qualified&&hardMax!==null,reason,
   estimatedResale,openingOffer,targetBuy,hardMax
  });
 }
 cohorts.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||b.soldItems-a.soldItems||b.saleEvents-a.saleEvents||b.purchaseSamples-a.purchaseSamples||a.model.localeCompare(b.model));
 const summary:LearningSummary={
  inventory:inventories.length,sales:sales.length,field:fields.length,
  forfeit:inventories.filter(x=>x.source_type==='FORFEIT').length,
  fieldDraft:fields.filter(x=>x.source_status==='DRAFT').length,
  uncategorized:inventories.filter(x=>!x.category?.trim()).length,
  saleMatched:sales.filter(x=>byCode.has(x.inventory_code)).length,
  saleUnmatched:sales.filter(x=>!byCode.has(x.inventory_code)).length,
  saleForfeit:sales.filter(x=>byCode.get(x.inventory_code)?.source_type==='FORFEIT').length,
  cohorts:cohorts.length,qualified:cohorts.filter(x=>x.qualified).length,
  structuredComplete:[...parsedByCode.values()].filter(x=>x.confidence==='COMPLETE').length,
  structuredPartial:[...parsedByCode.values()].filter(x=>x.confidence==='PARTIAL').length,
  structuredUnknown:[...parsedByCode.values()].filter(x=>x.confidence==='UNKNOWN').length,
  canonicalizedCohorts:cohorts.filter(x=>x.matchMethod==='STRUCTURED_EXACT').length,
 };
 return {summary,cohorts};
}
