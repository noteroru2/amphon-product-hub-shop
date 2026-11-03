// Strict, deterministic parse of loosely formatted AMPHON inventory names.
// Extraction is advisory; missing/conflicting specs must NEVER be inferred or priced automatically.
export type StructuredSpecs={
 brand:string;family:string|null;modelCode:string|null;
 cpu:string|null;gpu:string|null;ramGb:number|null;storageGb:number|null;
 screenInches:number|null;generation:string|null;
 confidence:'COMPLETE'|'PARTIAL'|'UNKNOWN';warnings:string[];
 normalizedLabel:string;canonicalKey:string|null;
};
const normalize=(name:string)=>name.normalize('NFKC').toLowerCase()
 .replace(/[“”″]/g,'"').replace(/[‘’]/g,"'")
 .replace(/\s+/g,' ').trim();
const brandNames:[RegExp,string][]=[
 [/(?:^|\s)lenovo(?:\s|$)/,'Lenovo'],[/(?:^|\s)asus(?:\s|$)/,'ASUS'],[/(?:^|\s)acer(?:\s|$)/,'Acer'],
 [/(?:^|\s)dell(?:\s|$)/,'Dell'],[/(?:^|\s)hp(?:\s|$)/,'HP'],[/(?:^|\s)msi(?:\s|$)/,'MSI'],
 [/(?:^|\s)(?:apple|macbook|iphone|ipad)(?:\s|$)/,'Apple'],[/(?:^|\s)huawei(?:\s|$)/,'Huawei'],
 [/(?:^|\s)gigabyte(?:\s|$)/,'Gigabyte'],[/(?:^|\s)sony(?:\s|$)/,'Sony'],
 [/(?:^|\s)canon(?:\s|$)/,'Canon'],[/(?:^|\s)fujifilm(?:\s|$)/,'Fujifilm'],
 [/(?:^|\s)samsung(?:\s|$)/,'Samsung'],[/(?:^|\s)microsoft(?:\s|$)/,'Microsoft'],
];
const families=[
 'thinkbook','thinkpad','ideapad','legion','loq','vivobook','vivo book','expertbook','zenbook','rog',
 'tuf','victus','omen','probook','elitebook','zbook','pavilion','inspiron','latitude','precision',
 'nitro','aspire','swift','predator','modern','gf63','katana','cyborg','matebook','surface',
 'macbook air','macbook pro','macbook neo','mac studio','mac mini','imac','iphone','ipad',
 'insta360','eos','lumix','alpha','playstation',
];
const modelCodes=[
 /\b(?:15irx9|15iax9|15irh8|15ach6|15arp9|15iah7|v3607vh|v3607|15s-fq\d*|15s-eq\d*|450\s*g5|450\s*g6)\b/i,
 /\b(?:[a-z]{1,3}\d{2,4}[a-z]{0,3}|\d{2}[a-z]{2}\d{1,3})\b/i,
];
const cores=[
 /\b(?:intel\s*)?(?:core\s*)?(i[3579])\s*[- ]?\s*(\d{4,5}[a-z]{0,3})\b/i,
 /\b(?:ryzen\s*)([3579])\s*[- ]?\s*(\d{4,5}[a-z]{0,3})\b/i,
 /\b(?:core\s*ultra)\s*([3579])\s*[- ]?(\d{3}[a-z]{0,2})\b/i,
 /\b(?:core)\s*([3579])\s*[- ]?(\d{3}[a-z]{1,2})\b/i,
];
function extractCpu(n:string):string|null{
 for(let i=0;i<cores.length;i++){
  const m=n.match(cores[i]);if(m)return (i===0?'i':i===1?'ryzen':i===2?'ultra':'core')+(i===0?m[1].slice(1):m[1])+'-'+m[2].toUpperCase();
 }
 const apple=n.match(/\b(m[1-5])\s*(pro|max|ultra)?\b/i);
 if(apple&&/(?:macbook|mac studio|mac mini|imac|ipad)/.test(n))return apple[1].toUpperCase()+(apple[2]?'-'+apple[2].toUpperCase():'');
 const gen=n.match(/\bi([3579])\s*gen\s*(\d{1,2})\b/i);
 if(gen)return 'i'+gen[1]+'-GEN'+gen[2];
 return null;
}
function extractGpu(n:string):string|null{
 const m=n.match(/\b(?:rtx|gtx)\s*[- ]?(\d{3,4})(\s*ti|\s*super)?\b/i);
 if(m)return (n.slice(m.index??0,(m.index??0)+3).toUpperCase()==='GTX'?'GTX':'RTX')+m[1]+(m[2]?m[2].trim().toUpperCase():'');
 // Bare 3050 / 3060 only in slash-separated PC specification, not in model name.
 const g=n.match(/(?:\/|\|)\s*(\d{4})(ti)?\s*(?:\/|\||\s+\d+gb\b)/i);
 if(g&&/^(?:10[56]0|16[56]0|20[67]0|30[5678]0|40[5678]0|50[5678]0)$/.test(g[1]))
  return (Number(g[1])<2000?'GTX':'RTX')+g[1]+(g[2]?'TI':'');
 return null;
}
function extractRamAndStorage(n:string,category:string):{ramGb:number|null;storageGb:number|null;warnings:string[]}{
 const warnings:string[]=[];
 const explicitRam=n.match(/\b(?:ram)\s*[:=-]?\s*(\d{1,3})\s*(?:gb|g)?\b/i);
 const explicitStorage=n.match(/\b(?:ssd|storage|hdd|nvme)\s*[:=-]?\s*(\d{2,4})\s*(tb|gb|g)?\b/i);
 const slash=n.match(/(?:^|[^\d])\b(4|8|12|16|24|32|48|64|96|128)\s*[\/|]\s*(128|256|500|512|1000|1024|2000|2048|4000)\b/);
 let ramGb=explicitRam?Number(explicitRam[1]):slash?Number(slash[1]):null;
 let storageGb=explicitStorage?Number(explicitStorage[1])*(explicitStorage[2]==='tb'?1024:1):slash?Number(slash[2]):null;
 if(!explicitStorage){
  const storage1=n.match(/\b(128|256|500|512|1000|1024|2000|2048|4000)\s*(gb|tb)\b/i);
  // Standalone "128GB" is phone storage, not notebook RAM.
  if(storage1)storageGb=Number(storage1[1])*(storage1[2].toLowerCase()==='tb'?1024:1);
 }
 const tb=n.match(/\b(1|2|4)\s*tb\b/i);if(tb&&!explicitStorage)storageGb=Number(tb[1])*1024;
 if(/\b(?:\d+\s*(?:\/|\|)\s*){3,}\d+\b/.test(n)&&!slash)warnings.push('AMBIGUOUS_SLASH_SPEC');
 if(category==='SMARTPHONE'||category==='TABLET'){
  // RAM is often absent from product name; single capacity is storage, not RAM.
  if(!explicitRam&&!slash)ramGb=null;
 }
 if(explicitRam&&slash&&Number(explicitRam[1])!==Number(slash[1]))warnings.push('CONFLICTING_RAM');
 if(explicitStorage&&slash&&Number(explicitStorage[1])!==Number(slash[2]))warnings.push('CONFLICTING_STORAGE');
 return {ramGb,storageGb,warnings};
}
function extractFamily(n:string,brand:string):string|null{
 if(brand==='Apple'){
  const m=n.match(/\bmacbook\s+(air|pro|neo)\b|\bmac\s+(studio|mini)\b|\bipad(?:\s+(air|pro|mini))?\b|\biphone(?:\s+\d{1,2})?\b|\bimac\b/i);
  if(m)return m[0].toLowerCase().replace(/\s+/g,' ');
 }
 const found=families.find(f=>new RegExp('(?:^|\\s)'+f.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s|$|[-\\d])','i').test(n));
 return found?found.replace('vivo book','vivobook'):null;
}
function extractModelCode(n:string,family:string|null):string|null{
 for(const re of modelCodes){
  for(const m of n.matchAll(new RegExp(re.source,'gi'))){
   const candidate=m[0].replace(/\s+/g,'').toUpperCase();
   if(/^(?:RTX|GTX|DDR|SSD|RAM|GEN)\d/.test(candidate))continue;
   if(/^[0-9]{2,4}$/.test(candidate))continue;
   // Don't treat CPU tokens, storage or standalone generation as model code.
   if(/^(?:I[3579]|R[3579])\d+/.test(candidate))continue;
   if(/^[A-Z]\d{2,4}$/.test(candidate)&&!family)continue;
   return candidate;
  }
 }
 return null;
}
export function extractStructuredSpecs(name:string,pricebookCategory:string):StructuredSpecs{
 const n=normalize(name);
 const brand=brandNames.find(([re])=>re.test(n))?.[1]??'';
 const category=pricebookCategory.toUpperCase();
 const family=extractFamily(n,brand);
 const cpu=extractCpu(n),gpu=extractGpu(n);
 const memory=extractRamAndStorage(n,category);
 const modelCode=extractModelCode(n,family);
 const screen=n.match(/\b(1[1-9]|2[0-9])(?:\.(?:3|4|5|6|8|9))?\s*(?:inch|inches|["]|นิ้ว)\b/);
 const screenInches=screen?Number(screen[0].match(/\d+(?:\.\d+)?/)?.[0]):null;
 const warnings=[...memory.warnings];
 const damage=/เสีย|ซาก|เปิดไม่ติด|น้ำเข้า|จอแตก|จอเสีย|ล๊อค|ล็อค|อะไหล่|แบตเสื่อม|ตำหนิ/.test(n);
 if(damage)warnings.push('CONDITION_REVIEW');
 if(!brand)warnings.push('BRAND_UNKNOWN');
 if(!family)warnings.push('FAMILY_UNKNOWN');
 if(!cpu&&(category==='NOTEBOOK'||category==='DESKTOP_PC'||category==='MACBOOK'))warnings.push('CPU_UNKNOWN');
 if(memory.ramGb===null&&(category==='NOTEBOOK'||category==='DESKTOP_PC'||category==='MACBOOK'))warnings.push('RAM_UNKNOWN');
 if(memory.storageGb===null&&(category==='NOTEBOOK'||category==='DESKTOP_PC'||category==='MACBOOK'||category==='SMARTPHONE'))warnings.push('STORAGE_UNKNOWN');
 const core=category==='NOTEBOOK'||category==='DESKTOP_PC'||category==='MACBOOK';
 const confidence:StructuredSpecs['confidence']=warnings.length===0&&brand&&family&&(!core||(cpu&&memory.ramGb&&memory.storageGb))
  ?'COMPLETE':brand&&family?'PARTIAL':'UNKNOWN';
 // Only canonicalize strict fully specified and safely identifiable notebook variants with a real model code.
 // Otherwise retain exact input key in Cost Learning, so historical prices never cross model or condition boundaries.
 const canonicalKey=confidence==='COMPLETE'&&category==='NOTEBOOK'&&modelCode&&cpu&&memory.ramGb&&memory.storageGb
  ?[category,brand.toLowerCase(),family,modelCode,cpu,gpu??'GPU_UNSPECIFIED',memory.ramGb,memory.storageGb,screenInches??'SCREEN_UNSPECIFIED'].join('|')
  :null;
 return {brand,family,modelCode,cpu,gpu,ramGb:memory.ramGb,storageGb:memory.storageGb,
  screenInches,generation:cpu?.match(/GEN\d+/)?.[0]??null,
  confidence,warnings,normalizedLabel:n,canonicalKey};
}
