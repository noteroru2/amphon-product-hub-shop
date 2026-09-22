import fs from 'node:fs'

const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'')
const key=process.env.SUPABASE_SECRET_KEY||''
if(!url||!key) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY required')

const wrangler=fs.readFileSync('workers/ai-buyer/wrangler.jsonc','utf8')
if(!wrangler.includes('"AI_BUYER_PAUSED": "true"')) throw new Error('AI Buyer must remain paused')

const fixture=JSON.parse(fs.readFileSync('workers/ai-buyer/data/p0-pricing-coverage-fixtures-v1.json','utf8'))
const headers={apikey:key,authorization:'Bearer '+key,accept:'application/json'}

async function get(path){
  const r=await fetch(url+'/rest/v1/'+path,{headers})
  const raw=await r.text()
  if(!r.ok) throw new Error('SUPABASE_'+r.status+':'+raw.slice(0,1000))
  return raw?JSON.parse(raw):[]
}

const versions=await get('ai_buyer_price_book_versions?status=eq.ACTIVE&select=id,version_name&limit=1')
const active=versions[0]
if(!active||active.version_name!==fixture.expectedActivePriceBook){
  throw new Error('Unexpected active price book: '+JSON.stringify(active))
}

const entries=await get('ai_buyer_price_book_entries?version_id=eq.'+encodeURIComponent(active.id)
  +'&active=eq.true&select=id,category,model,model_code,aliases,spec_match,opening_offer,target_buy,hard_max,adjustments')
const rules=await get('ai_buyer_category_pricing_rules?active=eq.true&select=category,adjustments')
const ruleByCategory=new Map(rules.map(x=>[x.category,x]))

const ids=fixture.directPriceBookCases.map(x=>x.caseId).join(',')
const cases=await get('ai_buyer_valuation_cases?id=in.('+ids+')&select=id,category,title,metadata')
const observations=await get('ai_buyer_product_observations?case_id=in.('+ids+')&select=case_id,confirmed,model_name,model_code,created_at&order=created_at.desc')
const latest=new Map()
for(const o of observations) if(!latest.has(o.case_id)) latest.set(o.case_id,o)
const caseById=new Map(cases.map(x=>[x.id,x]))

function tagsFor(c,o){
  const tags=Array.isArray(c?.metadata?.lastPricingTags)?[...c.metadata.lastPricingTags]:[]
  const text=JSON.stringify({confirmed:o?.confirmed||{},flags:c?.metadata?.lastFlags||[]})
  if(/back.?panel.*replaced|BACK_PANEL_REPLACED|ฝาหลัง.*เปลี่ยน/i.test(text) && !tags.includes('BACK_PANEL_REPLACED')){
    tags.push('BACK_PANEL_REPLACED')
  }
  return [...new Set(tags)]
}

const failures=[]
const previews=[]
const specPreviews=[]
const staleSafety=[]
for(const f of fixture.directPriceBookCases){
  const c=caseById.get(f.caseId)
  const o=latest.get(f.caseId)
  if(!c||!o){ failures.push({caseId:f.caseId,error:'CASE_OR_OBSERVATION_MISSING'}); continue }
  const matches=entries.filter(e=>e.category===c.category
    && e.model===f.entryModel
    && (!f.entryModelCode || e.model_code===f.entryModelCode))
  if(matches.length!==1){ failures.push({caseId:f.caseId,error:'ENTRY_MATCH_COUNT',count:matches.length,entryModel:f.entryModel,entryModelCode:f.entryModelCode||null}); continue }
  const e=matches[0]

  const confirmedText=JSON.stringify(o.confirmed||{}).toLowerCase().replace(/[^a-z0-9ก-๙]+/g,'')
  for(const expected of Object.values(e.spec_match||{})){
    const needle=String(expected).toLowerCase().replace(/[^a-z0-9ก-๙]+/g,'')
    if(needle && !confirmedText.includes(needle)){
      failures.push({caseId:f.caseId,error:'SPEC_GUARD_NOT_SATISFIED',needle,entryModel:f.entryModel})
    }
  }

  const tags=tagsFor(c,o)
  if(f.requiredTag && !tags.includes(f.requiredTag)) failures.push({caseId:f.caseId,error:'REQUIRED_TAG_MISSING',tag:f.requiredTag})
  if(f.derivedTag && !tags.includes(f.derivedTag)) failures.push({caseId:f.caseId,error:'DERIVED_TAG_MISSING',tag:f.derivedTag})

  let delta=0
  const applied=[]
  const rule=ruleByCategory.get(c.category)
  for(const tag of tags){
    for(const source of [e.adjustments||{},rule?.adjustments||{}]){
      const n=Number(source?.[tag])
      if(Number.isFinite(n) && n!==0){ delta+=n; applied.push({tag,amount:n}) }
    }
  }
  const preview={
    opening:Math.max(0,Math.round(Number(e.opening_offer)+delta)),
    target:Math.max(0,Math.round(Number(e.target_buy)+delta)),
    hardMax:Math.max(0,Math.round(Number(e.hard_max)+delta))
  }
  previews.push({caseId:f.caseId,title:c.title,entry:e.model,tags,delta,preview})
  for(const k of ['opening','target','hardMax']){
    if(preview[k]!==f.expected[k]) failures.push({caseId:f.caseId,error:'PRICE_PREVIEW_MISMATCH',field:k,expected:f.expected[k],actual:preview[k]})
  }
}


