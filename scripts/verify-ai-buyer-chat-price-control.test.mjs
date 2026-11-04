import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const input=fs.readFileSync(new URL('../src/lib/aiBuyerChatPriceControl.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const instance={exports:{}};
new Function('require','module','exports',transpiled)(()=>({supabase:null}),instance,instance.exports);
const {validateChatPriceValues,chatPriceDiff,chatPriceIsStale}=instance.exports;
const original={
 id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',draft_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
 category:'NOTEBOOK',brand:'Lenovo',model:'LOQ i5 RTX3050 16/512',model_code:'15IRX9',
 condition_key:'NORMAL',estimated_resale:16000,opening_offer:10000,target_buy:11000,hard_max:12000,
 active:true,note:'existing owner price',aliases:['LOQ'],spec_match:{ram_gb:16,ssd_gb:512},
 adjustments:{battery:0},created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-04T01:00:00Z'
};
const proposed={estimated_resale:17000,opening_offer:10500,target_buy:11500,hard_max:12500};
const proposal={
 id:'cccccccc-cccc-cccc-cccc-cccccccccccc',entry_id:original.id,draft_id:original.draft_id,
 before_snapshot:original,proposed_prices:proposed,expected_entry_updated_at:original.updated_at
};
test('well-ordered numbers validate and produce exactly four diff rows',()=>{
 assert.equal(validateChatPriceValues(proposed),null);
 const diff=chatPriceDiff(proposal);assert.equal(diff.length,4);
 assert.deepEqual(diff.map(x=>x.delta),[1000,500,500,500]);
});
test('negative, NaN, infinite, inverted prices fail closed',()=>{
 for(const v of [
  {...proposed,opening_offer:-1},{...proposed,target_buy:13000},
  {...proposed,hard_max:18000},{...proposed,estimated_resale:Infinity},
  {...proposed,estimated_resale:NaN},
 ]){
  assert.notEqual(validateChatPriceValues(v),null);
 }
});
test('unchanged full entry is not stale regardless of JSON property order',()=>{
 const reverse=Object.fromEntries(Object.entries(original).reverse());
 assert.equal(chatPriceIsStale(proposal,reverse),false);
});
test('any intervening spec/name/price/status/time edit becomes stale',()=>{
 for(const changed of [
  {...original,target_buy:11500},{...original,updated_at:'2026-11-04T01:01:00Z'},
  {...original,model_code:'15IRX8'},
  {...original,active:false},
  {...original,spec_match:{ram_gb:32,ssd_gb:512}},
  {...original,aliases:['DIFFERENT']},
  {...original,draft_id:'another'},
 ]){
  assert.equal(chatPriceIsStale(proposal,changed),true);
 }
 assert.equal(chatPriceIsStale(proposal,null),true);
});
test('SQL approval must require owner JWT, exact snapshot, and write only draft, not active pricebook',()=>{
 const sql=fs.readFileSync(new URL('../supabase/ai_buyer_chat_price_control.sql',import.meta.url),'utf8');
 assert.match(sql,/p\.role='owner'/);
 assert.match(sql,/CHAT_PRICE_STALE_BASELINE/);
 assert.match(sql,/status='DRAFT'/);
 assert.match(sql,/after_entry.*chat_price_proposal_id/s);
 assert.match(sql,/ai_buyer_pb28_audit/);
 assert.match(sql,/revoke all on function public\.ai_buyer_chat_price_enqueue/u);
 assert.doesNotMatch(sql,/update public\.ai_buyer_price_book_entries/u);
 assert.doesNotMatch(sql,/update public\.ai_buyer_price_book_versions/u);
});
