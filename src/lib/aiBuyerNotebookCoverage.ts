import type {CostHistoryRecord} from './aiBuyerCostLearning';
// Read-only coverage inventory. No inference can authorize a price or LINE response.
export type NotebookBucket={key:string;family:string;cpu:string;gpu:string;count:number;sold:number;
 medianBuy:number|null;minBuy:number|null;maxBuy:number|null;examples:string[];
 kind:'GAMING'|'BUSINESS'|'GENERAL'|'MACBOOK'|'REVIEW';
};
export type NotebookCoverage={inventory:number;matched:number;unknown:number;forfeit:number;
 buckets:NotebookBucket[];excludedNotebooks:number;};
const low=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const notebookModel=/\b(?:tuf|rog|nitro|victus|omen|loq|legion|ideapad|thinkpad|thinkbook|yoga|vivobook|zenbook|expertbook|swift|aspire|latitude|inspiron|precision|elitebook|probook|pavilion|zbook|matebook|modern|katana|cyborg|gf63|gf65|stealth|raider|titan|gram|surface laptop|xps)\b/;
const exclude=/^(?:pc\b|desktop\b|gpu\b|การ์ดจอ|จอ |monitor\b|mainboard\b|motherboard\b|cpu\b|rtx\s?\d+\b|gtx\s?\d+\b|ram\b|ssd\b|keyboard\b|คีย์บอร์ด|ipad\b|iphone\b|imac\b|mac mini\b|mac studio\b)/;
const mac=/\bmacbook\b|แมคบุ๊ค|แมคบุก/;
export function isNotebookCostRecord(r:CostHistoryRecord):boolean{
 if(r.source_kind!=='INVENTORY')return false;
 const n=low(r.product_name),c=low(r.category);
 if(exclude.test(n)||['คอมตั้งโต๊ะ','desktop_pc','การ์ดจอ','จอ','tablet','แท็บเล็ต','โทรศัพท์','โทรศัพท์มือถือ','กล้อง'].includes(c))return false;
 if(mac.test(n))return true;
 if(['โน๊ตบุ๊ค','โน้ตบุ๊ก','notebook','laptop'].includes(c))return true;
 if(/โน๊ตบุ๊ค|โน้ตบุ๊ค|โน้ตบุ๊ก|\bnotebook\b|\blaptop\b/.test(n))return true;
 return (notebookModel.test(n)&&/(?:i[3579]|ryzen|r[3579]\s?\d{3,5}|core|ultra|celeron|pentium|athlon|n100|n200|rtx\s?\d{4}|[48]\/\d{3})/.test(n))
 || (/^(?:hp|asus|acer|lenovo|dell|msi|huawei|samsung|lg|microsoft)\b/.test(n)
   &&/(?:i[3579]\s*(?:gen|g|[- ])\s*\d|ryzen\s*[3579]|r[3579]\s*\d{4,5}|core\s*ultra)/.test(n)
   &&/\b(?:4|8|12|16|24|32|64)\s*[/|]\s*(?:128|256|500|512|1000|1024)\b/.test(n));
}
function extractGpu(n:string):string{
 const m=n.match(/\b(?:rtx|gtx)\s*[- ]?(\d{3,4})\s*(ti|super)?\b/);
 if(m){
  const code=n.slice(m.index??0,(m.index??0)+3).toUpperCase()+m[1]+(m[2]?m[2].toUpperCase():'');
  if(code==='RTX3050'){
   const tail=n.slice((m.index??0)+m[0].length).match(/^\\s*(4|6)\\s*gb\\b/);
   return tail?'RTX3050_'+tail[1]+'GB':'RTX3050_UNSPEC';
  }
  return code;
 }
 const m2=n.match(/(?:^|[/| ])(1050|1050ti|1650|1650ti|1660|1660ti|2050|3050|3050ti|3060|4050|4060|4070|5050|5060|5070)(?=\/|\||\s|$)/);
 if(m2){
  const code=(m2[1].startsWith('1')?'GTX':'RTX')+m2[1].toUpperCase();
  if(code==='RTX3050'){
   const tail=n.slice((m2.index??0)+m2[0].length).match(/^\\s*(4|6)\\s*gb\\b/);
   return tail?'RTX3050_'+tail[1]+'GB':'RTX3050_UNSPEC';
  }
  return code;
 }
 return 'INTEGRATED_OR_UNKNOWN';
}
function cpu(n:string):string{
 const intel=n.match(/\bi\s*([3579])\s*(?:gen\s*|g\s*)(\d{1,2})\b/);
 if(intel)return 'i'+intel[1]+' Gen '+Number(intel[2]);
 const chip=n.match(/\bi([3579])[- ]?(\d{4,5})[a-z]{0,3}\b/);
 if(chip){const digits=chip[2];const gen=digits.length===5?Number(digits.slice(0,2)):Number(digits.slice(0,2))>=10&&Number(digits.slice(0,2))<=14?Number(digits.slice(0,2)):Number(digits.slice(0,1));
  return 'i'+chip[1]+' Gen '+gen;
 }
 const ultra=n.match(/\b(?:core\s*)?ultra\s*([3579])\s*[- ]?(\d{3})\b/);
 if(ultra)return 'Core Ultra '+ultra[1]+' Series '+Math.floor(Number(ultra[2])/100);
 const core=n.match(/\bcore\s*([3579])\s*[- ]?(\d{3})[a-z]{0,2}\b/);
 if(core)return 'Core '+core[1]+' '+core[2];
 const ryzen=n.match(/\b(?:ryzen\s*|r)([3579])\s*[- ]?(\d{4,5})[a-z]{0,3}\b/);
 if(ryzen)return 'Ryzen '+ryzen[1]+' '+ryzen[2][0]+'000 Series';
 const vague=n.match(/\bryzen\s*([3579])\s*(\d000s?)\b/);
 if(vague)return 'Ryzen '+vague[1]+' '+vague[2].slice(0,1)+'000 Series (unverified)';
 if(/\b(?:celeron|pentium|athlon|n100|n200|n4000|n4020|n4120)\b/.test(n))return 'Entry / Celeron / Pentium';
 const apple=n.match(/\bm\s*([1-5])\s*(pro|max|ultra)?\b/);
 if(mac.test(n)&&apple)return 'Apple M'+apple[1]+(apple[2]?' '+apple[2].toUpperCase():'');
 return 'CPU UNKNOWN';
}
function med(a:number[]){if(!a.length)return null;const x=[...a].sort((m,n)=>m-n);const p=Math.floor(x.length/2);return x.length%2?x[p]:Math.round((x[p-1]+x[p])/2)}
// Explicit fallback coverage catalog even when zero examples exist in historical stock.
// Unknown group prices remain null and must be supplied/approved by Owner.
export const NOTEBOOK_PRICE_TAXONOMY=(()=>{
 const groups:{kind:NotebookBucket['kind'];cpu:string;gpu:string;family:string}[]=[];
 for(const rank of [3,5,7,9])for(let gen=4;gen<=14;gen++)
  groups.push({kind:'GENERAL',cpu:'i'+rank+' Gen '+gen,gpu:'INTEGRATED_OR_UNKNOWN',family:'Windows / General'});
 for(const rank of [3,5,7,9])for(const series of [1,2,3])
  groups.push({kind:'GENERAL',cpu:'Core Ultra '+rank+' Series '+series,gpu:'INTEGRATED_OR_UNKNOWN',family:'Windows / General'});
 for(const rank of [3,5,7,9])for(let series=2;series<=9;series++)
  groups.push({kind:'GENERAL',cpu:'Ryzen '+rank+' '+series+'000 Series',gpu:'INTEGRATED_OR_UNKNOWN',family:'Windows / General'});
 for(const generation of [1,2,3,4,5])
  groups.push({kind:'MACBOOK',cpu:'Apple M'+generation,gpu:'INTEGRATED_OR_UNKNOWN',family:'MacBook'});
 for(const gpu of ['GTX1050','GTX1050TI','GTX1060','GTX1650','GTX1650TI','GTX1660TI',
  'RTX2050','RTX3050_4GB','RTX3050_6GB','RTX3050_UNSPEC','RTX3050TI','RTX3060','RTX3070','RTX3080',
  'RTX4050','RTX4060','RTX4070','RTX4080','RTX4090',
  'RTX5050','RTX5060','RTX5070','RTX5080','RTX5090'])
  groups.push({kind:'GAMING',cpu:'CPU ตามรุ่น (ต้องตรวจ)',gpu,family:'Gaming GPU'});
 groups.push({kind:'GENERAL',cpu:'Entry / Celeron / Pentium',gpu:'INTEGRATED_OR_UNKNOWN',family:'Windows / General'});
 return groups;
})();
export function analyzeNotebookCoverage(records:CostHistoryRecord[]):NotebookCoverage{
 const sold=new Set(records.filter(r=>r.source_kind==='SALE'&&r.inventory_code).map(r=>r.inventory_code));
 const all=records.filter(isNotebookCostRecord);
 const byCode=new Map<string,CostHistoryRecord>();for(const r of all)if(!byCode.has(r.inventory_code||r.source_key))byCode.set(r.inventory_code||r.source_key,r);
 const pool=[...byCode.values()];
 const buckets=new Map<string,{family:string;cpu:string;gpu:string;kind:NotebookBucket['kind'];rows:CostHistoryRecord[]}>();
 let unknown=0;
 for(const r of pool){
  const n=low(r.product_name);
  const chip=cpu(n),gpu=extractGpu(n);
  const family=mac.test(n)?'MacBook':gpu!=='INTEGRATED_OR_UNKNOWN'?'Gaming GPU':/thinkpad|latitude|elitebook|probook|expertbook|precision|zbook|thinkbook/.test(n)?'Business / Workstation':'Windows / General';
  const kind:NotebookBucket['kind']=family==='MacBook'?'MACBOOK':family==='Gaming GPU'?'GAMING':family==='Business / Workstation'?'BUSINESS':'GENERAL';
  const uncertain=chip==='CPU UNKNOWN'||(gpu==='INTEGRATED_OR_UNKNOWN'&&/(?:gaming|nitro|tuf|rog|legion|loq|victus)/.test(n));
  if(uncertain)unknown++;
  const safeKind=uncertain?'REVIEW':kind;
  const key=[safeKind,chip,gpu].join('|');
  const value=buckets.get(key)??{family,cpu:chip,gpu,kind:safeKind,rows:[]};
  value.rows.push(r);buckets.set(key,value);
 }
 // Present zero-evidence families as explicit gaps; never impute cost or opening price.
 for(const target of NOTEBOOK_PRICE_TAXONOMY){
  const key=[target.kind,target.cpu,target.gpu].join('|');
  if(!buckets.has(key))buckets.set(key,{family:target.family,cpu:target.cpu,gpu:target.gpu,kind:target.kind,rows:[]});
 }
  const output=[...buckets].map(([key,v])=>{
  // Only verified PURCHASE acquisitions with no defect signals can form descriptive medians.
  const prices=v.rows.filter(r=>r.source_type==='PURCHASE'&&Number(r.buy_cost)>0
    &&!/เสีย|ซาก|น้ำเข้า|เปิดไม่ติด|จอแตก|ล๊อค|ล็อค|อะไหล่|ตำหนิ/.test(low(r.product_name+' '+String(r.details?.condition??''))))
    .map(r=>Number(r.buy_cost));
  return {key,family:v.family,cpu:v.cpu,gpu:v.gpu,count:v.rows.length,
   sold:v.rows.filter(r=>sold.has(r.inventory_code)).length,medianBuy:med(prices),
   minBuy:prices.length?Math.min(...prices):null,maxBuy:prices.length?Math.max(...prices):null,
   examples:v.rows.slice(0,3).map(r=>r.product_name),kind:v.kind} satisfies NotebookBucket;
 }).sort((a,b)=>({GAMING:0,GENERAL:1,BUSINESS:2,MACBOOK:3,REVIEW:4}[a.kind]-{GAMING:0,GENERAL:1,BUSINESS:2,MACBOOK:3,REVIEW:4}[b.kind])||b.count-a.count||a.cpu.localeCompare(b.cpu)||a.gpu.localeCompare(b.gpu));
 return {inventory:pool.length,matched:pool.length-unknown,unknown,
  forfeit:pool.filter(r=>r.source_type==='FORFEIT').length,buckets:output,excludedNotebooks:records.filter(r=>r.source_kind==='INVENTORY').length-pool.length};
}
