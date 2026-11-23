import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source=readFileSync(new URL('../supabase/functions/seo-connector/releaseComparison.ts',import.meta.url),'utf8')
const script=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText
const {buildGscReleaseComparison,parseGscAggregate,compareVisibleGsc,sameCanonicalGscPage}=
  await import('data:text/javascript;base64,'+Buffer.from(script).toString('base64'))
const page='https://amphon.co.th/services/notebook'
const scope={
  site_id:'amphon',level:'PRODUCTION_EVIDENCE_COMPLETE',
  verified_release_at:'2026-11-15T03:00:00Z',
  confirmed_affected_urls:[page],latest_sha:'a'.repeat(40),
}
const options={site_id:'amphon',days:7,page}
const now=new Date('2026-11-29T09:00:00Z')
const metrics=(clicks,impressions,position)=>({
  rows:[{clicks,impressions,position,ctr:impressions?clicks/impressions:0}],
})

test('GSC comparison uses Google Pacific release calendar and excludes release date',()=>{
  const plan=buildGscReleaseComparison(scope,'https://amphon.co.th',options,now)
  // 03:00 UTC on Nov 15 is Nov 14 in Los Angeles.
  assert.equal(plan.release_gsc_day,'2026-11-14')
  assert.equal(plan.before.startDate,'2026-11-07')
  assert.equal(plan.before.endDate,'2026-11-13')
  assert.equal(plan.after.startDate,'2026-11-15')
  assert.equal(plan.after.endDate,'2026-11-21')
  assert.equal(plan.first_final_date,'2026-11-24')
  assert.deepEqual(plan.before.dimensions,[])
  assert.equal(plan.before.aggregationType,'auto')
  assert.equal(plan.before.dataState,'final')
  assert.deepEqual(plan.before.dimensionFilterGroups[0].filters,[
    {dimension:'page',operator:'equals',expression:page},
  ])
  assert.equal(plan.before.rowLimit,1)
})

test('identical page, query, country and device filters in both date windows',()=>{
  const plan=buildGscReleaseComparison(scope,'https://amphon.co.th',{
    ...options,days:14,query:'รับซื้อโน๊ตบุ๊ค',country:'tha',device:'MOBILE',
  },new Date('2026-12-05T15:00:00Z'))
  assert.deepEqual(plan.before.dimensionFilterGroups,plan.after.dimensionFilterGroups)
  assert.deepEqual(plan.before.dimensionFilterGroups[0].filters.map(x=>x.dimension),
    ['page','query','country','device'])
  assert.equal(plan.after.endDate,'2026-11-28')
  assert.equal(plan.query,'รับซื้อโน๊ตบุ๊ค')
})

