import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const cache={};
function load(name){
 if(cache[name])return cache[name].exports;
 const code=fs.readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const obj={exports:{}};cache[name]=obj;
 new Function('module','exports','require',js)(obj,obj.exports,path=>{
  if(path==='./aiBuyerNotebookCoverage')return load('aiBuyerNotebookCoverage');
  if(path==='./aiBuyerNotebookSpecVerification')return load('aiBuyerNotebookSpecVerification');
  return {};
 });
 return obj.exports;
}
const {parseNotebookVerification,buildNotebookSpecVerificationQueue}=load('aiBuyerNotebookSpecVerification');
const {analyzeNotebookCoverage}=load('aiBuyerNotebookCoverage');
const rec=(id,name,status='IN_STOCK')=>({source_kind:'INVENTORY',source_key:id,inventory_code:id,product_name:name,category:'โน๊ตบุ๊ค',source_type:'PURCHASE',source_status:status,buy_cost:5000,actual_sale:null,actual_profit:null,quantity:1,occurred_at:'2026-11-05',details:{}});
test('RTX 3050 unknown must stay unknown, and RAM 16 cannot be treated as VRAM',()=>{
 const p=parseNotebookVerification('ASUS TUF i5-11400H/RTX3050/16/512');
 assert.deepEqual(p.issues,['RTX3050_VRAM_MISSING']);
 assert.equal(p.vramGb,null);
});
test('RTX 3050 4GB / 6GB explicit are separate and Ti excluded',()=>{
 assert.equal(parseNotebookVerification('ASUS TUF RTX3050 4GB/8/512').vramGb,4);
 assert.equal(parseNotebookVerification('Lenovo LOQ i5/3050 6GB/16/512').vramGb,6);
 assert.equal(parseNotebookVerification('RTX3050Ti/16/512').gpu,null);
 const b=analyzeNotebookCoverage([rec('a','Asus Tuf i5gen11/RTX3050/16/512'),rec('b','Lenovo LOQ i5gen13/3050 6GB/16/512')]);
 assert.ok(b.buckets.some(x=>x.count===1&&x.gpu==='RTX3050_UNSPEC'));
 assert.ok(b.buckets.some(x=>x.count===1&&x.gpu==='RTX3050_6GB'));
});
test('MacBook Air M3 and Pro M1 Pro are parsed with distinct exact specs',()=>{
 const a=parseNotebookVerification('MacBook Air M3 15” 8/256');
 const b=parseNotebookVerification('MacBook Pro M1Pro 14” 16/512');
 assert.equal(a.macFamily,'Air');assert.equal(a.chip,'M3');
 assert.equal(a.ramGb,8);assert.equal(a.ssdGb,256);assert.equal(a.screenInches,15);
 assert.equal(b.macFamily,'Pro');assert.equal(b.chip,'M1 PRO');
 const rows=analyzeNotebookCoverage([rec('a','MacBook Air M3 15” 8/256'),rec('b','MacBook Pro M1Pro 14” 16/512')]);
 assert.equal(rows.buckets.filter(x=>x.kind==='MACBOOK'&&x.count>0).length,2);
});
test('missing MacBook screen or memory remains verification task, not inferred',()=>{
 const p=parseNotebookVerification('MacBook Air M1 8/256');
 assert.ok(p.issues.includes('MAC_SCREEN_MISSING'));
 assert.equal(p.screenInches,null);
 const q=parseNotebookVerification('MacBook Pro M2');
 assert.ok(q.issues.includes('MAC_RAM_MISSING'));
 assert.ok(q.issues.includes('MAC_STORAGE_MISSING'));
});
test('review queue excludes PC RTX3050 and prioritizes in-stock unverifiable laptop',()=>{
 const rows=buildNotebookSpecVerificationQueue([
 rec('pc','PC i5-12400 RTX3050/16/512'),
 rec('sold','ASUS TUF i5gen11/RTX3050/16/512','SOLD'),
 rec('stock','MacBook Air M2 8/256','IN_STOCK')
 ]);
 assert.equal(rows.length,2);assert.equal(rows[0].inventory_code,'stock');
});

test('Athlon 3050U is not an RTX3050 GPU and needs no false VRAM review',()=>{
 const cpu='โน๊ตบุ๊ค Acer Aspire 3 AMD ATHLON silver 3050U/4/256';
 assert.equal(parseNotebookVerification(cpu).gpu,null);
 assert.ok(!parseNotebookVerification(cpu).issues.includes('RTX3050_VRAM_MISSING'));
 const bucket=analyzeNotebookCoverage([rec('athlon',cpu)]).buckets.find(x=>x.count===1);
 assert.equal(bucket?.gpu,'INTEGRATED_OR_UNKNOWN');
 assert.equal(bucket?.kind,'GENERAL');
});
