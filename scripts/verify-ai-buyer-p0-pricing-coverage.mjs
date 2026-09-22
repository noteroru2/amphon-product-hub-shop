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

const deterministic=fixture.alreadyPricedCount+previews.length
if(deterministic!==fixture.expectedDeterministicPriceCoverage){
  failures.push({error:'DETERMINISTIC_COVERAGE_MISMATCH',expected:fixture.expectedDeterministicPriceCoverage,actual:deterministic})
}
if(fixture.directPriceBookCases.length+fixture.guardedFallbackCases.length!==14){
  failures.push({error:'P0_CASE_COUNT_MISMATCH'})
}

console.log(JSON.stringify({
  activePriceBook:active.version_name,
  directPriceBookCoverage:previews.length,
  alreadyPriced:fixture.alreadyPricedCount,
  deterministicCoverage:deterministic,
  totalEvidenceReady:fixture.totalEvidenceReady,
  guardedFallback:fixture.guardedFallbackCases,
  previews,
  failures
},null,2))
if(failures.length) process.exit(1)
console.log('AI BUYER P0 PRICING COVERAGE: PASS')