test('fail-closed for unverified deployment, foreign or unapproved URLs',()=>{
  for(const gate of [
    {...scope,level:'PROVIDER_DEPLOY_ONLY'},
    {...scope,confirmed_affected_urls:[]},
    {...scope,site_id:'iphone'},
    {...scope,verified_release_at:null},
  ]) assert.throws(()=>buildGscReleaseComparison(
    gate,'https://amphon.co.th',options,now),/SEO_RELEASE_COMPARE/)
  for(const p of [
    'https://evil.test/a','https://amphon.co.th.evil.test/a',
    'http://amphon.co.th/services/notebook',
    'https://amphon.co.th/services/notebook?x=1',
    'https://user@amphon.co.th/services/notebook',
  ]) assert.throws(()=>buildGscReleaseComparison(
    {...scope,confirmed_affected_urls:[p]},'https://amphon.co.th',
    {...options,page:p},now),/PAGE_NOT_IN_VERIFIED_RELEASE_SCOPE/)
})
test('Thai URL canonical encoding is idempotent and cannot bypass verified affected-page scope',()=>{
 const raw='https://amphon.co.th/บริการ/รับซื้อโน๊ตบุ๊ค'
 const encoded=new URL(raw).href
 assert.equal(sameCanonicalGscPage(raw,encoded),true)
 assert.equal(sameCanonicalGscPage(raw,'https://evil.test/บริการ/รับซื้อโน๊ตบุ๊ค'),false)
 assert.equal(sameCanonicalGscPage(raw,raw+'?secret=1'),false)
 for(const [input,allowed] of [[raw,encoded],[encoded,raw]]) {
   const plan=buildGscReleaseComparison(
     {...scope,confirmed_affected_urls:[allowed]},
     'https://amphon.co.th',{...options,page:input},now)
   assert.equal(plan.page,encoded)
   assert.equal(plan.before.dimensionFilterGroups[0].filters[0].expression,encoded)
   assert.equal(plan.after.dimensionFilterGroups[0].filters[0].expression,encoded)
 }
 assert.throws(()=>buildGscReleaseComparison(
   {...scope,confirmed_affected_urls:['https://amphon.co.th/บริการ/รับซื้อคอมพิวเตอร์']},
   'https://amphon.co.th',{...options,page:raw},now),/PAGE_NOT_IN_VERIFIED_RELEASE_SCOPE/)
})
test('future Google-final dates and >480-day baseline are rejected before API calls',()=>{
  assert.throws(()=>buildGscReleaseComparison(
    scope,'https://amphon.co.th',options,new Date('2026-11-23T09:00:00Z')),
  /AFTER_WINDOW_NOT_GOOGLE_FINAL/)
  assert.throws(()=>buildGscReleaseComparison(
    {...scope,verified_release_at:'2024-01-01T00:00:00Z'},
    'https://amphon.co.th',options,now),/GSC_HISTORY_EXPIRED/)
})
test('reject malformed query, country, device and window before Google fetch',()=>{
  for(const extra of [
    {days:90},{country:'TH'},{device:'SMARTPHONE'},{query:' '},
    {query:' query '},
  ]) assert.throws(()=>buildGscReleaseComparison(
    scope,'https://amphon.co.th',{...options,...extra},now),
  /SEO_RELEASE_COMPARE/)
})
test('strict aggregate GSC parsing prevents bogus rank and missing-row assumptions',()=>{
  assert.equal(parseGscAggregate({rows:[]}),null)
  assert.equal(parseGscAggregate({}),null)
  assert.deepEqual(parseGscAggregate(metrics(12,120,9.5)),{
    clicks:12,impressions:120,ctr:0.1,position:9.5,
  })
  assert.deepEqual(parseGscAggregate(metrics(0,0,0)),{
    clicks:0,impressions:0,ctr:0,position:null,
  })
  for(const value of [
    {rows:'invalid'},{rows:[{clicks:-1,impressions:5,ctr:0.1,position:3}]},
    {rows:[{clicks:4,impressions:3,ctr:1.1,position:3}]},
    {rows:[{clicks:3,impressions:40,ctr:0.5,position:'2.0'}]},
    {rows:[{clicks:3,impressions:40,ctr:0.05,position:3},
      {clicks:4,impressions:40,ctr:0.1,position:2}]},
  ]) assert.throws(()=>parseGscAggregate(value),/SEO_RELEASE_COMPARE/)
})
test('numeric deltas are descriptive, average position is never live SERP',()=>{
  const plan=buildGscReleaseComparison(scope,'https://amphon.co.th',options,now)
  const result=compareVisibleGsc(plan,
    parseGscAggregate(metrics(10,100,12)),
    parseGscAggregate(metrics(20,200,7)),
  )
  assert.equal(result.status,'VISIBLE_GSC_COMPARISON')
  assert.equal(result.changes.clicks,10)
  assert.equal(result.changes.clicks_pct,100)
  assert.equal(result.changes.impressions_pct,100)
  assert.equal(result.changes.average_position_improvement,5)
  assert.equal(result.live_serp_position,false)
  assert.equal(result.causal_impact_proven,false)
  assert.equal(result.full_data_coverage_confirmed,false)
  assert.equal(result.automatic_release_approval,false)
})
test('empty or zero impressions do not turn into rank zero or claim an increase',()=>{
  const plan=buildGscReleaseComparison(scope,'https://amphon.co.th',options,now)
  for(const pair of [
    [parseGscAggregate(metrics(0,0,0)),parseGscAggregate(metrics(5,40,9))],
    [null,parseGscAggregate(metrics(5,40,9))],
    [parseGscAggregate(metrics(5,40,9)),null],
  ]){
    const r=compareVisibleGsc(plan,...pair)
    assert.equal(r.status,'INSUFFICIENT_VISIBLE_DATA')
    assert.equal(r.changes,null)
    assert.equal(r.causal_impact_proven,false)
  }
})
test('P6 must not add a GSC or release write to either authenticated API path',()=>{
  const mcp=readFileSync(new URL('../supabase/functions/seo-connector/index.ts',import.meta.url),'utf8')
  assert.match(mcp,/if\(name==='seo_release_compare'\)/)
  assert.match(mcp,/compareVisibleGsc\(plan,before,after\)/)
  const edge=readFileSync(new URL('../supabase/functions/seo-gsc/index.ts',import.meta.url),'utf8')
  assert.match(edge,/body.action==='release_compare'/)
  assert.match(edge,/compareVisibleGsc\(plan,before,after\)/)
  assert.match(edge,/buildGscReleaseComparison\(/)
  const tools=readFileSync(new URL('../supabase/functions/seo-connector/core.ts',import.meta.url),'utf8')
  assert.match(tools,/tool\('seo_release_compare'/)
})
