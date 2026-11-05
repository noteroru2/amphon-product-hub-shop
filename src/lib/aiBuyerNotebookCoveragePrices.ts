import type {NotebookGapBatch} from './aiBuyerNotebookGapRules';
import type {NotebookBucket} from './aiBuyerNotebookCoverage';
import type {NotebookSpecOfferBatch,NotebookSpecOfferRule} from './aiBuyerNotebookRuleBatches';
import type {OfficeNotebookRuleBatch,OfficeNotebookRule} from './aiBuyerOfficeNotebookRules';
import type {BusinessNotebookRuleBatch,BusinessNotebookRule} from './aiBuyerBusinessNotebookRules';
export type CoveragePriceMatch={low:number|null;high:number|null;status:'APPROVED_DRAFT'|'PENDING';source:'Gaming'|'Office'|'Business'|'Historical Gap';rule:string;warning:string};
type Row={low:number|null;high:number|null;status:'APPROVED_DRAFT'|'PENDING';source:CoveragePriceMatch['source'];rule:string;warning:string};
const normalized=(s:string)=>s.toUpperCase().replace(/\s+/g,'').replace(/–/g,'-');
function cpuRankGen(s:string):{rank:number;gen:number}|null{
 const m=s.match(/^i([3579]) Gen (\d{1,2})$/);return m?{rank:Number(m[1]),gen:Number(m[2])}:null;
}
function belongs(cpu:string,target:string):boolean{
 const a=cpuRankGen(cpu);
 if(a){
  const m=target.match(/^i([3579]) Gen (\d+)(?:[–-](\d+))?$/);
  if(m)return a.rank===Number(m[1])&&a.gen>=Number(m[2])&&a.gen<=Number(m[3]??m[2]);
 }
 if(/^Ryzen [3579] \d000 Series(?: \(unverified\))?$/.test(cpu)){
  const m=cpu.match(/^Ryzen ([3579]) (\d)000/);
  const t=target.match(/^Ryzen ([3579]) (\d)000$/);
  if(m&&t)return m[1]===t[1]&&m[2]===t[2];
 }
 return normalized(cpu)===normalized(target);
}
const latest=<T extends {status:string;created_at:string}>(b:T[])=>[...b].filter(x=>x.status==='PENDING'||x.status==='APPROVED_DRAFT').sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())[0];
function office(b:NotebookBucket,r:OfficeNotebookRule):boolean{
 if(b.kind!=='GENERAL'||b.gpu!=='INTEGRATED_OR_UNKNOWN')return false;
 const cpu=r.cpu;
 if(cpu==='Core 3 / Core 5 รุ่นใหม่')return /^Core [35] \d+$/.test(b.cpu);
 if(cpu==='Core 7 รุ่นใหม่')return /^Core 7 \d+$/.test(b.cpu);
 if(cpu==='Core Ultra Series 2+')return /^Core Ultra [3579] Series [23]$/.test(b.cpu);
 if(cpu==='Core Ultra 5 Series 1'||cpu==='Core Ultra 7 Series 1')return b.cpu===cpu;
 return belongs(b.cpu,cpu);
}
function business(b:NotebookBucket,r:BusinessNotebookRule):boolean{
 if(b.kind!=='BUSINESS'||b.gpu!=='INTEGRATED_OR_UNKNOWN')return false;
 const cpu=r.cpu;
 if(cpu==='Workstation ZBook / Precision / ThinkPad P')return false; // Model identity absent from bucket.
 if(cpu==='i5 / Core 5 รุ่นใหม่')return /^Core 5 \d+$/.test(b.cpu);
 if(cpu==='Core Ultra 5'||cpu==='Core Ultra 7')return b.cpu.startsWith(cpu+' Series ');
 return belongs(b.cpu,cpu);
}
function gaming(b:NotebookBucket,r:NotebookSpecOfferRule):boolean{
 if(b.kind!=='GAMING'||b.cpu==='CPU ตามรุ่น (ต้องตรวจ)'||!r.gpu.includes(b.gpu))return false;
 const cpu=b.cpu;
 const rank=cpuRankGen(cpu);
 const spec=r.cpu;
 if(rank){
  const m=spec.match(/^(i[3579](?:\/i[3579])?) Gen (\d+)(?:[–-](\d+))?/);
  if(!m)return false;
  const ranks=m[1].split('/').map(x=>Number(x.slice(1)));
  return ranks.includes(rank.rank)&&rank.gen>=Number(m[2])&&rank.gen<=Number(m[3]??m[2]);
 }
 const ryzen=cpu.match(/^Ryzen ([3579]) (\d)000 Series/);
 if(ryzen&&/Ryzen [3579]/.test(spec))return spec.includes('Ryzen '+ryzen[1]);
 return false;
}
export function matchNotebookCoveragePrice(b:NotebookBucket,sources:{
 gaming:NotebookSpecOfferBatch[];office:OfficeNotebookRuleBatch[];business:BusinessNotebookRuleBatch[];gaps?:NotebookGapBatch[]
}):CoveragePriceMatch|null{
 if(b.kind==='REVIEW'||b.kind==='MACBOOK')return null;
 const rows:Row[]=[];
 const g=latest(sources.gaming);
 if(g)for(const r of g.rules)if(gaming(b,r))rows.push({
  low:r.opening_min,high:r.opening_max,status:g.status as Row['status'],source:'Gaming',rule:r.spec,
  warning:'ตรง CPU/GPU เบื้องต้นเท่านั้น ต้องยืนยัน RAM, SSD, VRAM และสภาพเครื่องก่อนเสนอราคา'
 });
 const o=latest(sources.office);
 if(o)for(const r of o.rules)if(office(b,r))rows.push({
  low:r.opening_min,high:r.opening_max,status:o.status as Row['status'],source:'Office',rule:r.cpu,
  warning:'การ์ดจอออนบอร์ดยังไม่ยืนยันจากชื่อสินค้า ต้องตรวจ GPU, RAM/SSD, CPU รุ่นเต็มและสภาพก่อนเสนอราคา'
 });
 const bus=latest(sources.business);
 if(bus)for(const r of bus.rules)if(business(b,r))rows.push({
  low:r.opening_min,high:r.opening_max,status:bus.status as Row['status'],source:'Business',rule:r.cpu,
  warning:'ต้องยืนยันรุ่น Business จริง, GPU ออนบอร์ด, สภาพและราคาขายต่อก่อนเสนอราคา'
 });
 // Only attach a gap proposal if it does not override any existing Owner rule.
 // Entry CPU N5030/N6000 and MacBook chip-only families remain unpriced at aggregated bucket level.
 if(rows.length===0&&sources.gaps?.length){
  const gap=latest(sources.gaps);
  if(gap){
   const found=gap.rules.filter(r=>{
    if(b.kind==='MACBOOK'||b.kind==='REVIEW')return false;
    const category=b.kind==='GAMING'?'NOTEBOOK_GAMING':b.kind==='BUSINESS'?'NOTEBOOK_BUSINESS':'NOTEBOOK_GENERAL';
    return r.category===category&&r.cpu===b.cpu&&
     (b.kind==='GAMING'?r.gpu===b.gpu:r.gpu==='INTEGRATED_ONLY'&&b.gpu==='INTEGRATED_OR_UNKNOWN');
   });
   if(found.length===1){
    const r=found[0];rows.push({
     low:r.opening_min,high:r.opening_max,status:gap.status as Row['status'],source:'Historical Gap',rule:r.cpu+' / '+r.gpu,
     warning:'ข้อเสนอเติมช่องว่างจากประวัติจริง ไม่ใช่ราคาที่ Owner ยืนยัน · ต้องตรวจ CPU/GPU/สภาพและราคาขายก่อนใช้งาน'
    });
   }
  }
 }
 // Ambiguous overlapping price rules must not be resolved by guessing.
 if(rows.length!==1)return null;
 const x=rows[0];return {low:x.low,high:x.high,status:x.status,source:x.source,rule:x.rule,warning:x.warning};
}
