import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/aiBuyerChatPriceControl.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function('module','exports',js)(mod,mod.exports);
const {parseChatPriceProposal,prepareChatPriceDiff}=mod.exports;
const before={id:'e-123',draft_id:'d',category:'NOTEBOOK',brand:'Lenovo',model:'LOQ 15IRX9 i5-13450HX RTX3050 16/512',model_code:'15IRX9',condition_key:'NORMAL',estimated_resale:18000,opening_offer:10000,target_buy:11000,hard_max:12000,active:true,note:'prior',aliases:[],spec_match:{},adjustments:{},updated_at:'2026-11-03T12:00:00Z'};
test('chat JSON parses inside fenced block and preview shows unchanged and changed values',()=>{
 const p=parseChatPriceProposal('```json\n'+JSON.stringify({version:1,items:[{model:before.model,target_buy:11500,hard_max:12500}]})+'\n```');
 const result=prepareChatPriceDiff(p,[before]);assert.equal(result[0].before.target_buy,11000);
 assert.equal(result[0].after.target_buy,11500);assert.equal(result[0].after.opening_offer,10000);
 assert.equal(result[0].after.active,false);assert.equal(result[0].after.expected_updated_at,before.updated_at);
 assert.equal(result[0].after.expected_entry_id,before.id);
});
test('ambiguous same-name variants must specify specs',()=>{
 const another={...before,id:'e-234',model_code:'15IRX8'};
 const proposal=parseChatPriceProposal(JSON.stringify({version:1,items:[{model:before.model,target_buy:11500}]}));
 assert.throws(()=>prepareChatPriceDiff(proposal,[before,another]),/หลายสเปก/);
});
test('reject model-only new item without category brand and all prices',()=>{
 const proposal=parseChatPriceProposal(JSON.stringify({version:1,items:[{model:'Unknown product',target_buy:5000}]}));
 assert.throws(()=>prepareChatPriceDiff(proposal,[]),/category และ brand/);
});
test('reject inconsistent price ordering',()=>{
 const proposal=parseChatPriceProposal(JSON.stringify({version:1,items:[{model:before.model,hard_max:10500}]}));
 assert.throws(()=>prepareChatPriceDiff(proposal,[before]),/ลำดับราคาผิด/);
});
test('reject unexpected payload keys including active publish controls',()=>{
 assert.throws(()=>parseChatPriceProposal(JSON.stringify({version:1,items:[{model:before.model,active:true,target_buy:12000}]})),/ไม่อนุญาต/);
});
test('reject numeric strings, NaN, overflow and multi-items >20',()=>{
 assert.throws(()=>parseChatPriceProposal(JSON.stringify({version:1,items:[{model:before.model,target_buy:'15000'}]})),/ไม่ถูกต้อง/);
 assert.throws(()=>parseChatPriceProposal(JSON.stringify({version:1,items:Array(21).fill({model:before.model,target_buy:10000})})),/1–20/);
});
test('refuse duplicated identity and no-op',()=>{
 const prop=parseChatPriceProposal(JSON.stringify({version:1,items:[{model:before.model,target_buy:11500},{model:before.model,hard_max:12600}]}));
 assert.throws(()=>prepareChatPriceDiff(prop,[before]),/ซ้ำ/);
 const noop=parseChatPriceProposal(JSON.stringify({version:1,items:[{model:before.model,target_buy:11000}]}));
 assert.throws(()=>prepareChatPriceDiff(noop,[before]),/ไม่มีราคาเปลี่ยนแปลง/);
});
test('new entry must be inactive and fully specified',()=>{
 const prop=parseChatPriceProposal(JSON.stringify({version:1,items:[{category:'NOTEBOOK',brand:'ASUS',model:'Vivobook new',estimated_resale:12000,opening_offer:5000,target_buy:6000,hard_max:7000}]}));
 const result=prepareChatPriceDiff(prop,[]);assert.equal(result[0].after.active,false);assert.equal(result[0].after.expected_entry_id,null);
});