const specIds=(fixture.specPricingPreviews||[]).map(x=>x.caseId).join(',')
if(specIds){
  const specCases=await get('ai_buyer_valuation_cases?id=in.('+specIds+')&select=id,category,title,state,metadata')
  const specDecisions=await get('ai_buyer_pricing_decisions?case_id=in.('+specIds+')&select=id,case_id,price_book_version_id,estimated_resale,created_at&order=created_at.desc')
  const specSettings=await get('ai_buyer_spec_price_settings?version_id=eq.'+encodeURIComponent(active.id)
    +'&select=category,target_buy_percent,hard_max_percent,opening_discount_percent,risk_reserve,rounding_step')
  const settingByCategory=new Map(specSettings.map(x=>[x.category,x]))
  const latestDecision=new Map()
  for(const d of specDecisions) if(!latestDecision.has(d.case_id)) latestDecision.set(d.case_id,d)
  const caseMap=new Map(specCases.map(x=>[x.id,x]))

  const roundTo=(value,step)=>Math.max(0,Math.round(value/Math.max(1,Number(step||100)))*Math.max(1,Number(step||100)))

  for(const f of fixture.specPricingPreviews||[]){
    const cse=caseMap.get(f.caseId)
    const setting=settingByCategory.get(f.category)
    if(!cse||!setting){ failures.push({caseId:f.caseId,error:'SPEC_CASE_OR_SETTING_MISSING'}); continue }
    const target=roundTo(Number(f.estimatedResale)*Number(setting.target_buy_percent)-Number(setting.risk_reserve),setting.rounding_step)
    const hardMax=roundTo(Number(f.estimatedResale)*Number(setting.hard_max_percent)-Number(setting.risk_reserve),setting.rounding_step)
    const opening=roundTo(target*(1-Number(setting.opening_discount_percent)),setting.rounding_step)
    const preview={opening,target,hardMax}
    specPreviews.push({caseId:f.caseId,title:cse.title,category:f.category,estimatedResale:f.estimatedResale,preview})
    for(const k of ['opening','target','hardMax']){
      if(preview[k]!==f.expected[k]) failures.push({caseId:f.caseId,error:'SPEC_PRICE_PREVIEW_MISMATCH',field:k,expected:f.expected[k],actual:preview[k]})
    }
  }

  const offers=await get('ai_buyer_offers?case_id=in.('+specIds+')&select=id,case_id,pricing_decision_id,status,delivered_at,created_at&order=created_at.desc')
  for(const s of fixture.staleDecisionSafety||[]){
    const cse=caseMap.get(s.caseId)
    const latest=latestDecision.get(s.caseId)
    const related=offers.filter(o=>o.case_id===s.caseId && latest && o.pricing_decision_id===latest.id)
    const delivered=related.filter(o=>o.delivered_at)
    const superseded=related.filter(o=>o.status==='SUPERSEDED')
    const row={caseId:s.caseId,state:cse?.state||null,latestDecisionVersion:latest?.price_book_version_id||null,activeVersion:active.id,delivered:delivered.length,superseded:superseded.length}
    staleSafety.push(row)
    if(!cse||cse.state!==s.expectedState) failures.push({caseId:s.caseId,error:'STALE_CASE_STATE_UNSAFE',expected:s.expectedState,actual:cse?.state||null})
    if(!latest||latest.price_book_version_id===active.id) failures.push({caseId:s.caseId,error:'EXPECTED_STALE_DECISION_NOT_FOUND'})
    if(delivered.length>0) failures.push({caseId:s.caseId,error:'STALE_OFFER_WAS_DELIVERED',count:delivered.length})
    if(related.length>0 && superseded.length!==related.length) failures.push({caseId:s.caseId,error:'STALE_OFFER_NOT_SUPERSEDED',related:related.length,superseded:superseded.length})
  }
}

const deterministic=fixture.alreadyPricedCount+previews.length
if(deterministic!==fixture.expectedDeterministicPriceCoverage){
  failures.push({error:'DETERMINISTIC_COVERAGE_MISMATCH',expected:fixture.expectedDeterministicPriceCoverage,actual:deterministic})
}
const coverageCaseCount=fixture.directPriceBookCases.length+fixture.guardedFallbackCases.length
if(coverageCaseCount!==Number(fixture.coverageCaseCountExpected)){
  failures.push({error:'P0_CASE_COUNT_MISMATCH',expected:fixture.coverageCaseCountExpected,actual:coverageCaseCount})
}

console.log(JSON.stringify({
  activePriceBook:active.version_name,
  directPriceBookCoverage:previews.length,
  alreadyPriced:fixture.alreadyPricedCount,
  deterministicCoverage:deterministic,
  totalEvidenceReady:fixture.totalEvidenceReady,
  guardedFallback:fixture.guardedFallbackCases,
  previews,
  specPreviews,
  staleSafety,
  failures
},null,2))
if(failures.length) process.exit(1)
console.log('AI BUYER P0 PRICING COVERAGE: PASS')
