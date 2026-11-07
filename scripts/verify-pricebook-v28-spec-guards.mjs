// Reference QA only: not wired into production PriceBook or LINE AUTO.
import assert from 'node:assert/strict';
function parse(name) {
 const s=String(name).toUpperCase().replace(/\s+/g,' ');
 const ti=/RTX\s*3050\s*TI\b/.test(s);
 const standard=!ti && /RTX\s*3050\b/.test(s);
 const v=standard && s.match(/RTX\s*3050(?:\s*\((4|6|8)\s*G(?:B)?\)|\s+(4|6|8)\s*G(?:B)?\b)/);
 return {gpu:ti?'RTX3050TI':standard?'RTX3050':null,vram:v?Number(v[1]||v[2]):null};
}
function decideGpu(spec,rules) {
 if(spec.gpu==='RTX3050'&&!spec.vram)return 'REVIEW_REQUIRED';
 const matches=rules.filter(r=>r.active!==false&&r.gpu===spec.gpu&&(spec.gpu!=='RTX3050'||r.vram===spec.vram));
 return matches.length>1?'AMBIGUOUS':matches.length===1?matches[0].code:'NO_MATCH';
}
function decideMac(spec,rules){
 if(!spec.family||!spec.chip||!spec.screen||!spec.ram||!spec.ssd)return 'REVIEW_REQUIRED';
 const matches=rules.filter(r=>r.active!==false&&['family','chip','screen','ram','ssd'].every(k=>r[k]===spec[k]));
 return matches.length>1?'AMBIGUOUS':matches.length===1?matches[0].code:'NO_MATCH';
}
const gpuRules=[{gpu:'RTX3050',vram:4,code:'3050-4'},{gpu:'RTX3050',vram:6,code:'3050-6'},{gpu:'RTX3050TI',code:'3050-TI'}];
const macRules=[{family:'AIR',chip:'M3',screen:13,ram:16,ssd:256,code:'AIR-M3-16-256'},{family:'AIR',chip:'M3',screen:13,ram:16,ssd:256,code:'UNAPPROVED',active:false},{family:'PRO',chip:'M1 PRO',screen:14,ram:16,ssd:512,code:'PRO-M1PRO-16-512'}];
const cases=[
 ['RTX3050/16/512 must hold',()=>assert.equal(decideGpu(parse('RTX3050/16/512'),gpuRules),'REVIEW_REQUIRED')],
 ['RTX3050 /8/512 must hold',()=>assert.equal(parse('RTX 3050 / 8 / 512').vram,null)],
 ['RTX3050 4GB precise',()=>assert.equal(decideGpu(parse('RTX3050 4GB/16/512'),gpuRules),'3050-4')],
 ['RTX3050 6GB precise',()=>assert.equal(decideGpu(parse('RTX3050 6GB/16/512'),gpuRules),'3050-6')],
 ['RTX3050Ti separate',()=>assert.equal(decideGpu(parse('RTX3050Ti/16/512'),gpuRules),'3050-TI')],
 ['unmatched VRAM no fallback',()=>assert.equal(decideGpu({gpu:'RTX3050',vram:8},gpuRules),'NO_MATCH')],
 ['unapproved rule excluded',()=>assert.equal(decideMac({family:'AIR',chip:'M3',screen:13,ram:16,ssd:256},macRules),'AIR-M3-16-256')],
 ['missing screen manual',()=>assert.equal(decideMac({family:'AIR',chip:'M3',ram:16,ssd:256},macRules),'REVIEW_REQUIRED')],
 ['Air never Pro',()=>assert.equal(decideMac({family:'PRO',chip:'M1 PRO',screen:14,ram:16,ssd:512},macRules),'PRO-M1PRO-16-512')],
 ['SSD must match',()=>assert.equal(decideMac({family:'AIR',chip:'M3',screen:13,ram:16,ssd:512},macRules),'NO_MATCH')],
 ['RAM must match',()=>assert.equal(decideMac({family:'AIR',chip:'M3',screen:13,ram:8,ssd:256},macRules),'NO_MATCH')],
 ['duplicate approved rules blocked',()=>assert.equal(decideMac({family:'AIR',chip:'M3',screen:13,ram:16,ssd:256},[...macRules,{...macRules[0],code:'DUP'}]),'AMBIGUOUS')]
];
cases.push(
 ['GTX 3050 not RTX 3050',()=>assert.equal(parse('GTX 3050 4GB').gpu,null)],
 ['RTX4050 must not match RTX3050',()=>assert.equal(parse('RTX4050 6GB').gpu,null)],
 ['two approved GPU variant rules ambiguous',()=>assert.equal(decideGpu({gpu:'RTX3050',vram:6},[...gpuRules,{gpu:'RTX3050',vram:6,code:'duplicate'}]),'AMBIGUOUS')],
 ['unknown MacBook family blocked',()=>assert.equal(decideMac({chip:'M3',screen:13,ram:16,ssd:256},macRules),'REVIEW_REQUIRED')]
);
const historicalUnknown = [
 ['INV-2026-0064','Asus Tuf i5-11400H/RTX3050/8/512'],
 ['INV-2026-0189','Acer Nitro5 i7-11800H/RTX3050/8/512'],
 ['INV-2026-0214','Asus Tuf A17 Ryzen7 4800H/RTX3050/8/512/17.3'],
 ['INV-2026-0292','MSI Thin 15 i5-124500H/RTX3050/16/512'],
 ['INV-2026-0436','Asus TUF gaming F15 i5-11400 RTX3050/16/512'],
 ['INV-2026-0458','ASUS TUF A15 Ryzen 7 170 / RTX3050 /16/512/15.6'],
 ['INV-2026-0459','Asus TUF F15 i5-11400H / RTX3050 /16 /512/15.6'],
];
for(const [id,description] of historicalUnknown) {
 cases.push([id+' must request VRAM verification',()=>assert.equal(decideGpu(parse(description),gpuRules),'REVIEW_REQUIRED')]);
}
for(const [name,fn] of cases){fn();console.log('PASS',name)}
console.log(cases.length+'/'+cases.length+' independent guard tests passed; production matcher not changed.');
