const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
function load(name, overrides={}, cache={}){
 if(overrides[name])return overrides[name]
 if(cache[name])return cache[name].exports
 const p=path.join(__dirname,'../src',name+'.ts')
 const mod={exports:{}};cache[name]=mod
 const js=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('require','module','exports',js)(id=>load(id.replace('./',''),overrides,cache),mod,mod.exports)
 return mod.exports
}
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test',OPENAI_API_KEY:'test'}
const fixture={offer:10000,hardMax:12000,confidence:.95,offerDecision:'decision1',decision:'decision1',version:'v1',activeVersion:'v1'}
async function scenario(settings){
 const data={...fixture,...settings};const writes=[];const previous=global.fetch
 global.fetch=async(url,init={})=>{
  const route=String(url)
  const method=init.method??'GET'
  if(method!=='GET'){writes.push({route,method});throw new Error('UNEXPECTED_WRITE_BEFORE_APPROVAL')}
  if(route.includes('ai_buyer_valuation_cases?'))return Response.json([{id:'case1',conversation_id:'conversation1',category:'NOTEBOOK',state:'PRICING',metadata:{}}])
  if(route.includes('ai_buyer_category_automation_modes?'))return Response.json([{category:'NOTEBOOK',mode:'APPROVAL',max_negotiation_rounds:4,active:true}])
  if(route.includes('ai_buyer_offers?'))return Response.json([{id:'offer1',case_id:'case1',pricing_decision_id:data.offerDecision,amount:data.offer,actor:'AI',status:'PROPOSED',round_no:0,delivered_at:null}])
  if(route.includes('ai_buyer_pricing_decisions?'))return Response.json([{id:data.decision,case_id:'case1',opening_offer:9000,target_buy:11000,hard_max:data.hardMax,current_authorized_offer:data.offer,pricing_confidence:data.confidence,estimated_resale:17000,price_source:'PRICE_BOOK',price_book_version_id:data.version,created_at:new Date().toISOString()}])
  if(route.includes('ai_buyer_price_book_versions?'))return Response.json(data.activeVersion?[{id:data.activeVersion}]:[])
  throw new Error('UNEXPECTED_READ:'+route)
 }
 try {
  const negotiation=load('negotiation-engine',{'pricing-engine':{createGuardedOffer:async()=>{throw new Error('NOT_CALLED')}}})
  const answer=await negotiation.approvePreparedOffer(env,'case1','offer1')
  return {answer,writes}
 }finally{global.fetch=previous}
}
test('approval cannot prepare outbound above hard max',async()=>{const x=await scenario({offer:15000});assert.equal(x.answer.reason,'HARD_MAX_EXCEEDED');assert.deepEqual(x.writes,[])})
test('approval cannot prepare outbound for old decision',async()=>{const x=await scenario({offerDecision:'old'});assert.equal(x.answer.reason,'STALE_OFFER_DECISION');assert.deepEqual(x.writes,[])})
test('approval cannot prepare outbound for archived pricebook',async()=>{const x=await scenario({activeVersion:'v2'});assert.equal(x.answer.reason,'STALE_OR_UNPUBLISHED_PRICEBOOK');assert.deepEqual(x.writes,[])})
test('approval cannot prepare outbound when active version absent',async()=>{const x=await scenario({activeVersion:null});assert.equal(x.answer.reason,'STALE_OR_UNPUBLISHED_PRICEBOOK');assert.deepEqual(x.writes,[])})
test('approval cannot prepare outbound on low confidence',async()=>{const x=await scenario({confidence:.5});assert.equal(x.answer.reason,'DECISION_CONFIDENCE_LOW');assert.deepEqual(x.writes,[])})
