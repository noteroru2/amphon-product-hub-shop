import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/lib/aiBuyerCostLearning.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const specSource=fs.readFileSync(new URL('../src/lib/aiBuyerStructuredSpecs.ts',import.meta.url),'utf8');
const specCompiled=ts.transpileModule(specSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const specs={exports:{}};
new Function('module','exports',specCompiled)(specs,specs.exports);
const moduleMock={exports:{}};
new Function('require','module','exports',compiled)((path)=>{if(path==='./aiBuyerStructuredSpecs')return specs.exports;throw Error('unexpected import: '+path)},moduleMock,moduleMock.exports);
const {analyzeCostHistory,mapCostHistoryCategory,normalizeCostModel}=moduleMock.exports;

const now=new Date('2026-11-03T17:00:00Z');
function inv(code,{name='Lenovo LOQ i5 RTX3050 16/512',cost=10000,category='โน๊ตบุ๊ค',source='PURCHASE'}={}){
 return {source_kind:'INVENTORY',source_key:code,inventory_code:code,product_name:name,category,source_type:source,
 source_status:'SOLD',buy_cost:cost,actual_sale:null,actual_profit:null,quantity:1,occurred_at:'2026-10-01T00:00:00Z',details:{}};
}
function sale(id,code,{price=16000,profit=5000,soldAt='2026-10-20T00:00:00Z',quantity=1}={}){
 return {source_kind:'SALE',source_key:id,inventory_code:code,product_name:'Lenovo LOQ',category:'โน๊ตบุ๊ค',source_type:'PURCHASE',
 source_status:'SOLD',buy_cost:10000,actual_sale:price,actual_profit:profit,quantity,occurred_at:soldAt,details:{stock_age_days:19}};
}
function field(code,status='DRAFT'){return {...inv(code),source_kind:'FIELD',source_status:status,source_type:'FIELD_PURCHASE'};}
test('one stock code sold five times counts as one sold unit, no suggestion',()=>{
 const x=analyzeCostHistory([inv('A'),...Array.from({length:5},(_,i)=>sale('SALE-'+i,'A'))],now);
 const c=x.cohorts[0];assert.equal(c.saleEvents,5);assert.equal(c.soldItems,1);assert.equal(c.qualified,false);assert.equal(c.targetBuy,null);
});
test('three distinct profitable independently sold items qualify for owner-only draft suggestion',()=>{
 const x=analyzeCostHistory([inv('A'),inv('B'),inv('C'),sale('1','A'),sale('2','B'),sale('3','C')],now);
 const c=x.cohorts[0];assert.equal(c.purchaseSamples,3);assert.equal(c.soldItems,3);assert.equal(c.qualified,true);
 assert.ok(c.openingOffer<=c.targetBuy&&c.targetBuy<=c.hardMax&&c.hardMax<=c.estimatedResale);
});
test('forfeit cannot qualify even if sold',()=>{
 const x=analyzeCostHistory([inv('A'),inv('B'),inv('C',{source:'FORFEIT'}),sale('1','A'),sale('2','B'),sale('3','C')],now);
 assert.equal(x.cohorts[0].soldItems,2);assert.equal(x.summary.forfeit,1);assert.equal(x.cohorts[0].qualified,false);
});
test('field DRAFT is not a completed bought inventory item',()=>{
 const x=analyzeCostHistory([inv('A'),field('FP-1')],now);
 assert.equal(x.summary.fieldDraft,1);assert.equal(x.cohorts[0].purchaseSamples,1);
});
test('missing category excluded from proposals and shown as data quality issue',()=>{
 const x=analyzeCostHistory([inv('A',{category:''}),sale('1','A')],now);
 assert.equal(x.summary.uncategorized,1);assert.equal(x.cohorts.length,0);
});
test('unmatched sale counted but never forms a cohort',()=>{
 const x=analyzeCostHistory([sale('1','MISSING')],now);
 assert.equal(x.summary.saleUnmatched,1);assert.equal(x.cohorts.length,0);
});
test('stale sale cannot qualify',()=>{
 const x=analyzeCostHistory([inv('A'),inv('B'),inv('C'),sale('1','A',{soldAt:'2025-10-01T00:00:00Z'}),sale('2','B',{soldAt:'2025-10-01T00:00:00Z'}),sale('3','C',{soldAt:'2025-10-01T00:00:00Z'})],now);
 assert.equal(x.cohorts[0].qualified,false);assert.equal(x.cohorts[0].targetBuy,null);
});
test('a loss-making sale prevents a generated suggested price',()=>{
 const x=analyzeCostHistory([inv('A'),inv('B'),inv('C'),sale('1','A'),sale('2','B',{profit:-1000}),sale('3','C')],now);
 assert.equal(x.cohorts[0].qualified,false);assert.equal(x.cohorts[0].actualProfitMedian,5000);
});
test('different RAM and SSD variants do not mix across cohorts',()=>{
 const x=analyzeCostHistory([inv('A'),inv('B',{name:'Lenovo LOQ i5 RTX3050 32/1TB'}),sale('1','A'),sale('2','B')],now);
 assert.equal(x.cohorts.length,2);
});
test('normalizes Unicode whitespace, category and MacBook names',()=>{
 assert.equal(normalizeCostModel('  MACBOOK   Air　M1 '),'macbook air m1');
 assert.equal(mapCostHistoryCategory('โน๊ตบุ๊ค','Macbook Air M1'),'MACBOOK');
 assert.equal(mapCostHistoryCategory('กล้อง','Canon EOS R50'),'CAMERA');
});
