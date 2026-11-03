import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(path,deps={}){
 const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',compiled)(key=>{if(!(key in deps))throw Error('Unexpected import: '+key);return deps[key]},mod,mod.exports);
 return mod.exports;
}
const specs=load('../src/lib/aiBuyerStructuredSpecs.ts');
const rules=load('../src/lib/aiBuyerCostReviewRules.ts',{'./aiBuyerStructuredSpecs':specs});
const learning=load('../src/lib/aiBuyerCostLearning.ts',{'./aiBuyerStructuredSpecs':specs});
const {generateCostSpecReviewQueue,applyCostSpecReviews}=rules;
function inv(code,name,category='',condition='',source_type='PURCHASE'){
 return {source_kind:'INVENTORY',source_key:code,inventory_code:code,product_name:name,category,
  source_type,source_status:'SOLD',buy_cost:12000,actual_sale:null,actual_profit:null,quantity:1,
  occurred_at:'2026-10-01T00:00:00Z',details:{condition}};
}
function sale(id,code){return {...inv(id,'Sale','โน๊ตบุ๊ค'),source_kind:'SALE',inventory_code:code,actual_sale:16500,actual_profit:4000,occurred_at:'2026-10-22T00:00:00Z'};}
function review(source,reviewedName='MacBook Air M4/16/256',reviewedCategory='MACBOOK'){
 return {source_kind:'INVENTORY',source_key:source.source_key,source_name_snapshot:source.product_name,
  source_category_snapshot:source.category,reviewed_name:reviewedName,reviewed_category:reviewedCategory,
  review_note:'verified against receipt',reviewed_by:'owner',reviewed_at:'2026-11-03T00:00:00Z'};
}
test('missing category queues and suggested MacBook category never auto-overwrites history',()=>{
 const a=inv('INV-A','Macbook air M4/16/256');
 const queue=generateCostSpecReviewQueue([a,sale('S-1','INV-A')],[]);
 assert.equal(queue[0].priority,'HIGH');assert.equal(queue[0].proposedCategory,'MACBOOK');
 assert.ok(queue[0].flags.includes('MISSING_CATEGORY'));assert.equal(a.category,'');
});
test('verified owner category/name overlays only learning metadata; costs and source preserved',()=>{
 const a=inv('INV-A','Macbook air M4/16/256');
 const r=review(a);
 const enriched=applyCostSpecReviews([a,sale('S-1','INV-A')],[r]);
 assert.equal(enriched[0].category,'MACBOOK');assert.equal(enriched[0].buy_cost,12000);
 assert.equal(enriched[0].details._original_product_name,a.product_name);
 assert.equal(enriched[1].source_kind,'SALE');assert.equal(a.category,'');
 const report=learning.analyzeCostHistory(enriched,new Date('2026-11-03T00:00:00Z'));
 assert.equal(report.summary.uncategorized,0);assert.equal(report.cohorts[0].qualified,false);
});
test('source title or category changes invalidate old review and restore original grouping',()=>{
 const a=inv('INV-A','Macbook air M4/16/256');
 const r=review(a);const updated={...a,product_name:'MacBook Air M4 16/512'};
 const q=generateCostSpecReviewQueue([updated],[r]);assert.equal(q[0].stale,true);
 const enriched=applyCostSpecReviews([updated],[r]);assert.equal(enriched[0].category,'');
});
test('explicit category conflict flagged, not silently recategorized',()=>{
 const a=inv('INV-A','HP Zbook i7gen11/16/512','แท็บเล็ต');
 const q=generateCostSpecReviewQueue([a],[]);
 assert.ok(q[0].flags.includes('CATEGORY_CONFLICT'));assert.equal(q[0].priority,'HIGH');
});
test('three reviewed records do not ignore damage flags in original title or condition',()=>{
 const base='Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/512/15.6”';
 const raw=[inv('A',base+' จอเสีย','โน๊ตบุ๊ค'),inv('B',base,'โน๊ตบุ๊ค','แบตเสื่อม'),inv('C',base,'โน๊ตบุ๊ค')];
 const items=applyCostSpecReviews(raw,raw.map(r=>review(r,base,'NOTEBOOK')));
 const report=learning.analyzeCostHistory([...items,sale('1','A'),sale('2','B'),sale('3','C')],new Date('2026-11-03T00:00:00Z'));
 assert.equal(report.cohorts[0].qualified,false);
 assert.equal(report.cohorts[0].estimatedResale,null);
});
test('review queue excludes field purchases and sale events from edit targets',()=>{
 const a=inv('INV-A','Canon EOS M50','');
 const out=generateCostSpecReviewQueue([a,{...a,source_kind:'FIELD',source_key:'FP-1'},sale('S-1','INV-A')],[]);
 assert.equal(out.length,1);
});
