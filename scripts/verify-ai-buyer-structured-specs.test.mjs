import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(path,requireFn=()=>{throw Error('unexpected import')}) {
 const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mock={exports:{}};new Function('require','module','exports',compiled)(requireFn,mock,mock.exports);return mock.exports;
}
const specs=load('../src/lib/aiBuyerStructuredSpecs.ts');
const {extractStructuredSpecs:parse}=specs;
const {analyzeCostHistory}=load('../src/lib/aiBuyerCostLearning.ts',path=>{
 assert.equal(path,'./aiBuyerStructuredSpecs');return specs;
});
const now=new Date('2026-11-03T17:00:00Z');
function item(code,name,condition='') {
 return {source_kind:'INVENTORY',source_key:code,inventory_code:code,product_name:name,category:'โน๊ตบุ๊ค',
 source_type:'PURCHASE',source_status:'SOLD',buy_cost:10000,actual_sale:null,actual_profit:null,quantity:1,
 occurred_at:'2026-10-01T00:00:00Z',details:{condition}};
}
function sold(code,id) {
 return {source_kind:'SALE',source_key:id,inventory_code:code,product_name:'LOQ',category:'โน๊ตบุ๊ค',
 source_type:'PURCHASE',source_status:'SOLD',buy_cost:10000,actual_sale:16000,actual_profit:5000,quantity:1,
 occurred_at:'2026-10-20T00:00:00Z',details:{stock_age_days:19}};
}
test('extracts core notebook CPU/GPU/RAM/SSD and model code from real name',()=>{
 const r=parse('Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/512/15.6”','NOTEBOOK');
 assert.equal(r.brand,'Lenovo');assert.equal(r.family,'loq');assert.equal(r.modelCode,'15IRX9');
 assert.equal(r.cpu,'i5-13450HX');assert.equal(r.gpu,'RTX3050');assert.equal(r.ramGb,16);assert.equal(r.storageGb,512);
 assert.equal(r.screenInches,15.6);assert.equal(r.confidence,'COMPLETE');
 assert.ok(r.canonicalKey);
});
test('normalizes 3050 GPU and RTX3050 for structurally equivalent LOQ entries',()=>{
 const a=parse('Lenovo LOQ 15IRX9 i5-13450HX/3050 6GB/16/512/15.6”','NOTEBOOK');
 const b=parse('Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/512/15.6”','NOTEBOOK');
 assert.equal(a.gpu,b.gpu);assert.equal(a.canonicalKey,b.canonicalKey);
});
test('different GPU RAM SSD and condition are never merged for pricing',()=>{
 const names=[
  'Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/512/15.6”',
  'Lenovo LOQ 15IRX9 i5-13450HX/RTX4050 6GB/16/512/15.6”',
  'Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/32/512/15.6”',
  'Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/1000/15.6”'
 ];
 const out=names.map(name=>parse(name,'NOTEBOOK').canonicalKey);
 assert.equal(new Set(out).size,4);
 const r=analyzeCostHistory([item('A',names[0]),item('B',names[0],'แบตเสื่อม'),sold('A','1'),sold('B','2')],now);
 assert.equal(r.cohorts.length,2);
});
test('cosmetic format variants merge only when complete key matches',()=>{
 const a='Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/512/15.6”';
 const b='LENOVO  LOQ 15IRX9  i5-13450HX / 3050 6GB / 16 / 512 /15.6"';
 const r=analyzeCostHistory([item('A',a),item('B',b),sold('A','1'),sold('B','2')],now);
 assert.equal(r.cohorts.length,1);assert.equal(r.cohorts[0].soldItems,2);
 assert.equal(r.cohorts[0].matchMethod,'STRUCTURED_EXACT');
 assert.equal(r.cohorts[0].qualified,false);
});
test('ambiguous or damaged devices cannot receive structured key',()=>{
 const r=parse('โน๊ตบุ๊ค Lenovo เปิดไม่ติด','NOTEBOOK');
 assert.notEqual(r.confidence,'COMPLETE');assert.equal(r.canonicalKey,null);
 assert.ok(r.warnings.includes('CONDITION_REVIEW'));
});
test('MacBook SoC and iPhone capacities are not interpreted as CPU/RAM blindly',()=>{
 const mac=parse('MacBook Air M3 15” 8/256 ครบกล่อง','MACBOOK');
 assert.equal(mac.cpu,'M3');assert.equal(mac.ramGb,8);assert.equal(mac.storageGb,256);
 const iphone=parse('iPhone 13 Pro Max 256GB','SMARTPHONE');
 assert.equal(iphone.storageGb,256);assert.equal(iphone.ramGb,null);
});
test('unknown family has no structured match identity',()=>{
 const r=parse('Generic i5-13450HX /16/512','NOTEBOOK');
 assert.equal(r.canonicalKey,null);
});
