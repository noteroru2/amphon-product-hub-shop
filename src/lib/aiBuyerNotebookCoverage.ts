import type {CostHistoryRecord} from './aiBuyerCostLearning';
// Read-only coverage inventory. No inference can authorize a price or LINE response.
export type NotebookBucket={key:string;family:string;cpu:string;gpu:string;count:number;sold:number;
 medianBuy:number|null;minBuy:number|null;maxBuy:number|null;examples:string[];
 kind:'GAMING'|'BUSINESS'|'GENERAL'|'MACBOOK'|'REVIEW';
};
export type NotebookCoverage={inventory:number;matched:number;unknown:number;forfeit:number;
 buckets:NotebookBucket[];excludedNotebooks:number;};
const low=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const gaming=/(?:rtx|gtx)\s*[- ]?\d{3,4}|\b(?:16[56]0|1050|20[67]0|30[5678]0|40[5678]0|50[5678]0)\s*ti?\b/i;
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
 return notebookModel.test(n)&&/(?:i[3579]|ryzen|r[3579]\s?\d{3,5}|core|ultra|celeron|pentium|athlon|n100|n200|[48]\/\d{3})/.test(n);
}
function extractGpu(n:string):string{
 const m=n.match(/\b(?:rtx|gtx)\s*[- ]?(\d{3,4})\s*(ti|super)?\b/);
 if(m)return n.slice(m.index??0,(m.index??0)+3).toUpperCase()+m[1]+(m[2]?m[2].toUpperCase():'');
 const m2=n.match(/(?:^|[/| ])(1050|1050ti|1650|1650ti|1660|1660ti|2050|3050|3050ti|3060|4050|4060|4070|5050|5060|5070)(?=\/|\||\s|$)/);
 if(m2)return (m2[1].startsWith('1')?'GTX':'RTX')+m2[1].toUpperCase();
 return 'INTEGRATED_OR_UNKNOWN';
}
function cpu(n:string):string{
 const intel=n.match(/\bi\s*([3579])\s*(?:gen\s*|g\s*)(\d{1,2})\b/);
 if(intel)return 'i'+intel[1]+' Gen '+Number(intel[2]);
 const chip=n.match(/\bi([3579])[- ]?(\d{4,5})[a-z]{0,3}\b/);
 if(chip){const digits=chip[2];const gen=digits.length===5?Number(digits.slice(0,2)):Number(digits.slice(0,1))<=6?Number(digits.slice(0,1)):Number(digits.slice(0,2));
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
 const output=[...buckets].map(([key,v])=>{
  // Only verified PURCHASE acquisitions with no defect signals can form descriptive medians.
  const prices=v.rows.filter(r=>r.source_type==='PURCHASE'&&Number(r.buy_cost)>0
    &&!/เสีย|ซาก|น้ำเข้า|เปิดไม่ติด|จอแตก|ล๊อค|ล็อค|อะไหล่|ตำหนิ/.test(low(r.product_name+' '+String(r.details?.condition??''))))
    .map(r=>Number(r.buy_cost));
  return {key,family:v.family,cpu:v.cpu,gpu:v.gpu,count:v.rows.length,
   sold:v.rows.filter(r=>sold.has(r.inventory_code)).length,medianBuy:med(prices),
   minBuy:prices.length?Math.min(...prices):null,maxBuy:prices.length?Math.max(...prices):null,
   examples:v.rows.slice(0,3).map(r=>r.product_name),kind:v.kind} satisfies NotebookBucket;
 }).sort((a,b)=>({GAMING:0,GENERAL:1,BUSINESS:2,MACBOOK:3,REVIEW:4}[a.kind]-{GAMING:0,GENERAL:1,BUSINESS:2,MACBOOK:3,REVIEW:4}[b.kind])||b.count-a.count);
 return {inventory:pool.length,matched:pool.length-unknown,unknown,
  forfeit:pool.filter(r=>r.source_type==='FORFEIT').length,buckets:output,excludedNotebooks:records.filter(r=>r.source_kind==='INVENTORY').length-pool.length};
}
