import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/aiBuyerNotebookCoverage.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('module','exports',js)(mod,mod.exports);
const {isNotebookCostRecord,analyzeNotebookCoverage}=mod.exports;
const item=(key,name,category='',cost=5000,type='PURCHASE')=>({
 source_kind:'INVENTORY',source_key:key,inventory_code:key,product_name:name,category,
 source_type:type,source_status:'SOLD',buy_cost:cost,actual_sale:null,actual_profit:null,
 quantity:1,occurred_at:'2026-10-01',details:{}});
test('include historical MacBook even when legacy category notebook',()=>{
 const a=item('mac','MacBook Air M1/8/256','โน๊ตบุ๊ค',7500);
 assert.equal(isNotebookCostRecord(a),true);
 assert.ok(analyzeNotebookCoverage([a]).buckets.some(x=>x.kind==='MACBOOK'&&x.count===1));
});
test('include unclassified HP/ASUS office notebooks but keep PC and GPU excluded',()=>{
 const a=item('hp','HP i3Gen10 /8/256 15.6"','');
 const b=item('asus','Asus i3gen11/8/512','');
 const c=item('pc','PC i5-10400/1650/16/256/500','');
 const d=item('gpu','RTX 5060Ti','การ์ดจอ');
 assert.equal(isNotebookCostRecord(a),true);assert.equal(isNotebookCostRecord(b),true);
 assert.equal(isNotebookCostRecord(c),false);assert.equal(isNotebookCostRecord(d),false);
});
test('Intel generation parsing distinguishes 9th from 10th/13th',()=>{
 const rows=[item('g9','Lenovo Legion i5-9300H/GTX1050/8/256','โน๊ตบุ๊ค'),
 item('g10','Asus Tuf F15 i5-10300H/GTX1650/8/512','โน๊ตบุ๊ค'),
 item('g13','Lenovo LOQ 15IRX9 i5-13450HX/RTX3050 6GB/16/512','โน๊ตบุ๊ค')];
 const b=analyzeNotebookCoverage(rows).buckets.filter(x=>x.count>0);
 assert.ok(b.some(x=>x.cpu==='i5 Gen 9'&&x.gpu==='GTX1050'));
 assert.ok(b.some(x=>x.cpu==='i5 Gen 10'&&x.gpu==='GTX1650'));
 assert.ok(b.some(x=>x.cpu==='i5 Gen 13'&&x.gpu==='RTX3050_6GB'));
});
test('GTX1050 and GTX1050 Ti are kept in separate buckets',()=>{
 const b=analyzeNotebookCoverage([
 item('a','Acer Nitro i5-8300H GTX1050 8/512','โน๊ตบุ๊ค'),
 item('b','Asus TUF i5-8300H GTX1050Ti 8/512','โน๊ตบุ๊ค')]).buckets.filter(x=>x.count>0);
 assert.equal(b.length,2);assert.notEqual(b[0].gpu,b[1].gpu);
});
test('missing CPU is review; no artificial price generated',()=>{
 const b=analyzeNotebookCoverage([item('a','ASUS TUF RTX5070','')]).buckets.filter(x=>x.count>0);
 assert.equal(b.length,1);assert.equal(b[0].kind,'REVIEW');
 assert.equal('openingOffer' in b[0],false);
});
test('dedupe inventory and count independent sales, skip damage and forfeits in buy median',()=>{
 const a=item('a','ASUS TUF i5gen10/GTX1650/8/512','โน๊ตบุ๊ค',7000);
 const b=item('b','ASUS TUF i5gen10/GTX1650/8/512 เสีย','โน๊ตบุ๊ค',1000);
 const c=item('c','ASUS TUF i5gen10/GTX1650/8/512','โน๊ตบุ๊ค',4000,'FORFEIT');
 const sale={...a,source_kind:'SALE',source_key:'s1',inventory_code:'a'};
 const r=analyzeNotebookCoverage([a,a,b,c,sale]);
 assert.equal(r.inventory,3);assert.equal(r.forfeit,1);
 assert.equal(r.buckets.find(x=>x.count>0)?.medianBuy,7000);assert.equal(r.buckets.find(x=>x.count>0)?.sold,1);
});
test('Windows Business and Ryzen office notebooks are included',()=>{
 const out=analyzeNotebookCoverage([
  item('dell','Dell Latitude 7440 i5-1345U 16/512','โน๊ตบุ๊ค'),
  item('lenovo','Lenovo V15 Ryzen5 5500U/8/256','โน๊ตบุ๊ค')
 ]).buckets.filter(x=>x.count>0);
 assert.ok(out.some(x=>x.kind==='BUSINESS'));
 assert.ok(out.some(x=>x.kind==='GENERAL'&&x.cpu.includes('Ryzen 5')));
});

test('explicit price taxonomy includes no-history generations without making up buy prices',()=>{
 const r=analyzeNotebookCoverage([]);
 assert.ok(r.buckets.some(x=>x.cpu==='i3 Gen 7'&&x.count===0&&x.medianBuy===null));
 assert.ok(r.buckets.some(x=>x.cpu==='Ryzen 7 8000 Series'&&x.count===0&&x.medianBuy===null));
 assert.ok(r.buckets.some(x=>x.gpu==='RTX5060'&&x.count===0));
 assert.ok(r.buckets.some(x=>x.cpu==='Apple M5'&&x.count===0));
 assert.equal(r.inventory,0);
});

test('RTX3050 4GB, 6GB and unknown VRAM are never combined',()=>{
 const r=analyzeNotebookCoverage([
 item('a','Acer Nitro i5-12500H/RTX3050 4GB/16/512','โน๊ตบุ๊ค'),
 item('b','Lenovo LOQ i5-13450HX/RTX3050 6GB/16/512','โน๊ตบุ๊ค'),
 item('c','ASUS TUF i5-11400H/RTX3050/16/512','โน๊ตบุ๊ค')]);
 const gp=new Set(r.buckets.filter(x=>x.count>0).map(x=>x.gpu));
 assert.ok(gp.has('RTX3050_4GB'));assert.ok(gp.has('RTX3050_6GB'));assert.ok(gp.has('RTX3050_UNSPEC'));
});
