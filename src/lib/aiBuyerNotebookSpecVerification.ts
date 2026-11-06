import type {CostHistoryRecord} from './aiBuyerCostLearning';
import {isNotebookCostRecord} from './aiBuyerNotebookCoverage';
export type NotebookSpecIssue='RTX3050_VRAM_MISSING'|'RTX3050_VRAM_CONFLICT'|'MAC_FAMILY_MISSING'|'MAC_CHIP_OR_YEAR_MISSING'|'MAC_RAM_MISSING'|'MAC_STORAGE_MISSING'|'MAC_SCREEN_MISSING';
export type NotebookVerificationRow={source_key:string;inventory_code:string;product_name:string;category:string;source_status:string;source_type:string;issues:NotebookSpecIssue[];parsed:{gpu:string|null;vramGb:4|6|null;macFamily:'Air'|'Pro'|'Neo'|null;chip:string|null;year:number|null;ramGb:number|null;ssdGb:number|null;screenInches:number|null};priority:number;};
const norm=(s:string)=>s.normalize('NFKC').replace(/[“”″]/g,'"').replace(/\s+/g,' ').trim();
function ramAndStorage(s:string):{ramGb:number|null;ssdGb:number|null}{
 const pair=s.match(/(?:^|[^\d])(4|8|12|16|18|24|32|36|48|64|96|128)\s*[\/|]\s*(128|256|512|1000|1024|2048|4096)(?!\d)/i);
 const ram=s.match(/\b(?:ram|memory|unified memory)\s*[:=-]?\s*(8|16|18|24|32|36|48|64|96|128)\s*(?:gb)?\b/i);
 const ssd=s.match(/\b(?:ssd|storage)\s*[:=-]?\s*(128|256|512|1000|1024|2048|4096)\s*(?:gb)?\b/i);
 const r=ram?Number(ram[1]):pair?Number(pair[1]):null;
 const d=ssd?Number(ssd[1]):pair?Number(pair[2]):null;
 return {ramGb:r,ssdGb:d};
}
export function parseNotebookVerification(name:string){
 const n=norm(name), mac=/\bmac\s*book\b|\bmacbook\b|แมคบุ๊ค|แมคบุก/i.test(n);
 const gpu=/\b(?:rtx\s*3050|(?<=[\/\s])3050)(?!\s*ti\b)/i.test(n)?'RTX3050':null;
 // VRAM must be anchored to the graphics card token, not RAM/SSD later in the name.
 const gpuToken=n.match(/\b(?:rtx\s*3050|3050)(?!\s*ti\b)/i);
 const after=gpuToken?n.slice((gpuToken.index??0)+gpuToken[0].length):'';
 const explicit=after.match(/^\s*(?:\(|\/)?\s*(4|6)\s*(?:GB|G)\b/i);
 const before=gpuToken?n.slice(Math.max(0,(gpuToken.index??0)-22),gpuToken.index??0):'';
 const prefix=before.match(/(?:VRAM|VGA)\s*[:=-]?\s*(4|6)\s*(?:GB|G)?\s*[\/\- ]*$/i);
 const vramValues=[explicit?.[1],prefix?.[1]].filter(Boolean).map(Number);
 const conflicting=new Set(vramValues).size>1;
 const vramGb=conflicting||vramValues.length===0?null:vramValues[0] as 4|6;
 const fam=n.match(/\bmac\s*book\s*(air|pro|neo)\b/i);
 const macFamily=fam?fam[1][0].toUpperCase()+fam[1].slice(1).toLowerCase() as 'Air'|'Pro'|'Neo':null;
 const chipM=n.match(/\bM\s*([1-9])\s*(Pro|Max|Ultra)?\b/i);
 const chip=chipM?'M'+chipM[1]+(chipM[2]?' '+chipM[2].toUpperCase():''):null;
 const yearM=n.match(/\b(20(?:1[0-9]|2[0-9]))\b/);
 const year=yearM?Number(yearM[1]):null;
 const memory=ramAndStorage(n);
 const screen=n.match(/\b(12\.9|13(?:\.3|\.6)?|14|15(?:\.3)?|16)\s*(?:inch|inches|นิ้ว|")/i);
 const screenInches=screen?Number(screen[1]):null;
 const issues:NotebookSpecIssue[]=[];
 if(gpu&&conflicting)issues.push('RTX3050_VRAM_CONFLICT');
 else if(gpu&&!vramGb)issues.push('RTX3050_VRAM_MISSING');
 if(mac){
  if(!macFamily)issues.push('MAC_FAMILY_MISSING');
  if(!chip&&!year)issues.push('MAC_CHIP_OR_YEAR_MISSING');
  if(!memory.ramGb)issues.push('MAC_RAM_MISSING');
  if(!memory.ssdGb)issues.push('MAC_STORAGE_MISSING');
  // Missing screen is important to compare 13/15/16-inch variants, but never assumed from chip.
  if(!screenInches)issues.push('MAC_SCREEN_MISSING');
 }
 return {gpu,vramGb,macFamily,chip,year,ramGb:memory.ramGb,ssdGb:memory.ssdGb,screenInches,issues};
}
export function buildNotebookSpecVerificationQueue(records:CostHistoryRecord[]):NotebookVerificationRow[]{
 const seen=new Set<string>();const out:NotebookVerificationRow[]=[];
 for(const record of records){
  if(record.source_kind!=='INVENTORY'||!isNotebookCostRecord(record))continue;
  const key=record.source_key||record.inventory_code;
  if(seen.has(key))continue;seen.add(key);
  const parsed=parseNotebookVerification(record.product_name);
  if(!parsed.issues.length)continue;
  const priority=(record.source_status==='IN_STOCK'?100:0)+(parsed.issues.some(i=>i.startsWith('RTX3050'))?30:0)+parsed.issues.length;
  out.push({source_key:key,inventory_code:record.inventory_code,product_name:record.product_name,category:record.category,
   source_status:record.source_status,source_type:record.source_type,issues:parsed.issues,parsed,priority});
 }
 return out.sort((a,b)=>b.priority-a.priority||a.inventory_code.localeCompare(b.inventory_code));
}
