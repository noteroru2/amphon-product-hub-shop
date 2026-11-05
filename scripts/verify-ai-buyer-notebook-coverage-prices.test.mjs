import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/aiBuyerNotebookCoveragePrices.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('module','exports','require',js)(mod,mod.exports,()=>({}));
const match=mod.exports.matchNotebookCoveragePrice;
const b=(kind,cpu,gpu='INTEGRATED_OR_UNKNOWN')=>({kind,cpu,gpu,count:1,examples:[],key:kind+'|'+cpu+'|'+gpu});
const pack=(status,rules)=>[{status,created_at:'2026-11-05T11:50:00.000Z',rules}];
const rule=(cpu,low,high)=>({cpu,opening_min:low,opening_max:high,gpu:'INTEGRATED_ONLY'});
test('business and office are distinct with correct PENDING state',()=>{
 const src={gaming:[],office:pack('PENDING',[rule('i5 Gen 11',3500,4500)]),business:pack('PENDING',[rule('i5 Gen 11',3000,4500)])};
 assert.equal(match(b('GENERAL','i5 Gen 11'),src).low,3500);
 assert.equal(match(b('BUSINESS','i5 Gen 11'),src).low,3000);
 assert.equal(match(b('BUSINESS','i5 Gen 11'),src).status,'PENDING');
});
test('Intel generation intervals are bounded',()=>{
 const src={gaming:[],office:pack('PENDING',[rule('i3 Gen 6–7',1000,1500)]),business:pack('PENDING',[rule('i5 Gen 8–9',1500,2500)])};
 assert.equal(match(b('GENERAL','i3 Gen 6'),src).high,1500);
 assert.equal(match(b('BUSINESS','i5 Gen 8'),src).low,1500);
 assert.equal(match(b('BUSINESS','i5 Gen 10'),src),null);
});
test('gaming non-Ti never matches Ti, and CPU range guard applies',()=>{
 const src={office:[],business:[],gaming:pack('APPROVED_DRAFT',[
 {cpu:'i5 Gen 7–9',gpu:['GTX1050'],opening_min:4500,opening_max:4500,spec:'GTX1050'},
 {cpu:'i5 Gen 7–9',gpu:['GTX1050TI'],opening_min:6000,opening_max:6000,spec:'GTX1050TI'},
 {cpu:'i5/i7 Gen 12–14',gpu:['RTX4060'],opening_min:20000,opening_max:21000,spec:'RTX4060'}
 ])};
 assert.equal(match(b('GAMING','i5 Gen 9','GTX1050'),src).low,4500);
 assert.equal(match(b('GAMING','i5 Gen 9','GTX1050TI'),src).low,6000);
 assert.equal(match(b('GAMING','i5 Gen 10','GTX1050'),src),null);
 assert.equal(match(b('GAMING','i7 Gen 13','RTX4060'),src).low,20000);
 assert.equal(match(b('GAMING','i5 Gen 13','RTX4060'),src).low,20000);
});
test('unknown VRAM, missing CPU and MacBook family do not fabricate opening prices',()=>{
 const src={gaming:pack('APPROVED_DRAFT',[{cpu:'i5 Gen 12–13',gpu:['RTX3050_6GB'],opening_min:13000,opening_max:14000,spec:'RTX3050'}]),office:[],business:[]};
 assert.equal(match(b('GAMING','i5 Gen 13','RTX3050_UNSPEC'),src),null);
 assert.equal(match(b('GAMING','CPU ตามรุ่น (ต้องตรวจ)','RTX3050_6GB'),src),null);
 assert.equal(match(b('MACBOOK','Apple M1'),src),null);
 assert.equal(match(b('REVIEW','CPU UNKNOWN'),src),null);
});
test('core ultra per-model rule never becomes zero-price',()=>{
 const src={gaming:[],business:[],office:pack('PENDING',[{...rule('Core Ultra Series 2+',null,null),review_type:'PER_MODEL'}])};
 const p=match(b('GENERAL','Core Ultra 7 Series 2'),src);
 assert.equal(p.low,null);assert.equal(p.high,null);
});

test('historical gap prices display only for uncovered exact CPU and GPU',()=>{
 const gaps=pack('PENDING',[
  {category:'NOTEBOOK_GAMING',cpu:'i5 Gen 11',gpu:'RTX3060',opening_min:11000,opening_max:12500},
  {category:'NOTEBOOK_BUSINESS',cpu:'i3 Gen 11',gpu:'INTEGRATED_ONLY',opening_min:2000,opening_max:3000}
 ]);
 const src={gaming:[],office:[],business:[],gaps};
 assert.equal(match(b('GAMING','i5 Gen 11','RTX3060'),src)?.low,11000);
 assert.equal(match(b('BUSINESS','i3 Gen 11'),src)?.low,2000);
 assert.equal(match(b('GAMING','i7 Gen 11','RTX3060'),src),null);
 assert.equal(match(b('GENERAL','i3 Gen 11'),src),null);
});
test('historical gap does not override already staged owner price',()=>{
 const gaps=pack('PENDING',[{category:'NOTEBOOK_BUSINESS',cpu:'i3 Gen 11',gpu:'INTEGRATED_ONLY',opening_min:2000,opening_max:3000}]);
 const src={gaming:[],office:[],business:pack('APPROVED_DRAFT',[rule('i3 Gen 11',2500,3500)]),gaps};
 const p=match(b('BUSINESS','i3 Gen 11'),src);
 assert.equal(p.low,2500);assert.equal(p.source,'Business');
});
test('historical gap cannot convert unknown hardware, MacBook or Entry CPU to priced offer',()=>{
 const gaps=pack('PENDING',[
  {category:'NOTEBOOK_GAMING',cpu:'i5 Gen 11',gpu:'RTX3050_6GB',opening_min:12000,opening_max:14000},
  {category:'NOTEBOOK_GENERAL',cpu:'Pentium N6000',gpu:'INTEGRATED_ONLY',opening_min:1500,opening_max:2500}
 ]);
 const src={gaming:[],office:[],business:[],gaps};
 assert.equal(match(b('GAMING','i5 Gen 11','RTX3050_UNSPEC'),src),null);
 assert.equal(match(b('GENERAL','Entry / Celeron / Pentium'),src),null);
 assert.equal(match(b('MACBOOK','Apple M2'),src),null);
});
